import { URL } from "node:url";

export type DatabaseTestEnvironment = Readonly<Record<string, string | undefined>>;

export interface DisposableDatabaseTarget {
  canonicalTarget: string;
  databaseName: string;
  hostname: string;
  port: number | null;
  url: string;
}

export interface DisposableDatabaseGuardOptions {
  /** Name of the environment variable holding the database under test. */
  targetEnvName?: string;
  /** Environment variables that may contain development/preview references. */
  referenceEnvNames?: readonly string[];
}

const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "::1", "postgres"] as const;
const DEFAULT_REFERENCE_ENV_NAMES = [
  "DATABASE_URL",
  "DEV_DATABASE_URL",
  "DEVELOPMENT_DATABASE_URL",
  "PREVIEW_DATABASE_URL",
  "BANKING_PREVIEW_DATABASE_URL",
  "P0_PREVIEW_DATABASE_URL",
] as const;
const DATABASE_NAME_PATTERN = /^banking_test_[a-z0-9_]+$/;
const EXPLICITLY_FORBIDDEN_DATABASE_NAMES = new Set([
  "banking_preview",
  "banking_dev",
  "banking_development",
]);

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function parsePostgresUrl(rawUrl: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL.`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${label} must use postgres:// or postgresql://.`);
  }
  if (!parsed.hostname) throw new Error(`${label} must include a hostname.`);
  if (!parsed.pathname || parsed.pathname === "/") {
    throw new Error(`${label} must include a database name.`);
  }
  return parsed;
}

function databaseName(parsed: URL, label: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new Error(`${label} contains an invalid encoded database name.`);
  }
  if (!decoded || decoded.includes("/")) {
    throw new Error(`${label} must contain exactly one database name.`);
  }
  return decoded;
}

function canonicalTarget(parsed: URL, name: string): string {
  const port = parsed.port || (parsed.protocol === "postgres:" ? "5432" : "5432");
  return `${parsed.protocol}//${normalizeHostname(parsed.hostname)}:${port}/${name}`;
}

function allowedHosts(env: DatabaseTestEnvironment): Set<string> {
  const configured = env.DATABASE_TEST_ALLOWED_HOSTS?.split(",")
    .map((host) => normalizeHostname(host))
    .filter(Boolean);
  return new Set(configured && configured.length > 0 ? configured : DEFAULT_ALLOWED_HOSTS);
}

function referenceUrls(env: DatabaseTestEnvironment, names: readonly string[]): string[] {
  const explicit = env.DATABASE_TEST_REFERENCE_URLS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  return [
    ...names.map((name) => env[name]?.trim()).filter((value): value is string => Boolean(value)),
    ...explicit,
  ];
}

/**
 * Validate the target of a destructive PostgreSQL test before a connection is
 * opened. This is intentionally fail-closed: a missing test marker or an
 * unknown host/database is an error, not a skipped test.
 */
export function assertDisposableDatabaseResetAllowed(
  databaseUrl: string,
  env: DatabaseTestEnvironment = process.env,
  options: DisposableDatabaseGuardOptions = {},
): DisposableDatabaseTarget {
  if (env.NODE_ENV?.trim().toLowerCase() !== "test") {
    throw new Error("Destructive PostgreSQL tests require NODE_ENV=test.");
  }
  if (env.BANKING_ENV?.trim().toLowerCase() !== "test") {
    throw new Error("Destructive PostgreSQL tests require BANKING_ENV=test.");
  }
  if (env.ALLOW_DATABASE_TEST_RESET !== "1") {
    throw new Error("Destructive PostgreSQL tests require ALLOW_DATABASE_TEST_RESET=1.");
  }

  const targetUrl = databaseUrl.trim();
  if (!targetUrl) throw new Error("A disposable PostgreSQL test URL is required.");
  const parsed = parsePostgresUrl(targetUrl, "Test database URL");
  const name = databaseName(parsed, "Test database URL");
  const hostname = normalizeHostname(parsed.hostname);
  if (!allowedHosts(env).has(hostname)) {
    throw new Error(`Test database host '${hostname}' is not in DATABASE_TEST_ALLOWED_HOSTS.`);
  }
  if (EXPLICITLY_FORBIDDEN_DATABASE_NAMES.has(name.toLowerCase())) {
    throw new Error(`Refusing destructive tests against forbidden database '${name}'.`);
  }
  if (!DATABASE_NAME_PATTERN.test(name)) {
    throw new Error("Test database name must match banking_test_<suffix>.");
  }

  const target = {
    canonicalTarget: canonicalTarget(parsed, name),
    databaseName: name,
    hostname,
    port: parsed.port ? Number(parsed.port) : null,
    url: targetUrl,
  } satisfies DisposableDatabaseTarget;
  const references = referenceUrls(
    env,
    (options.referenceEnvNames ?? DEFAULT_REFERENCE_ENV_NAMES).filter(
      (name) => name !== options.targetEnvName,
    ),
  );
  for (const reference of references) {
    const referenceParsed = parsePostgresUrl(reference, "Development/preview database URL");
    const referenceName = databaseName(referenceParsed, "Development/preview database URL");
    if (canonicalTarget(referenceParsed, referenceName) === target.canonicalTarget) {
      throw new Error("Refusing destructive tests because the test URL matches a development/preview database URL.");
    }
  }
  return target;
}

export function assertDisposableDatabaseAdminUrl(
  databaseUrl: string,
  env: DatabaseTestEnvironment = process.env,
): DisposableDatabaseTarget {
  const parsed = parsePostgresUrl(databaseUrl.trim(), "Database test admin URL");
  const name = databaseName(parsed, "Database test admin URL");
  const hostname = normalizeHostname(parsed.hostname);
  if (!allowedHosts(env).has(hostname)) {
    throw new Error(`Database test admin host '${hostname}' is not in DATABASE_TEST_ALLOWED_HOSTS.`);
  }
  if (!new Set(["postgres", "template1"]).has(name.toLowerCase())) {
    throw new Error("Database test admin URL must connect to postgres or template1, never an application database.");
  }
  return {
    canonicalTarget: canonicalTarget(parsed, name),
    databaseName: name,
    hostname,
    port: parsed.port ? Number(parsed.port) : null,
    url: databaseUrl.trim(),
  };
}
