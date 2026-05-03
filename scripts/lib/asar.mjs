import fs from "node:fs/promises";
import path from "node:path";

export async function readAsar(asarPath) {
  const handle = await fs.open(asarPath, "r");
  try {
    const prelude = Buffer.alloc(16);
    await handle.read(prelude, 0, prelude.length, 0);

    const pickleSize = prelude.readUInt32LE(4);
    const headerStringSize = prelude.readUInt32LE(12);
    const headerBuffer = Buffer.alloc(headerStringSize);
    await handle.read(headerBuffer, 0, headerStringSize, 16);

    return {
      asarPath,
      dataOffset: 8 + pickleSize,
      header: JSON.parse(headerBuffer.toString("utf8")),
    };
  } finally {
    await handle.close();
  }
}

export async function extractAsar(asarPath, outputDir, options = {}) {
  const archive = await readAsar(asarPath);
  await fs.rm(outputDir, { force: true, recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  const handle = await fs.open(asarPath, "r");
  try {
    await extractTree(handle, archive, archive.header.files, outputDir, "", options);
  } finally {
    await handle.close();
  }
}

export function listAsarFiles(archive) {
  const files = [];
  walkHeader(archive.header.files, "", (relativePath, entry) => {
    if (!entry.files) {
      files.push(relativePath);
    }
  });
  return files;
}

export function getAsarFileEntry(archive, relativePath) {
  const parts = relativePath.split("/").filter(Boolean);
  let current = { files: archive.header.files };
  for (const part of parts) {
    current = current.files?.[part];
    if (!current) {
      return null;
    }
  }
  return current;
}

export async function readAsarFile(archive, relativePath) {
  const entry = getAsarFileEntry(archive, relativePath);
  if (!entry || entry.files) {
    throw new Error(`ASAR file not found: ${relativePath}`);
  }

  const handle = await fs.open(archive.asarPath, "r");
  try {
    const buffer = Buffer.alloc(entry.size);
    await handle.read(buffer, 0, entry.size, archive.dataOffset + Number(entry.offset));
    return buffer;
  } finally {
    await handle.close();
  }
}

function walkHeader(files, currentPath, visitor) {
  for (const [name, entry] of Object.entries(files)) {
    const relativePath = currentPath ? `${currentPath}/${name}` : name;
    visitor(relativePath, entry);
    if (entry.files) {
      walkHeader(entry.files, relativePath, visitor);
    }
  }
}

async function extractTree(handle, archive, files, outputDir, currentPath, options) {
  for (const [name, entry] of Object.entries(files)) {
    const relativePath = currentPath ? `${currentPath}/${name}` : name;
    const target = path.join(outputDir, relativePath);

    if (entry.files) {
      await fs.mkdir(target, { recursive: true });
      await extractTree(handle, archive, entry.files, outputDir, relativePath, options);
      continue;
    }

    if (entry.unpacked && options.skipUnpacked !== false) {
      continue;
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    const buffer = Buffer.alloc(entry.size);
    await handle.read(buffer, 0, entry.size, archive.dataOffset + Number(entry.offset));
    await fs.writeFile(target, buffer);

    if (isExecutablePath(relativePath)) {
      await fs.chmod(target, 0o755);
    }
  }
}

function isExecutablePath(relativePath) {
  return relativePath.endsWith(".sh") || relativePath.includes("/.bin/");
}
