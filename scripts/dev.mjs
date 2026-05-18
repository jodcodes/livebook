import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendRoot = path.join(repoRoot, "backend");
const uiRoot = path.join(repoRoot, "frontend/livebook-ui");
const addinRoot = path.join(repoRoot, "frontend/addin");
const addinRequire = createRequire(path.join(addinRoot, "package.json"));
const devCerts = addinRequire("office-addin-dev-certs");
const baseEnv = {
  ...process.env,
  ...readEnvFile(path.join(repoRoot, ".env")),
};

const gatewayPort = Number(process.env.LIVEBOOK_GATEWAY_PORT ?? 5001);
const backendPort = Number(process.env.LIVEBOOK_BACKEND_PORT ?? 5002);
const uiPort = Number(process.env.LIVEBOOK_UI_PORT ?? 3002);
const addinPort = Number(process.env.LIVEBOOK_ADDIN_PORT ?? 3001);

const backendUrl = `http://127.0.0.1:${backendPort}`;
const uiUrl = `http://localhost:${uiPort}`;
const addinUrl = `https://127.0.0.1:${addinPort}`;
let gatewayServer;
let shuttingDown = false;
let shutdownPromise;
let children = [];

await ensurePostgres();

children = [
  run("backend", "cargo", ["run"], backendRoot, {
    LIVEBOOK_BACKEND_HOST: "127.0.0.1",
    LIVEBOOK_BACKEND_PORT: String(backendPort),
  }),
  run("livebook-ui", "npm", ["run", "dev"], uiRoot, {
    LIVEBOOK_BACKEND_URL: backendUrl,
    LIVEBOOK_UI_PORT: String(uiPort),
    PORT: String(uiPort),
  }),
  run("addin", "npm", ["run", "dev"], addinRoot, {
    LIVEBOOK_BACKEND_URL: backendUrl,
    PORT: String(addinPort),
  }),
];

gatewayServer = await startGateway();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

process.on("exit", () => {
  if (!shuttingDown) {
    spawn("docker", ["compose", "stop", "postgres"], {
      cwd: repoRoot,
      stdio: "ignore",
      detached: true,
    }).unref();
  }
});

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
    void shutdown("SIGTERM");
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown || signal) return;
    console.error(`[${label}] exited with code ${code}`);
    void shutdown("SIGTERM");
  });

  return child;
}

async function ensurePostgres() {
  console.log("[postgres] starting docker compose service");
  await runCommand(
    "docker",
    ["compose", "up", "-d", "postgres"],
    repoRoot,
    "failed to start postgres container",
  );

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = await readCommand(
      "docker",
      ["inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}", "livebook-postgres"],
      repoRoot,
    );

    if (status === "healthy" || status === "running") {
      console.log(`[postgres] ready (${status})`);
      return;
    }

    await sleep(1_000);
  }

  throw new Error("postgres did not become ready within 30s");
}

async function startGateway() {
  const httpsOptions = await devCerts.getHttpsServerOptions(365);
  const server = https.createServer(httpsOptions, (req, res) => {
    const target = targetForPath(req.url ?? "/");
    proxyRequest(req, res, target);
  });

  server.on("upgrade", (req, socket, head) => {
    const target = targetForUpgrade(req.url ?? "/");
    if (!target) {
      socket.destroy();
      return;
    }

    proxyUpgrade(req, socket, head, target);
  });

  server.on("error", (error) => {
    console.error(`[gateway] failed to start on ${gatewayPort}:`, error);
    shutdown("SIGTERM");
  });

  await new Promise((resolve) => {
    server.listen(gatewayPort, resolve);
  });

  console.log(`Public dev gateway: https://localhost:${gatewayPort}`);
  console.log(`  UI: https://localhost:${gatewayPort}/`);
  console.log(`  API: https://localhost:${gatewayPort}/api/*`);
  console.log(`  Add-in: https://localhost:${gatewayPort}/taskpane.html`);

  return server;
}

function targetForPath(requestPath) {
  const pathname = new URL(requestPath, "https://localhost").pathname;

  if (pathname.startsWith("/api/backend/")) return uiUrl;
  if (pathname.startsWith("/api/")) return addinUrl;
  if (isAddinPath(pathname)) return addinUrl;
  return uiUrl;
}

