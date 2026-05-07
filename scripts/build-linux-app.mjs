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
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const icnsPngIconTypes = new Map([
  ["ic04", { physicalSize: 16, outputs: [{ directory: "16x16", priority: 0 }] }],
  ["icp4", { physicalSize: 16, outputs: [{ directory: "16x16", priority: 0 }] }],
  ["ic05", { physicalSize: 32, outputs: [{ directory: "32x32", priority: 0 }] }],
  ["icp5", { physicalSize: 32, outputs: [{ directory: "32x32", priority: 0 }] }],
  ["icp6", { physicalSize: 64, outputs: [{ directory: "64x64", priority: 0 }] }],
  ["ic07", { physicalSize: 128, outputs: [{ directory: "128x128", priority: 0 }] }],
  ["ic08", { physicalSize: 256, outputs: [{ directory: "256x256", priority: 0 }] }],
  ["ic09", { physicalSize: 512, outputs: [{ directory: "512x512", priority: 0 }] }],
  [
    "ic11",
    {
      physicalSize: 32,
      outputs: [
        { directory: "16x16@2", priority: 0 },
        { directory: "32x32", priority: 1 },
      ],
    },
  ],
  [
    "ic12",
    {
      physicalSize: 64,
      outputs: [
        { directory: "32x32@2", priority: 0 },
        { directory: "64x64", priority: 1 },
      ],
    },
  ],
  [
    "ic13",
    {
      physicalSize: 256,
      outputs: [
        { directory: "128x128@2", priority: 0 },
        { directory: "256x256", priority: 1 },
      ],
    },
  ],
  [
    "ic14",
    {
      physicalSize: 512,
      outputs: [
        { directory: "256x256@2", priority: 0 },
        { directory: "512x512", priority: 1 },
      ],
    },
  ],
  ["ic10", { physicalSize: 1024, outputs: [{ directory: "512x512@2", priority: 0 }] }],
]);

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
  await hideDefaultLinuxApplicationMenu(appDir);
  await makeLinuxAppWindowsOpaque(appDir);
  await fixLinuxAvatarOverlay(appDir);
  await addLinuxOpenTargets(appDir);
}

async function hideDefaultLinuxApplicationMenu(appDir) {
  const bootstrapPath = path.join(appDir, ".vite", "build", "bootstrap.js");
  const bootstrap = await fs.readFile(bootstrapPath, "utf8");
  const marker = "n.app.whenReady().then(async()=>{";
  const replacement =
    "n.Menu.setApplicationMenu=(e=>()=>e(null))(n.Menu.setApplicationMenu.bind(n.Menu)),n.Menu.setApplicationMenu(null),n.app.whenReady().then(async()=>{";
  if (bootstrap.includes(replacement)) {
    return;
  }
  if (!bootstrap.includes(marker)) {
    throw new Error("could not find Electron bootstrap ready marker to hide the Linux application menu");
  }
  await fs.writeFile(bootstrapPath, bootstrap.replace(marker, replacement));
}

async function makeLinuxAppWindowsOpaque(appDir) {
  const mainBuildPath = await findMainBuildPath(appDir);
  const mainBuild = await fs.readFile(mainBuildPath, "utf8");
  const marker =
    "function PM({platform:e,appearance:t,opaqueWindowsEnabled:n,prefersDarkColors:r}){return e===`win32`&&!jM(t)?";
  const replacement =
    "function PM({platform:e,appearance:t,opaqueWindowsEnabled:n,prefersDarkColors:r}){return e===`linux`&&(t===`primary`||t===`secondary`)?{backgroundColor:r?fM:pM,backgroundMaterial:null}:e===`win32`&&!jM(t)?";
  if (mainBuild.includes(replacement)) {
    return;
  }
  if (!mainBuild.includes(marker)) {
    throw new Error("could not find Electron background-color helper to make Linux app windows opaque");
  }
  await fs.writeFile(mainBuildPath, mainBuild.replace(marker, replacement));
}

