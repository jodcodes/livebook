import { spawn } from "node:child_process";

const port = Number(process.env.LIVEBOOK_UI_PORT ?? process.env.PORT ?? 3002);
const child = spawn("next", ["dev", "--webpack", "-p", String(port)], {
  env: {
    ...process.env,
    WATCHPACK_POLLING: process.env.WATCHPACK_POLLING ?? "true",
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

child.on("error", (error) => {
  console.error("[livebook-ui] failed to start dev server:", error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(signal === "SIGINT" ? 130 : 143);
  }
  process.exit(code ?? 0);
});
