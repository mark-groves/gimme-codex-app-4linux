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
  sudo pacman -S --needed nodejs npm base-devel git curl p7zip unzip zstd python
}

ensure_local_bin_on_path() {
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *)
      export PATH="$HOME/.local/bin:$PATH"
      warn "Added ~/.local/bin to PATH for this shell. Add it to your shell profile if Codex was installed there."
      ;;
  esac
}

install_codex_cli() {
  if command -v codex >/dev/null 2>&1; then
    local codex_path
    codex_path="$(command -v codex)"
    if [[ "$codex_path" != *"/.npm/_npx/"* ]]; then
      info "Codex CLI already available: $codex_path"
      return
    fi
    warn "Codex CLI resolves to a transient npx cache path; installing a stable CLI"
  fi

  info "Installing official Codex CLI"
  if npm i -g @openai/codex; then
    return
  fi

  warn "Global npm install failed; retrying with --prefix ~/.local"
  npm i -g --prefix "$HOME/.local" @openai/codex
  ensure_local_bin_on_path
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
