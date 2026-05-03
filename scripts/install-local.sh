#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

latest_build="$(
  find "$repo_root/dist" -maxdepth 1 -type d -name 'codex-linux-prod-*' 2>/dev/null \
    | LC_ALL=C sort -V \
    | tail -n 1
)"

if [ -z "$latest_build" ]; then
  printf 'No local build found. Run:\n' >&2
  printf '  node scripts/build-linux-app.mjs --channel prod\n' >&2
  exit 1
fi

mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications"
ln -sfn "$latest_build/codex-linux" "$HOME/.local/bin/codex-linux"
cp "$latest_build/codex-linux.desktop" "$HOME/.local/share/applications/codex-linux.desktop"

printf 'Installed launcher: %s\n' "$HOME/.local/bin/codex-linux"
printf 'Installed desktop entry: %s\n' "$HOME/.local/share/applications/codex-linux.desktop"
