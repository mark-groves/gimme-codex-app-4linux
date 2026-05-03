#!/usr/bin/env bash
set -Eeuo pipefail

timeout_seconds="${CODEX_SMOKE_TIMEOUT:-45}"
build_dir="${CODEX_SMOKE_BUILD_DIR:-}"
keep_user_data="${CODEX_SMOKE_KEEP_USER_DATA:-}"
log_path="${CODEX_SMOKE_LOG:-}"

usage() {
  cat <<'EOF'
Usage: bash scripts/smoke-test.sh [build-dir]

Launch a converted Codex Linux build with isolated user data and wait for:
  - window ready-to-show
  - Codex CLI initialized or app_server_connection ... next=connected

Environment:
  CODEX_SMOKE_TIMEOUT=45          Seconds to wait before failing.
  CODEX_SMOKE_BUILD_DIR=path      Build directory when no argument is passed.
  CODEX_SMOKE_LOG=path            Log path. Defaults to a temporary file.
  CODEX_SMOKE_KEEP_USER_DATA=1    Keep the temporary user-data directory.
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

if [ "$#" -gt 1 ]; then
  usage >&2
  exit 2
fi

if [ -n "${1:-}" ]; then
  build_dir="$1"
fi

if [ -z "$build_dir" ] && [ -d dist ]; then
  build_dir="$(find dist -maxdepth 1 -type d -name 'codex-linux-*' -printf '%T@ %p\n' 2>/dev/null | sort -nr | awk 'NR == 1 { print $2 }')"
fi

if [ -z "$build_dir" ]; then
  printf 'No converted build found under dist/. Run: node scripts/build-linux-app.mjs --channel prod\n' >&2
  exit 1
fi

if [ ! -x "$build_dir/codex-linux" ]; then
  printf 'Build launcher is missing or not executable: %s/codex-linux\n' "$build_dir" >&2
  exit 1
fi

if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
  printf 'No graphical display detected. Run this from a desktop session with DISPLAY or WAYLAND_DISPLAY set.\n' >&2
  exit 1
fi

if [ -n "${CODEX_CLI_PATH:-}" ]; then
  if [ ! -x "$CODEX_CLI_PATH" ]; then
    printf 'CODEX_CLI_PATH is set but not executable: %s\n' "$CODEX_CLI_PATH" >&2
    exit 1
  fi
elif ! command -v codex >/dev/null 2>&1 && [ ! -x /usr/bin/codex ] && [ ! -x /usr/local/bin/codex ] && [ ! -x "$HOME/.local/bin/codex" ]; then
  printf 'Codex CLI was not found. Set executable CODEX_CLI_PATH or install codex on PATH, /usr/bin/codex, /usr/local/bin/codex, or ~/.local/bin/codex.\n' >&2
  exit 1
fi

if [ -z "$log_path" ]; then
  log_path="$(mktemp -t codex-linux-smoke-log.XXXXXX)"
fi

user_data_dir="$(mktemp -d -t codex-linux-smoke-user-data.XXXXXX)"
pid=""

cleanup() {
  local status=$?

  if [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    wait "$pid" >/dev/null 2>&1 || true
  fi

  if [ -z "$keep_user_data" ]; then
    rm -rf "$user_data_dir"
  else
    printf 'Kept user data: %s\n' "$user_data_dir"
  fi

  exit "$status"
}
trap cleanup EXIT INT TERM

printf 'Build:     %s\n' "$build_dir"
printf 'User data: %s\n' "$user_data_dir"
printf 'Log:       %s\n' "$log_path"

CODEX_ELECTRON_USER_DATA_PATH="$user_data_dir" \
  "$build_dir/codex-linux" >"$log_path" 2>&1 &
pid="$!"

deadline=$((SECONDS + timeout_seconds))
ready_seen=0
cli_seen=0

while [ "$SECONDS" -lt "$deadline" ]; do
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    printf 'Smoke test process exited before readiness checks completed.\n' >&2
    tail -n 80 "$log_path" >&2 || true
    exit 1
  fi

  if [ "$ready_seen" -eq 0 ] && grep -Eq 'window ready-to-show|ready-to-show' "$log_path"; then
    ready_seen=1
    printf 'Observed:  window ready-to-show\n'
  fi

  if [ "$cli_seen" -eq 0 ] && grep -Eq 'Codex CLI initialized|app_server_connection\.state_changed.*next=connected' "$log_path"; then
    cli_seen=1
    printf 'Observed:  Codex CLI connection\n'
  fi

  if [ "$ready_seen" -eq 1 ] && [ "$cli_seen" -eq 1 ]; then
    printf 'Smoke test passed.\n'
    exit 0
  fi

  sleep 1
done

printf 'Smoke test timed out after %s seconds.\n' "$timeout_seconds" >&2
printf 'Missing readiness checks:' >&2
if [ "$ready_seen" -eq 0 ]; then
  printf ' ready-to-show' >&2
fi
if [ "$cli_seen" -eq 0 ]; then
  printf ' cli-connection' >&2
fi
printf '\n\nLast log lines:\n' >&2
tail -n 120 "$log_path" >&2 || true
exit 1
