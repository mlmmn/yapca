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
  -- INSERT and UPDATE are checked column-aware: has_table_privilege returns false when only
  -- column-level grants exist, which is the grant shape 20260802120000 introduces on plants.
  -- DELETE has no column-level form in Postgres, so it stays a table-level check.
  where case
    when privilege = 'DELETE' then has_table_privilege('authenticated', 'public.watering_events', privilege)
    else has_any_column_privilege('authenticated', 'public.watering_events', privilege)
  end;

  if v_watering_events_write_privileges is not null then
    raise exception 'authenticated must not hold watering_events write privileges: %', v_watering_events_write_privileges;
  end if;
end;
$$;

-- INSERT grants are independent of plants_insert_own. The pointer and audit
-- columns must stay unavailable, while the app's actual create columns remain
-- writable. Otherwise either a cross-account FK poisoning primitive returns or
-- addPlant/createPlantFixture breaks without a focused regression signal.
do $$
declare
  v_insert_columns_denied text;
begin
  if has_column_privilege('authenticated', 'public.plants', 'current_watering_event_id', 'insert')
    or has_column_privilege('authenticated', 'public.plants', 'created_at', 'insert')
    or has_column_privilege('authenticated', 'public.plants', 'updated_at', 'insert') then
    raise exception 'authenticated must not hold INSERT on plant pointer or audit columns';
  end if;

  select string_agg(column_name, ', ')
  into v_insert_columns_denied
  from unnest(array[
    'id',
    'user_id',
    'name',
    'growing_interval_days',
    'dormancy_interval_days',
    'next_due_on',
    'photo_path'
  ]) as column_name
  where not has_column_privilege('authenticated', 'public.plants', column_name, 'insert');

  if v_insert_columns_denied is not null then
    raise exception 'authenticated lost INSERT on required plant columns: %', v_insert_columns_denied;
  end if;
end;
$$;

-- This fails on the column grant before RLS: B may create their own row, but
-- must not be able to inject A's event as its current stack pointer.
do $$
begin
  begin
    insert into public.plants (
      id,
      user_id,
      name,
      growing_interval_days,
      dormancy_interval_days,
      next_due_on,
      current_watering_event_id
    ) values (
      '00000000-0000-0000-0000-000000000222',
      '00000000-0000-0000-0000-000000000022',
      'Foreign event pointer',
      7,
      30,
      date '2024-03-01',
      '00000000-0000-0000-0000-000000000321'
    );
    raise exception 'Foreign event pointer INSERT unexpectedly succeeded';
  exception
    when insufficient_privilege then
      null;
  end;

  insert into public.plants (
    id,
    user_id,
    name,
    growing_interval_days,
    dormancy_interval_days,
    next_due_on
  ) values (
    '00000000-0000-0000-0000-000000000222',
    '00000000-0000-0000-0000-000000000022',
    'Attacker-owned fixture',
    7,
    30,
    date '2024-03-01'
  );
end;
$$;

-- This is a separate control from the pointer case: the clean insert has all
-- granted columns, but plants_insert_own must still reject an owner mismatch.
do $$
begin
  begin
    insert into public.plants (
      id,
      user_id,
      name,
      growing_interval_days,
      dormancy_interval_days,
      next_due_on
    ) values (
      '00000000-0000-0000-0000-000000000223',
      '00000000-0000-0000-0000-000000000021',
      'Foreign-owned insert',
      7,
      30,
      date '2024-03-01'
    );
    raise exception 'Foreign-owner plant INSERT unexpectedly succeeded';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

do $$
declare
  v_updated_count int;
  v_deleted_count int;
begin
  -- plants_update_own deliberately has no WITH CHECK. Its row predicate and
  -- the separate user_id column grant are independent controls, so an allowed
  -- column is required here to prove this policy filters a foreign row.
  update public.plants
  set name = 'Foreign plant renamed'
  where id = '00000000-0000-0000-0000-000000000221';

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> 0 then
    raise exception 'Foreign allowed-column UPDATE affected % row(s)', v_updated_count;
  end if;

  delete from public.plants
  where id = '00000000-0000-0000-0000-000000000221';

  get diagnostics v_deleted_count = row_count;

  if v_deleted_count <> 0 then
    raise exception 'Foreign plant DELETE affected % row(s)', v_deleted_count;
  end if;

  begin
    perform * from public.postpone_plant('00000000-0000-0000-0000-000000000221', date '2024-03-01');
    raise exception 'Foreign postpone unexpectedly succeeded';
  exception
    when sqlstate 'P0002' then
      null;
  end;

  -- update_plant_schedule's final return query has no owner predicate, so this
  -- guard must remain: without its P0002 raise it would expose the full row.
  begin
    perform * from public.update_plant_schedule(
      '00000000-0000-0000-0000-000000000221',
      'Foreign schedule update',
      7,
      30,
      false,
      null,
      0,
      now()
    );
    raise exception 'Foreign schedule update unexpectedly succeeded';
  exception
    when sqlstate 'P0002' then
      null;
  end;
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

-- Direct DELETE has no Action path, so execute its owner control here.
do $$
declare
  v_deleted_count int;
begin
  insert into public.plants (
    id,
    user_id,
    name,
    growing_interval_days,
    dormancy_interval_days,
    next_due_on
  ) values (
    '00000000-0000-0000-0000-000000000224',
    '00000000-0000-0000-0000-000000000021',
    'Owner disposable fixture',
    7,
    30,
    date '2024-03-01'
  );

  delete from public.plants
  where id = '00000000-0000-0000-0000-000000000224';

  get diagnostics v_deleted_count = row_count;

  if v_deleted_count <> 1 then
    raise exception 'Owner plant DELETE positive control affected % row(s)', v_deleted_count;
  end if;
end;
$$;

rollback;
