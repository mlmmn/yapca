#!/usr/bin/env sh

set -eu

export LC_ALL=C

# The gate resets the local database, so resolve every path from the repository root.
cd "$(dirname "$0")/.."

base_ref="${MIGRATION_GATE_BASE_REF:-origin/main}"
database_url="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
# Bare assignment so `set -e` sees git's status; piping it would report sort's.
if ! baseline_files="$(git ls-tree -r --name-only "$base_ref" -- supabase/migrations)"; then
  echo "Migration gate error: cannot read migrations from $base_ref; fetch the base ref first." >&2
  exit 1
fi

baseline_versions="$(printf '%s\n' "$baseline_files" | sed '/^$/d; s#^.*/##; s/_.*//' | sort)"
baseline_version="$(printf '%s\n' "$baseline_versions" | tail -n 1)"
new_versions=""

# `[ x -le y ]` inside an `if` suspends `set -e`, so a non-numeric version would
# make the ordering check silently pass. Reject the filename instead.
assert_version_format() {
  case "$1" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
    *)
      echo "Migration history integrity error: '$2' does not start with a 14-digit YYYYMMDDHHmmss version." >&2
      exit 1
      ;;
  esac
}

restore_database() {
  gate_status=$?

  trap - 0 INT TERM

  if [ -n "${CI:-}" ]; then
    # The CI container is discarded next; restoring it costs minutes of the job timeout.
    exit "$gate_status"
  fi

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

assert_version_format "$baseline_version" "$base_ref baseline"

# git never reports untracked files as added, so an uncommitted migration would
# reach the SKIP path and report a pass over SQL the gate never ran.
untracked_migrations="$(git ls-files --others --exclude-standard -- supabase/migrations)"

if [ -n "$untracked_migrations" ]; then
  echo "Migration gate error: untracked migrations are invisible to the baseline diff; git add them first:" >&2
  printf '%s\n' "$untracked_migrations" >&2
  exit 1
fi

if ! baseline_diff="$(git diff --name-status --find-renames --find-copies "$base_ref" -- supabase/migrations)"; then
  echo "Migration gate error: cannot diff supabase/migrations against $base_ref." >&2
  exit 1
fi

while IFS="$(printf '\t')" read -r status first_path second_path; do
  if [ -z "$status" ]; then
    continue
  fi

  case "$status" in
    A)
      version="$(basename "$first_path" | sed 's/_.*//')"
      assert_version_format "$version" "$first_path"
      new_versions="${new_versions}${version}\n"
      ;;
    *)
      echo "Migration history integrity error: baseline migrations are add-only; found $status for $first_path${second_path:+ -> $second_path}." >&2
      exit 1
      ;;
  esac
done <<EOF
$baseline_diff
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

trap restore_database 0 INT TERM

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

# `migration up` exits 0 even when it applies nothing, so assert the new
# versions actually landed before the survival assertions claim to prove them.
expected_versions="$(printf '%s\n%s\n' "$baseline_versions" "$new_versions" | sed '/^$/d' | sort -u)"
applied_versions="$(psql "$database_url" -At -v ON_ERROR_STOP=1 -c 'select version from supabase_migrations.schema_migrations order by version;')"

if [ "$applied_versions" != "$expected_versions" ]; then
  echo "Migration gate error: migration up did not apply the expected migration set." >&2
  echo "Expected:" >&2
  printf '%s\n' "$expected_versions" >&2
  echo "Applied:" >&2
  printf '%s\n' "$applied_versions" >&2
  exit 1
fi

psql "$database_url" -v ON_ERROR_STOP=1 -f supabase/migration-gate/assert-survival.sql

echo "Migration gate asserted fixture row survival after migration up."
