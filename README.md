# Codex App on Linux / Omarchy

This repo builds a local Linux version of the OpenAI Codex desktop app, with Omarchy / Arch as the primary target.

As of 2026-05-03, OpenAI's official Codex app downloads are for macOS and Windows. The official docs show a Linux notification signup, not a Linux build. The Codex CLI is officially available on Linux.

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
7. Installs a `codex-linux` symlink and desktop entry.

Manual equivalent:

```bash
sudo pacman -S --needed nodejs npm base-devel git curl p7zip unzip zstd python openai-codex
node scripts/build-linux-app.mjs --channel prod
bash scripts/install-local.sh
codex-linux
```

On Omarchy / Arch, `openai-codex` installs the stable CLI at `/usr/bin/codex`. The generated launcher prefers that pacman-managed binary over older `npx` wrappers or transient npm cache paths. If you are not on Arch, install the official CLI into a stable location:

```bash
npm i -g @openai/codex
```

## Current Upstream

Check the current upstream appcast metadata:

```bash
node scripts/check-upstream.mjs
```

The tracked snapshot lives in [data/upstream.json](data/upstream.json), and the scheduled GitHub workflow in [.github/workflows/upstream-watch.yml](.github/workflows/upstream-watch.yml) flags appcast drift every 6 hours.

Verified on 2026-05-03:

- production appcast: `26.429.30905`, published 2026-05-01, build `2345`
- beta appcast: `26.429.21146`, published 2026-04-30, build `2317`

## Build Output

Generated output is local-only and ignored by git:

- `dist/codex-linux-prod-<version>/codex-linux`: launcher that sets Omarchy/Wayland and Codex CLI environment.
- `dist/codex-linux-prod-<version>/codex-electron`: renamed Linux Electron runtime so Electron treats the app as packaged.
- `dist/codex-linux-prod-<version>/resources/app`: extracted Codex Electron app.
- `dist/codex-linux-prod-<version>/resources/codex-linux-build.json`: source URL, appcast build, SHA-256, Electron version, and target platform.

## Docs

- [Research notes](docs/research.md)
- [Omarchy install details](docs/omarchy.md)
- [Builder design](docs/design.md)
- [Native modules](docs/native-modules.md)

## Caveats

This Linux build is unofficial and may break when OpenAI changes app internals. Do not commit or publish extracted OpenAI app assets from this repo. The build artifacts stay in ignored local directories.
