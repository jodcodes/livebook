import fs from "node:fs";
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

fs.mkdirSync(wefDir, { recursive: true });

const staleFiles = fs
  .readdirSync(wefDir)
  .filter((file) => file.toLowerCase().endsWith(".xml"))
  .filter((file) => {
    const filePath = path.join(wefDir, file);
    try {
      const content = fs.readFileSync(filePath, "utf8");
      return readManifestId(content) === addinId;
    } catch {
      return false;
    }
  });

for (const file of staleFiles) {
  const stalePath = path.join(wefDir, file);
  try {
    fs.rmSync(stalePath);
  } catch (error) {
    explainPermissionIssue("remove", stalePath, error);
  }
}

const target = path.join(wefDir, `${addinId}.manifest.xml`);
try {
  fs.copyFileSync(manifestPath, target);
} catch (error) {
  explainPermissionIssue("write", target, error);
}

console.log(`Synced Livebook manifest to ${target}`);
console.log("Restart Word, then open Insert > Add-ins > My Add-ins > Livebook.");

function readManifestId(xml) {
  const match = xml.match(/<Id>\s*([^<]+?)\s*<\/Id>/i);
  if (!match) {
    throw new Error("Could not find <Id> in manifest.xml");
  }
  return match[1].trim();
}

function explainPermissionIssue(action, target, error) {
  if (error?.code !== "EPERM" && error?.code !== "EACCES") {
    throw error;
  }

  console.error(`Cannot ${action} ${target}`);
  console.error("macOS denied access to Word's sideload folder for this process.");
  console.error("Close Word and rerun this command from your normal Terminal:");
  console.error("");
  console.error("  npm run sideload");
  console.error("");
  console.error("If it still fails, delete the old Livebook manifest in:");
  console.error("");
  console.error(`  ${wefDir}`);
  process.exit(1);
}
