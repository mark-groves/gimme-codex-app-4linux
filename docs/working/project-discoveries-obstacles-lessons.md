# Project Discoveries, Obstacles, And Lessons Learned

Last updated: 2026-05-03.

This document records how this repo moved from "can we run the Codex desktop app on Omarchy?" to a working local Linux build pipeline. It is written for future maintainers and agents so they can understand the reasoning, avoid old traps, and continue from the current state instead of rediscovering everything.

## Goal

The goal is not to install somebody else's unofficial Linux package. The goal is to own a local, inspectable, rebuildable path for running the Codex desktop app on Linux, especially Omarchy / Arch / Hyprland.

The current strategy is:

1. Use OpenAI's official Codex macOS appcast as the source.
2. Download the official macOS archive locally.
3. Extract the Electron application payload.
4. Pair it with the matching official Linux Electron runtime.
5. Rebuild native Node modules locally for Linux.
6. Launch with the Linux Codex CLI.

Generated OpenAI-derived app artifacts stay out of git.

## Important Discovery: The App Is Electron

The macOS archive contains a normal Electron app layout:

```text
Codex.app/
  Contents/
    Info.plist
    MacOS/Codex
    Resources/app.asar
    Resources/app.asar.unpacked/
    Resources/plugins/
```

The extracted app `package.json` showed:

- app package name: `openai-codex-electron`
- app version: `26.429.30905`
- main entry: `.vite/build/bootstrap.js`
- Electron version: `41.2.0`
- production build number: `2345`
- production Sparkle feed: `https://persistent.oaistatic.com/codex-app-prod/appcast.xml`

That made a native Linux port plausible without modifying the app UI: the platform-specific work is mostly runtime replacement and native module rebuilds.

## Upstream State At Time Of Work

Verified on 2026-05-03:

- production: `26.429.30905`, build `2345`, published 2026-05-01
- beta: `26.429.21146`, build `2317`, published 2026-04-30

The appcast URLs are:

```text
https://persistent.oaistatic.com/codex-app-prod/appcast.xml
https://persistent.oaistatic.com/codex-app-beta/appcast.xml
```

The repo tracks a snapshot in `data/upstream.json`, and `scripts/check-upstream.mjs` can compare live appcasts against that snapshot.

## What Was Built

The core implementation is now:

```text
scripts/build-linux-app.mjs
scripts/lib/asar.mjs
scripts/extract-asar.mjs
scripts/install-local.sh
scripts/omarchy-quickstart.sh
```

The builder output looks like:

```text
dist/codex-linux-prod-26.429.30905/
  codex-linux
  codex-electron
  resources/
    app/
    plugins/
    codex-linux-build.json
```

`codex-linux` is the launcher. `codex-electron` is the renamed Linux Electron runtime. `resources/app` is the extracted Electron app.

## Why We Wrote Our Own ASAR Reader

The project needed to be independent of third-party conversion tooling. The ASAR format used here is simple enough for our needs:

- read the header size from the ASAR prelude
- parse the JSON file table
- copy each file out by offset and size
- skip unpacked file placeholders, then rebuild/copy the native unpacked modules separately

This lives in `scripts/lib/asar.mjs`. It is intentionally small and specific to the build pipeline.

## Native Modules

The macOS app contains native modules compiled for Darwin/arm64. They cannot run on Linux.

The current required native modules are:

| Module | Version | Why it matters |
| --- | --- | --- |
| `better-sqlite3` | `12.8.0` | local SQLite state |
| `node-pty` | `1.1.0` | terminal / pseudoterminal support |

The builder reads these versions from the extracted app, creates a temporary npm project, installs source packages, and runs:

```bash
npx electron-rebuild --version 41.2.0 --force --module-dir <native-build-dir>
```

Only runtime packages are copied into the final app. The rebuild toolchain stays in `.cache`.

## Critical Obstacle: Packaged Mode

The first smoke test launched Electron directly from the npm-installed Electron distribution:

```text
dist/.../electron
```

That started the app, but Electron reported `app.isPackaged=false`. The Codex app then behaved like a development build and attempted to load:

```text
http://localhost:5175/
```

That failed because no Vite dev server exists in this converted app.

The fix was to rename the Electron binary:

```text
electron -> codex-electron
```

With the renamed binary, Electron treated the app as packaged:

