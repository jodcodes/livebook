import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "../..");

await import("./sideload-word-mac.mjs");

const children = [run("dev", process.execPath, ["scripts/dev.mjs"], repoRoot)];

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(signal));
}

process.on("exit", () => {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
});

function run(label, command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env },
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (code === 0 || signal) return;
    console.error(`[${label}] exited with code ${code}`);
    shutdown("SIGTERM");
  });

  return child;
}

function shutdown(signal) {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
  process.exit(signal === "SIGINT" ? 130 : 143);
}
