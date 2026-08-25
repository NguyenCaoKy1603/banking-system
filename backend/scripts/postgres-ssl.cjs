function normalizeCertificate(value) {
  const normalized = value?.trim();
  return normalized ? normalized.replace(/\\n/g, "\n") : undefined;
}

function resolvePostgresSsl(env = process.env) {
  const environment = env.BANKING_ENV?.trim().toLowerCase() || "development";
  const productionLike = environment === "staging" || environment === "production-like";
  const mode = (env.DATABASE_SSL_MODE?.trim().toLowerCase() || (productionLike ? "verify-full" : "disable"));
  if (!["disable", "require", "verify-ca", "verify-full"].includes(mode)) {
    throw new Error("DATABASE_SSL_MODE must be disable, require, verify-ca or verify-full.");
  }
  if (mode === "disable") {
    if (productionLike) throw new Error("Production-like PostgreSQL connections require DATABASE_SSL_MODE=verify-full.");
    return undefined;
  }
  const ca = normalizeCertificate(env.DATABASE_CA_CERT);
  const servername = env.DATABASE_SERVER_NAME?.trim();
  if ((mode === "verify-ca" || mode === "verify-full") && !ca) {
    throw new Error(`${mode} PostgreSQL mode requires DATABASE_CA_CERT or a resolved trust-store CA.`);
  }
  if (mode === "verify-full" && !servername) {
    throw new Error("verify-full PostgreSQL mode requires DATABASE_SERVER_NAME.");
  }
  return {
    rejectUnauthorized: true,
    ...(ca ? { ca } : {}),
    ...(servername ? { servername } : {}),
  };
}

module.exports = { resolvePostgresSsl };
