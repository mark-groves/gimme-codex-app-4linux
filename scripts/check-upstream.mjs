#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const feeds = {
  prod: "https://persistent.oaistatic.com/codex-app-prod/appcast.xml",
  beta: "https://persistent.oaistatic.com/codex-app-beta/appcast.xml",
};

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

function parseLatest(xml) {
  const item = xml.match(/<item>([\s\S]*?)<\/item>/i)?.[1];
  if (!item) {
    throw new Error("appcast has no <item>");
  }

  const enclosure = item.match(/<enclosure\s+([^>]+?)\/>/i)?.[1];
  if (!enclosure) {
    throw new Error("latest appcast item has no enclosure");
  }

  return {
    title: textBetween(item, "title"),
    version: textBetween(item, "sparkle:shortVersionString"),
    build: textBetween(item, "sparkle:version"),
    published: textBetween(item, "pubDate"),
    hardware: textBetween(item, "sparkle:hardwareRequirements"),
    url: attr(enclosure, "url"),
    length: Number(attr(enclosure, "length")),
  };
}

const args = parseArgs(process.argv.slice(2));
const result = {};

for (const [channel, url] of Object.entries(feeds)) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch ${channel} appcast: ${response.status} ${response.statusText}`);
  }
  result[channel] = {
    appcast: url,
    latest: parseLatest(await response.text()),
  };
}

if (args.write) {
  await fs.mkdir(path.dirname(args.write), { recursive: true });
  await fs.writeFile(args.write, `${JSON.stringify(result, null, 2)}\n`);
}

if (args.compare) {
  const expected = JSON.parse(await fs.readFile(args.compare, "utf8"));
  const drift = compareSnapshots(expected, result);
  if (drift.length > 0) {
    console.error("Upstream appcast drift detected:");
    for (const item of drift) {
      console.error(`- ${item}`);
    }
    process.exitCode = 1;
  }
}

console.log(JSON.stringify(result, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write" || arg === "--compare") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a path`);
      }
      parsed[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/check-upstream.mjs [--write path] [--compare path]");
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}

function compareSnapshots(expected, actual) {
  const messages = [];
  for (const channel of Object.keys(feeds)) {
    const expectedLatest = expected[channel]?.latest;
    const actualLatest = actual[channel]?.latest;
    if (!expectedLatest || !actualLatest) {
      messages.push(`${channel}: missing snapshot data`);
      continue;
    }
    if (expectedLatest.version !== actualLatest.version || expectedLatest.build !== actualLatest.build) {
      messages.push(
        `${channel}: ${expectedLatest.version} (${expectedLatest.build}) -> ${actualLatest.version} (${actualLatest.build})`,
      );
    }
  }
  return messages;
}
