#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
const rootDir = path.resolve(import.meta.dirname, "..");
const snapshotPath = path.resolve(rootDir, options.snapshot);
const distDir = path.resolve(rootDir, options.distDir);
const cacheDir = path.resolve(rootDir, options.cacheDir);
const maxBuildAttempts = 2;

const snapshot = await readJson(snapshotPath);
let state = await resolveUpdateState(await fetchLiveMetadata(), snapshot);

if (state.snapshotDrifted || !state.targetBuildValid) {
  for (let attempt = 1; attempt <= maxBuildAttempts; attempt += 1) {
    const reason = attempt === 1 ? buildReason(state) : "refreshed prod appcast target missing or stale";
    console.log(`Building prod app (${reason})...`);
    await run("node", [
      "scripts/build-linux-app.mjs",
      "--channel",
      "prod",
      "--cache-dir",
      path.relative(rootDir, cacheDir) || ".",
      "--dist-dir",
      path.relative(rootDir, distDir) || ".",
    ]);

    state = await resolveUpdateState(await fetchLiveMetadata(), snapshot);
    if (state.targetBuildValid) {
      break;
    }
  }
}

if (!state.targetBuildValid) {
  throw new Error(`prod build is missing or stale after ${maxBuildAttempts} build attempts: ${state.targetBuildDir}`);
}

console.log(`Installing prod app from ${state.targetBuildDir}...`);
await run("bash", ["scripts/install-local.sh", "--build-dir", state.targetBuildDir]);

if (state.snapshotDrifted) {
  await writeJsonAtomic(snapshotPath, state.live);
  console.log(`Updated upstream snapshot: ${snapshotPath}`);
} else {
  console.log("Upstream snapshot already matches live prod appcast.");
}

async function resolveUpdateState(live, snapshot) {
  const liveProd = live.prod?.latest;
  if (!liveProd?.version || !liveProd?.build) {
    throw new Error("live appcast metadata is missing prod.latest.version or prod.latest.build");
  }

  const snapshotProd = snapshot.prod?.latest;
  const snapshotDrifted =
    snapshotProd?.version !== liveProd.version || snapshotProd?.build !== liveProd.build;
  const targetBuildDir = path.join(distDir, `codex-linux-prod-${liveProd.version}`);
  const targetBuildValid = await hasMatchingBuild(targetBuildDir, liveProd);
  return { live, liveProd, snapshotDrifted, targetBuildDir, targetBuildValid };
}

function buildReason(state) {
  return state.snapshotDrifted ? "prod appcast drift detected" : "matching prod build missing or stale";
}

async function fetchLiveMetadata() {
  const { stdout } = await run("node", ["scripts/check-upstream.mjs"], { capture: true });
  return JSON.parse(stdout);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function hasMatchingBuild(buildDir, liveProdMetadata) {
  const metadataPath = path.join(buildDir, "resources", "codex-linux-build.json");
  try {
    const metadata = await readJson(metadataPath);
    return metadata.source?.version === liveProdMetadata.version && metadata.source?.build === liveProdMetadata.build;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tempPath, filePath);
}

function run(command, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });

    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = signal ? `signal ${signal}` : `exit ${code}`;
      const error = new Error(`${command} ${args.join(" ")} failed with ${detail}`);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function parseArgs(argv) {
  const parsed = {
    cacheDir: ".cache",
    distDir: "dist",
    snapshot: "data/upstream.json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cache-dir") {
      parsed.cacheDir = requiredValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--dist-dir") {
      parsed.distDir = requiredValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--snapshot") {
      parsed.snapshot = requiredValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/update-local.mjs [--cache-dir .cache] [--dist-dir dist] [--snapshot data/upstream.json]",
      );
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
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
