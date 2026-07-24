-- Local-only fixtures. `supabase db reset` recreates the database, then runs
-- this file so the development account and sample plants are available again.
-- Do not use these credentials outside the local Supabase project.

do $$
declare
  v_user_id constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    'test@yapca.local',
    crypt('password', gen_salt('bf')),
    now(),
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now()
  )
  on conflict (id) do update
    set email = excluded.email,
        encrypted_password = excluded.encrypted_password,
        email_confirmed_at = excluded.email_confirmed_at,
        confirmation_token = excluded.confirmation_token,
        email_change = excluded.email_change,
        email_change_token_new = excluded.email_change_token_new,
        recovery_token = excluded.recovery_token,
        updated_at = now();

  insert into auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    created_at,
    updated_at
  )
  values (
    v_user_id::text,
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', 'test@yapca.local'),
    'email',
    now(),
    now()
  )
  on conflict (provider_id, provider) do nothing;
end
$$;

insert into public.plants (id, user_id, name, growing_interval_days, dormancy_interval_days, next_due_on)
values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'Monstera', 7, 30, current_date),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'Snake plant', 21, 21, current_date + 5),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', 'Peace lily', 4, 14, current_date - 1)
on conflict (id) do update
  set user_id = excluded.user_id,
      name = excluded.name,
      growing_interval_days = excluded.growing_interval_days,
      dormancy_interval_days = excluded.dormancy_interval_days,
      next_due_on = excluded.next_due_on,
      updated_at = now();
