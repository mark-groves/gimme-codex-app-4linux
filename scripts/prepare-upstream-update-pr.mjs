#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const channels = new Set(["prod", "beta"]);
const options = parseArgs(process.argv.slice(2));
const snapshotPath = path.resolve(options.snapshot);
const currentPath = path.resolve(options.current);
const bodyPath = path.resolve(options.body);
const channel = options.channel;

const snapshot = await readJson(snapshotPath);
const current = await readJson(currentPath);
const expected = latestFor(snapshot, channel, "snapshot");
const actual = latestFor(current, channel, "current");
const drifted = expected.version !== actual.version || expected.build !== actual.build;

if (!drifted) {
  await writeGithubOutputs({
    drift: "false",
    summary: `${channel} appcast already matches ${actual.version} (${actual.build})`,
  });
  console.log(`${channel} appcast already matches ${actual.version} (${actual.build})`);
  process.exit(0);
}

await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
await fs.writeFile(snapshotPath, `${JSON.stringify(current, null, 2)}\n`);

await fs.mkdir(path.dirname(bodyPath), { recursive: true });
await fs.writeFile(bodyPath, prBody({ channel, expected, actual }));

const title = `Update ${channel} appcast to ${actual.version}`;
const commitMessage = `chore: update ${channel} appcast to ${actual.version}`;
const branch = `automation/update-${channel}-appcast`;

await writeGithubOutputs({
  drift: "true",
  channel,
  old_version: expected.version,
  old_build: expected.build,
  new_version: actual.version,
  new_build: actual.build,
  branch,
  title,
  commit_message: commitMessage,
  body_path: path.relative(process.cwd(), bodyPath) || ".",
  summary: `${channel}: ${expected.version} (${expected.build}) -> ${actual.version} (${actual.build})`,
});

console.log(`${channel} appcast drift detected: ${expected.version} (${expected.build}) -> ${actual.version} (${actual.build})`);
console.log(`Updated snapshot: ${snapshotPath}`);
console.log(`Prepared PR body: ${bodyPath}`);

function parseArgs(argv) {
  const parsed = {
    channel: "prod",
    snapshot: "data/upstream.json",
    current: "upstream-current.json",
    body: ".cache/upstream-update-pr-body.md",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--snapshot" || arg === "--current" || arg === "--body" || arg === "--channel") {
      parsed[arg.slice(2).replaceAll("-", "_")] = requiredValue(argv, ++index, arg);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: node scripts/prepare-upstream-update-pr.mjs [--snapshot path]",
          "                                                     [--current path]",
          "                                                     [--body path]",
          "                                                     [--channel prod|beta]",
        ].join("\n"),
      );
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!channels.has(parsed.channel)) {
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

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function latestFor(snapshot, channel, label) {
  const latest = snapshot[channel]?.latest;
  if (!latest?.version || !latest?.build) {
    throw new Error(`${label} metadata is missing ${channel}.latest.version or ${channel}.latest.build`);
  }
  return latest;
}

function prBody({ channel, expected, actual }) {
  return `${[
    "## Summary",
    `- Update tracked ${channel} appcast metadata from \`${expected.version}\` build \`${expected.build}\` to \`${actual.version}\` build \`${actual.build}\`.`,
    "- Refresh `data/upstream.json` from the live upstream appcasts so the snapshot stays current for all tracked channels.",
    "- Keep the local desktop install as an explicit `make update` step after merge.",
    "",
    "## Test plan",
    "- Ran `make check`",
    "",
  ].join("\n")}`;
}

async function writeGithubOutputs(outputs) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }

  const lines = [];
  for (const [key, value] of Object.entries(outputs)) {
    lines.push(`${key}=${String(value).replaceAll("\n", " ")}`);
  }
  await fs.appendFile(outputPath, `${lines.join("\n")}\n`);
}
