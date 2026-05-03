#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
xdg_data_home="${XDG_DATA_HOME:-$HOME/.local/share}"

latest_build=""
if [ -d "$repo_root/dist" ]; then
  latest_build="$(
    find "$repo_root/dist" -maxdepth 1 -type d -name 'codex-linux-prod-*' 2>/dev/null \
      | LC_ALL=C sort -V \
      | tail -n 1
  )"
fi

if [ -z "$latest_build" ]; then
  printf 'No local build found. Run:\n' >&2
  printf '  node scripts/build-linux-app.mjs --channel prod\n' >&2
  exit 1
fi

mkdir -p "$HOME/.local/bin" "$xdg_data_home/applications" "$xdg_data_home/icons"
ln -sfn "$latest_build/codex-linux" "$HOME/.local/bin/codex-linux"
cp "$latest_build/codex-linux.desktop" "$xdg_data_home/applications/codex-linux.desktop"

if [ -d "$latest_build/resources/icons/hicolor" ]; then
  mkdir -p "$xdg_data_home/icons/hicolor"
  cp -a "$latest_build/resources/icons/hicolor/." "$xdg_data_home/icons/hicolor/"
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q -t "$xdg_data_home/icons/hicolor" >/dev/null 2>&1 || true
  fi
fi

printf 'Installed launcher: %s\n' "$HOME/.local/bin/codex-linux"
printf 'Installed desktop entry: %s\n' "$xdg_data_home/applications/codex-linux.desktop"
printf 'Installed icons: %s\n' "$xdg_data_home/icons/hicolor"
