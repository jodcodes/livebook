import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertSafeE2eDatabaseName,
  databaseNameFromUrl,
  resolveE2eDatabaseConfig,
  resetE2eDatabase,
} from "./e2e-db.mjs";

test("resolves an isolated database by default", () => {
  const config = resolveE2eDatabaseConfig({}, 5432);

  assert.equal(config.databaseName, "livebook_e2e");
  assert.equal(
    config.databaseUrl,
    "postgres://postgres:postgres@127.0.0.1:5432/livebook_e2e"
  );
  assert.equal(config.shouldResetDatabase, true);
});

test("extracts the database name from a postgres URL", () => {
  assert.equal(
    databaseNameFromUrl("postgres://postgres:postgres@127.0.0.1:5433/custom_e2e"),
    "custom_e2e"
  );
});

test("blocks protected and non-test database names", () => {
  assert.throws(() => assertSafeE2eDatabaseName("livebook"), /Refusing/);
  assert.throws(() => assertSafeE2eDatabaseName("postgres"), /Refusing/);
  assert.throws(() => assertSafeE2eDatabaseName("customer_data"), /Refusing/);
  assert.doesNotThrow(() => assertSafeE2eDatabaseName("customer_data_test"));
});

test("reset drops and recreates the isolated database", async () => {
  const calls = [];
  const config = resolveE2eDatabaseConfig({}, 5432);

  await resetE2eDatabase({
    config,
    repoRoot: "/repo",
    runCommand: async (command, args, cwd) => {
      calls.push({ command, args, cwd });
    },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    command: "docker",
    args: [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      'DROP DATABASE IF EXISTS "livebook_e2e" WITH (FORCE);',
    ],
    cwd: "/repo",
  });
  assert.deepEqual(calls[1], {
    command: "docker",
    args: [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      'CREATE DATABASE "livebook_e2e";',
    ],
    cwd: "/repo",
  });
});
