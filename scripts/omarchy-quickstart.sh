#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

info() {
  printf '[info] %s\n' "$*"
}

warn() {
  printf '[warn] %s\n' "$*" >&2
}

require_arch_linux() {
  if ! command -v pacman >/dev/null 2>&1; then
    printf 'This quickstart targets Omarchy / Arch and needs pacman.\n' >&2
    exit 1
  fi
}

install_system_deps() {
  info "Installing Arch prerequisites"
  sudo pacman -S --needed nodejs npm base-devel git curl p7zip unzip zstd python openai-codex
}

install_codex_cli() {
  if [ -x /usr/bin/codex ]; then
    info "Codex CLI available from pacman: /usr/bin/codex"
    if [ -f "$HOME/.local/bin/codex" ] && head -n 8 "$HOME/.local/bin/codex" 2>/dev/null | grep -Eq 'npx .*@openai/codex|@openai/codex.*npx'; then
      warn "An older ~/.local/bin/codex npx wrapper exists before /usr/bin on Omarchy PATH"
      warn "The generated app launcher will prefer /usr/bin/codex; move the wrapper aside if terminal codex should also use pacman"
    fi
    return
  fi

  info "Installing official Codex CLI from pacman"
  sudo pacman -S --needed openai-codex
}

install_app() {
  info "Building local Codex Linux app from official OpenAI appcast"
  node scripts/build-linux-app.mjs --channel prod
  bash scripts/install-local.sh
}

main() {
  require_arch_linux
  install_system_deps
  install_codex_cli
  install_app

  printf '\nDone. Try one of:\n'
  printf '  codex-linux\n'
  printf '  dist/codex-linux-prod-*/codex-linux\n'
}

main "$@"
