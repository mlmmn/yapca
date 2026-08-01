-- Transaction-scoped direct-id read-isolation checks.
-- Run with: pnpm test:sql (requires `pnpx supabase start`).

begin;

do $$
declare
  v_owner_id constant uuid := '00000000-0000-0000-0000-000000000021';
  v_other_id constant uuid := '00000000-0000-0000-0000-000000000022';
  v_owner_plant_id constant uuid := '00000000-0000-0000-0000-000000000221';
  v_owner_event_id constant uuid := '00000000-0000-0000-0000-000000000321';
begin
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
  values
    (v_owner_id, 'authenticated', 'authenticated', 'isolation-owner@yapca.local', crypt('password', gen_salt('bf')), now()),
    (v_other_id, 'authenticated', 'authenticated', 'isolation-other@yapca.local', crypt('password', gen_salt('bf')), now())
  on conflict (id) do nothing;

  insert into public.plants (id, user_id, name, growing_interval_days, dormancy_interval_days, next_due_on)
  values (v_owner_plant_id, v_owner_id, 'Isolation owner fixture', 7, 30, date '2024-03-01');

  insert into public.watering_events (id, plant_id, user_id, event_type, acted_on, prev_due_on, new_due_on)
  values (v_owner_event_id, v_owner_plant_id, v_owner_id, 'watered', date '2024-03-01', date '2024-03-01', date '2024-03-08');
end;
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000022","role":"authenticated"}';

do $$
declare
  v_visible_plants int;
  v_visible_events_by_plant int;
  v_visible_events_by_id int;
  v_watering_events_write_privileges text;
begin
  select count(*) into v_visible_plants
  from public.plants
  where id = '00000000-0000-0000-0000-000000000221';

  if v_visible_plants <> 0 then
    raise exception 'Foreign plant was visible by direct id';
  end if;

  -- The plant detail journal reads by plant_id, so it has an RLS dependency separate from
  -- the plant query in src/pages/plants/[id].astro:46-50.
  select count(*) into v_visible_events_by_plant
  from public.watering_events
  where plant_id = '00000000-0000-0000-0000-000000000221';

  if v_visible_events_by_plant <> 0 then
    raise exception 'Foreign watering events were visible by plant_id';
  end if;

  select count(*) into v_visible_events_by_id
  from public.watering_events
  where id = '00000000-0000-0000-0000-000000000321';

  if v_visible_events_by_id <> 0 then
    raise exception 'Foreign watering event was visible by direct id';
  end if;

  select string_agg(privilege, ', ')
  into v_watering_events_write_privileges
  from unnest(array['INSERT', 'UPDATE', 'DELETE']) as privilege
  where has_table_privilege('authenticated', 'public.watering_events', privilege);

  if v_watering_events_write_privileges is not null then
    raise exception 'authenticated must not hold watering_events write privileges: %', v_watering_events_write_privileges;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000021","role":"authenticated"}';

do $$
declare
  v_visible_plants int;
  v_visible_events_by_plant int;
  v_visible_events_by_id int;
begin
  select count(*) into v_visible_plants
  from public.plants
  where id = '00000000-0000-0000-0000-000000000221';

  if v_visible_plants <> 1 then
    raise exception 'Owner plant positive control expected one row, got %', v_visible_plants;
  end if;

  select count(*) into v_visible_events_by_plant
  from public.watering_events
  where plant_id = '00000000-0000-0000-0000-000000000221';

  if v_visible_events_by_plant <> 1 then
    raise exception 'Owner event-by-plant positive control expected one row, got %', v_visible_events_by_plant;
  end if;

  select count(*) into v_visible_events_by_id
  from public.watering_events
  where id = '00000000-0000-0000-0000-000000000321';

  if v_visible_events_by_id <> 1 then
    raise exception 'Owner event-by-id positive control expected one row, got %', v_visible_events_by_id;
  end if;
end;
$$;

rollback;
