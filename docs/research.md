# Research Notes

Last checked: 2026-05-03.

## Official State

OpenAI's Codex app was introduced as a macOS app on 2026-02-02, and OpenAI's announcement says Windows availability was added on 2026-03-04. The current Codex app docs say the app is available on macOS and Windows, with a "Get notified for Linux" link rather than a Linux download.

The Codex CLI is officially supported on Linux. OpenAI's CLI docs install it with:

```bash
npm i -g @openai/codex
```

## Upstream Appcasts

OpenAI's current public appcast URLs:

```text
https://persistent.oaistatic.com/codex-app-prod/appcast.xml
https://persistent.oaistatic.com/codex-app-beta/appcast.xml
```

Verified on 2026-05-03:

| Channel | Version | Build | Published | Archive |
| --- | --- | --- | --- | --- |
| prod | `26.429.30905` | `2345` | 2026-05-01 18:05:19 UTC | `Codex-darwin-arm64-26.429.30905.zip` |
| beta | `26.429.21146` | `2317` | 2026-04-30 21:18:12 UTC | `Codex (Beta)-darwin-arm64-26.429.21146.zip` |

Use `node scripts/check-upstream.mjs` to refresh this locally.

## Direct Bundle Inspection

The current production bundle contains:

- Electron app version: `26.429.30905`
- Electron runtime dependency: `41.2.0`
- Main entry: `.vite/build/bootstrap.js`
- Native modules: `better-sqlite3@12.8.0` and `node-pty@1.1.0`
- macOS-only native resources: Sparkle updater, launch-services helper, modifier-key monitor, and browser-use peer authorization helper

The local Linux builder:

1. Extracts `app.asar` with `scripts/lib/asar.mjs`.
2. Downloads official `electron@41.2.0` for Linux through npm.
3. Renames the runtime binary to `codex-electron`, which makes `app.isPackaged` true.
4. Rebuilds `better-sqlite3` and `node-pty` with `@electron/rebuild`.
5. Launches with `BUILD_FLAVOR=prod`, `NODE_ENV=production`, and `CODEX_CLI_PATH`.

## Smoke Result

On Omarchy / Hyprland / Wayland, the generated production launcher reached:

- `packaged=true`
- `buildFlavor=prod`
- main window `ready-to-show`
- successful Codex CLI stdio handshake
- successful initial account/thread/config requests

The app also downloaded OpenAI's Linux primary runtime on first startup, which is expected app behavior.

## Sources

- OpenAI Codex app docs: https://developers.openai.com/codex/app
- OpenAI Codex CLI docs: https://developers.openai.com/codex/cli
- OpenAI launch announcement: https://openai.com/index/introducing-the-codex-app/
- OpenAI production appcast: https://persistent.oaistatic.com/codex-app-prod/appcast.xml
- OpenAI beta appcast: https://persistent.oaistatic.com/codex-app-beta/appcast.xml