```text
packaged=true
```

That made the app load bundled `app://` assets instead of trying the dev server.

Future agents should preserve this. Do not "clean up" the renamed runtime back to `electron`.

## Critical Obstacle: Build Flavor

After packaged mode worked, the app still needed production metadata. Without explicit environment, logs showed missing build flavor metadata and fallback behavior.

The generated launcher now sets:

```bash
BUILD_FLAVOR=prod
CODEX_BUILD_NUMBER=2345
NODE_ENV=production
```

This produced the desired startup path:

```text
buildFlavor=prod
allowDebugMenu=false
allowDevtools=false
enableUpdater=false
platform=linux
```

The app's own Sparkle updater is macOS-only and remains disabled on Linux.

## Critical Obstacle: Codex CLI Path

The desktop app talks to a local app server by spawning the Codex CLI. On Linux, the converted app must be pointed at the Linux CLI.

The launcher sets `CODEX_CLI_PATH` when it can find `codex` on `PATH`:

```bash
export CODEX_CLI_PATH="$(command -v codex)"
```

Smoke testing confirmed that the app spawned the CLI and completed the initial handshake.

One remaining local-machine caveat: during this work, `codex` resolved to a transient `npx` cache path:

```text
/home/grovr/.npm/_npx/.../node_modules/.bin/codex
```

That works but is not ideal. Future hardening should make the launcher prefer a stable CLI path, or install `@openai/codex` into a durable prefix.

## Omarchy / Hyprland Notes

The smoke test ran on:

```text
OS: Linux
Arch: x86_64
Desktop: Hyprland
Session: wayland
```

The generated launcher sets:

```bash
ELECTRON_OZONE_PLATFORM_HINT=auto
```

Wayland warnings appeared during startup, but they were non-fatal. The main window reached `ready-to-show`.

Do not use `--disable-gpu` for smoke testing. That caused an avoidable GPU-access error from app/Sentry GPU info collection. A normal launch without that flag worked.

## Smoke Test Evidence

The successful local launch reached:

```text
packaged=true
buildFlavor=prod
platform=linux
window ready-to-show
Codex CLI initialized
app_server_connection.state_changed ... next=connected
```

It also handled initial requests such as:

```text
account/read
thread/list
config/read
skills/list
plugin/list
```

On first startup, the app downloaded OpenAI's Linux primary runtime. That appears to be normal current app behavior and is not part of this repo's packaging.

## What Not To Do

Do not reintroduce AUR packages as the primary solution.

Do not depend on third-party Linux repacks, AppImages, or release artifacts.

Do not commit generated app output from `dist/`, `.cache/`, or extracted OpenAI app files.

Do not launch the final app by running the unrenamed `electron` binary.

Do not disable GPU during basic smoke tests unless investigating rendering problems.

Do not assume the Codex CLI path is stable just because `command -v codex` returns something.

## Current Commands

Build:

```bash
node scripts/build-linux-app.mjs --channel prod
```

Install local launcher:

```bash
bash scripts/install-local.sh
```

Launch:

```bash
codex-linux
```

Diagnostics:

```bash
bash scripts/check-local.sh
make check
node scripts/check-upstream.mjs --compare data/upstream.json
```

## Future Work

The next best improvements are:

1. Make `codex-linux` prefer a stable CLI install over transient `npx` cache paths.
2. Add a pacman package builder for Omarchy, still built locally from official upstream.
3. Add icon extraction from `electron.icns` into PNG desktop icons.
4. Add a local update command that rebuilds when `scripts/check-upstream.mjs` detects appcast drift.
5. Improve beta-channel install support in `scripts/install-local.sh`.
6. Add a focused smoke-test script that launches with an isolated `CODEX_ELECTRON_USER_DATA_PATH` and checks logs for `ready-to-show` plus CLI connection.

## Lesson For Future Agentic Work

The biggest lesson is that this problem was not solved by finding "a Linux build." It was solved by reducing the macOS app to its portable Electron parts, then identifying the minimum platform-specific requirements:

- packaged-mode Electron runtime
- Linux native modules
- Linux Codex CLI path
- production build environment
- Wayland-compatible launch defaults

For future agents: inspect the artifact first, then build the smallest owned pipeline around the facts found in the artifact. External projects can be useful signals, but they should not become the architecture unless the user explicitly wants that dependency.