async function fixLinuxAvatarOverlay(appDir) {
  const mainBuildPath = await findMainBuildPath(appDir);
  let mainBuild = await fs.readFile(mainBuildPath, "utf8");
  const replacements = [
    {
      marker:
        "traySize=null;constructor(e,t){this.windowManager=e,this.globalState=t}",
      replacement:
        "traySize=null;trayVisible=!1;constructor(e,t){this.windowManager=e,this.globalState=t}",
      description: "could not find avatar overlay state fields to track Linux tray shape visibility",
    },
    {
      marker:
        "setElementSize(e,{mascot:t,tray:n}){let r=this.window;r==null||r.isDestroyed()||r.webContents.id!==e||(this.cancelMomentum(),this.anchor={...this.anchor,width:t.width,height:t.height},this.mascotSize=t,this.traySize=n,this.applyLayout(r))}",
      replacement:
        "setElementSize(e,{isTrayVisible:t,mascot:r,tray:i}){let a=this.window;a==null||a.isDestroyed()||a.webContents.id!==e||(this.cancelMomentum(),this.anchor={...this.anchor,width:r.width,height:r.height},this.mascotSize=r,this.traySize=i,this.trayVisible=t===!0,this.applyLayout(a))}",
      description: "could not find avatar overlay element-size handler to track Linux tray shape visibility",
    },
    {
      marker:
        "this.traySize=null,process.platform===`darwin`?t.setVisibleOnAllWorkspaces(!0,{visibleOnFullScreen:!0,skipTransformProcessType:!0}):t.setVisibleOnAllWorkspaces(!0),t.setAlwaysOnTop(!0,`floating`)",
      replacement:
        "this.traySize=null,this.trayVisible=!1,process.platform===`darwin`?t.setVisibleOnAllWorkspaces(!0,{visibleOnFullScreen:!0,skipTransformProcessType:!0}):t.setVisibleOnAllWorkspaces(!0),t.setAlwaysOnTop(!0,`floating`)",
      description: "could not find avatar overlay window reset path to reset Linux tray shape visibility",
    },
    {
      marker:
        "setWindowBounds(e,t){e.isDestroyed()||OO(e.getContentBounds(),t)||e.setContentBounds(t,!1)}sendLayoutToRenderer(e){",
      replacement:
        "setWindowBounds(e,t){e.isDestroyed()||(OO(e.getContentBounds(),t)||e.setContentBounds(t,!1),this.applyLinuxWindowShape(e))}applyLinuxWindowShape(e){if(process.platform!==`linux`||e.isDestroyed()||typeof e.setShape!=`function`||this.layout==null)return;let t=this.layout,n=[t.mascot,...this.trayVisible&&t.tray!=null?[t.tray]:[]].map(e=>({x:e.left,y:e.top,width:e.width,height:e.height})).filter(e=>e.width>0&&e.height>0);try{e.setShape(n)}catch{}}sendLayoutToRenderer(e){",
      description: "could not find avatar overlay window bounds path to apply Linux window shape",
    },
    {
      marker:
        "applyPointerInteractivityPolicy(){let e=this.window;if(e==null||e.isDestroyed()){this.mousePassthroughEnabled=!1;return}let t=!this.pointerInteractive;if(this.mousePassthroughEnabled!==t){if(this.mousePassthroughEnabled=t,t){e.setIgnoreMouseEvents(!0,{forward:!0});return}e.setIgnoreMouseEvents(!1),this.refreshCursorAtCurrentMousePosition(e)}}",
      replacement:
        "applyPointerInteractivityPolicy(){let e=this.window;if(e==null||e.isDestroyed()){this.mousePassthroughEnabled=!1;return}if(process.platform===`linux`){this.mousePassthroughEnabled=!1,e.setIgnoreMouseEvents(!1);return}let t=!this.pointerInteractive;if(this.mousePassthroughEnabled!==t){if(this.mousePassthroughEnabled=t,t){e.setIgnoreMouseEvents(!0,{forward:!0});return}e.setIgnoreMouseEvents(!1),this.refreshCursorAtCurrentMousePosition(e)}}",
      description: "could not find avatar overlay pointer policy to avoid unsupported Linux mouse forwarding",
    },
  ];

  for (const { marker, replacement, description } of replacements) {
    if (mainBuild.includes(replacement)) {
      continue;
    }
    if (!mainBuild.includes(marker)) {
      throw new Error(description);
    }
    mainBuild = mainBuild.replace(marker, replacement);
  }

  await fs.writeFile(mainBuildPath, mainBuild);
}

