-- Transaction-scoped stack, ownership, and schedule-alignment checks for undo.
-- Run with: pnpm test:sql (requires `pnpx supabase start`).

begin;

do $$
declare
  v_owner_id constant uuid := '00000000-0000-0000-0000-000000000011';
  v_other_id constant uuid := '00000000-0000-0000-0000-000000000012';
begin
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
  values
    (v_owner_id, 'authenticated', 'authenticated', 'undo-owner@yapca.local', crypt('password', gen_salt('bf')), now()),
    (v_other_id, 'authenticated', 'authenticated', 'undo-other@yapca.local', crypt('password', gen_salt('bf')), now())
  on conflict (id) do nothing;

  insert into public.plants (id, user_id, name, growing_interval_days, dormancy_interval_days, next_due_on)
  values
    ('00000000-0000-0000-0000-000000000211', v_owner_id, 'Undo stack fixture', 7, 30, date '2024-03-01'),
    ('00000000-0000-0000-0000-000000000212', v_owner_id, 'Divergent undo fixture', 7, 30, date '2024-03-01'),
    ('00000000-0000-0000-0000-000000000213', v_other_id, 'Other owner fixture', 7, 30, date '2024-03-01');
end;
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}';

do $$
declare
  v_first record;
  v_second record;
  v_event record;
  v_current_event_id uuid;
  v_due_on date;
begin
  select * into v_first
  from public.postpone_plant('00000000-0000-0000-0000-000000000211', date '2024-03-10');

  select * into v_second
  from public.postpone_plant('00000000-0000-0000-0000-000000000211', date '2024-03-10');

  select current_watering_event_id, next_due_on
  into v_current_event_id, v_due_on
  from public.plants
  where id = '00000000-0000-0000-0000-000000000211';

  if v_current_event_id <> v_second.event_id or v_due_on <> date '2024-03-12' then
    raise exception 'Forward actions did not set the current stack pointer';
  end if;

  select * into v_event from public.watering_events where id = v_second.event_id;

  if v_event.previous_event_id <> v_first.event_id then
    raise exception 'Second event does not point to its predecessor';
  end if;

  begin
    perform * from public.undo_watering_event(v_first.event_id);
    raise exception 'Out-of-order undo unexpectedly succeeded';
  exception
    when sqlstate 'P0003' then
      null;
  end;

  select current_watering_event_id, next_due_on
  into v_current_event_id, v_due_on
  from public.plants
  where id = '00000000-0000-0000-0000-000000000211';

  if v_current_event_id <> v_second.event_id or v_due_on <> date '2024-03-12' then
    raise exception 'Out-of-order undo changed stack state';
  end if;

  perform * from public.undo_watering_event(v_second.event_id);

  select current_watering_event_id into v_current_event_id
  from public.plants
  where id = '00000000-0000-0000-0000-000000000211';

  if v_current_event_id <> v_first.event_id then
    raise exception 'Undo did not advance pointer to predecessor';
  end if;

  perform * from public.undo_watering_event(v_first.event_id);

  select current_watering_event_id, next_due_on
  into v_current_event_id, v_due_on
  from public.plants
  where id = '00000000-0000-0000-0000-000000000211';

  if v_current_event_id is not null or v_due_on <> date '2024-03-01' then
    raise exception 'Two-event unwind did not restore original plant state';
  end if;

  if exists (select 1 from public.watering_events where plant_id = '00000000-0000-0000-0000-000000000211') then
    raise exception 'Two-event unwind left journal rows behind';
  end if;
end;
$$;

do $$
declare
  v_event record;
  v_current_event_id uuid;
  v_due_on date;
begin
  select * into v_event
  from public.mark_watered('00000000-0000-0000-0000-000000000212', date '2024-03-10');

  update public.plants
  set next_due_on = date '2024-03-20'
  where id = '00000000-0000-0000-0000-000000000212';

  begin
    perform * from public.undo_watering_event(v_event.event_id);
    raise exception 'Divergent current event unexpectedly undid';
  exception
    when sqlstate 'P0004' then
      null;
  end;

  select current_watering_event_id, next_due_on
  into v_current_event_id, v_due_on
  from public.plants
  where id = '00000000-0000-0000-0000-000000000212';

  if v_current_event_id <> v_event.event_id or v_due_on <> date '2024-03-20' then
    raise exception 'Divergent undo changed plant state';
  end if;

  if not exists (select 1 from public.watering_events where id = v_event.event_id) then
    raise exception 'Divergent undo deleted its event';
  end if;
