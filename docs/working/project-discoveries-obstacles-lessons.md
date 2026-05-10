# Project Discoveries, Obstacles, And Lessons Learned

Last updated: 2026-05-10.

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
scripts/update-local.mjs
scripts/build-pacman-package.sh
scripts/smoke-test.sh
scripts/check-local.sh
scripts/check-upstream.mjs
```

The builder output looks like:

```text
dist/codex-linux-prod-26.429.30905/
  codex-linux
  codex-electron
  codex-linux.desktop
  README-linux-build.txt
  resources/
    app/
    electron.icns
    icons/hicolor/
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

## Linux Visual Smoke Test: Electron Menu Bar

A visual launch test on Hyprland showed the converted Linux app rendered the Codex onboarding screen correctly, but Electron displayed its default Linux application menu:

```text
File Edit View Window Help
```

The app later refreshes its own application menu during startup, so clearing the menu once before `app.whenReady()` was not enough. The builder now patches the extracted bootstrap so `Menu.setApplicationMenu(...)` always clears the application menu in the Linux conversion. A rebuilt app screenshot confirmed the default menu bar was removed while startup still reached `ready-to-show` and the Codex CLI connected.

## Linux Visual Smoke Test: Hyprland Resize Gap

On Hyprland/Wayland, the app could tile to a larger native window while the renderer stayed at its original viewport size. DevTools confirmed the bad case reported `innerWidth=1024` and `innerHeight=680` even though Hyprland had tiled the window to a taller area, leaving transparent wallpaper visible below the onboarding surface.

Forcing Xwayland fixed the resize path. With the launcher passing `--ozone-platform=x11` plus `--force-device-scale-factor=2` on the focused 2x Hyprland monitor, DevTools reported `innerWidth=788`, `innerHeight=960`, `devicePixelRatio=2`, matching the tiled window. A screenshot confirmed the onboarding surface filled the window with no transparent bottom gap.

The launcher now defaults `CODEX_ELECTRON_OZONE_PLATFORM` to `x11`, detects the focused Hyprland monitor scale via `hyprctl monitors`, and passes `--force-device-scale-factor` when the detected scale is not 1. Set `CODEX_ELECTRON_OZONE_PLATFORM` or `CODEX_ELECTRON_SCALE_FACTOR` to override this behavior during future smoke tests.

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

The launcher resolves `CODEX_CLI_PATH` before starting Electron. It first honors an executable user-provided `CODEX_CLI_PATH`, then prefers stable locations such as:

```text
/usr/bin/codex
/usr/local/bin/codex
$HOME/.local/bin/codex
```

After checking those stable locations, it scans all executable `codex` matches from Bash `type -P -a` and selects the first candidate that is not an unstable `npx` wrapper or transient `/.npm/_npx/` cache path. Smoke testing confirmed that the app spawned the CLI and completed the initial handshake.

One remaining local-machine caveat: during this work, `codex` resolved to a transient `npx` cache path:

```text
/home/grovr/.npm/_npx/.../node_modules/.bin/codex
```

That worked during early testing but is not ideal; the generated launcher now rejects or warns on that class of path.

## Omarchy / Hyprland Notes

The smoke test ran on:

```text
OS: Linux
Arch: x86_64
Desktop: Hyprland
Session: wayland
```

Native Wayland startup reached `ready-to-show`, but visual testing showed a renderer resize mismatch under Hyprland tiling. Prefer the generated launcher's default Xwayland path for visual smoke tests unless specifically investigating native Wayland behavior.

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

Update local prod build and user install:

```bash
make update
```

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

1. Improve beta-channel install support in `scripts/install-local.sh`.

## Agent Guidance Update

On 2026-05-03, `AGENTS.md` was narrowed from "read this project history before every session" to "read it before making repository changes." This keeps the project memory active for code, script, documentation, packaging, and workflow edits without forcing simple questions or status checks to load and update the history document.

