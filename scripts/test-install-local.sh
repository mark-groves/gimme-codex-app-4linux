#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

mkdir -p "$tmp_dir/work/build" "$tmp_dir/home" "$tmp_dir/xdg"

printf '#!/usr/bin/env bash\nexit 0\n' >"$tmp_dir/work/build/codex-linux"
chmod +x "$tmp_dir/work/build/codex-linux"

cat >"$tmp_dir/work/build/codex-linux.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Codex
Exec=codex-linux
DESKTOP

(
  cd "$tmp_dir/work"
  HOME="$tmp_dir/home" XDG_DATA_HOME="$tmp_dir/xdg" \
    bash "$repo_root/scripts/install-local.sh" --build-dir build >/dev/null
)

launcher_link="$tmp_dir/home/.local/bin/codex-linux"
launcher_target="$(readlink "$launcher_link")"

case "$launcher_target" in
  /*) ;;
  *)
    printf 'expected absolute launcher symlink target, got: %s\n' "$launcher_target" >&2
    exit 1
    ;;
esac

if [ ! -x "$launcher_link" ]; then
  printf 'expected installed launcher symlink to resolve to an executable: %s\n' "$launcher_link" >&2
  exit 1
fi

if [ ! -f "$tmp_dir/xdg/applications/codex-linux.desktop" ]; then
  printf 'expected desktop entry to be installed\n' >&2
  exit 1
fi