async function addLinuxOpenTargets(appDir) {
  const mainBuildPath = await findMainBuildPath(appDir);
  let mainBuild = await fs.readFile(mainBuildPath, "utf8");
  const replacements = [
    {
      marker:
        "function ih({id:e,label:t,icon:n,darwinDetect:r,win32Detect:i,darwinEnv:a,darwinArgs:o,hidden:s}){return{id:e,platforms:{darwin:r?{label:t,icon:n,kind:`editor`,hidden:s,detect:r,env:a,args:o??ah,supportsSsh:!0}:void 0,win32:i?{label:t,icon:n,kind:`editor`,hidden:s,detect:i,args:ah,supportsSsh:!0}:void 0}}}",
      replacement:
        "function ih({id:e,label:t,icon:n,darwinDetect:r,win32Detect:i,linuxDetect:c,darwinEnv:a,darwinArgs:o,hidden:s}){return{id:e,platforms:{darwin:r?{label:t,icon:n,kind:`editor`,hidden:s,detect:r,env:a,args:o??ah,supportsSsh:!0}:void 0,win32:i?{label:t,icon:n,kind:`editor`,hidden:s,detect:i,args:ah,supportsSsh:!0}:void 0,linux:c?{label:t,icon:n,kind:`editor`,hidden:s,detect:c,args:ah,supportsSsh:!0}:void 0}}}",
      description: "could not find Electron open-target helper to add Linux editor support",
    },
    {
      marker:
        "var Og=ih({id:`vscode`,label:`VS Code`,icon:`apps/vscode.png`,darwinDetect:()=>_m([`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`,`/Applications/Code.app/Contents/Resources/app/bin/code`]),win32Detect:kg});",
      replacement:
        "var Og=ih({id:`vscode`,label:`VS Code`,icon:`apps/vscode.png`,darwinDetect:()=>_m([`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`,`/Applications/Code.app/Contents/Resources/app/bin/code`]),win32Detect:kg,linuxDetect:()=>q(`code`)});",
      description: "could not find VS Code open-target marker to add Linux support",
    },
    {
      marker:
        "var Ag=ih({id:`vscodeInsiders`,label:`VS Code Insiders`,icon:`apps/vscode-insiders.png`,darwinDetect:()=>_m([`/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code`,`/Applications/Code - Insiders.app/Contents/Resources/app/bin/code`]),win32Detect:jg});",
      replacement:
        "var Ag=ih({id:`vscodeInsiders`,label:`VS Code Insiders`,icon:`apps/vscode-insiders.png`,darwinDetect:()=>_m([`/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code`,`/Applications/Code - Insiders.app/Contents/Resources/app/bin/code`]),win32Detect:jg,linuxDetect:()=>q(`code-insiders`)});",
      description: "could not find VS Code Insiders open-target marker to add Linux support",
    },
    {
      marker:
        "Ih=rh({id:`fileManager`,label:`Finder`,icon:`apps/finder.png`,kind:`fileManager`,darwin:{detect:()=>`open`,args:e=>km(e)},win32:{label:`File Explorer`,icon:`apps/file-explorer.png`,detect:Lh,args:e=>km(e),open:async({path:e})=>Rh(e)}});function Lh(){",
      replacement:
        "Ih=rh({id:`fileManager`,label:`Finder`,icon:`apps/finder.png`,kind:`fileManager`,darwin:{detect:()=>`open`,args:e=>km(e)},win32:{label:`File Explorer`,icon:`apps/file-explorer.png`,detect:Lh,args:e=>km(e),open:async({path:e})=>Rh(e)},linux:{label:`Files`,icon:`apps/file-explorer.png`,detect:()=>q(`xdg-open`),args:e=>km(e)}});function Lh(){",
      description: "could not find file manager open-target marker to add Linux support",
    },
    {
      marker:
        "var Xg=[Og,Ag,Eg,jh,ch,Fh,gg,Wg,Ng,oh,Wh,yg,Ih,uh,Vh,kh,Fg,Kh,Bh,Mg,zg,Qh,$h,eg,tg,ng,rg,ig,ag,Sg],Zg=t.Pr(`open-in-targets`);",
      replacement:
        "function codexLinuxGuiEditor(){for(let e of[`code`,`code-insiders`,`codium`,`cursor`,`zed`,`subl`,`sublime_text`,`gnome-text-editor`,`kate`,`gedit`,`xed`,`mousepad`]){let t=q(e);if(t)return t}return null}function codexLinuxGuiEditorArgs(e,t){let n=codexLinuxGuiEditor(),r=n?(0,i.basename)(n).toLowerCase():``;return t&&[`code`,`code-insiders`,`codium`,`cursor`,`zed`,`subl`,`sublime_text`].some(e=>r.includes(e))?Jm(e,t):[e]}var codexLinuxEditorTarget=rh({id:`linuxEditor`,label:`Text editor`,icon:`apps/vscode.png`,kind:`editor`,linux:{detect:codexLinuxGuiEditor,args:codexLinuxGuiEditorArgs}}),Xg=[Og,Ag,Eg,jh,ch,Fh,gg,Wg,codexLinuxEditorTarget,Ng,oh,Wh,yg,Ih,uh,Vh,kh,Fg,Kh,Bh,Mg,zg,Qh,$h,eg,tg,ng,rg,ig,ag,Sg],Zg=t.Pr(`open-in-targets`);",
      description: "could not find open-target registry marker to add generic Linux editor support",
    },
  ];

  for (const { marker, replacement, description } of replacements) {
    if (mainBuild.includes(replacement)) {
      continue;
    }
    if (!mainBuild.includes(marker)) {
      throw new Error(description);
    }
    mainBuild = mainBuild.replace(marker, replacement);
  }

  await fs.writeFile(mainBuildPath, mainBuild);
}

