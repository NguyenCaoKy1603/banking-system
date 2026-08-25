const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const MAGIC = Buffer.from("BANKING-BACKUP-V1\0", "utf8");
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const CHECKSUM_BYTES = 32;

function option(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function hasFlag(name) { return process.argv.includes(`--${name}`); }

function parseKey(value) {
  const normalized = value?.trim();
  if (!normalized) throw new Error("BACKUP_ENCRYPTION_KEY is required and is never printed.");
  const key = normalized.startsWith("base64:")
    ? Buffer.from(normalized.slice(7), "base64")
    : normalized.startsWith("hex:")
      ? Buffer.from(normalized.slice(4), "hex")
      : Buffer.from(normalized, "base64");
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
}

function inputStream(input) {
  return input === "-" ? process.stdin : fs.createReadStream(path.resolve(input));
}

function outputStream(output) {
  if (output !== "-") return fs.createWriteStream(path.resolve(output), { flags: "wx" });
  return process.stdout;
}

function header(metadata, nonce) {
  const metadataBytes = Buffer.from(JSON.stringify(metadata), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(metadataBytes.length, 0);
  return Buffer.concat([MAGIC, length, metadataBytes, nonce]);
}

async function encrypt() {
  const input = option("input", "-");
  const output = option("output");
  if (!output) throw new Error("--output is required for backup encryption.");
  const key = parseKey(process.env.BACKUP_ENCRYPTION_KEY);
  const keyId = option("key-id", process.env.BACKUP_ENCRYPTION_KEY_ID || "backup-local-v1");
  const metadata = {
    format: "BANKING-BACKUP-V1",
    environment: option("environment", process.env.BANKING_ENV || "development"),
    database: option("database", process.env.POSTGRES_DB || "unknown"),
    schemaVersion: option("schema-version", process.env.SCHEMA_VERSION || "unknown"),
    releaseCommit: option("release-commit", process.env.BUILD_COMMIT_SHA || "unknown"),
    releaseDigest: option("release-digest", process.env.IMAGE_DIGEST || "unknown"),
    createdAt: new Date().toISOString(),
    keyId,
  };
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const aad = Buffer.from(JSON.stringify(metadata), "utf8");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const checksum = crypto.createHash("sha256");
  const hashing = new Transform({ transform(chunk, encoding, callback) { checksum.update(chunk); callback(null, chunk); } });
  const destination = outputStream(output);
  destination.write(header(metadata, nonce));
  cipher.on("data", (chunk) => destination.write(chunk));
  await pipeline(inputStream(input), hashing, cipher);
  const footer = Buffer.concat([cipher.getAuthTag(), checksum.digest()]);
  destination.write(footer);
  if (output !== "-") destination.end();
  const sidecar = option("metadata");
  if (sidecar) {
    fs.writeFileSync(path.resolve(sidecar), `${JSON.stringify({ ...metadata, checksum: footer.subarray(TAG_BYTES).toString("hex") }, null, 2)}\n`, { flag: "wx" });
  }
  console.error(`Encrypted backup written: ${output}`);
}

async function readPrefix(inputPath) {
  const handle = await fs.promises.open(path.resolve(inputPath), "r");
  try {
    const fixed = Buffer.alloc(MAGIC.length + 4);
    await handle.read(fixed, 0, fixed.length, 0);
    if (!fixed.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Backup magic is invalid.");
    const metadataLength = fixed.readUInt32BE(MAGIC.length);
    const metadataBytes = Buffer.alloc(metadataLength);
    await handle.read(metadataBytes, 0, metadataLength, fixed.length);
    const nonce = Buffer.alloc(NONCE_BYTES);
    await handle.read(nonce, 0, NONCE_BYTES, fixed.length + metadataLength);
    return { metadataBytes, metadata: JSON.parse(metadataBytes.toString("utf8")), nonce, dataStart: fixed.length + metadataLength + NONCE_BYTES };
  } finally { await handle.close(); }
}

async function decrypt() {
  const input = option("input");
  const output = option("output", "-");
  if (!input || input === "-") throw new Error("Encrypted backup decryption requires a file input.");
  if (output !== "-" && !hasFlag("allow-plaintext-output")) throw new Error("Restore must stream plaintext to --output=-; use --allow-plaintext-output only for an explicitly isolated disposable restore target.");
  const key = parseKey(process.env.BACKUP_ENCRYPTION_KEY);
  const prefix = await readPrefix(input);
  const stats = await fs.promises.stat(path.resolve(input));
  const footerLength = TAG_BYTES + CHECKSUM_BYTES;
  if (stats.size <= prefix.dataStart + footerLength) throw new Error("Encrypted backup is truncated.");
  const footerHandle = await fs.promises.open(path.resolve(input), "r");
  const footer = Buffer.alloc(footerLength);
  await footerHandle.read(footer, 0, footerLength, stats.size - footerLength);
  await footerHandle.close();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, prefix.nonce);
  decipher.setAAD(prefix.metadataBytes);
  decipher.setAuthTag(footer.subarray(0, TAG_BYTES));
  const checksum = crypto.createHash("sha256");
  const hashing = new Transform({ transform(chunk, encoding, callback) { checksum.update(chunk); callback(null, chunk); } });
  await pipeline(fs.createReadStream(path.resolve(input), { start: prefix.dataStart, end: stats.size - footerLength - 1 }), decipher, hashing, outputStream(output));
  const actual = checksum.digest();
  if (!crypto.timingSafeEqual(actual, footer.subarray(TAG_BYTES))) throw new Error("Backup checksum verification failed.");
  console.error(`Backup restored from ${input}; metadata environment=${prefix.metadata.environment}, schema=${prefix.metadata.schemaVersion}`);
}

const mode = hasFlag("encrypt") ? "encrypt" : hasFlag("decrypt") ? "decrypt" : "";
if (!mode) {
  console.error("Usage: node scripts/encrypted-backup.cjs --encrypt --input=<dump.sql> --output=<dump.sql.enc> [--metadata=<metadata.json]\n       node scripts/encrypted-backup.cjs --decrypt --input=<dump.sql.enc> --output=- | pg_restore ...");
  process.exitCode = 2;
} else {
  (mode === "encrypt" ? encrypt : decrypt)().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
