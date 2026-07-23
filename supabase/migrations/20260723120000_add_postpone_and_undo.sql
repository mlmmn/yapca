-- Generalize watering journal events and make schedule changes use an
-- ownership-checked, row-locking RPC boundary.

alter table public.watering_events rename column watered_on to acted_on;

alter table public.watering_events
  drop constraint watering_events_event_type_check,
  add constraint watering_events_event_type_check check (event_type in ('watered', 'postponed'));

drop function if exists public.mark_watered(uuid, date);

revoke insert, delete on public.watering_events from authenticated;
drop policy if exists "watering_events_insert_own" on public.watering_events;
drop policy if exists "watering_events_delete_own" on public.watering_events;

create or replace function public.mark_watered(p_plant_id uuid, p_acted_on date)
returns table (
  event_id uuid,
  plant_id uuid,
  event_type text,
  acted_on date,
  prev_due_on date,
  new_due_on date
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_interval_days int;
  v_prev_due_on date;
  v_new_due_on date;
  v_event_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select p.interval_days, p.next_due_on
  into v_interval_days, v_prev_due_on
  from public.plants as p
  where p.id = p_plant_id and p.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Plant not found' using errcode = 'P0002';
  end if;

  v_new_due_on := p_acted_on + v_interval_days;

  update public.plants
  set next_due_on = v_new_due_on
  where id = p_plant_id and user_id = v_user_id;

  insert into public.watering_events (plant_id, user_id, event_type, acted_on, prev_due_on, new_due_on)
  values (p_plant_id, v_user_id, 'watered', p_acted_on, v_prev_due_on, v_new_due_on)
  returning id into v_event_id;

  return query select v_event_id, p_plant_id, 'watered'::text, p_acted_on, v_prev_due_on, v_new_due_on;
end;
$$;

create or replace function public.postpone_plant(p_plant_id uuid, p_acted_on date)
returns table (
  event_id uuid,
  plant_id uuid,
  event_type text,
  acted_on date,
  prev_due_on date,
  new_due_on date
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_prev_due_on date;
  v_new_due_on date;
  v_event_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select p.next_due_on
  into v_prev_due_on
  from public.plants as p
  where p.id = p_plant_id and p.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Plant not found' using errcode = 'P0002';
  end if;

  v_new_due_on := p_acted_on + 2;

  update public.plants
  set next_due_on = v_new_due_on
  where id = p_plant_id and user_id = v_user_id;

  insert into public.watering_events (plant_id, user_id, event_type, acted_on, prev_due_on, new_due_on)
  values (p_plant_id, v_user_id, 'postponed', p_acted_on, v_prev_due_on, v_new_due_on)
  returning id into v_event_id;

  return query select v_event_id, p_plant_id, 'postponed'::text, p_acted_on, v_prev_due_on, v_new_due_on;
end;
$$;

create or replace function public.undo_watering_event(p_event_id uuid)
returns table (
  event_id uuid,
  plant_id uuid,
  restored_due_on date
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_plant_id uuid;
  v_prev_due_on date;
  v_new_due_on date;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select e.plant_id, e.prev_due_on, e.new_due_on
  into v_plant_id, v_prev_due_on, v_new_due_on
  from public.watering_events as e
  where e.id = p_event_id and e.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  perform 1
  from public.plants as p
  where p.id = v_plant_id and p.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Plant not found' using errcode = 'P0002';
  end if;

  if (select p.next_due_on from public.plants as p where p.id = v_plant_id) <> v_new_due_on then
    raise exception 'Event is no longer current' using errcode = 'P0003';
  end if;

  update public.plants
  set next_due_on = v_prev_due_on
  where id = v_plant_id and user_id = v_user_id;

  delete from public.watering_events where id = p_event_id and user_id = v_user_id;

  return query select p_event_id, v_plant_id, v_prev_due_on;
end;
$$;

revoke all on function public.mark_watered(uuid, date) from public, anon, authenticated;
revoke all on function public.postpone_plant(uuid, date) from public, anon, authenticated;
revoke all on function public.undo_watering_event(uuid) from public, anon, authenticated;
grant execute on function public.mark_watered(uuid, date) to authenticated;
grant execute on function public.postpone_plant(uuid, date) to authenticated;
grant execute on function public.undo_watering_event(uuid) to authenticated;
