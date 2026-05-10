# Builder Design

The builder is intentionally local and reproducible. It creates a working Linux app without relying on AUR packages, AppImages, or third-party repacked binaries.

## Pipeline

```bash
node scripts/build-linux-app.mjs --channel prod
```

Steps:

1. Fetch the official OpenAI appcast.
2. Download the latest macOS Codex archive into `.cache/downloads`.
3. Verify the archive byte length from the appcast.
4. Extract `app.asar`, `Info.plist`, icons, and bundled plugin resources.
5. Parse `app.asar` with `scripts/lib/asar.mjs`.
6. Read the app's `package.json` to discover the Electron version.
7. Install official Linux Electron for that version into `.cache/tools`.
8. Copy the Linux Electron runtime into `dist/codex-linux-<channel>-<version>/`.
9. Rename `electron` to `codex-electron` so Electron treats the app as packaged.
10. Extract the Electron app into `resources/app`.
11. Patch the extracted app for Linux runtime behavior.
12. Rebuild native modules for Electron/Linux.
13. Copy bundled plugin resources.
14. Extract embedded PNGs from `electron.icns` into freedesktop hicolor icon paths.
15. Write provenance metadata, `codex-linux`, and `codex-linux.desktop`.

## Why Rename Electron

Running the npm Electron binary directly makes `app.isPackaged` false, which pushes the app toward dev-server behavior such as trying to load `localhost:5175`.

The generated build renames the runtime to `codex-electron`. In smoke testing this made `app.isPackaged` true and the app loaded bundled `app://` assets instead of a dev server.

## Linux App Patches

The builder keeps the app code as close to upstream as possible, but applies narrow Linux runtime patches to the extracted bundled JavaScript:

- It forces `Menu.setApplicationMenu(...)` to clear the application menu, because Electron's default Linux menu bar otherwise appears during startup.
- It labels normal Linux app windows after `app.whenReady()` with the converted app version, channel, and appcast build, and shows the same metadata as a small sidebar-footer label that can be hidden with `CODEX_LINUX_VERSION_BADGE=0`.
- It makes primary and secondary Linux app windows opaque so Hyprland/Wayland resize and underdraw issues do not reveal transparent wallpaper behind the app surface.
- It makes the avatar overlay use Linux window shaping instead of ignored mouse-event forwarding, because Electron only forwards ignored mouse moves on macOS and Windows. This keeps the floating pet draggable without letting the whole transparent overlay rectangle capture clicks.

These patches are string-anchored to the current bundled files and fail the build if the expected upstream markers disappear.

## Output Contract

Generated output is local-only and ignored by git:

```text
dist/codex-linux-prod-<version>/
  codex-linux
  codex-electron
  codex-linux.desktop
  README-linux-build.txt
  resources/app/
  resources/electron.icns
  resources/icons/hicolor/
  resources/plugins/
  resources/codex-linux-build.json
```

`resources/codex-linux-build.json` records provenance: appcast URL, source archive URL, SHA-256, source version, Electron version, and target platform.

## Local Pacman Package

```bash
make pacman-package
```

The pacman package builder consumes the newest prod build in `dist/` by default and writes a local package to `dist/pacman/`. It generates a temporary `PKGBUILD` under `.cache/pacman/codex-linux/`, copies the converted bundle into `/opt/codex-linux`, installs a wrapper at `/usr/bin/codex-linux`, writes a package-owned desktop entry with `Exec=/usr/bin/codex-linux %U` and `Icon=codex-linux`, and installs the generated icons under `/usr/share/icons/hicolor`.

The package uses `options=('!strip' '!debug')` because the converted app includes bundled Electron and rebuilt native module binaries. It declares the runtime library dependencies used by Arch's Electron 41 package plus `alsa-lib` and `hicolor-icon-theme`, but it does not depend on `electron41`; the converted app carries its matching Electron runtime.

The package path is composed from the upstream app package version and appcast build, for example `dist/pacman/codex-linux-26.429.30905.2345-1-x86_64.pkg.tar.zst`. The builder removes older `codex-linux-*.pkg.tar*` outputs from `dist/pacman/` before copying the latest package so the documented install glob has a single target.
