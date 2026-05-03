#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { extractAsar, readAsar, readAsarFile } from "./lib/asar.mjs";

const channels = {
  prod: "https://persistent.oaistatic.com/codex-app-prod/appcast.xml",
  beta: "https://persistent.oaistatic.com/codex-app-beta/appcast.xml",
};

const nativeModules = ["better-sqlite3", "node-pty"];

const options = parseArgs(process.argv.slice(2));
const rootDir = path.resolve(import.meta.dirname, "..");
const cacheDir = path.resolve(rootDir, options.cacheDir);
const distDir = path.resolve(rootDir, options.distDir);
const channel = options.channel;

const latest = await latestAppcastItem(channels[channel]);
const version = latest.version;
const build = latest.build;
const archivePath = path.join(cacheDir, "downloads", `${channel}-${version}-${build}.zip`);
const workDir = path.join(cacheDir, "work", `${channel}-${version}-${build}`);
const outputDir = path.join(distDir, `codex-linux-${channel}-${version}`);

await fs.mkdir(path.dirname(archivePath), { recursive: true });
await fs.mkdir(distDir, { recursive: true });

if (await missing(archivePath)) {
  await download(latest.url, archivePath);
}

await verifyFileSize(archivePath, latest.length);

await fs.rm(workDir, { force: true, recursive: true });
await fs.mkdir(workDir, { recursive: true });

const macResourcesDir = path.join(workDir, "mac", "Codex.app", "Contents", "Resources");
await unzipOnly(archivePath, workDir, [
  "Codex.app/Contents/Info.plist",
  "Codex.app/Contents/Resources/app.asar",
  "Codex.app/Contents/Resources/electron.icns",
  "Codex.app/Contents/Resources/plugins/*",
]);

const asarPath = path.join(macResourcesDir, "app.asar");
const appArchive = await readAsar(asarPath);
const packageJson = JSON.parse((await readAsarFile(appArchive, "package.json")).toString("utf8"));
latest.electronVersion = packageJson.devDependencies?.electron ?? "41.2.0";
const toolsDir = path.join(cacheDir, "tools", `electron-${latest.electronVersion}`);

await ensureElectronRuntime({ electronVersion: latest.electronVersion, toolsDir });

await fs.rm(outputDir, { force: true, recursive: true });
await copyDir(path.join(toolsDir, "node_modules", "electron", "dist"), outputDir);
await fs.rename(path.join(outputDir, "electron"), path.join(outputDir, "codex-electron"));

const resourcesDir = path.join(outputDir, "resources");
const appDir = path.join(resourcesDir, "app");
await extractAsar(asarPath, appDir);

await patchExtractedApp({ appDir, channel, latest, packageJson });
await installNativeModules({ appDir, electronVersion: latest.electronVersion, workDir });
await copyOptionalResources({ macResourcesDir, resourcesDir });
await writeLinuxMetadata({ outputDir, channel, latest, packageJson });
await writeLauncher({ outputDir, resourcesDir, buildFlavor: channel === "beta" ? "beta" : "prod", buildNumber: build });
await writeDesktopFile({ outputDir, channel, version });

console.log(`Built ${outputDir}`);
console.log(`Launch with: ${path.join(outputDir, "codex-linux")}`);