end;
$$;

do $$
declare
  v_first record;
  v_second record;
  v_plant record;
  v_stale_updated_at timestamptz;
  v_event record;
  v_due_before date;
  v_due_after date;
  v_events_before jsonb;
  v_events_after jsonb;
begin
  select * into v_first
  from public.mark_watered('00000000-0000-0000-0000-000000000211', date '2024-03-10');

  select * into v_second
  from public.mark_watered('00000000-0000-0000-0000-000000000211', date '2024-03-10');

  select updated_at into v_stale_updated_at
  from public.plants
  where id = '00000000-0000-0000-0000-000000000211';

  -- Snapshot the schedule and the whole journal so the zero-delta call below can be
  -- shown to leave both untouched, rather than leaving that implied by later baselines.
  select next_due_on into v_due_before
  from public.plants
  where id = '00000000-0000-0000-0000-000000000211';

  select jsonb_agg(to_jsonb(e.*) order by e.id) into v_events_before
  from public.watering_events as e
  where e.plant_id = '00000000-0000-0000-0000-000000000211';

  perform * from public.update_plant_schedule(
    '00000000-0000-0000-0000-000000000211',
    'Undo stack fixture renamed',
    7,
    30,
    false,
    null,
    0,
    v_stale_updated_at - interval '1 microsecond'
  );

  select next_due_on into v_due_after
  from public.plants
  where id = '00000000-0000-0000-0000-000000000211';

  select jsonb_agg(to_jsonb(e.*) order by e.id) into v_events_after
  from public.watering_events as e
  where e.plant_id = '00000000-0000-0000-0000-000000000211';

  if v_due_after <> v_due_before then
    raise exception 'Zero-delta edit moved next_due_on from % to %', v_due_before, v_due_after;
  end if;

  if v_events_after is distinct from v_events_before then
    raise exception 'Zero-delta edit modified the journal';
  end if;

  begin
    perform * from public.update_plant_schedule(
      '00000000-0000-0000-0000-000000000211',
      'Undo stack fixture renamed again',
      8,
      31,
      false,
      null,
      1,
      v_stale_updated_at - interval '1 microsecond'
    );
    raise exception 'Stale schedule token unexpectedly succeeded';
  exception
    when sqlstate 'P0003' then
      null;
  end;

  select * into v_plant
  from public.plants
  where id = '00000000-0000-0000-0000-000000000211';

  perform * from public.update_plant_schedule(
    '00000000-0000-0000-0000-000000000211',
    'Undo stack fixture amended',
    8,
    31,
    false,
    null,
    1,
    v_plant.updated_at
  );

  select * into v_event
  from public.watering_events
  where id = v_first.event_id;

  if v_event.prev_due_on <> date '2024-03-02' or v_event.new_due_on <> date '2024-03-18' then
    raise exception 'First event window did not shift by the schedule delta';
  end if;

  select * into v_event
  from public.watering_events
  where id = v_second.event_id;

  if v_event.prev_due_on <> date '2024-03-18' or v_event.new_due_on <> date '2024-03-18' then
    raise exception 'Second event window did not shift by the schedule delta';
  end if;

  perform * from public.undo_watering_event(v_second.event_id);
  perform * from public.undo_watering_event(v_first.event_id);

  select * into v_plant
  from public.plants
  where id = '00000000-0000-0000-0000-000000000211';

  if v_plant.next_due_on <> date '2024-03-02' or v_plant.current_watering_event_id is not null then
    raise exception 'Amended stack did not retain the schedule delta through unwind';
  end if;

  update public.plants
  set next_due_on = date '2024-03-20'
  where id = '00000000-0000-0000-0000-000000000212';

  select * into v_plant
  from public.plants
  where id = '00000000-0000-0000-0000-000000000212';

  perform * from public.update_plant_schedule(
    '00000000-0000-0000-0000-000000000212',
    'Divergent undo fixture amended',
    8,
    31,
    false,
    null,
    1,
    v_plant.updated_at
  );

  if not exists (
    select 1
    from public.watering_events
    where plant_id = '00000000-0000-0000-0000-000000000212'
      and prev_due_on = date '2024-03-01'
      and new_due_on = date '2024-03-17'
  ) then
    raise exception 'Divergent stack was amended despite its mismatch';
  end if;

  begin
    perform * from public.undo_watering_event((
      select id from public.watering_events where plant_id = '00000000-0000-0000-0000-000000000212'
    ));
    raise exception 'Divergent stack unexpectedly undid after schedule edit';
  exception
    when sqlstate 'P0004' then
      null;
  end;