async function findMainBuildPath(appDir) {
  const buildDir = path.join(appDir, ".vite", "build");
  const entries = await fs.readdir(buildDir);
  const candidates = entries.filter(entry => /^main-.*\.js$/.test(entry));
  if (candidates.length !== 1) {
    throw new Error(`expected exactly one main build file, found ${candidates.length}`);
  }
  return path.join(buildDir, candidates[0]);
}

async function copyOptionalResources({ macResourcesDir, resourcesDir }) {
  const pluginsDir = path.join(macResourcesDir, "plugins");
  if (!(await missing(pluginsDir))) {
    await copyDir(pluginsDir, path.join(resourcesDir, "plugins"));
  }

  const iconPath = path.join(macResourcesDir, "electron.icns");
  if (!(await missing(iconPath))) {
    await fs.copyFile(iconPath, path.join(resourcesDir, "electron.icns"));
    await extractIcnsPngIcons({
      iconPath,
      outputRoot: path.join(resourcesDir, "icons", "hicolor"),
    });
  }
}

async function extractIcnsPngIcons({ iconPath, outputRoot }) {
  const buffer = await fs.readFile(iconPath);
  const entries = parseIcnsPngEntries(buffer, iconPath);
  if (entries.length === 0) {
    throw new Error(`no usable PNG icon entries found in ${iconPath}`);
  }

  for (const entry of entries) {
    const target = path.join(outputRoot, entry.directory, "apps", "codex-linux.png");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.payload);
  }

  console.log(`Extracted ${entries.length} desktop icon(s) from ${iconPath}`);
}

function parseIcnsPngEntries(buffer, iconPath) {
  if (buffer.length < 8) {
    throw new Error(`invalid ICNS file ${iconPath}: file is too small`);
  }
  if (buffer.subarray(0, 4).toString("ascii") !== "icns") {
    throw new Error(`invalid ICNS file ${iconPath}: missing icns header`);
  }

  const declaredLength = buffer.readUInt32BE(4);
  if (declaredLength < 8 || declaredLength > buffer.length) {
    throw new Error(
      `invalid ICNS file ${iconPath}: declared length ${declaredLength} exceeds file length ${buffer.length}`,
    );
  }

  const entries = new Map();
  let offset = 8;
  while (offset < declaredLength) {
    if (offset + 8 > declaredLength) {
      throw new Error(`invalid ICNS file ${iconPath}: truncated entry header at offset ${offset}`);
    }

    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const entryLength = buffer.readUInt32BE(offset + 4);
    if (entryLength < 8 || offset + entryLength > declaredLength) {
      throw new Error(`invalid ICNS file ${iconPath}: invalid ${type} entry length ${entryLength}`);
    }

    const icon = icnsPngIconTypes.get(type);
    const payload = buffer.subarray(offset + 8, offset + entryLength);
    if (icon && startsWithPngSignature(payload)) {
      validatePngDimensions({ payload, icon, iconPath, type });
      for (const output of icon.outputs) {
        const current = entries.get(output.directory);
        if (!current || output.priority < current.priority) {
          entries.set(output.directory, { directory: output.directory, payload, priority: output.priority });
        }
      }
    }

    offset += entryLength;
  }

  if (offset !== declaredLength) {
    throw new Error(`invalid ICNS file ${iconPath}: entry parsing ended at ${offset}, expected ${declaredLength}`);
  }

  return [...entries.values()].map(({ directory, payload }) => ({ directory, payload }));
}

function startsWithPngSignature(buffer) {
  return buffer.length >= pngSignature.length && buffer.subarray(0, pngSignature.length).equals(pngSignature);
}

