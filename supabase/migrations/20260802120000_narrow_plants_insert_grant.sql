-- Narrow the client's INSERT grant on plants to the columns it legitimately
-- supplies, so `current_watering_event_id` becomes RPC-only on creation too.
--
-- This is the INSERT-verb counterpart of the UPDATE narrowing in
-- 20260801120002_secure_and_index_undo_stack.sql. Keep the pair together: the
-- stack pointer is a cross-row foreign key, and a blanket grant on either verb
-- would let an authenticated user point their own plant at another user's event.

revoke insert on public.plants from authenticated;

grant insert (
  id,
  user_id,
  name,
  growing_interval_days,
  dormancy_interval_days,
  next_due_on,
  photo_path
) on public.plants to authenticated;
