-- Test that deleting a plant with event chains cascades correctly through deferred FKs.
-- Run with: pnpm test:sql (requires `pnpx supabase start`).

begin;

do $$
declare
  v_owner_id constant uuid := '00000000-0000-0000-0000-000000000031';
  v_other_id constant uuid := '00000000-0000-0000-0000-000000000032';
  v_owner_plant_id constant uuid := '00000000-0000-0000-0000-000000000331';
  v_other_plant_id constant uuid := '00000000-0000-0000-0000-000000000332';
begin
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
  values
    (v_owner_id, 'authenticated', 'authenticated', 'cascade-owner@yapca.local', crypt('password', gen_salt('bf')), now()),
    (v_other_id, 'authenticated', 'authenticated', 'cascade-other@yapca.local', crypt('password', gen_salt('bf')), now())
  on conflict (id) do nothing;

  insert into public.plants (id, user_id, name, growing_interval_days, dormancy_interval_days, next_due_on)
  values
    (v_owner_plant_id, v_owner_id, 'Owner plant with events', 7, 30, date '2024-03-01'),
    (v_other_plant_id, v_other_id, 'Other plant with events', 7, 30, date '2024-03-01');
end;
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000031","role":"authenticated"}';

do $$
declare
  v_owner_plant_id constant uuid := '00000000-0000-0000-0000-000000000331';
  v_other_plant_id constant uuid := '00000000-0000-0000-0000-000000000332';
  v_owner_event_1_id uuid;
  v_owner_event_2_id uuid;
  v_deleted_count int;
  v_remaining_events int;
  v_prev_event_id uuid;
  v_other_plant_count int;
begin
  perform * from public.mark_watered(v_owner_plant_id, date '2024-03-01');
  perform * from public.postpone_plant(v_owner_plant_id, date '2024-03-02');

  select current_watering_event_id into v_owner_event_2_id from public.plants where id = v_owner_plant_id;

  select id, previous_event_id into v_owner_event_1_id, v_prev_event_id from public.watering_events
  where plant_id = v_owner_plant_id and id <> v_owner_event_2_id limit 1;

  if v_owner_event_1_id is null or v_owner_event_2_id is null then
    raise exception 'Failed to set up event chain for cascade test';
  end if;

  if (select previous_event_id from public.watering_events where id = v_owner_event_2_id) <> v_owner_event_1_id then
    raise exception 'Event chain was not set up correctly';
  end if;

  delete from public.plants where id = v_owner_plant_id;

  set constraints all immediate;

  select count(*) into v_deleted_count from public.plants where id = v_owner_plant_id;
  if v_deleted_count <> 0 then
    raise exception 'Plant was not deleted';
  end if;

  select count(*) into v_remaining_events from public.watering_events where plant_id = v_owner_plant_id;
  if v_remaining_events <> 0 then
    raise exception 'Cascaded events were not deleted: % remaining', v_remaining_events;
  end if;
end;
$$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000032","role":"authenticated"}';

do $$
declare
  v_other_plant_id constant uuid := '00000000-0000-0000-0000-000000000332';
  v_other_plant_count int;
begin
  select count(*) into v_other_plant_count from public.plants where id = v_other_plant_id;
  if v_other_plant_count <> 1 then
    raise exception 'Other account plant should still exist but got % rows', v_other_plant_count;
  end if;
end;
$$;

rollback;
