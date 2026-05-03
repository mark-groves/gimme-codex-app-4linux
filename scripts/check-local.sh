#!/usr/bin/env bash
set -Eeuo pipefail

check_command() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    local path
    path="$(command -v "$name")"
    if [ "$name" = "codex" ] && [[ "$path" == *"/.npm/_npx/"* ]]; then
      printf '%-18s %s (transient npx cache)\n' "$name" "$path"
    else
      printf '%-18s %s\n' "$name" "$path"
    fi
  else
    printf '%-18s missing\n' "$name"
  fi
}

printf 'OS:       %s\n' "$(uname -s)"
printf 'Arch:     %s\n' "$(uname -m)"
printf 'Desktop:  %s\n' "${XDG_CURRENT_DESKTOP:-unknown}"
printf 'Session:  %s\n' "${XDG_SESSION_TYPE:-unknown}"
printf '\nCommands:\n'

for name in node npm npx codex codex-linux pacman unzip gcc make python; do
  check_command "$name"
done

if command -v codex >/dev/null 2>&1; then
  printf '\nCodex CLI:\n'
  codex --version || true
fi