Future agents should still append concise durable discoveries after repository-changing sessions, especially when the work affects the Linux build pipeline, appcast update flow, Electron runtime behavior, native module rebuilds, or Omarchy/Hyprland launch behavior.

## Omarchy Codex CLI Package Note

On 2026-05-03, local inspection showed Omarchy / Arch has `openai-codex` in pacman `extra`, installing the stable CLI at `/usr/bin/codex`. This machine also had an older Omarchy-generated `~/.local/bin/codex` wrapper from `omarchy-npx-install` that executed `npx --yes @openai/codex`; because Omarchy prepends `~/.local/bin`, fresh shells resolved `codex` to the npx wrapper instead of the pacman package. Moving that wrapper aside made clean login and interactive shells resolve `codex` to `/usr/bin/codex`.

The generated launcher now prefers `/usr/bin/codex` when present and executable on Omarchy / Arch, then rejects or warns on `/.npm/_npx/` paths and local npx wrappers. The Omarchy quickstart installs `openai-codex` with pacman instead of installing the CLI through npm.

On 2026-05-03, PR review identified one remaining mixed-PATH edge case: after the preferred stable locations, a single `command -v codex` fallback could stop on an unstable npx wrapper even when a stable custom-prefix CLI appeared later on `PATH`. The generated launcher now scans all executable `codex` matches reported by Bash `type -P -a` and selects the first non-unstable candidate.

## Lesson For Future Agentic Work

The biggest lesson is that this problem was not solved by finding "a Linux build." It was solved by reducing the macOS app to its portable Electron parts, then identifying the minimum platform-specific requirements:

- packaged-mode Electron runtime
- Linux native modules
- Linux Codex CLI path
- production build environment
- Wayland-compatible launch defaults

For future agents: inspect the artifact first, then build the smallest owned pipeline around the facts found in the artifact. External projects can be useful signals, but they should not become the architecture unless the user explicitly wants that dependency.

## Focused Smoke Test Script

On 2026-05-03, `scripts/smoke-test.sh` was added to make the manual visual launch checks repeatable. It selects the newest `dist/codex-linux-*` build by default, launches `codex-linux` with an isolated temporary `CODEX_ELECTRON_USER_DATA_PATH`, captures logs, waits for `ready-to-show`, and confirms either `Codex CLI initialized` or `app_server_connection.state_changed ... next=connected`.

The target is intentionally a manual `make smoke-test` workflow, not part of `make check`, because it requires a live graphical session. A local run against `dist/codex-linux-prod-26.429.30905` passed on 2026-05-03.

On 2026-05-03, PR review found the smoke-test CLI preflight did not accept the launcher-supported `CODEX_CLI_PATH` configuration before checking fallback locations. The smoke test now treats an executable `CODEX_CLI_PATH` as sufficient, matching the generated launcher's supported stable CLI override.

On 2026-05-03, a follow-up review found the smoke-test preflight still missed the launcher's `$HOME/.local/bin/codex` fallback when that directory is not on `PATH`. Keep manual smoke-test CLI preflight checks aligned with `resolve_codex_cli` so supported launcher configurations are not rejected before launch.

On 2026-05-03, another review found `scripts/smoke-test.sh` could abort during default build discovery when `dist/` does not exist because the `find | sort | awk` command substitution runs under `set -e -o pipefail`. The script now checks for `dist/` before running discovery so first-run users reach the explicit "No converted build found" guidance.

## Local Pacman Package Builder

On 2026-05-03, `scripts/build-pacman-package.sh` added a v1 local Arch/Omarchy package path for prod builds. It consumes the newest `dist/codex-linux-prod-*` output by default, generates a temporary `PKGBUILD` under `.cache/pacman/codex-linux/`, and writes `dist/pacman/codex-linux-<app version>.<appcast build>-1-x86_64.pkg.tar.zst`.

The package installs the converted bundle to `/opt/codex-linux`, removes the build-directory desktop entry from that copy, adds a wrapper at `/usr/bin/codex-linux`, and registers `/usr/share/applications/codex-linux.desktop` with `Exec=/usr/bin/codex-linux %U`. The wrapper is intentional: a symlink can confuse launch/resource resolution because the app launcher relies on its executed path.

