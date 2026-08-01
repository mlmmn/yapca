#!/usr/bin/env sh

set -eu

export LC_ALL=C

for sql_file in supabase/tests/*.sql; do
  if [ ! -f "$sql_file" ]; then
    continue
  fi

  psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$sql_file"
done