function parseArgs(argv) {
  const parsed = {
    cacheDir: ".cache",
    channel: "prod",
    distDir: "dist",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--channel") {
      parsed.channel = requiredValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--cache-dir") {
      parsed.cacheDir = requiredValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--dist-dir") {
      parsed.distDir = requiredValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/build-linux-app.mjs [--channel prod|beta] [--cache-dir .cache] [--dist-dir dist]");
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!Object.hasOwn(channels, parsed.channel)) {
    throw new Error(`unknown channel: ${parsed.channel}`);
  }

  return parsed;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function latestAppcastItem(feedUrl) {
  const response = await fetch(feedUrl);
  if (!response.ok) {
    throw new Error(`failed to fetch appcast: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const item = xml.match(/<item>([\s\S]*?)<\/item>/i)?.[1];
  if (!item) {
    throw new Error("appcast has no item");
  }

  const enclosure = item.match(/<enclosure\s+([^>]+?)\/>/i)?.[1];
  if (!enclosure) {
    throw new Error("latest appcast item has no enclosure");
  }

  return {
    appcast: feedUrl,
    build: textBetween(item, "sparkle:version"),
    electronVersion: null,
    length: Number(attr(enclosure, "length")),
    published: textBetween(item, "pubDate"),
    url: attr(enclosure, "url"),
    version: textBetween(item, "sparkle:shortVersionString") ?? textBetween(item, "title"),
  };
}

function textBetween(source, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`<${escaped}>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? decodeXml(match[1].trim()) : null;
}

function attr(fragment, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = fragment.match(new RegExp(`${escaped}="([^"]+)"`, "i"));
  return match ? decodeXml(match[1]) : null;
}

function decodeXml(value) {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

async function download(url, target) {
  console.log(`Downloading ${url}`);
  await fs.mkdir(path.dirname(target), { recursive: true });

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`download failed: ${response.status} ${response.statusText}`);
  }

  const temp = `${target}.tmp-${process.pid}`;
  const file = await fs.open(temp, "w");
  try {
    const reader = response.body.getReader();
    let downloaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      downloaded += value.byteLength;
      await file.write(Buffer.from(value));
      if (downloaded % (25 * 1024 * 1024) < value.byteLength) {
        console.log(`Downloaded ${Math.round(downloaded / 1024 / 1024)} MB`);
      }
    }
  } finally {
    await file.close();
  }
  await fs.rename(temp, target);
}

async function verifyFileSize(filePath, expectedSize) {
  if (!Number.isFinite(expectedSize) || expectedSize <= 0) {
    return;
  }
  const stat = await fs.stat(filePath);
  if (stat.size !== expectedSize) {
    throw new Error(`download size mismatch for ${filePath}: expected ${expectedSize}, got ${stat.size}`);
  }
}

async function unzipOnly(zipPath, outputDir, members) {
  await run("unzip", ["-q", "-o", zipPath, ...members, "-d", path.join(outputDir, "mac")]);
}

async function ensureElectronRuntime({ electronVersion, toolsDir }) {
  const electronBinary = path.join(toolsDir, "node_modules", "electron", "dist", "electron");
  if (!(await missing(electronBinary))) {
    return;
  }

  await fs.rm(toolsDir, { force: true, recursive: true });
  await fs.mkdir(toolsDir, { recursive: true });
  await fs.writeFile(
    path.join(toolsDir, "package.json"),
    `${JSON.stringify({ private: true, dependencies: { electron: electronVersion } }, null, 2)}\n`,
  );
  await run("npm", ["install", "--omit=dev", "--package-lock=false"], { cwd: toolsDir });
}

async function installNativeModules({ appDir, electronVersion, workDir }) {
  const nativeDir = path.join(workDir, "native-build");
  await fs.rm(nativeDir, { force: true, recursive: true });
  await fs.mkdir(nativeDir, { recursive: true });

  const dependencies = {};
  for (const name of nativeModules) {
    const packageJson = JSON.parse(await fs.readFile(path.join(appDir, "node_modules", name, "package.json"), "utf8"));
    dependencies[name] = packageJson.version;
  }

  await fs.writeFile(
    path.join(nativeDir, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        dependencies,
        devDependencies: {
          "@electron/rebuild": "^4.0.1",
        },
      },
      null,
      2,
    )}\n`,
  );

  await run("npm", ["install", "--ignore-scripts", "--package-lock=false"], { cwd: nativeDir });
  await run("npx", ["electron-rebuild", "--version", electronVersion, "--force", "--module-dir", nativeDir], {
    cwd: nativeDir,
  });

  const runtimePackages = new Set(["better-sqlite3", "bindings", "file-uri-to-path", "node-addon-api", "node-pty"]);
  const nativeNodeModules = path.join(nativeDir, "node_modules");
  for (const name of runtimePackages) {
    const from = path.join(nativeNodeModules, name);
    if (await missing(from)) {
      continue;
    }
    await copyDir(from, path.join(appDir, "node_modules", name));
  }

  await removeDarwinBuildDebris(appDir);
}

async function patchExtractedApp({ appDir, channel, latest, packageJson }) {
  const nextPackageJson = {
    ...packageJson,
    codexLinuxChannel: channel,
    codexLinuxConvertedAt: new Date().toISOString(),
    codexLinuxSourceAppcast: latest.appcast,
    codexLinuxSourceUrl: latest.url,
  };
  delete nextPackageJson.scripts;
  delete nextPackageJson.devDependencies;
  await fs.writeFile(path.join(appDir, "package.json"), `${JSON.stringify(nextPackageJson, null, 2)}\n`);
}

async function copyOptionalResources({ macResourcesDir, resourcesDir }) {
  const pluginsDir = path.join(macResourcesDir, "plugins");
  if (!(await missing(pluginsDir))) {
    await copyDir(pluginsDir, path.join(resourcesDir, "plugins"));
  }

  const iconPath = path.join(macResourcesDir, "electron.icns");
  if (!(await missing(iconPath))) {
    await fs.copyFile(iconPath, path.join(resourcesDir, "electron.icns"));
  }
}

async function writeLinuxMetadata({ outputDir, channel, latest, packageJson }) {
  const sourceArchiveSha256 = await sha256(archivePath);
  const metadata = {
    channel,
    convertedAt: new Date().toISOString(),
    electronVersion: latest.electronVersion,
    packageVersion: packageJson.version,
    source: {
      appcast: latest.appcast,
      build: latest.build,
      published: latest.published,
      sha256: sourceArchiveSha256,
      url: latest.url,
      version: latest.version,
    },
    target: {
      arch: process.arch,
      platform: process.platform,
    },
  };
  await fs.mkdir(path.join(outputDir, "resources"), { recursive: true });
  await fs.writeFile(path.join(outputDir, "resources", "codex-linux-build.json"), `${JSON.stringify(metadata, null, 2)}\n`);
}

async function writeLauncher({ outputDir, resourcesDir, buildFlavor, buildNumber }) {
  const launcher = `#!/usr/bin/env bash
set -Eeuo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

if [ -z "\${CODEX_CLI_PATH:-}" ]; then
  if command -v codex >/dev/null 2>&1; then
    export CODEX_CLI_PATH="$(command -v codex)"
  else
    printf 'Codex CLI not found. Install it with: npm i -g @openai/codex\\n' >&2
    exit 1
  fi
fi

export CODEX_ELECTRON_RESOURCES_PATH="\${CODEX_ELECTRON_RESOURCES_PATH:-$here/resources}"
export ELECTRON_OZONE_PLATFORM_HINT="\${ELECTRON_OZONE_PLATFORM_HINT:-auto}"
export BUILD_FLAVOR="\${BUILD_FLAVOR:-${buildFlavor}}"
export CODEX_BUILD_NUMBER="\${CODEX_BUILD_NUMBER:-${buildNumber}}"
export NODE_ENV="\${NODE_ENV:-production}"

exec "$here/codex-electron" "$@"
`;
  const launcherPath = path.join(outputDir, "codex-linux");
  await fs.writeFile(launcherPath, launcher);
  await fs.chmod(launcherPath, 0o755);

  const resourcesPath = path.relative(outputDir, resourcesDir);
  await fs.writeFile(path.join(outputDir, "README-linux-build.txt"), `Run ./codex-linux from this directory. Resources: ${resourcesPath}\n`);
}

async function writeDesktopFile({ outputDir, channel, version }) {
  const desktopFile = `[Desktop Entry]
Type=Application
Name=Codex (${channel})
Comment=OpenAI Codex desktop app converted locally for Linux
Exec=${path.join(outputDir, "codex-linux")} %U
Terminal=false
Categories=Development;IDE;
MimeType=x-scheme-handler/codex;
X-Codex-Linux-Version=${version}
`;
  await fs.writeFile(path.join(outputDir, "codex-linux.desktop"), desktopFile);
}

async function removeDarwinBuildDebris(appDir) {
  const targets = [
    path.join(appDir, "node_modules", "node-pty", "build", "Release", "pty.node.dSYM"),
  ];
  for (const target of targets) {
    await fs.rm(target, { force: true, recursive: true });
  }
}

async function copyDir(from, to) {
  await fs.rm(to, { force: true, recursive: true });
  await fs.cp(from, to, { dereference: true, recursive: true });
}

async function missing(filePath) {
  try {
    await fs.access(filePath);
    return false;
  } catch {
    return true;
  }
}

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const file = await fs.open(filePath, "r");
  try {
    for await (const chunk of file.readableWebStream()) {
      hash.update(Buffer.from(chunk));
    }
  } finally {
    await file.close();
  }
  return hash.digest("hex");
}

async function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      env: {
        ...process.env,
        npm_config_fund: "false",
        npm_config_audit: "false",
      },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with ${code}`));
      }
    });
  });
}
