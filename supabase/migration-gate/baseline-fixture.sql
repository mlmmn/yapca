-- Persistent baseline rows for the migration-safety gate. Keep this valid against
-- the base schema: it is inserted before the migration under test is applied.

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
values (
  '00000000-0000-0000-0000-000000000901',
  'authenticated',
  'authenticated',
  'migration-gate@yapca.local',
  crypt('password', gen_salt('bf')),
  timestamptz '2025-01-01 00:00:00+00'
);

insert into public.plants (
  id,
  user_id,
  name,
  growing_interval_days,
  dormancy_interval_days,
  next_due_on,
  photo_path
)
values
  (
    '00000000-0000-0000-0000-000000000911',
    '00000000-0000-0000-0000-000000000901',
    'Migration gate growing fixture',
    7,
    30,
    date '2025-03-08',
    '00000000-0000-0000-0000-000000000901/growing.webp'
  ),
  (
    '00000000-0000-0000-0000-000000000912',
    '00000000-0000-0000-0000-000000000901',
    'Migration gate dormancy fixture',
    14,
    45,
    date '2025-11-15',
    null
  );

insert into public.watering_events (
  id,
  plant_id,
  user_id,
  event_type,
  acted_on,
  prev_due_on,
  new_due_on,
  created_at
)
values
  (
    '00000000-0000-0000-0000-000000000921',
    '00000000-0000-0000-0000-000000000911',
    '00000000-0000-0000-0000-000000000901',
    'watered',
    date '2025-03-01',
    date '2025-02-22',
    date '2025-03-08',
    timestamptz '2025-03-01 12:00:00+00'
  ),
  (
    '00000000-0000-0000-0000-000000000922',
    '00000000-0000-0000-0000-000000000912',
    '00000000-0000-0000-0000-000000000901',
    'postponed',
    date '2025-11-13',
    date '2025-11-10',
    date '2025-11-15',
    timestamptz '2025-11-13 12:00:00+00'
  );
