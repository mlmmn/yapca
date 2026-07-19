echo "🔗 Setting up agent symlinks..."

REPO_ROOT="$(git rev-parse --show-toplevel)"
AGENTS_DIR="$REPO_ROOT/.agents"

if [ ! -d "$AGENTS_DIR" ]; then
  echo "⚠️  .agents directory not found, skipping symlink setup"
  exit 0
fi

for subdir in "$AGENTS_DIR"/*/; do
  name="$(basename "$subdir")"

  for target_dir in "$REPO_ROOT/.cursor" "$REPO_ROOT/.claude"; do
    mkdir -p "$target_dir"
    link="$target_dir/$name"

    if [ -L "$link" ]; then
      # Already a symlink — skip
      continue
    elif [ -e "$link" ]; then
      echo "⚠️  $link exists and is not a symlink, skipping"
      continue
    fi

    ln -s "../.agents/$name" "$link"
    echo "  ✅ $link -> ../.agents/$name"
  done
done

echo "🎉 Agent symlinks ready!"