The package declares `openai-codex`, `alsa-lib`, and Arch Electron 41's runtime library dependencies, but it does not depend on `electron41` because this repo packages the matching bundled Electron runtime from the converted app. The `PKGBUILD` uses `options=('!strip' '!debug')` so makepkg does not rewrite bundled Electron or rebuilt native-module binaries.

On 2026-05-03, PR review found `scripts/build-pacman-package.sh` could abort during default prod build discovery when `dist/` does not exist because the `find | sort | tail` command substitution runs under `set -e -o pipefail`. The script now checks for `dist/` before running discovery so `make pacman-package` on a fresh checkout reaches the intended "no prod build found. Run: make build" guidance.

On 2026-05-03, PR review found the pacman package builder assumed makepkg wrote the package into the temporary package root and left older copied packages in `dist/pacman/`. The script now captures `makepkg --packagelist` before building, resolves the reported package path after `makepkg` runs so configured `PKGDEST` is honored, and removes stale `codex-linux-*.pkg.tar*` outputs before copying the new package so the documented `pacman -U dist/pacman/codex-linux-*.pkg.tar.zst` glob has only one target.

On 2026-05-03, PR review found newest prod build discovery used plain lexicographic ordering, which can choose an older build when version digit widths differ, such as `0.9` sorting after `0.10`. The pacman package builder and local installer now use `LC_ALL=C sort -V` for version-aware build selection.

On 2026-05-03, PR review found the pacman package builder accepted hyphenated upstream app versions in the generated `pkgver`, but Arch `pkgver` cannot contain hyphens. The builder now fails early unless the composed version uses only ASCII letters, digits, `.`, `_`, `+`, and `~`; prerelease-style upstream versions such as `1.2.3-beta.1` must be handled deliberately instead of silently normalized.

## Desktop Icon Extraction

On 2026-05-03, the builder added a pure Node ICNS parser for `electron.icns`. It validates the `icns` header, declared file length, per-entry bounds, PNG signatures, and IHDR dimensions, then writes embedded PNG entries to `resources/icons/hicolor/<size>/apps/codex-linux.png`, including normal sizes and available `@2` directories. The build fails if `electron.icns` is present but contains no usable PNG entries.

The generated desktop entry now uses `Icon=codex-linux`. The user-local installer respects `${XDG_DATA_HOME:-$HOME/.local/share}`, installs the desktop file and hicolor icon tree there, and refreshes the user hicolor cache when `gtk-update-icon-cache` is available. The pacman package installs the same icon tree under `/usr/share/icons/hicolor` and declares `hicolor-icon-theme`.

## Local Prod Update Command

On 2026-05-03, `scripts/update-local.mjs` added the v1 `make update` workflow. It fetches live metadata through `scripts/check-upstream.mjs`, compares only `prod.latest.version` and `prod.latest.build` against `data/upstream.json`, rebuilds prod when drift is present or the matching `dist/codex-linux-prod-<version>/resources/codex-linux-build.json` is missing/stale, installs that exact build with `scripts/install-local.sh --build-dir`, and atomically rewrites `data/upstream.json` only after build/install succeeds.

On 2026-05-03, PR review found `scripts/install-local.sh --build-dir <relative-path>` wrote the relative path directly into `~/.local/bin/codex-linux`, making the symlink resolve relative to `~/.local/bin` instead of the caller's working directory. The installer now canonicalizes the selected build directory before validating launcher and desktop-entry paths or creating the symlink. Keep user-supplied installer build paths absolute before writing installed links.

On 2026-05-04, PR review found an appcast double-fetch race in `make update`: `scripts/update-local.mjs` read prod metadata before rebuild, while `scripts/build-linux-app.mjs` fetched appcast metadata again during rebuild. If prod advanced between those reads, the builder could produce a newer `dist/codex-linux-prod-<version>` than the updater later validated. The updater now refreshes live metadata after rebuild, recomputes the exact prod target from that refreshed response, retries once if the refreshed target is still stale, installs that refreshed build, and writes `data/upstream.json` from the same refreshed metadata only after install succeeds.

