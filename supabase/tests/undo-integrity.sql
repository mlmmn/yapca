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
end;
$$;

rollback;
