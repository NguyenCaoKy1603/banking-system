const { Pool } = require("pg");
const { createDecipheriv, createHmac } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");

function loadEnvFile() {
  const envPath = path.resolve(__dirname, "../../.env.compose");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    process.env[key] = value;
  }
}
loadEnvFile();

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of input.toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function getTotp(secretBase32) {
  const now = Date.now();
  const step = 30;
  const counter = Math.floor(now / 1000 / step);
  const remaining = step - (Math.floor(now / 1000) % step);

  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const key = base32Decode(secretBase32);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
  return { code, remaining };
}

async function main() {
  const email = process.argv[2] || "admin@banking.local";
  const pool = new Pool({
    connectionString: "postgresql://banking:stage1-local-password@127.0.0.1:5433/banking_preview",
  });

  try {
    const staffRes = await pool.query("SELECT * FROM staff_users WHERE email_normalized = $1", [email.trim().toLowerCase()]);
    if (!staffRes.rows.length) {
      console.error(`Không tìm thấy nhân viên với email: ${email}`);
      process.exit(1);
    }
    const staff = staffRes.rows[0];
    const credRes = await pool.query("SELECT * FROM staff_mfa_credentials WHERE staff_id = $1", [staff.id]);
    if (!credRes.rows.length) {
      console.error(`Nhân viên ${email} chưa được cấu hình 2FA/MFA trong DB.`);
      process.exit(1);
    }
    const cred = credRes.rows[0];

    const mfaKey = process.env.BANKING_MFA_ENCRYPTION_KEY;
    const rawKey = Buffer.from(mfaKey.replace("base64:", ""), "base64");

    const parts = cred.secret_ciphertext.split(".");
    const nonce = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    const body = Buffer.from(parts[4], "base64url");

    const decipher = createDecipheriv("aes-256-gcm", rawKey, nonce);
    decipher.setAuthTag(tag);
    const secret = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");

    const { code, remaining } = getTotp(secret);
    console.log("\n=======================================================");
    console.log(` >> TÀI KHOẢN: ${email} (${staff.display_name})`);
    console.log(` >> KHÓA BÍ MẬT 2FA (Secret trong DB): ${secret}`);
    console.log(` >> MÃ 2FA TOTP HIỆN TẠI LÀ: [ ${code} ]`);
    console.log(` >> Còn hiệu lực trong: ${remaining} giây`);
    console.log("=======================================================\n");
  } catch (err) {
    console.error("Lỗi:", err.message);
  } finally {
    await pool.end();
  }
}

main();