function validatePngDimensions({ payload, icon, iconPath, type }) {
  if (payload.length < 24 || payload.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error(`invalid PNG payload in ${iconPath}: ${type} has no IHDR chunk`);
  }

  const width = payload.readUInt32BE(16);
  const height = payload.readUInt32BE(20);
  if (width !== icon.physicalSize || height !== icon.physicalSize) {
    throw new Error(
      `unexpected PNG dimensions in ${iconPath}: ${type} expected ${icon.physicalSize}x${icon.physicalSize}, got ${width}x${height}`,
    );
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

is_unstable_codex_cli() {
  local candidate="$1"

  case "$candidate" in
    *"/.npm/_npx/"*) return 0 ;;
  esac

  if [ -f "$candidate" ] && head -n 8 "$candidate" 2>/dev/null | grep -Eq 'npx .*@openai/codex|@openai/codex.*npx'; then
    return 0
  fi

  return 1
}

resolve_codex_cli() {
  if [ -n "\${CODEX_CLI_PATH:-}" ]; then
    if [ -x "$CODEX_CLI_PATH" ]; then
      printf '%s\\n' "$CODEX_CLI_PATH"
      return 0
    fi

    printf 'CODEX_CLI_PATH is set but not executable: %s\\n' "$CODEX_CLI_PATH" >&2
    return 1
  fi

  local candidate
  for candidate in /usr/bin/codex /usr/local/bin/codex "$HOME/.local/bin/codex"; do
    if [ -x "$candidate" ] && ! is_unstable_codex_cli "$candidate"; then
      printf '%s\\n' "$candidate"
      return 0
    fi
  done

  while IFS= read -r candidate; do
    if ! is_unstable_codex_cli "$candidate"; then
      printf '%s\\n' "$candidate"
      return 0
    fi

    printf 'Ignoring unstable Codex CLI path: %s\\n' "$candidate" >&2
  done < <(type -P -a codex 2>/dev/null || true)

  printf 'Codex CLI not found in a stable location.\\n' >&2
  printf 'On Omarchy / Arch, install it with: sudo pacman -S openai-codex\\n' >&2
  printf 'Or install the official npm package into a stable prefix: npm i -g @openai/codex\\n' >&2
  return 1
}

CODEX_CLI_PATH="$(resolve_codex_cli)" || exit 1
export CODEX_CLI_PATH

export CODEX_ELECTRON_RESOURCES_PATH="\${CODEX_ELECTRON_RESOURCES_PATH:-$here/resources}"
export BUILD_FLAVOR="\${BUILD_FLAVOR:-${buildFlavor}}"
export CODEX_BUILD_NUMBER="\${CODEX_BUILD_NUMBER:-${buildNumber}}"
export NODE_ENV="\${NODE_ENV:-production}"

detect_hyprland_scale() {
  if ! command -v hyprctl >/dev/null 2>&1; then
    return 0
  fi

  hyprctl monitors 2>/dev/null | awk '
    /^Monitor / { scale = ""; focused = 0 }
    /^[[:space:]]*scale:/ { scale = $2 }
    /^[[:space:]]*focused:[[:space:]]*yes/ {
      if (scale != "") {
        print scale
        exit
      }
    }
  '
}

electron_args=()
ozone_platform="\${CODEX_ELECTRON_OZONE_PLATFORM-x11}"
if [ -n "$ozone_platform" ]; then
  electron_args+=("--ozone-platform=$ozone_platform")
fi

scale_factor="\${CODEX_ELECTRON_SCALE_FACTOR-}"
if [ -z "$scale_factor" ] && [ "$ozone_platform" = "x11" ]; then
  scale_factor="$(detect_hyprland_scale || true)"
fi

case "$scale_factor" in
  ""|"1"|"1.0"|"1.00") ;;
  *) electron_args+=("--force-device-scale-factor=$scale_factor") ;;
esac

exec "$here/codex-electron" "\${electron_args[@]}" "$@"
`;
  const launcherPath = path.join(outputDir, "codex-linux");
  await fs.writeFile(launcherPath, launcher);
  await fs.chmod(launcherPath, 0o755);

  const resourcesPath = path.relative(outputDir, resourcesDir);
  await fs.writeFile(path.join(outputDir, "README-linux-build.txt"), `Run ./codex-linux from this directory. Resources: ${resourcesPath}\n`);
}

async function writeDesktopFile({ outputDir, channel, version }) {
  const displayName = channel === "prod" ? "Codex" : `Codex (${channel})`;
  const desktopFile = `[Desktop Entry]
Type=Application
Name=${displayName}
Comment=OpenAI Codex desktop app converted locally for Linux
Exec=${path.join(outputDir, "codex-linux")} %U
Terminal=false
Categories=Development;IDE;
Icon=codex-linux
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
