import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const wordData = path.join(os.homedir(), "Library/Containers/com.microsoft.Word/Data");
const targets = [
  path.join(wordData, "Library/Application Support/Microsoft/Office/16.0/Wef"),
  path.join(wordData, "Library/Caches/WebKit"),
  path.join(wordData, "Library/WebKit/WebsiteData"),
];

console.log("Resetting Word add-in caches...");
console.log("Close Word before running this command.");

for (const target of targets) {
  if (!fs.existsSync(target)) {
    console.log(`SKIP missing: ${target}`);
    continue;
  }

  fs.rmSync(target, { recursive: true, force: true });
  console.log(`REMOVED ${target}`);
}

console.log("");
console.log("Now run: npm run sideload");
console.log("Then restart Word and open Home > Add-ins > My Add-ins > Livebook.");
