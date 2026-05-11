import fs from "node:fs";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "manifest.xml");
const manifest = fs.readFileSync(manifestPath, "utf8");
const addinId = readManifestId(manifest);
const wefDir =
  process.env.WORD_WEF_DIR ??
  path.join(
    os.homedir(),
    "Library/Containers/com.microsoft.Word/Data/Documents/wef",
  );
const officeWefCache = path.join(
  os.homedir(),
  "Library/Containers/com.microsoft.Word/Data/Library/Application Support/Microsoft/Office/16.0/Wef",
);

console.log("Livebook Word add-in doctor");
console.log("");

checkManifestSource();
checkWefFolder();
checkOfficeCache();
await checkHttps("https://localhost:3001/taskpane.html", "Add-in taskpane");
await checkHttps("https://localhost:3001/assets/icon-32.png", "Add-in icon");
await checkTcp("127.0.0.1", 3020, "Backend");

console.log("");
console.log("If the manifest checks pass but Word still does not show Livebook:");
console.log("1. Keep npm run live running.");
console.log("2. Fully quit Word.");
console.log("3. Reopen Word and check Home > Add-ins > My Add-ins.");
console.log("4. If it is still missing, run npm run reset-word-cache && npm run sideload.");

function checkManifestSource() {
  const hasWordHost = manifest.includes('<Host Name="Document"');
  const hasSource = manifest.includes("https://localhost:3001/taskpane.html");
  print("Repo manifest", hasWordHost && hasSource, manifestPath);
}

function checkWefFolder() {
  if (!fs.existsSync(wefDir)) {
    print("Word wef folder", false, `missing: ${wefDir}`);
    return;
  }

  const files = fs
    .readdirSync(wefDir)
    .filter((file) => file.toLowerCase().endsWith(".xml"))
    .map((file) => path.join(wefDir, file))
    .filter((file) => safeRead(file).includes(addinId));

  if (files.length !== 1) {
    print("Word wef manifest", false, `expected 1 Livebook manifest, found ${files.length}`);
    for (const file of files) console.log(`  - ${file}`);
    return;
  }

  const copiedManifest = safeRead(files[0]);
  print(
    "Word wef manifest",
    copiedManifest === manifest,
    copiedManifest === manifest ? files[0] : `stale copy: ${files[0]}`,
  );
}

function checkOfficeCache() {
  if (!fs.existsSync(officeWefCache)) {
    print("Office Wef cache", false, `missing: ${officeWefCache}`);
    return;
  }

  const cached = findFiles(officeWefCache).filter((file) => safeRead(file).includes(addinId));
  print("Office Wef cache", cached.length > 0, `${cached.length} cached Livebook file(s)`);
}

async function checkHttps(url, label) {
  const ok = await new Promise((resolve) => {
    const req = https.get(
      url,
      { rejectUnauthorized: false, timeout: 1200 },
      (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) < 400);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
  print(label, ok, url);
}

async function checkTcp(host, port, label) {
  const ok = await new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 1200 });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
  print(label, ok, `${host}:${port}`);
}

function print(label, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${detail}`);
}

function findFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function readManifestId(xml) {
  const match = xml.match(/<Id>\s*([^<]+?)\s*<\/Id>/i);
  if (!match) {
    throw new Error("Could not find <Id> in manifest.xml");
  }
  return match[1].trim();
}
