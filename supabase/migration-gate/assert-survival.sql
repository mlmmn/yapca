-- Post-migration proof that every persistent baseline value is still reachable.
-- Intentional schema transformations must map each value below to its new form.

do $$
declare
  v_user_count int;
  v_plant_count int;
  v_event_count int;
  v_user auth.users%rowtype;
  v_growing_plant public.plants%rowtype;
  v_dormancy_plant public.plants%rowtype;
  v_growing_event public.watering_events%rowtype;
  v_dormancy_event public.watering_events%rowtype;
begin
  select count(*) into v_user_count
  from auth.users
  where id = '00000000-0000-0000-0000-000000000901';

  select count(*) into v_plant_count
  from public.plants
  where id in (
    '00000000-0000-0000-0000-000000000911',
    '00000000-0000-0000-0000-000000000912'
  );

  select count(*) into v_event_count
  from public.watering_events
  where id in (
    '00000000-0000-0000-0000-000000000921',
    '00000000-0000-0000-0000-000000000922'
  );

  if v_user_count <> 1 or v_plant_count <> 2 or v_event_count <> 2 then
    raise exception 'Migration gate fixture row counts changed: users %, plants %, events %',
      v_user_count, v_plant_count, v_event_count;
  end if;

  select * into v_user
  from auth.users
  where id = '00000000-0000-0000-0000-000000000901';

  if v_user.aud <> 'authenticated'
    or v_user.role <> 'authenticated'
    or v_user.email <> 'migration-gate@yapca.local'
    or v_user.email_confirmed_at <> timestamptz '2025-01-01 00:00:00+00'
  then
    raise exception 'Migration gate fixture user values changed';
  end if;

  select * into v_growing_plant
  from public.plants
  where id = '00000000-0000-0000-0000-000000000911';

  if v_growing_plant.user_id <> '00000000-0000-0000-0000-000000000901'
    or v_growing_plant.name <> 'Migration gate growing fixture'
    or v_growing_plant.growing_interval_days <> 7
    or v_growing_plant.dormancy_interval_days <> 30
    or v_growing_plant.next_due_on <> date '2025-03-08'
    or v_growing_plant.photo_path <> '00000000-0000-0000-0000-000000000901/growing.webp'
    or v_growing_plant.current_watering_event_id <> '00000000-0000-0000-0000-000000000921'
  then
    raise exception 'Migration gate growing-plant values changed';
  end if;

  select * into v_dormancy_plant
  from public.plants
  where id = '00000000-0000-0000-0000-000000000912';

  if v_dormancy_plant.user_id <> '00000000-0000-0000-0000-000000000901'
    or v_dormancy_plant.name <> 'Migration gate dormancy fixture'
    or v_dormancy_plant.growing_interval_days <> 14
    or v_dormancy_plant.dormancy_interval_days <> 45
    or v_dormancy_plant.next_due_on <> date '2025-11-15'
    or v_dormancy_plant.photo_path is not null
    or v_dormancy_plant.current_watering_event_id <> '00000000-0000-0000-0000-000000000922'
  then
    raise exception 'Migration gate dormancy-plant values changed';
  end if;

  select * into v_growing_event
  from public.watering_events
  where id = '00000000-0000-0000-0000-000000000921';

  if v_growing_event.plant_id <> '00000000-0000-0000-0000-000000000911'
    or v_growing_event.user_id <> '00000000-0000-0000-0000-000000000901'
    or v_growing_event.event_type <> 'watered'
    or v_growing_event.acted_on <> date '2025-03-01'
    or v_growing_event.prev_due_on <> date '2025-02-22'
    or v_growing_event.new_due_on <> date '2025-03-08'
    or v_growing_event.previous_event_id is not null
    or v_growing_event.created_at <> timestamptz '2025-03-01 12:00:00+00'
  then
    raise exception 'Migration gate growing-event values changed';
  end if;

  select * into v_dormancy_event
  from public.watering_events
  where id = '00000000-0000-0000-0000-000000000922';

  if v_dormancy_event.plant_id <> '00000000-0000-0000-0000-000000000912'
    or v_dormancy_event.user_id <> '00000000-0000-0000-0000-000000000901'
    or v_dormancy_event.event_type <> 'postponed'
    or v_dormancy_event.acted_on <> date '2025-11-13'
    or v_dormancy_event.prev_due_on <> date '2025-11-10'
    or v_dormancy_event.new_due_on <> date '2025-11-15'
    or v_dormancy_event.previous_event_id is not null
    or v_dormancy_event.created_at <> timestamptz '2025-11-13 12:00:00+00'
  then
    raise exception 'Migration gate dormancy-event values changed';
  end if;
end;
$$;
