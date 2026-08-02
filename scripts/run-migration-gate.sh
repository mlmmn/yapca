#!/usr/bin/env sh

set -eu

export LC_ALL=C

# The gate resets the local database, so resolve every path from the repository root.
cd "$(dirname "$0")/.."

base_ref="${MIGRATION_GATE_BASE_REF:-origin/main}"
database_url="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
baseline_files="$(git ls-tree -r --name-only "$base_ref" -- supabase/migrations | sort)"
baseline_versions="$(printf '%s\n' "$baseline_files" | sed '/^$/d; s#^.*/##; s/_.*//' | sort)"
baseline_version="$(printf '%s\n' "$baseline_versions" | tail -n 1)"
new_versions=""

restore_database() {
  gate_status=$?

  trap - 0

  if [ "$gate_status" -eq 0 ]; then
    echo "Migration gate passed; restoring the full local schema and seed data."
    if ! pnpm exec supabase db reset --local; then
      echo "Migration gate passed, but the local database reset failed." >&2
      exit 1
    fi
  else
    echo "Migration gate failed. Fix or remove the failing migration, then run: pnpm exec supabase db reset --local" >&2
  fi

  exit "$gate_status"
}

if [ -z "$baseline_version" ]; then
  echo "Migration history integrity error: no baseline migrations found in $base_ref." >&2
  exit 1
fi

while IFS="$(printf '\t')" read -r status first_path second_path; do
  if [ -z "$status" ]; then
    continue
  fi

  case "$status" in
    A)
      version="$(basename "$first_path" | sed 's/_.*//')"
      new_versions="${new_versions}${version}\n"
      ;;
    *)
      echo "Migration history integrity error: baseline migrations are add-only; found $status for $first_path${second_path:+ -> $second_path}." >&2
      exit 1
      ;;
  esac
done <<EOF
$(git diff --name-status --find-renames --find-copies "$base_ref" -- supabase/migrations)
EOF

new_versions="$(printf '%b' "$new_versions" | sed '/^$/d' | sort -u)"

if [ -z "$new_versions" ]; then
  echo "SKIP: no new migrations relative to $base_ref."
  exit 0
fi

for new_version in $new_versions; do
  if [ "$new_version" -le "$baseline_version" ]; then
    echo "Migration history integrity error: new migration $new_version is not later than baseline $baseline_version." >&2
    exit 1
  fi
done

trap restore_database 0

pnpm exec supabase db reset --version "$baseline_version" --no-seed --local

applied_versions="$(psql "$database_url" -At -v ON_ERROR_STOP=1 -c 'select version from supabase_migrations.schema_migrations order by version;')"

if [ "$applied_versions" != "$baseline_versions" ]; then
  echo "Migration baseline self-check failed: --version $baseline_version applied an unexpected migration set." >&2
  echo "Expected:" >&2
  printf '%s\n' "$baseline_versions" >&2
  echo "Applied:" >&2
  printf '%s\n' "$applied_versions" >&2
  exit 1
fi

psql "$database_url" -v ON_ERROR_STOP=1 -f supabase/migration-gate/baseline-fixture.sql
pnpm exec supabase migration up --local
psql "$database_url" -v ON_ERROR_STOP=1 -f supabase/migration-gate/assert-survival.sql

echo "Migration gate asserted fixture row survival after migration up."
