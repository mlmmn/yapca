-- Create a private Storage bucket for plant photos, isolated per account at
-- the object level via a {user_id}/{uuid}.{ext} path convention.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'plant-photos',
  'plant-photos',
  false,
  4194304, -- 4 MB
  array['image/jpeg', 'image/png', 'image/webp']
);

create policy "plant_photos_select_own"
on storage.objects for select
to authenticated
using (
  bucket_id = 'plant-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "plant_photos_insert_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'plant-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "plant_photos_update_own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'plant-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'plant-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "plant_photos_delete_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'plant-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);
