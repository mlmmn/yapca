#!/usr/bin/env sh

set -eu

export LC_ALL=C

# Run from the repo root so the glob resolves regardless of the caller's cwd.
cd "$(dirname "$0")/.."

executed_count=0

for sql_file in supabase/tests/*.sql; do
  if [ ! -f "$sql_file" ]; then
    continue
  fi

  psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$sql_file"
  executed_count=$((executed_count + 1))
done

# A suite that executed no files must not report success.
if [ "$executed_count" -eq 0 ]; then
  echo "No SQL test files found in supabase/tests/" >&2
  exit 1
fi
