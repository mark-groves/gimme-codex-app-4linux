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
sudo pacman -S --needed nodejs npm base-devel git curl p7zip unzip zstd python openai-codex
```

On Omarchy / Arch, `openai-codex` installs the stable Codex CLI at `/usr/bin/codex`. The generated app launcher prefers that pacman-managed binary, even if an older `~/.local/bin/codex` npx wrapper appears earlier on `PATH`.

Build and install the local launcher:

```bash
node scripts/build-linux-app.mjs --channel prod
bash scripts/install-local.sh
```

The local installer writes the desktop entry to `${XDG_DATA_HOME:-$HOME/.local/share}/applications` and installs the generated hicolor icons to `${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor`.

Or build a local pacman package and install it explicitly:

```bash
make build
make pacman-package
sudo pacman -U dist/pacman/codex-linux-*.pkg.tar.zst
```

The package installs the app under `/opt/codex-linux`, adds `/usr/bin/codex-linux`, and registers a package-owned desktop entry and hicolor icon set. It deliberately packages the bundled Electron runtime from the converted app, so it depends on the Electron runtime libraries but not on Arch's `electron41` package.

Beta channel:

```bash
node scripts/build-linux-app.mjs --channel beta
```

## Hyprland / Wayland Notes

Omarchy commonly runs Hyprland. The generated launcher defaults to Xwayland because native Wayland can leave transparent underdraw when Hyprland tiles the Electron window larger than the renderer viewport. The launcher also detects the focused Hyprland monitor scale and passes `--force-device-scale-factor` when needed.

To force native Wayland for investigation:

```bash
CODEX_ELECTRON_OZONE_PLATFORM=wayland codex-linux
```

To override scale detection:

```bash
CODEX_ELECTRON_SCALE_FACTOR=1.5 codex-linux
```

## Verify

```bash
codex --version
command -v codex-linux
```

If the app cannot find the CLI:

```bash
export CODEX_CLI_PATH=/usr/bin/codex
codex-linux
```
