#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-upstream-pr-test-"));

try {
  await testProdDriftPreparesSnapshotAndOutputs();
  await testBetaOnlyDriftDoesNotPreparePr();
  console.log("upstream update PR tests passed");
} finally {
  await fs.rm(tmpRoot, { recursive: true, force: true });
}

async function testProdDriftPreparesSnapshotAndOutputs() {
  const testDir = path.join(tmpRoot, "prod-drift");
  await fs.mkdir(testDir, { recursive: true });
  const snapshotPath = path.join(testDir, "upstream.json");
  const currentPath = path.join(testDir, "current.json");
  const bodyPath = path.join(testDir, "body.md");
  const outputPath = path.join(testDir, "github-output.txt");
  const oldSnapshot = appcastSnapshot({
    prodVersion: "1.0.0",
    prodBuild: "100",
    betaVersion: "1.0.0-beta",
    betaBuild: "90",
  });
  const currentSnapshot = appcastSnapshot({
    prodVersion: "1.1.0",
    prodBuild: "110",
    betaVersion: "1.1.0-beta",
    betaBuild: "109",
  });

  await writeJson(snapshotPath, oldSnapshot);
  await writeJson(currentPath, currentSnapshot);
  await runPrepare({ snapshotPath, currentPath, bodyPath, outputPath });

  const writtenSnapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
  assertEqual(writtenSnapshot.prod.latest.version, "1.1.0", "prod snapshot version");
  assertEqual(writtenSnapshot.beta.latest.build, "109", "beta snapshot build refresh");

  const outputs = parseGithubOutput(await fs.readFile(outputPath, "utf8"));
  assertEqual(outputs.drift, "true", "drift output");
  assertEqual(outputs.branch, "automation/update-prod-appcast", "branch output");
  assertEqual(outputs.commit_message, "chore: update prod appcast to 1.1.0", "commit output");

  const body = await fs.readFile(bodyPath, "utf8");
  if (!body.includes("1.0.0") || !body.includes("1.1.0") || !body.includes("make check")) {
    throw new Error(`PR body missing expected content:\n${body}`);
  }
}

async function testBetaOnlyDriftDoesNotPreparePr() {
  const testDir = path.join(tmpRoot, "beta-only");
  await fs.mkdir(testDir, { recursive: true });
  const snapshotPath = path.join(testDir, "upstream.json");
  const currentPath = path.join(testDir, "current.json");
  const bodyPath = path.join(testDir, "body.md");
  const outputPath = path.join(testDir, "github-output.txt");
  const oldSnapshot = appcastSnapshot({
    prodVersion: "1.0.0",
    prodBuild: "100",
    betaVersion: "1.0.0-beta",
    betaBuild: "90",
  });
  const currentSnapshot = appcastSnapshot({
    prodVersion: "1.0.0",
    prodBuild: "100",
    betaVersion: "1.1.0-beta",
    betaBuild: "109",
  });

  await writeJson(snapshotPath, oldSnapshot);
  await writeJson(currentPath, currentSnapshot);
  await runPrepare({ snapshotPath, currentPath, bodyPath, outputPath });

  const writtenSnapshot = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
  assertEqual(writtenSnapshot.beta.latest.build, "90", "beta-only drift should not rewrite snapshot");

  const outputs = parseGithubOutput(await fs.readFile(outputPath, "utf8"));
  assertEqual(outputs.drift, "false", "beta-only drift output");

  try {
    await fs.access(bodyPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error("beta-only drift should not write a PR body");
}

async function runPrepare({ snapshotPath, currentPath, bodyPath, outputPath }) {
  await run("node", [
    "scripts/prepare-upstream-update-pr.mjs",
    "--snapshot",
    snapshotPath,
    "--current",
    currentPath,
    "--body",
    bodyPath,
    "--channel",
    "prod",
  ], {
    cwd: repoRoot,
    env: { ...process.env, GITHUB_OUTPUT: outputPath },
  });
}

function appcastSnapshot({ prodVersion, prodBuild, betaVersion, betaBuild }) {
  return {
    prod: channelSnapshot("prod", prodVersion, prodBuild),
    beta: channelSnapshot("beta", betaVersion, betaBuild),
  };
}

function channelSnapshot(channel, version, build) {
  return {
    appcast: `https://example.test/${channel}.xml`,
    latest: {
      title: version,
      version,
      build,
      published: "Thu, 07 May 2026 21:12:47 +0000",
      hardware: "arm64",
      url: `https://example.test/${channel}-${version}.zip`,
      length: 123,
    },
  };
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseGithubOutput(content) {
  const result = {};
  for (const line of content.trim().split("\n")) {
    const separator = line.indexOf("=");
    if (separator === -1) {
      throw new Error(`invalid GitHub output line: ${line}`);
    }
    result[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return result;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
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
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with ${code}\n${stdout}\n${stderr}`));
    });
  });
}