On 2026-05-06, a local update to prod `26.429.61741` hit a native rebuild failure because the active Arch Python was 3.14.4 without `distutils` or `setuptools`, while the transient `electron-rebuild@3.2.9` / `node-gyp` path still imported `distutils.version.StrictVersion`. Installing `python-setuptools` system-wide should fix that prerequisite; when sudo is unavailable, a repo-local virtualenv also works:

```bash
python -m venv .cache/node-gyp-python
.cache/node-gyp-python/bin/python -m pip install setuptools
env npm_config_python="$PWD/.cache/node-gyp-python/bin/python" make update
```

That workaround completed the rebuild, installed the user-local launcher, and refreshed `data/upstream.json` to prod `26.429.61741` / build `2429`.

On 2026-05-10, updating to prod `26.506.31421` showed two recurring update risks. First, upstream minified symbol names changed in the window-backdrop, avatar overlay, and open-target code, so exact string patches such as the older `PM(...)` background helper broke even though the same behavior still existed under new names. The builder now matches those patch sites by helper shape and captures the current minified symbols instead of pinning one upstream build's names. Second, Arch Python 3.14.4 still lacked `distutils`; the builder now falls back to `.cache/python-node-gyp` with `setuptools` and passes that interpreter through both `PYTHON` and `npm_config_python` for native module rebuilds. PR review also found that an inherited `npm_config_python` can override `PYTHON` when npm or npx invokes node-gyp, so the native rebuild environment now forces it to the selected fallback interpreter. A rerun of `make update` built and installed prod `26.506.31421` / build `2620`.

## Documentation Alignment Check

On 2026-05-03, a docs audit compared README and docs against the current scripts, local prod build metadata, pacman package output, live appcasts, and official Codex docs. Live prod and beta appcasts still matched `data/upstream.json`; official Codex app docs still listed macOS and Windows app downloads with Linux notification, while official CLI docs still listed Linux support and npm installation.

The audit updated docs for the current output contract, `make update`, `make check`, local diagnostics, smoke testing, beta build limitations, generated desktop/icon/package behavior, and the Linux-specific app patches that clear Electron's default menu and make primary/secondary windows opaque. Keep future docs tied to script behavior rather than inferred behavior from generated artifacts.

On 2026-05-04, a follow-up documentation audit verified live prod and beta appcasts still matched `data/upstream.json`, checked the official Codex app and CLI docs again, and aligned README, research notes, Omarchy guidance, and this project history with the current script behavior. The main durable correction was to describe the current stable Codex CLI resolution path instead of the older single `command -v codex` behavior.

On 2026-05-04, settings investigation found the converted Electron app's Linux open-target registry exposed only the hidden `systemDefault` target plus no Linux editor or file-manager targets. That made Settings' `Open config.toml` depend on desktop MIME association for `.toml`, which is unreliable on Omarchy/Hyprland. The builder now patches the extracted main bundle to add Linux VS Code/Insiders detection, a generic GUI text-editor fallback, and an `xdg-open` file-manager target. `make check` and `make smoke-test` passed after rebuilding `dist/codex-linux-prod-26.429.30905`.

The same investigation found app-server logs for reported Configuration changes showed successful `config/value/write` and follow-up `config/read` requests, and the Git PR icon toggle persisted to `~/.codex/.codex-global-state.json` despite the switch rendering stale until relaunch. Treat future "Unable to save" or unchanged Git toggle reports as likely renderer/query-state feedback problems unless app-server logs show actual write errors.

