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
8. Extract the Electron app into `dist/codex-linux-<channel>-<version>/resources/app`.
9. Extract embedded PNGs from `electron.icns` into freedesktop hicolor icon paths.
10. Rebuild native modules for Electron/Linux.
11. Rename `electron` to `codex-electron` so Electron treats the app as packaged.
12. Write `codex-linux`, a launcher that sets Linux-specific runtime environment.

## Why Rename Electron

Running the npm Electron binary directly makes `app.isPackaged` false, which pushes the app toward dev-server behavior such as trying to load `localhost:5175`.

The generated build renames the runtime to `codex-electron`. In smoke testing this made `app.isPackaged` true and the app loaded bundled `app://` assets instead of a dev server.

## Output Contract

Generated output is local-only and ignored by git:

```text
dist/codex-linux-prod-<version>/
  codex-linux
  codex-electron
  resources/app/
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
