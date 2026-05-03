# Omarchy Install Details

Omarchy is Arch-based, so the build path is Pacman plus local Node/npm tooling. No AUR package or third-party repack is used.

## Quick Start

```bash
bash scripts/omarchy-quickstart.sh
```

The quickstart installs Arch prerequisites and runs the lower-level prod build/install path. For routine updates after the initial setup, prefer `make update`.

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
make update
```

`make update` checks the live prod appcast, rebuilds only when the tracked prod version/build changed or the matching local build is missing/stale, installs that exact build, and updates `data/upstream.json` only after build/install succeeds.

To force the lower-level build/install path:

```bash
node scripts/build-linux-app.mjs --channel prod
bash scripts/install-local.sh
```

The local installer writes `~/.local/bin/codex-linux`, copies the desktop entry to `${XDG_DATA_HOME:-$HOME/.local/share}/applications`, and installs the generated hicolor icons to `${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor`.

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

The default installer and pacman package builder select prod builds. For beta testing, launch the generated beta build directly or pass an explicit beta build path to tools that support `--build-dir`.

## Hyprland / Wayland Notes

Omarchy commonly runs Hyprland. The generated launcher defaults to Xwayland because native Wayland can leave resize and underdraw artifacts when Hyprland tiles the Electron window larger than the renderer viewport. The launcher also detects the focused Hyprland monitor scale and passes `--force-device-scale-factor` when needed.

The builder also patches the app's primary and secondary Linux windows to be opaque, and clears Electron's default Linux application menu during startup.

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
make local-diagnostics
```

If the app cannot find the CLI:

```bash
export CODEX_CLI_PATH=/usr/bin/codex
codex-linux
```

For a live graphical launch check:

```bash
make smoke-test
```
