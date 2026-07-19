-- Create the plants table: one row per plant, owned by a user, carrying the
-- watering interval and the next due calendar date the loop reschedules.

create table public.plants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  interval_days int not null check (interval_days between 1 and 365),
  next_due_on date not null,
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plants_user_id_next_due_on_idx on public.plants (user_id, next_due_on);

create function public.set_plants_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger plants_set_updated_at
before update on public.plants
for each row
execute function public.set_plants_updated_at();

-- Migrations run as `postgres`, whose default privileges for `authenticated`
-- omit select/insert/update; grant them explicitly so RLS policies below can
-- actually be evaluated (RLS narrows rows, it doesn't substitute for grants).
grant select, insert, update, delete on public.plants to authenticated;

alter table public.plants enable row level security;

create policy "plants_select_own"
on public.plants for select
to authenticated
using (auth.uid() = user_id);

create policy "plants_insert_own"
on public.plants for insert
to authenticated
with check (auth.uid() = user_id);

create policy "plants_update_own"
on public.plants for update
to authenticated
using (auth.uid() = user_id);

create policy "plants_delete_own"
on public.plants for delete
to authenticated
using (auth.uid() = user_id);
