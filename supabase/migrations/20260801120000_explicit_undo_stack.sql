-- Store undo causality explicitly so it never depends on colliding due dates
-- or transaction timestamps.

alter table public.watering_events
  add column previous_event_id uuid references public.watering_events (id) deferrable initially deferred;

alter table public.plants
  add column current_watering_event_id uuid references public.watering_events (id) deferrable initially deferred;

with ordered_events as (
  select
    id,
    lag(id) over (partition by plant_id order by created_at, id) as previous_event_id
  from public.watering_events
)
update public.watering_events as event
set previous_event_id = ordered_events.previous_event_id
from ordered_events
where event.id = ordered_events.id;

with current_events as (
  select distinct on (plant_id) plant_id, id
  from public.watering_events
  order by plant_id, created_at desc, id desc
)
update public.plants as plant
set current_watering_event_id = current_events.id
from current_events
where plant.id = current_events.plant_id;

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
  v_growing_interval_days int;
  v_dormancy_interval_days int;
  v_interval_days int;
  v_prev_due_on date;
  v_new_due_on date;
  v_current_event_id uuid;
  v_event_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select p.growing_interval_days, p.dormancy_interval_days, p.next_due_on, p.current_watering_event_id
  into v_growing_interval_days, v_dormancy_interval_days, v_prev_due_on, v_current_event_id
  from public.plants as p
  where p.id = p_plant_id and p.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Plant not found' using errcode = 'P0002';
  end if;

  if p_acted_on between make_date(extract(year from p_acted_on)::int, 3, 1)
    and make_date(extract(year from p_acted_on)::int, 10, 31) then
    v_interval_days := v_growing_interval_days;
  else
    v_interval_days := v_dormancy_interval_days;
  end if;

  v_new_due_on := p_acted_on + v_interval_days;

  insert into public.watering_events (
    plant_id,
    user_id,
    event_type,
    acted_on,
    prev_due_on,
    new_due_on,
    previous_event_id
  )
  values (
    p_plant_id,
    v_user_id,
    'watered',
    p_acted_on,
    v_prev_due_on,
    v_new_due_on,
    v_current_event_id
  )
  returning id into v_event_id;

  update public.plants
  set next_due_on = v_new_due_on,
      current_watering_event_id = v_event_id
  where id = p_plant_id and user_id = v_user_id;

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
  v_current_event_id uuid;
  v_event_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select p.next_due_on, p.current_watering_event_id
  into v_prev_due_on, v_current_event_id
  from public.plants as p
  where p.id = p_plant_id and p.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Plant not found' using errcode = 'P0002';
  end if;

  v_new_due_on := p_acted_on + 2;

  insert into public.watering_events (
    plant_id,
    user_id,
    event_type,
    acted_on,
    prev_due_on,
    new_due_on,
    previous_event_id
  )
  values (
    p_plant_id,
    v_user_id,
    'postponed',
    p_acted_on,
    v_prev_due_on,
    v_new_due_on,
    v_current_event_id
  )
  returning id into v_event_id;

  update public.plants
  set next_due_on = v_new_due_on,
      current_watering_event_id = v_event_id
  where id = p_plant_id and user_id = v_user_id;

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
  v_plant_due_on date;
  v_current_event_id uuid;
  v_prev_due_on date;
  v_new_due_on date;
  v_previous_event_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select e.plant_id
  into v_plant_id
  from public.watering_events as e
  where e.id = p_event_id and e.user_id = v_user_id;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  select p.next_due_on, p.current_watering_event_id
  into v_plant_due_on, v_current_event_id
  from public.plants as p
  where p.id = v_plant_id and p.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Plant not found' using errcode = 'P0002';
  end if;

  select e.prev_due_on, e.new_due_on, e.previous_event_id
  into v_prev_due_on, v_new_due_on, v_previous_event_id
  from public.watering_events as e
  where e.id = p_event_id and e.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;

  if v_current_event_id is distinct from p_event_id then
    raise exception 'Only the most recent action can be undone' using errcode = 'P0003';
  end if;

  if v_plant_due_on <> v_new_due_on then
    raise exception 'This action is no longer aligned with the plant schedule' using errcode = 'P0004';
  end if;

  update public.plants
  set next_due_on = v_prev_due_on,
      current_watering_event_id = v_previous_event_id
  where id = v_plant_id and user_id = v_user_id;

  delete from public.watering_events
  where id = p_event_id and user_id = v_user_id;

  return query select p_event_id, v_plant_id, v_prev_due_on;
end;
$$;

revoke all on function public.mark_watered(uuid, date) from public, anon, authenticated;
revoke all on function public.postpone_plant(uuid, date) from public, anon, authenticated;
revoke all on function public.undo_watering_event(uuid) from public, anon, authenticated;
grant execute on function public.mark_watered(uuid, date) to authenticated;
grant execute on function public.postpone_plant(uuid, date) to authenticated;
grant execute on function public.undo_watering_event(uuid) to authenticated;
