import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "../..");
const backendRoot = path.join(repoRoot, "backend");

await import("./sideload-word-mac.mjs");

const children = [
  run("backend", "cargo", ["run"], backendRoot),
  run("addin", process.execPath, ["scripts/dev-server.mjs"], root),
];

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
    env: {
      ...process.env,
      LIVEBOOK_BACKEND_URL:
        process.env.LIVEBOOK_BACKEND_URL ?? "http://127.0.0.1:3020",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => process.stdout.write(prefix(label, chunk)));
  child.stderr.on("data", (chunk) => process.stderr.write(prefix(label, chunk)));

  child.on("exit", (code, signal) => {
    if (code === 0 || signal) return;
    console.error(`[${label}] exited with code ${code}`);
    shutdown("SIGTERM");
  });

  return child;
}

function prefix(label, chunk) {
  return String(chunk)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => `[${label}] ${line}\n`)
    .join("");
}

function shutdown(signal) {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
  process.exit(signal === "SIGINT" ? 130 : 143);
}
