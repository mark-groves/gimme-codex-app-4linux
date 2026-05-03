#!/usr/bin/env node

import { extractAsar, listAsarFiles, readAsar } from "./lib/asar.mjs";

const [asarPath, outputDir] = process.argv.slice(2);

if (!asarPath || !outputDir) {
  console.error("Usage: node scripts/extract-asar.mjs <app.asar> <output-dir>");
  process.exit(1);
}

await extractAsar(asarPath, outputDir);
const archive = await readAsar(asarPath);
console.error(`Extracted ${listAsarFiles(archive).length} files to ${outputDir}`);
