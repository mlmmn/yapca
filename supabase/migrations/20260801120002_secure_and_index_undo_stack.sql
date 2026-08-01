-- Narrow the client's UPDATE grant on plants to the columns it legitimately
-- edits, so `current_watering_event_id` becomes RPC-only.
--
-- The stack pointer added by 20260801120000 is a plain foreign key with no
-- ownership predicate: RLS on plants constrains *which row* you may update, but
-- it cannot constrain *which event id* you write into that row. Under the
-- previous table-wide grant an authenticated user could therefore aim their own
-- plant's pointer at another user's event. Because the constraint is NO ACTION,
-- the victim's own `undo_watering_event` (which deletes the event) and their
-- plant deletion (which cascades to it) then failed at constraint-check time
-- with 23503 — a cross-tenant denial of service the victim could not clear.
--
-- Restricting the grant removes the write primitive outright rather than trying
-- to validate it. The pointer is maintained solely by mark_watered,
-- postpone_plant, undo_watering_event and update_plant_schedule, all of which
-- are `security definer` and so unaffected by this grant.
--
-- id / user_id / created_at are withheld for the same reason (a row's identity
-- and ownership are not client-editable), and updated_at because it is the
-- optimistic-lock token update_plant_schedule compares against — a client that
-- can forge it can defeat the lock.

revoke update on public.plants from authenticated;

grant update (
  name,
  growing_interval_days,
  dormancy_interval_days,
  next_due_on,
  photo_path
) on public.plants to authenticated;

-- Index the referencing side of both stack links.
--
-- Postgres indexes the referenced side of a foreign key automatically but never
-- the referencing side, so without these every delete of a watering_events row
-- sequentially scans watering_events (for previous_event_id) and plants (for
-- current_watering_event_id) to prove no inbound reference survives. That delete
-- is on undo's hot path, and plant deletion pays it once per cascaded event.

create index watering_events_previous_event_id_idx
  on public.watering_events (previous_event_id);

create index plants_current_watering_event_id_idx
  on public.plants (current_watering_event_id);

-- Make a dangling stack pointer diagnosable instead of silent.
--
-- 20260801120001 skipped the stack amendment whenever
-- `v_current_event_new_due_on = v_previous_due_on` was not true. When the head
-- event lookup found no row at all that variable stayed null, the comparison
-- evaluated to null rather than false, and the amendment was skipped down the
-- same path as a legitimately divergent legacy stack. Both outcomes are correct
-- and conservative, but they were indistinguishable after the fact.
--
-- A plant naming an event that does not exist (or belongs to another plant) is
-- not a legacy schedule divergence — it is corruption. Behaviour is unchanged;
-- the case just leaves a trace now. Only this branch differs from 20260801120001.

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
  v_current_event_found boolean;
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

    v_current_event_found := found;

    if not v_current_event_found then
      raise warning 'Plant % names a current watering event % that does not exist for this plant; leaving the undo stack unamended',
        p_plant_id, v_current_watering_event_id;
    elsif v_current_event_new_due_on = v_previous_due_on then
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
