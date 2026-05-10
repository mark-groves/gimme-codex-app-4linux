# Codex App on Linux / Omarchy

This repo builds a local Linux version of the OpenAI Codex desktop app, with Omarchy / Arch as the primary target.

As of 2026-05-04, OpenAI's official Codex app downloads are for macOS and Windows. The official docs show a Linux notification signup, not a Linux build. The Codex CLI is officially available on Linux.

This repo does not use AUR packages, third-party repacks, or third-party Linux binaries. It downloads OpenAI's official macOS app archive, extracts the Electron app, pairs it with the matching official Electron Linux runtime, rebuilds native modules locally, and creates a local launcher.

## Omarchy Quick Start

```bash
bash scripts/omarchy-quickstart.sh
```

That script:

1. Installs Arch/Omarchy prerequisites with `pacman`.
2. Ensures the official Codex CLI is installed.
3. Downloads the current OpenAI Codex app from the official appcast.
4. Extracts `app.asar` with this repo's own ASAR extractor.
5. Downloads the matching Electron Linux runtime.
6. Rebuilds `better-sqlite3` and `node-pty` locally for Electron/Linux.
7. Installs a `codex-linux` symlink, desktop entry, and hicolor desktop icons.

Recommended manual path:

```bash
sudo pacman -S --needed nodejs npm base-devel git curl p7zip unzip zstd python openai-codex
make update
codex-linux
```

`make update` is the normal local update path. It checks the live production appcast, rebuilds the converted Linux app only when prod has changed or the matching local build is missing, refreshes the user-local launcher/desktop/icon install, and updates [data/upstream.json](data/upstream.json) only after a successful build and install.

To mirror the quickstart script's lower-level build/install steps:

```bash
node scripts/build-linux-app.mjs --channel prod
bash scripts/install-local.sh
```

To build a local pacman package instead of installing the lightweight user symlink:

```bash
make build
make pacman-package
sudo pacman -U dist/pacman/codex-linux-*.pkg.tar.zst
codex-linux
```

The package is local and unofficial. It installs the converted app to `/opt/codex-linux`, exposes `/usr/bin/codex-linux`, and owns `/usr/share/applications/codex-linux.desktop` plus `/usr/share/icons/hicolor/.../apps/codex-linux.png`. It does not install automatically; use `sudo pacman -U` explicitly when you want the package on the system.

Run a focused graphical smoke test against the newest build in `dist/`:

```bash
make smoke-test
```

The smoke test launches with a temporary `CODEX_ELECTRON_USER_DATA_PATH`, waits for the app window to reach `ready-to-show`, and confirms the Codex CLI connection appears in the app logs. It must run from a desktop session with `DISPLAY` or `WAYLAND_DISPLAY` set.

On Omarchy / Arch, `openai-codex` installs the stable CLI at `/usr/bin/codex`. The generated launcher prefers that pacman-managed binary over older `npx` wrappers or transient npm cache paths. If you are not on Arch, install the official CLI into a stable location:

```bash
npm i -g @openai/codex
```

## Current Upstream

Check the current upstream appcast metadata:

```bash
node scripts/check-upstream.mjs
```

The tracked snapshot lives in [data/upstream.json](data/upstream.json). Compare live appcasts against it with:

```bash
node scripts/check-upstream.mjs --compare data/upstream.json
```

Limit the comparison to a channel when only that channel is actionable:

```bash
node scripts/check-upstream.mjs --compare data/upstream.json --compare-channel prod
```

The scheduled GitHub workflow in [.github/workflows/upstream-watch.yml](.github/workflows/upstream-watch.yml) runs every 6 hours. It fetches live prod and beta metadata, uploads that metadata as an artifact, and opens or updates a PR when the production appcast changes. Beta remains visible in the snapshot and artifact, but beta-only drift does not create a PR because the local update/install path is currently prod-only.

When the generated prod update PR merges, run the normal local update path to build and install the new version:

```bash
make update
```

The launched Linux app shows a small version label in the sidebar footer, for example `Codex 26.506.31421 | prod 2620`, so the visible UI can be matched to the converted app package and appcast build. Set `CODEX_LINUX_VERSION_BADGE=0` when launching to hide it.

## Build Output

Generated output is local-only and ignored by git:

- `dist/codex-linux-prod-<version>/codex-linux`: launcher that sets Omarchy/Wayland and Codex CLI environment.
- `dist/codex-linux-prod-<version>/codex-electron`: renamed Linux Electron runtime so Electron treats the app as packaged.
- `dist/codex-linux-prod-<version>/codex-linux.desktop`: generated user-local desktop entry.
- `dist/codex-linux-prod-<version>/README-linux-build.txt`: short local launch note.
- `dist/codex-linux-prod-<version>/resources/app`: extracted Codex Electron app.
- `dist/codex-linux-prod-<version>/resources/electron.icns`: upstream icon source copied from the macOS bundle.
- `dist/codex-linux-prod-<version>/resources/icons/hicolor`: desktop PNG icons extracted from the upstream `electron.icns`.
- `dist/codex-linux-prod-<version>/resources/plugins`: bundled plugin resources copied from the upstream app.
- `dist/codex-linux-prod-<version>/resources/codex-linux-build.json`: source URL, appcast build, SHA-256, Electron version, and target platform.
- `dist/pacman/codex-linux-<version>.<build>-1-x86_64.pkg.tar.zst`: optional local Arch package built from the prod output.

## Maintenance Checks

Run non-graphical checks before committing script or doc changes:

```bash
make check
```

Run environment diagnostics when debugging local installs:

```bash
make local-diagnostics
```

## Docs

- [Research notes](docs/research.md)
- [Omarchy install details](docs/omarchy.md)
- [Builder design](docs/design.md)
- [Native modules](docs/native-modules.md)

## Caveats

This Linux build is unofficial and may break when OpenAI changes app internals. Do not commit or publish extracted OpenAI app assets from this repo. The build artifacts stay in ignored local directories.
