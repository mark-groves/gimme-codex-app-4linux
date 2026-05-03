# Omarchy Install Details

Omarchy is Arch-based, so the build path is Pacman plus local Node/npm tooling. No AUR package or third-party repack is used.

## Quick Start

```bash
bash scripts/omarchy-quickstart.sh
```

Then launch:

```bash
codex-linux
```

## Manual Install

Install prerequisites:

```bash
sudo pacman -S --needed nodejs npm base-devel git curl p7zip unzip zstd python
```

Install the official Codex CLI:

```bash
npm i -g @openai/codex
```

If that fails because npm's global prefix is not writable:

```bash
npm i -g --prefix ~/.local @openai/codex
export PATH="$HOME/.local/bin:$PATH"
```

Build and install the local launcher:

```bash
node scripts/build-linux-app.mjs --channel prod
bash scripts/install-local.sh
```

Beta channel:

```bash
node scripts/build-linux-app.mjs --channel beta
```

## Hyprland / Wayland Notes

Omarchy commonly runs Hyprland. The generated launcher defaults `ELECTRON_OZONE_PLATFORM_HINT=auto`. If windows or popups behave oddly, launch with:

```bash
ELECTRON_OZONE_PLATFORM_HINT=auto codex-linux
```

If that is worse, force XWayland:

```bash
codex-linux --ozone-platform=x11
```

## Verify

```bash
codex --version
command -v codex-linux
```

If the app cannot find the CLI:

```bash
export CODEX_CLI_PATH="$(command -v codex)"
codex-linux
```
