#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-update-local-"));

try {
  await fs.mkdir(path.join(tmpDir, "scripts"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, "data"), { recursive: true });
  await fs.copyFile(path.join(repoRoot, "scripts", "update-local.mjs"), path.join(tmpDir, "scripts", "update-local.mjs"));

  await fs.writeFile(
    path.join(tmpDir, "data", "upstream.json"),
    `${JSON.stringify(appcastSnapshot("1.0.0", "100"), null, 2)}\n`,
  );
  await fs.writeFile(path.join(tmpDir, "scripts", "check-upstream.mjs"), checkUpstreamStub());
  await fs.writeFile(path.join(tmpDir, "scripts", "build-linux-app.mjs"), buildLinuxAppStub());
  await fs.writeFile(path.join(tmpDir, "scripts", "install-local.sh"), installLocalStub(), { mode: 0o755 });

  const result = await run("node", [
    "scripts/update-local.mjs",
    "--snapshot",
    "data/upstream.json",
    "--dist-dir",
    "dist",
    "--cache-dir",
    ".cache",
  ]);
  if (result.code !== 0) {
    throw new Error(`update-local failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  const installedBuildDir = (await fs.readFile(path.join(tmpDir, "installed-build-dir.txt"), "utf8")).trim();
  const expectedBuildDir = path.join(tmpDir, "dist", "codex-linux-prod-1.0.1");
  if (installedBuildDir !== expectedBuildDir) {
    throw new Error(`expected install from ${expectedBuildDir}, got ${installedBuildDir}`);
  }

  const writtenSnapshot = JSON.parse(await fs.readFile(path.join(tmpDir, "data", "upstream.json"), "utf8"));
  const writtenProd = writtenSnapshot.prod?.latest;
  if (writtenProd?.version !== "1.0.1" || writtenProd?.build !== "101") {
    throw new Error(`expected refreshed prod snapshot 1.0.1 (101), got ${writtenProd?.version} (${writtenProd?.build})`);
  }
} finally {
  await fs.rm(tmpDir, { force: true, recursive: true });
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
import fs from "node:fs/promises";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const countPath = path.join(rootDir, "check-upstream-count.txt");
let count = 0;
try {
  count = Number(await fs.readFile(countPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}
count += 1;
await fs.writeFile(countPath, String(count));

const prodVersion = count === 1 ? "1.0.0" : "1.0.1";
const prodBuild = count === 1 ? "100" : "101";
const snapshot = ${JSON.stringify(appcastSnapshot("__VERSION__", "__BUILD__"), null, 2)}
snapshot.prod.latest.title = prodVersion;
snapshot.prod.latest.version = prodVersion;
snapshot.prod.latest.build = prodBuild;
snapshot.prod.latest.url = \`https://example.test/Codex-\${prodVersion}.zip\`;
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
const distDir = path.resolve(rootDir, distFlagIndex === -1 ? "dist" : args[distFlagIndex + 1]);
const buildDir = path.join(distDir, "codex-linux-prod-1.0.1");
await fs.mkdir(path.join(buildDir, "resources"), { recursive: true });
await fs.writeFile(
  path.join(buildDir, "resources", "codex-linux-build.json"),
  JSON.stringify({ source: { version: "1.0.1", build: "101" } }, null, 2) + "\\n",
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

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: tmpDir,
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
