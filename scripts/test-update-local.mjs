#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-update-local-"));

try {
  await testSnapshotUpdateUsesTrackedSnapshot();
  await testLiveUpdateRefreshesSnapshotAfterBuild();
  console.log("local update tests passed");
} finally {
  await fs.rm(tmpRoot, { force: true, recursive: true });
}

async function testSnapshotUpdateUsesTrackedSnapshot() {
  const testDir = await setupTestDir("snapshot");
  const result = await runUpdate(testDir);
  if (result.code !== 0) {
    throw new Error(`snapshot update failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  const installedBuildDir = (await fs.readFile(path.join(testDir, "installed-build-dir.txt"), "utf8")).trim();
  const expectedBuildDir = path.join(testDir, "dist", "codex-linux-prod-1.0.0");
  if (installedBuildDir !== expectedBuildDir) {
    throw new Error(`expected install from ${expectedBuildDir}, got ${installedBuildDir}`);
  }

  const writtenSnapshot = JSON.parse(await fs.readFile(path.join(testDir, "data", "upstream.json"), "utf8"));
  const writtenProd = writtenSnapshot.prod?.latest;
  if (writtenProd?.version !== "1.0.0" || writtenProd?.build !== "100") {
    throw new Error(`expected pinned prod snapshot 1.0.0 (100), got ${writtenProd?.version} (${writtenProd?.build})`);
  }
}

async function testLiveUpdateRefreshesSnapshotAfterBuild() {
  const testDir = await setupTestDir("live");
  const result = await runUpdate(testDir, ["--source", "live"]);
  if (result.code !== 0) {
    throw new Error(`live update failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  const installedBuildDir = (await fs.readFile(path.join(testDir, "installed-build-dir.txt"), "utf8")).trim();
  const expectedBuildDir = path.join(testDir, "dist", "codex-linux-prod-1.0.1");
  if (installedBuildDir !== expectedBuildDir) {
    throw new Error(`expected install from ${expectedBuildDir}, got ${installedBuildDir}`);
  }

  const writtenSnapshot = JSON.parse(await fs.readFile(path.join(testDir, "data", "upstream.json"), "utf8"));
  const writtenProd = writtenSnapshot.prod?.latest;
  if (writtenProd?.version !== "1.0.1" || writtenProd?.build !== "101") {
    throw new Error(`expected refreshed prod snapshot 1.0.1 (101), got ${writtenProd?.version} (${writtenProd?.build})`);
  }
}

async function setupTestDir(name) {
  const testDir = path.join(tmpRoot, name);
  await fs.mkdir(path.join(testDir, "scripts"), { recursive: true });
  await fs.mkdir(path.join(testDir, "data"), { recursive: true });
  await fs.copyFile(path.join(repoRoot, "scripts", "update-local.mjs"), path.join(testDir, "scripts", "update-local.mjs"));

  await fs.writeFile(
    path.join(testDir, "data", "upstream.json"),
    `${JSON.stringify(appcastSnapshot("1.0.0", "100"), null, 2)}\n`,
  );
  await fs.writeFile(path.join(testDir, "scripts", "check-upstream.mjs"), checkUpstreamStub());
  await fs.writeFile(path.join(testDir, "scripts", "build-linux-app.mjs"), buildLinuxAppStub());
  await fs.writeFile(path.join(testDir, "scripts", "install-local.sh"), installLocalStub(), { mode: 0o755 });
  return testDir;
}

function appcastSnapshot(version, build) {
  return {
    prod: {
      appcast: "https://example.test/prod.xml",
      latest: {
        title: version,
        version,
        build,
        published: "Mon, 04 May 2026 00:00:00 +0000",
        hardware: "arm64",
        url: `https://example.test/Codex-${version}.zip`,
        length: 1,
      },
    },
    beta: {
      appcast: "https://example.test/beta.xml",
      latest: {
        title: "0.9.0",
        version: "0.9.0",
        build: "90",
        published: "Mon, 04 May 2026 00:00:00 +0000",
        hardware: "arm64",
        url: "https://example.test/Codex-beta.zip",
        length: 1,
      },
    },
  };
}

function checkUpstreamStub() {
  return `#!/usr/bin/env node
const snapshot = ${JSON.stringify(appcastSnapshot("1.0.1", "101"), null, 2)}
console.log(JSON.stringify(snapshot, null, 2));
`;
}

function buildLinuxAppStub() {
  return `#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const distFlagIndex = args.indexOf("--dist-dir");
const sourceFlagIndex = args.indexOf("--source");
const snapshotFlagIndex = args.indexOf("--snapshot");
const distDir = path.resolve(rootDir, distFlagIndex === -1 ? "dist" : args[distFlagIndex + 1]);
const source = sourceFlagIndex === -1 ? "snapshot" : args[sourceFlagIndex + 1];
const snapshotPath = path.resolve(rootDir, snapshotFlagIndex === -1 ? "data/upstream.json" : args[snapshotFlagIndex + 1]);
let version = "1.0.1";
let build = "101";
if (source === "snapshot") {
  const snapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
  version = snapshot.prod.latest.version;
  build = snapshot.prod.latest.build;
}
const buildDir = path.join(distDir, \`codex-linux-prod-\${version}\`);
await fs.mkdir(path.join(buildDir, "resources"), { recursive: true });
await fs.writeFile(
  path.join(buildDir, "resources", "codex-linux-build.json"),
  JSON.stringify({ source: { version, build } }, null, 2) + "\\n",
);
`;
}

function installLocalStub() {
  return `#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
build_dir=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --build-dir)
      build_dir="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [ -z "$build_dir" ]; then
  printf 'missing --build-dir\\n' >&2
  exit 1
fi

printf '%s\\n' "$build_dir" >"$root_dir/installed-build-dir.txt"
`;
}

function runUpdate(testDir, extraArgs = []) {
  return run("node", [
    "scripts/update-local.mjs",
    "--snapshot",
    "data/upstream.json",
    "--dist-dir",
    "dist",
    "--cache-dir",
    ".cache",
    ...extraArgs,
  ], {
    cwd: testDir,
  });
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}
