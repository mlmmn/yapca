-- Delete cleanup assumes each Storage object belongs to at most one plant.
-- Abort with a clear error instead of choosing which legacy reference to keep.
do $$
declare
  v_duplicate_path_count bigint;
begin
  select count(*)
  into v_duplicate_path_count
  from (
    select photo_path
    from public.plants
    where photo_path is not null
    group by photo_path
    having count(*) > 1
  ) duplicate_paths;

  if v_duplicate_path_count > 0 then
    raise exception
      'Cannot enforce unique plant photo paths: % duplicate path(s) exist',
      v_duplicate_path_count;
  end if;
end;
$$;

create unique index plants_photo_path_unique_idx
on public.plants (photo_path)
where photo_path is not null;
