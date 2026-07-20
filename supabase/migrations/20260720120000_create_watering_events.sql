-- Create the watering_events table: one row per watering action, owned by a user,
-- scoped to a plant, capturing the watering date and the before/after due dates
-- so undo can be implemented deterministically.

create table public.watering_events (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references public.plants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null default 'watered' check (event_type in ('watered')),
  watered_on date not null,
  prev_due_on date not null,
  new_due_on date not null,
  created_at timestamptz not null default now()
);

create index watering_events_plant_id_created_at_idx on public.watering_events (plant_id, created_at desc);

-- Migrations run as `postgres`, whose default privileges for `authenticated`
-- omit select/insert/delete; grant them explicitly so RLS policies below can
-- actually be evaluated (RLS narrows rows, it doesn't substitute for grants).
grant select, insert, delete on public.watering_events to authenticated;

alter table public.watering_events enable row level security;

create policy "watering_events_select_own"
on public.watering_events for select
to authenticated
using (auth.uid() = user_id);

create policy "watering_events_insert_own"
on public.watering_events for insert
to authenticated
with check (auth.uid() = user_id);

create policy "watering_events_delete_own"
on public.watering_events for delete
to authenticated
using (auth.uid() = user_id);

-- mark_watered: reschedule a plant and record the journal event in one transaction
-- so the due date and its history can never diverge.
-- Runs as SECURITY INVOKER so the caller's RLS constraints still apply.
create function public.mark_watered(p_plant_id uuid, p_watered_on date)
returns date
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_interval_days int;
  v_prev_due_on date;
  v_new_due_on date;
begin
  -- Get the current user (always available in SECURITY INVOKER context)
  v_user_id := auth.uid();

  -- Select the plant's interval and current due date, constrained by RLS
  select interval_days, next_due_on
  into v_interval_days, v_prev_due_on
  from public.plants
  where id = p_plant_id and user_id = v_user_id;

  -- If the plant doesn't exist or isn't owned by the caller, RLS returns no row
  if v_interval_days is null then
    raise exception 'Plant not found' using errcode = '02000';
  end if;

  -- Compute the new due date: watered_on + interval_days (calendar-day exact)
  v_new_due_on := p_watered_on + v_interval_days;

  -- Update the plant's due date
  update public.plants
  set next_due_on = v_new_due_on
  where id = p_plant_id and user_id = v_user_id;

  -- Insert the journal event
  insert into public.watering_events (plant_id, user_id, event_type, watered_on, prev_due_on, new_due_on)
  values (p_plant_id, v_user_id, 'watered', p_watered_on, v_prev_due_on, v_new_due_on);

  return v_new_due_on;
end;
$$;

grant execute on function public.mark_watered(uuid, date) to authenticated;
