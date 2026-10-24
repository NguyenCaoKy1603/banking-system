const LOCAL_ENVIRONMENTS = new Set(["development", "test"]);

/** Resolve the public API listener address without permitting accidental LAN binding in local learning runs. */
export function resolveBankingBindHost(env: NodeJS.ProcessEnv = process.env): "0.0.0.0" | "127.0.0.1" {
  const configured = env.BANKING_BIND_HOST?.trim();
  if (!configured) return "0.0.0.0";
  if (configured === "0.0.0.0") return configured;

  const environment = env.BANKING_ENV?.trim().toLowerCase() ?? "development";
  if (configured === "127.0.0.1" && LOCAL_ENVIRONMENTS.has(environment)) {
    return configured;
  }

  throw new Error(
    "BANKING_BIND_HOST may use 127.0.0.1 only in development/test; other runtimes must bind 0.0.0.0.",
  );
}
