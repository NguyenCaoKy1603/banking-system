const { Pool } = require("pg");
const crypto = require("node:crypto");
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

const email = process.argv[2] || "ncaoky160305+testlan1@gmail.com";
const password = process.argv[3] || "Password@123";

function resolveLocalDatabaseUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (parsed.hostname === "postgres") {
      parsed.hostname = "127.0.0.1";
      parsed.port = process.env.POSTGRES_PORT || "5433";
    }
    return parsed.toString();
  } catch {
    return urlStr;
  }
}

async function main() {
  const dbUrl = process.env.DATABASE_URL
    ? resolveLocalDatabaseUrl(process.env.DATABASE_URL)
    : "postgresql://banking:stage1-local-password@127.0.0.1:5433/banking_preview";

  const pool = new Pool({
    connectionString: dbUrl,
  });

  try {
    const salt = crypto.randomBytes(16);
    const digest = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");

    const res = await pool.query(
      "UPDATE customers SET password_salt = $1, password_digest = $2, access_status = 'ACTIVE' WHERE email = $3 RETURNING id, full_name, phone_number",
      [salt.toString("hex"), digest, email]
    );

    if (res.rowCount === 0) {
      console.log(`Không tìm thấy khách hàng với email: ${email}`);
      return;
    }

    const customer = res.rows[0];
    console.log(`Đã cập nhật mật khẩu cho: ${customer.full_name} (${email})`);
    console.log(`Số điện thoại: ${customer.phone_number}`);
    console.log(`Mật khẩu mới: ${password}`);

    // Kiểm tra tài khoản thanh toán và số dư
    const paRes = await pool.query(
      "SELECT account_number, available_minor, current_minor FROM payment_accounts WHERE customer_id = $1",
      [customer.id]
    );

    if (paRes.rows.length > 0) {
      console.log(`Số tài khoản: ${paRes.rows[0].account_number}`);
      console.log(`Số dư khả dụng: ${paRes.rows[0].available_minor} VND`);
    }
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