On 2026-05-05, follow-up settings triage found the Configuration page writes user config through the app server with the config layer's `expectedVersion`, while project config writes use the renderer-side `local-environment-config-save` path. If `~/.codex/config.toml` changes after the page's last `config/read`, for example from another Codex process updating marketplaces or global state, the next user-config save can surface "Unable to save" even though file permissions are correct and the desired value may already be present. Restarting/reloading the desktop app or editing `~/.codex/config.toml` directly works around this stale-version UI path.

On 2026-05-05, the generated user-local prod desktop entry was aligned with the pacman package entry by using `Name=Codex` for `prod` builds, while keeping non-prod channels labeled, for example `Codex (beta)`. Future launcher label changes should preserve that distinction so the normal app grid entry is clean but beta installs remain visually identifiable.

On 2026-05-10, the Linux conversion added a visual version badge by patching the Electron bootstrap rather than the minified renderer bundle. The badge is injected after `app.whenReady()`, attaches to normal app BrowserWindows through `browser-window-created`, skips always-on-top overlay windows, and can be disabled with `CODEX_LINUX_VERSION_BADGE=0`. A remote-debugging launch confirmed the renderer contained a fixed `codex-linux-version-badge` element showing `Codex 26.506.31421 | prod 2620`. CodeQL flagged the generated badge browser script as code construction, so the builder now validates badge metadata against narrow version, channel, and build-token formats before generating the script; the renderer still assigns values with `textContent` and `title`. A follow-up visual check found the first bottom-right placement overlapped document/editor content, so the badge now sits in the top toolbar area with subdued styling and pointer events disabled.

On 2026-05-07, CodeQL alert #1 (`actions/missing-workflow-permissions`) was validated for `.github/workflows/upstream-watch.yml`. The repository default workflow token permission was already read-only, but the workflow itself now declares `permissions: contents: read` so the appcast drift job remains least-privilege if repository defaults change.

On 2026-05-07, floating Codex pets were traced to the upstream `avatarOverlay` BrowserWindow. The overlay relied on `setIgnoreMouseEvents(true, { forward: true })` so its renderer could keep receiving hover/mousemove events while clicks passed through transparent space, but Electron's own type docs mark `forward` as macOS/Windows-only. On Linux this can leave the overlay unable to re-enter its interactive state after it starts ignoring mouse events, making the pet effectively stuck. The builder now patches the avatar overlay on Linux to keep mouse events enabled and uses Electron's Linux `setShape(...)` support to restrict hit testing to the mascot and visible tray rectangles, which preserves dragging without letting the whole transparent overlay capture clicks.

The same 2026-05-07 pet visual follow-up showed the blurry rectangles around pets and native context menus were caused by Omarchy's Hyprland defaults, not by the Codex webview assets. Omarchy tags all windows with `default-opacity` and applies `opacity 0.97 0.9`; that makes transparent XWayland surfaces appear as blurred rectangles under Hyprland. The persistent fix belongs in the user's Hyprland config: remove `default-opacity`, force `opacity 1 1`, and set `no_blur on` for `class ^Codex$` plus empty-class floating XWayland popup windows. Keep future Linux build patches focused on the interaction fix; do not shrink the pet overlay, force the tray closed, or strip upstream webview blur/dropdown classes for this issue.

On 2026-05-08, `.github/workflows/upstream-watch.yml` changed from a read-only drift alarm into a prod update PR automation. The workflow still fetches both prod and beta appcasts and uploads the live metadata artifact, but it only treats prod drift as actionable. When prod changes, `scripts/prepare-upstream-update-pr.mjs` rewrites `data/upstream.json` from the fetched metadata, generates a PR body, runs `make check`, pushes the stable unprotected `automation/update-prod-appcast` branch, and creates or updates the matching PR with the built-in GitHub token. Beta-only drift is intentionally non-failing until beta install/update support is first-class; beta metadata is refreshed opportunistically when a prod update PR is generated.

On 2026-05-08, PR review for the upstream automation found `gh pr list --head` does not support `<owner>:<branch>` syntax. Same-repo automation PR lookup now uses the bare `automation/update-prod-appcast` branch name so repeated scheduled runs update the existing PR instead of trying to create a duplicate.
