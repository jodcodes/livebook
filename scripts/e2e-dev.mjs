import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveE2eDatabaseConfig, resetE2eDatabase } from "./e2e-db.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendRoot = path.join(repoRoot, "backend");
const uiRoot = path.join(repoRoot, "frontend/livebook-ui");
const baseEnv = {
  ...readEnvFile(path.join(repoRoot, ".env")),
  ...process.env,
};

const backendPort = Number(process.env.LIVEBOOK_E2E_BACKEND_PORT ?? 5002);
const uiPort = Number(process.env.LIVEBOOK_E2E_UI_PORT ?? 3002);
const postgresPort = Number(baseEnv.LIVEBOOK_POSTGRES_PORT ?? 5432);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const uiUrl = `http://localhost:${uiPort}`;
const databaseConfig = resolveE2eDatabaseConfig(baseEnv, postgresPort);
const databaseUrl = databaseConfig.databaseUrl;

let children = [];
let shuttingDown = false;
let shutdownPromise;
let postgresWasRunning = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(signal, signal === "SIGINT" ? 130 : 143);
  });
}

main().catch((error) => {
  console.error("[e2e-dev]", error);
  void shutdown("SIGTERM", 1);
});

async function main() {
  await ensurePostgres();
  await resetE2eDatabase({ config: databaseConfig, repoRoot, runCommand });

  children = [
    run("backend", "cargo", ["run"], backendRoot, {
      DATABASE_URL: databaseUrl,
      LIVEBOOK_BACKEND_HOST: "127.0.0.1",
      LIVEBOOK_BACKEND_PORT: String(backendPort),
      LIVEBOOK_PRODUCT_AI_DISABLED: "1",
    }),
  ];
  await waitForUrl(`${backendUrl}/playbook`, "backend");

  children.push(
    run("livebook-ui", "npm", ["run", "dev"], uiRoot, {
      LIVEBOOK_BACKEND_URL: backendUrl,
      LIVEBOOK_UI_PORT: String(uiPort),
      PORT: String(uiPort),
    })
  );
  await waitForUrl(uiUrl, "livebook-ui");
  console.log(`[e2e-dev] ready: ${uiUrl} -> ${backendUrl}`);
}

function run(label, command, args, cwd, extraEnv) {
  const child = spawn(command, args, {
    cwd,
    env: {
      ...baseEnv,
      ...extraEnv,
    },
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`[${label}] failed to start:`, error);
    void shutdown("SIGTERM", 1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown || signal) return;
    console.error(`[${label}] exited with code ${code}`);
    void shutdown("SIGTERM", code ?? 1);
  });

  return child;
}

async function ensurePostgres() {
  postgresWasRunning = await isPostgresRunning();
  console.log("[postgres] starting docker compose service");
  await runCommand("docker", ["compose", "up", "-d", "postgres"], repoRoot);

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const status = await readCommand("docker", [
      "inspect",
      "--format",
      "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
      "livebook-postgres",
    ]);

    if (status === "healthy" || status === "running") {
      console.log(`[postgres] ready (${status})`);
      return;
    }

    await sleep(1_000);
  }

  throw new Error("postgres did not become ready within 60s");
}

async function waitForUrl(url, label) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) {
        console.log(`[${label}] ready (${response.status})`);
        return;
      }
    } catch {
      // Retry while the service starts.
    }

    await sleep(1_000);
  }

  throw new Error(`${label} did not become ready at ${url}`);
}

function shutdown(signal, exitCode = 0) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = (async () => {
    await Promise.allSettled(children.map((child) => stopChild(child, signal)));

    try {
      if (!postgresWasRunning) {
        await runCommand("docker", ["compose", "stop", "postgres"], repoRoot);
      }
    } catch (error) {
      console.error("[postgres] failed to stop cleanly:", error.message);
    }

    process.exit(exitCode);
  })();

  return shutdownPromise;
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function stopChild(child, signal) {
  return new Promise((resolve) => {
    if (!child || child.killed || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 5_000);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });

    child.kill(signal);
  });
}

async function isPostgresRunning() {
  try {
    const status = await readCommand("docker", [
      "inspect",
      "--format",
      "{{.State.Status}}",
      "livebook-postgres",
    ]);
    return status === "running";
  } catch {
    return false;
  }
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: baseEnv,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit ${code ?? "unknown"}`));
    });
  });
}

function readCommand(command, args) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: baseEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error((stderr || stdout || `${command} ${args.join(" ")}`).trim()));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