function targetForUpgrade(requestPath) {
  const pathname = new URL(requestPath, "https://localhost").pathname;
  if (pathname.startsWith("/api/backend/")) return uiUrl;
  if (pathname.startsWith("/api/")) return addinUrl;
  if (isAddinPath(pathname)) return addinUrl;
  return uiUrl;
}

function isAddinPath(pathname) {
  return (
    pathname === "/taskpane.html" ||
    pathname === "/taskpane.js" ||
    pathname === "/taskpane.js.map" ||
    pathname === "/styles.css" ||
    pathname === "/manifest.xml" ||
    pathname.startsWith("/assets/")
  );
}

function proxyRequest(req, res, targetBaseUrl) {
  const target = new URL(targetBaseUrl);
  const pathname = new URL(req.url ?? "/", "https://localhost").pathname;
  if (pathname === "/" && targetBaseUrl === uiUrl) {
    void proxyRootPageViaFetch(res, targetBaseUrl);
    return;
  }

  const client = target.protocol === "https:" ? https : http;
  const options = {
    hostname: target.hostname,
    port: target.port || (target.protocol === "https:" ? 443 : 80),
    path: req.url ?? "/",
    method: req.method,
    headers: {
      ...req.headers,
      host: target.host,
    },
    rejectUnauthorized: false,
  };

  const upstream = client.request(options, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  upstream.on("error", (error) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`Gateway proxy error to ${target.origin}: ${error.message}`);
  });

  req.pipe(upstream);
}

async function proxyRootPageViaFetch(res, targetBaseUrl) {
  try {
    const upstream = await fetch(new URL("/", targetBaseUrl));
    const headers = new Headers(upstream.headers);
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    headers.delete("content-encoding");

    res.writeHead(upstream.status, Object.fromEntries(headers));
    res.end(await upstream.text());
  } catch (error) {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`Gateway proxy error to ${targetBaseUrl}: ${error.message}`);
  }
}

function proxyUpgrade(req, clientSocket, head, targetBaseUrl) {
  const target = new URL(targetBaseUrl);
  if (target.protocol !== "http:") {
    clientSocket.destroy();
    return;
  }

  const upstreamSocket = net.connect(
    Number(target.port || 80),
    target.hostname,
    () => {
      const headers = [`${req.method} ${req.url ?? "/"} HTTP/1.1`, `Host: ${target.host}`];

      for (const [name, value] of Object.entries(req.headers)) {
        const lower = name.toLowerCase();
        if (lower === "host" || lower === "connection" || lower === "upgrade") continue;
        headers.push(`${name}: ${value}`);
      }

      headers.push("Connection: Upgrade");
      headers.push(`Upgrade: ${req.headers.upgrade ?? "websocket"}`);
      headers.push("");
      headers.push("");

      upstreamSocket.write(headers.join("\r\n"));
      if (head.length > 0) upstreamSocket.write(head);

      clientSocket.pipe(upstreamSocket).pipe(clientSocket);
    },
  );

  upstreamSocket.on("error", () => {
    clientSocket.destroy();
  });
}

function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = (async () => {
    const stopSignal = signal === "exit" ? "SIGTERM" : signal;

    const childExitPromises = children.map((child) => stopChild(child, stopSignal));
    const gatewayClosePromise = gatewayServer
      ? new Promise((resolve) => gatewayServer.close(resolve))
      : Promise.resolve();

    await Promise.allSettled([...childExitPromises, gatewayClosePromise]);

    try {
      await runCommand("docker", ["compose", "stop", "postgres"], repoRoot);
    } catch (error) {
      console.error("[postgres] failed to stop cleanly:", error.message);
    }

    if (signal === "SIGINT") process.exit(130);
    if (signal === "SIGTERM") process.exit(143);
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

function runCommand(command, args, cwd, failureMessage = `${command} ${args.join(" ")} failed`) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${failureMessage} (exit ${code ?? "unknown"})`));
    });
  });
}

function readCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd,
      env: process.env,
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
