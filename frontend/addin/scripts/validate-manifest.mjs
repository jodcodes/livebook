import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "manifest.xml");
const manifest = fs.readFileSync(manifestPath, "utf8");

const required = [
  "<Hosts>",
  '<Host Name="Document"',
  "<Permissions>ReadWriteDocument</Permissions>",
  "https://localhost:5001/taskpane.html",
  "Livebook.TaskpaneButton",
  "WordApi",
];

const missing = required.filter((needle) => !manifest.includes(needle));
const assets = ["icon-16.png", "icon-32.png", "icon-80.png"].filter(
  (file) => !fs.existsSync(path.join(root, "public/assets", file)),
);

if (missing.length || assets.length) {
  if (missing.length) console.error(`Manifest is missing: ${missing.join(", ")}`);
  if (assets.length) console.error(`Missing assets: ${assets.join(", ")}`);
  process.exit(1);
}

console.log("Manifest smoke validation passed");
