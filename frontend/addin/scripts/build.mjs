import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "src/main.ts")],
  bundle: true,
  outfile: path.join(dist, "taskpane.js"),
  format: "esm",
  target: "es2020",
  define: {
    __LIVEBOOK_API_URL__: JSON.stringify(process.env.VITE_LIVEBOOK_API_URL ?? ""),
  },
  sourcemap: true,
  logLevel: "silent",
});

fs.copyFileSync(path.join(root, "taskpane.html"), path.join(dist, "taskpane.html"));
fs.copyFileSync(path.join(root, "src/styles.css"), path.join(dist, "styles.css"));
copyDir(path.join(root, "public"), dist);

console.log("Built dist/taskpane.html");

function copyDir(source, target) {
  if (!fs.existsSync(source)) return;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      copyDir(sourcePath, targetPath);
    } else {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}
