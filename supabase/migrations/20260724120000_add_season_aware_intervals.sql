-- Split the legacy watering interval into growing- and dormancy-season
-- intervals without changing any materialized due dates or journal history.

alter table public.plants
  add column growing_interval_days int,
  add column dormancy_interval_days int;

update public.plants
set growing_interval_days = interval_days,
    dormancy_interval_days = interval_days;

alter table public.plants
  alter column growing_interval_days set not null,
  alter column dormancy_interval_days set not null,
  add constraint plants_growing_interval_days_check check (growing_interval_days between 1 and 365),
  add constraint plants_dormancy_interval_days_check check (dormancy_interval_days between 1 and 365),
  drop column interval_days;

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
  v_event_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select p.growing_interval_days, p.dormancy_interval_days, p.next_due_on
  into v_growing_interval_days, v_dormancy_interval_days, v_prev_due_on
  from public.plants as p
  where p.id = p_plant_id and p.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Plant not found' using errcode = 'P0002';
  end if;

  -- Growing season is March 1 through October 31, inclusive. This rule is mirrored in
  -- `src/lib/season.ts` (getSeason), which selects the interval for a plant's FIRST due
  -- date at creation; every later reschedule comes through here. Change both together.
  if p_acted_on between make_date(extract(year from p_acted_on)::int, 3, 1)
    and make_date(extract(year from p_acted_on)::int, 10, 31) then
    v_interval_days := v_growing_interval_days;
  else
    v_interval_days := v_dormancy_interval_days;
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

revoke all on function public.mark_watered(uuid, date) from public, anon, authenticated;
grant execute on function public.mark_watered(uuid, date) to authenticated;
