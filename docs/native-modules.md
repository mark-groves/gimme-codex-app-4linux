# Native Modules

The macOS app bundle contains native modules compiled for Darwin/arm64. They cannot run on Linux.

The current required native modules are:

| Module | Version | Purpose |
| --- | --- | --- |
| `better-sqlite3` | `12.8.0` | local SQLite state |
| `node-pty` | `1.1.0` | integrated terminal / pseudoterminal support |

The builder reads these versions from the extracted app and creates a temporary npm project under `.cache/work/<build>/native-build`.

It installs source packages, then runs:

```bash
npx electron-rebuild --version <electron-version> --force --module-dir <native-build-dir>
```

Only runtime packages are copied into the generated app:

- `better-sqlite3`
- `bindings`
- `file-uri-to-path`
- `node-addon-api`
- `node-pty`

This avoids shipping the rebuild toolchain in `dist/`.
