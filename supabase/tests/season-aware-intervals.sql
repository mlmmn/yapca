-- Transaction-scoped boundary and ownership checks for seasonal scheduling.
-- Run with: psql ... -v ON_ERROR_STOP=1 -f supabase/tests/season-aware-intervals.sql

begin;

do $$
declare
  v_owner_id constant uuid := '00000000-0000-0000-0000-000000000001';
  v_other_id constant uuid := '00000000-0000-0000-0000-000000000002';
begin
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
  values (v_other_id, 'authenticated', 'authenticated', 'other@yapca.local', crypt('password', gen_salt('bf')), now())
  on conflict (id) do nothing;

  insert into public.plants (
    id, user_id, name, growing_interval_days, dormancy_interval_days, next_due_on
  )
  values (
    '00000000-0000-0000-0000-000000000199', v_owner_id, 'Season boundary fixture', 7, 30, date '2000-01-01'
  );
end;
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  v_case record;
  v_result record;
  v_event record;
  v_previous_due date := date '2000-01-01';
begin
  for v_case in
    select * from (values
      (date '2024-02-29', date '2024-03-30'),
      (date '2024-03-01', date '2024-03-08'),
      (date '2024-10-31', date '2024-11-07'),
      (date '2024-11-01', date '2024-12-01'),
      (date '2025-02-28', date '2025-03-30'),
      (date '2025-03-01', date '2025-03-08')
    ) as cases(acted_on, expected_due)
  loop
    select * into v_result
    from public.mark_watered('00000000-0000-0000-0000-000000000199', v_case.acted_on);

    if v_result.prev_due_on <> v_previous_due or v_result.new_due_on <> v_case.expected_due then
      raise exception 'Unexpected Watered result for %: %', v_case.acted_on, row_to_json(v_result);
    end if;

    select * into v_event
    from public.watering_events
    where id = v_result.event_id;

    if v_event.acted_on <> v_case.acted_on
      or v_event.prev_due_on <> v_result.prev_due_on
      or v_event.new_due_on <> v_case.expected_due
    then
      raise exception 'Unexpected journal result for %: %', v_case.acted_on, row_to_json(v_event);
    end if;

    select * into v_result
    from public.undo_watering_event(v_result.event_id);

    if v_result.restored_due_on <> v_previous_due then
      raise exception 'Undo did not restore prior due date for %', v_case.acted_on;
    end if;
  end loop;

  select * into v_result
  from public.postpone_plant('00000000-0000-0000-0000-000000000199', date '2024-03-01');

  if v_result.new_due_on <> date '2024-03-03' then
    raise exception 'Postpone did not preserve +2 behavior: %', row_to_json(v_result);
  end if;

  select * into v_result
  from public.undo_watering_event(v_result.event_id);

  if v_result.restored_due_on <> v_previous_due then
    raise exception 'Postpone Undo did not restore the prior due date';
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
begin
  perform *
  from public.mark_watered('00000000-0000-0000-0000-000000000199', date '2024-03-01');
  raise exception 'Cross-account Watered unexpectedly succeeded';
exception
  when sqlstate 'P0002' then
    null;
end;
$$;

rollback;