end;
$$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000012","role":"authenticated"}';

do $$
declare
  v_other_event record;
begin
  select * into v_other_event
  from public.mark_watered('00000000-0000-0000-0000-000000000213', date '2024-03-10');

  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}';

  begin
    perform * from public.undo_watering_event(v_other_event.event_id);
    raise exception 'Another user''s event unexpectedly undid';
  exception
    when sqlstate 'P0002' then
      null;
  end;

  begin
    perform * from public.update_plant_schedule(
      '00000000-0000-0000-0000-000000000213',
      'Other owner fixture',
      7,
      30,
      false,
      null,
      0,
      now()
    );
    raise exception 'Another user''s plant unexpectedly updated';
  exception
    when sqlstate 'P0002' then
      null;
  end;
end;
$$;

-- The stack pointer must stay RPC-only.
--
-- `plants.current_watering_event_id` is a plain foreign key: RLS decides which row a
-- client may update, but nothing constrains which event id it writes there. While the
-- client held a table-wide UPDATE grant, a user could aim their own plant at another
-- user's event, and the victim's own undo and plant deletion then failed at
-- constraint-check time with 23503 -- a cross-tenant denial of service they could not
-- clear. 20260801120002 narrowed the grant to the columns the client legitimately edits.
-- This asserts the grant, not the policy, because only the grant can express it.

do $$
declare
  v_editable_denied text;
begin
  if has_column_privilege('authenticated', 'public.plants', 'current_watering_event_id', 'update') then
    raise exception 'authenticated must not hold UPDATE on plants.current_watering_event_id';
  end if;

  -- Withheld for the same reason: row identity, ownership, and the optimistic-lock
  -- token update_plant_schedule compares against.
  if has_column_privilege('authenticated', 'public.plants', 'id', 'update')
    or has_column_privilege('authenticated', 'public.plants', 'user_id', 'update')
    or has_column_privilege('authenticated', 'public.plants', 'updated_at', 'update') then
    raise exception 'authenticated must not hold UPDATE on plant identity or lock columns';
  end if;

  -- The columns the edit form legitimately writes must remain granted, or the app breaks
  -- in a way no other assertion here would catch.
  select string_agg(column_name, ', ')
  into v_editable_denied
  from unnest(array['name', 'growing_interval_days', 'dormancy_interval_days', 'next_due_on', 'photo_path'])
    as column_name
  where not has_column_privilege('authenticated', 'public.plants', column_name, 'update');

  if v_editable_denied is not null then
    raise exception 'authenticated lost UPDATE on editable plant columns: %', v_editable_denied;
  end if;
end;
$$;

-- Anonymous callers must not reach any stack-mutating RPC.
do $$
declare
  v_granted text;
begin
  select string_agg(signature, ', ')
  into v_granted
  from unnest(array[
    'public.mark_watered(uuid, date)',
    'public.postpone_plant(uuid, date)',
    'public.undo_watering_event(uuid)',
    'public.update_plant_schedule(uuid, text, int, int, boolean, text, int, timestamptz)'
  ]) as signature
  where has_function_privilege('anon', signature, 'execute');

  if v_granted is not null then
    raise exception 'anon must not hold EXECUTE on: %', v_granted;
  end if;
end;
$$;

rollback;
