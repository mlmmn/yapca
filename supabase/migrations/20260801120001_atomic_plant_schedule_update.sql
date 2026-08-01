-- Update plant schedules and their reachable undo windows atomically.

create or replace function public.update_plant_schedule(
  p_plant_id uuid,
  p_name text,
  p_growing_interval_days int,
  p_dormancy_interval_days int,
  p_set_photo_path boolean,
  p_photo_path text,
  p_delta_days int,
  p_updated_at timestamptz
)
returns setof public.plants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_previous_due_on date;
  v_current_watering_event_id uuid;
  v_updated_at timestamptz;
  v_current_event_new_due_on date;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select p.next_due_on, p.current_watering_event_id, p.updated_at
  into v_previous_due_on, v_current_watering_event_id, v_updated_at
  from public.plants as p
  where p.id = p_plant_id and p.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Plant not found' using errcode = 'P0002';
  end if;

  if p_delta_days <> 0 and v_updated_at <> p_updated_at then
    raise exception 'Plant changed elsewhere' using errcode = 'P0003';
  end if;

  update public.plants
  set name = p_name,
      growing_interval_days = p_growing_interval_days,
      dormancy_interval_days = p_dormancy_interval_days,
      photo_path = case when p_set_photo_path then p_photo_path else photo_path end,
      next_due_on = case when p_delta_days <> 0 then next_due_on + p_delta_days else next_due_on end
  where id = p_plant_id and user_id = v_user_id;

  if p_delta_days <> 0 and v_current_watering_event_id is not null then
    select e.new_due_on
    into v_current_event_new_due_on
    from public.watering_events as e
    where e.id = v_current_watering_event_id
      and e.plant_id = p_plant_id
      and e.user_id = v_user_id
    for update;

    if v_current_event_new_due_on = v_previous_due_on then
      with recursive undo_stack as (
        select e.id, e.previous_event_id
        from public.watering_events as e
        where e.id = v_current_watering_event_id
          and e.plant_id = p_plant_id
          and e.user_id = v_user_id

        union all

        select predecessor.id, predecessor.previous_event_id
        from public.watering_events as predecessor
        join undo_stack as current on predecessor.id = current.previous_event_id
        where predecessor.plant_id = p_plant_id
          and predecessor.user_id = v_user_id
      )
      update public.watering_events as e
      set prev_due_on = e.prev_due_on + p_delta_days,
          new_due_on = e.new_due_on + p_delta_days
      from undo_stack
      where e.id = undo_stack.id;
    end if;
  end if;

  return query
  select *
  from public.plants
  where id = p_plant_id;
end;
$$;

revoke all on function public.update_plant_schedule(uuid, text, int, int, boolean, text, int, timestamptz)
  from public, anon, authenticated;
grant execute on function public.update_plant_schedule(uuid, text, int, int, boolean, text, int, timestamptz)
  to authenticated;
