#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
xdg_data_home="${XDG_DATA_HOME:-$HOME/.local/share}"

usage() {
  cat <<'EOF'
Usage: bash scripts/install-local.sh [--build-dir path]

Install the converted prod Codex Linux app into the current user's local bin,
desktop applications, and hicolor icon directories.

Options:
  --build-dir path  Install this exact converted build directory.
  -h, --help        Show this help.
EOF
}

build_dir=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --build-dir)
      if [ "$#" -lt 2 ] || [[ "$2" == --* ]]; then
        printf '%s requires a path\n' "$1" >&2
        exit 1
      fi
      build_dir="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ -z "$build_dir" ]; then
  if [ -d "$repo_root/dist" ]; then
    build_dir="$(
      find "$repo_root/dist" -maxdepth 1 -type d -name 'codex-linux-prod-*' 2>/dev/null \
        | LC_ALL=C sort -V \
        | tail -n 1
    )"
  fi
fi

if [ -z "$build_dir" ]; then
  printf 'No local build found. Run:\n' >&2
  printf '  node scripts/build-linux-app.mjs --channel prod\n' >&2
  exit 1
fi

if [ ! -d "$build_dir" ]; then
  printf 'Build directory does not exist: %s\n' "$build_dir" >&2
  exit 1
fi

build_dir="$(cd -- "$build_dir" && pwd -P)"

if [ ! -x "$build_dir/codex-linux" ]; then
  printf 'Build is missing executable launcher: %s\n' "$build_dir/codex-linux" >&2
  exit 1
fi

if [ ! -f "$build_dir/codex-linux.desktop" ]; then
  printf 'Build is missing desktop entry: %s\n' "$build_dir/codex-linux.desktop" >&2
  exit 1
fi

mkdir -p "$HOME/.local/bin" "$xdg_data_home/applications" "$xdg_data_home/icons"
ln -sfn "$build_dir/codex-linux" "$HOME/.local/bin/codex-linux"
cp "$build_dir/codex-linux.desktop" "$xdg_data_home/applications/codex-linux.desktop"

if [ -d "$build_dir/resources/icons/hicolor" ]; then
  mkdir -p "$xdg_data_home/icons/hicolor"
  cp -a "$build_dir/resources/icons/hicolor/." "$xdg_data_home/icons/hicolor/"
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q -t "$xdg_data_home/icons/hicolor" >/dev/null 2>&1 || true
  fi
fi

printf 'Installed launcher: %s\n' "$HOME/.local/bin/codex-linux"
printf 'Installed desktop entry: %s\n' "$xdg_data_home/applications/codex-linux.desktop"
printf 'Installed icons: %s\n' "$xdg_data_home/icons/hicolor"
