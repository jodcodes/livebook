const DEFAULT_E2E_DATABASE_NAME = "livebook_e2e";
const PROTECTED_DATABASE_NAMES = new Set(["livebook", "postgres", "template0", "template1"]);

export function resolveE2eDatabaseConfig(baseEnv, postgresPort) {
  const databaseUrl =
    baseEnv.LIVEBOOK_E2E_DATABASE_URL ??
    `postgres://postgres:postgres@127.0.0.1:${postgresPort}/${DEFAULT_E2E_DATABASE_NAME}`;
  const databaseName = databaseNameFromUrl(databaseUrl);

  return {
    databaseUrl,
    databaseName,
    postgresUser: baseEnv.LIVEBOOK_E2E_POSTGRES_USER ?? baseEnv.POSTGRES_USER ?? "postgres",
    shouldResetDatabase: baseEnv.LIVEBOOK_E2E_RESET_DB !== "0",
    allowProtectedDatabaseReset: baseEnv.LIVEBOOK_E2E_ALLOW_PROTECTED_DB_RESET === "1",
  };
}

export function databaseNameFromUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new Error(`invalid LIVEBOOK_E2E_DATABASE_URL: ${error.message}`);
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!databaseName) {
    throw new Error("LIVEBOOK_E2E_DATABASE_URL must include a database name");
  }

  return databaseName;
}

export function assertSafeE2eDatabaseName(databaseName, allowProtectedDatabaseReset = false) {
  if (!allowProtectedDatabaseReset && PROTECTED_DATABASE_NAMES.has(databaseName)) {
    throw new Error(`Refusing to reset protected database \`${databaseName}\``);
  }

  if (
    !allowProtectedDatabaseReset &&
    !databaseName.includes("e2e") &&
    !databaseName.endsWith("_test")
  ) {
    throw new Error(
      `Refusing to reset database \`${databaseName}\`; use a name containing e2e or ending in _test`
    );
  }
}

export async function resetE2eDatabase({ config, repoRoot, runCommand }) {
  if (!config.shouldResetDatabase) {
    console.log(`[postgres] keeping existing database ${config.databaseName}`);
    return;
  }

  assertSafeE2eDatabaseName(config.databaseName, config.allowProtectedDatabaseReset);

  await runPsql({
    repoRoot,
    runCommand,
    postgresUser: config.postgresUser,
    databaseName: "postgres",
    sql: `DROP DATABASE IF EXISTS ${quoteSqlIdentifier(config.databaseName)} WITH (FORCE);`,
  });
  await runPsql({
    repoRoot,
    runCommand,
    postgresUser: config.postgresUser,
    databaseName: "postgres",
    sql: `CREATE DATABASE ${quoteSqlIdentifier(config.databaseName)};`,
  });

  console.log(`[postgres] reset database ${config.databaseName}`);
}

function runPsql({ repoRoot, runCommand, postgresUser, databaseName, sql }) {
  return runCommand(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      postgresUser,
      "-d",
      databaseName,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    repoRoot
  );
}

function quoteSqlIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
