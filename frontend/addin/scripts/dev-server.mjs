import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

await import("./build.mjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const devCerts = require("office-addin-dev-certs");
const dist = path.join(root, "dist");
const port = Number(process.env.PORT ?? 3001);
const backendUrl = new URL(process.env.LIVEBOOK_BACKEND_URL ?? "http://127.0.0.1:3020");

const httpsOptions = await devCerts.getHttpsServerOptions(365);

const server = https.createServer(
  httpsOptions,
  (req, res) => {
    if (!req.url) {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }

    if (req.url.startsWith("/api/")) {
      proxyToBackend(req, res);
      return;
    }

    serveStatic(req, res);
  },
);

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the other add-in server or set PORT.`);
    process.exit(1);
  }
  if (error.code === "EPERM" || error.code === "EACCES") {
    console.error(`Cannot bind https://127.0.0.1:${port}. Run from a normal Terminal or set PORT.`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Livebook add-in dev server: https://localhost:${port}/taskpane.html`);
  console.log(`Proxying /api to ${backendUrl.origin}`);
});

function proxyToBackend(req, res) {
  const backendPath = req.url.replace(/^\/api/, "");
  const proxy = http.request(
    {
      hostname: backendUrl.hostname,
      port: backendUrl.port || (backendUrl.protocol === "https:" ? 443 : 80),
      path: backendPath,
      method: req.method,
      headers: { ...req.headers, host: backendUrl.host },
    },
    (backendRes) => {
      res.writeHead(backendRes.statusCode ?? 502, backendRes.headers);
      backendRes.pipe(res);
    },
  );
  proxy.on("error", (error) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(
      `Backend unavailable at ${backendUrl.origin}. Start it with: cd ../../backend && cargo run, or set LIVEBOOK_BACKEND_URL. ${error.message}`,
    );
  });
  req.pipe(proxy);
}

function serveStatic(req, res) {
  const url = new URL(req.url, "https://localhost");
  const requestPath = url.pathname === "/" ? "/taskpane.html" : url.pathname;
  const filePath = path.normalize(path.join(dist, requestPath));

  if (!filePath.startsWith(dist) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "content-type": contentType(filePath),
    "cache-control": "no-store, max-age=0",
  });
  fs.createReadStream(filePath).pipe(res);
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}
