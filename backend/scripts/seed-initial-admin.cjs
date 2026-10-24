/**
 * Script khởi tạo tài khoản Super Admin trực tiếp vào PostgreSQL.
 * Không cần mở cổng phụ 8025, không phụ thuộc vào container invitation-capture.
 *
 * Cách dùng:
 *   node scripts/seed-initial-admin.cjs [email] [password] [displayName]
 *
 * Ví dụ:
 *   node scripts/seed-initial-admin.cjs admin@banking.local "Admin@123456" "Super Admin"
 */
const { randomBytes, randomUUID, pbkdf2Sync, createCipheriv, createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

// Đọc file .env.compose nếu biến môi trường chưa được nạp
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

const emailInput = process.argv[2] || "superadmin@example.test";
const passwordInput = process.argv[3] || "Admin@123456";
const displayNameInput = process.argv[4] || "Super Admin";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("LỖI: Biến DATABASE_URL chưa được cấu hình.");
  process.exit(1);
}

// Chuyển hostname sang 127.0.0.1:5433 nếu chạy từ máy host
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

// Hàm sinh khóa Base32 cho TOTP
function generateTotpSecret() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = randomBytes(20);
  let secret = "";
  for (let i = 0; i < 32; i++) {
    secret += chars[bytes[i % bytes.length] % chars.length];
  }
  return secret;
}

// Băm mật khẩu chuẩn PBKDF2 của dự án (120,000 rounds)
function hashPassword(password) {
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("hex");
  return { salt: salt.toString("hex"), digest };
}

// Mã hóa TOTP Secret bằng AES-256-GCM chuẩn Envelope của dự án
function encryptMfaSecret(secretText, keyPayload, keyId = "mfa-v1") {
  const rawKey = keyPayload.startsWith("base64:") ? keyPayload.slice(7) : keyPayload;
  const masterKey = Buffer.from(rawKey, "base64");
  if (masterKey.length !== 32) {
    throw new Error("BANKING_MFA_ENCRYPTION_KEY phải decode ra đúng 32 bytes.");
  }

  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(secretText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Định dạng envelope tương thích: v1.<keyId>.<nonce>.<tag>.<ciphertext>
  return [
    "v1",
    keyId,
    nonce.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

async function main() {
  const mfaKeyEnv = process.env.BANKING_MFA_ENCRYPTION_KEY?.trim();
  if (!mfaKeyEnv) {
    console.error("LỖI: Biến BANKING_MFA_ENCRYPTION_KEY chưa được cấu hình.");
    process.exit(1);
  }

  const connectionString = resolveLocalDatabaseUrl(databaseUrl);
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });

  try {
    const client = await pool.connect();
    try {
      const emailNormalized = emailInput.trim().toLowerCase();
      const employeeCode = `ADMIN-${randomBytes(4).toString("hex").toUpperCase()}`;
      const staffId = randomUUID();
      const mfaId = randomUUID();
      const environmentScope = process.env.BANKING_ENV || "preview";
      const keyId = process.env.BANKING_MFA_ENCRYPTION_KEY_ID || "mfa-v1";

      const { salt, digest } = hashPassword(passwordInput);
      const totpSecret = generateTotpSecret();
      const encryptedSecret = encryptMfaSecret(totpSecret, mfaKeyEnv, keyId);

      await client.query("BEGIN");

      // 1. Tạo hoặc cập nhật thông tin user trong staff_users
      await client.query(
        `INSERT INTO staff_users (id, employee_code, email_normalized, display_name, password_salt, password_digest, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
         ON CONFLICT (email_normalized) DO UPDATE 
         SET password_salt = EXCLUDED.password_salt,
             password_digest = EXCLUDED.password_digest,
             status = 'ACTIVE',
             display_name = EXCLUDED.display_name
         RETURNING id`,
        [staffId, employeeCode, emailNormalized, displayNameInput, salt, digest]
      );

      // Lấy ID thực tế (phòng trường hợp email đã tồn tại và update)
      const res = await client.query("SELECT id FROM staff_users WHERE email_normalized = $1", [emailNormalized]);
      const actualStaffId = res.rows[0].id;

      // 2. Gán quyền ADMIN
      await client.query(
        `INSERT INTO staff_user_roles (staff_id, role_code, environment_scope)
         VALUES ($1, 'ADMIN', $2)
         ON CONFLICT (staff_id, role_code, environment_scope) DO NOTHING`,
        [actualStaffId, environmentScope]
      );

      // 3. Xóa credential MFA cũ nếu có và nạp credential mới
      await client.query("DELETE FROM staff_mfa_credentials WHERE staff_id = $1", [actualStaffId]);
      await client.query(
        `INSERT INTO staff_mfa_credentials (id, staff_id, credential_type, secret_ciphertext, encryption_key_id, secret_cipher_version, secret_encryption_algorithm)
         VALUES ($1, $2, 'TOTP', $3, $4, 'v1', 'AES-256-GCM')`,
        [mfaId, actualStaffId, encryptedSecret, keyId]
      );

      await client.query("COMMIT");

      console.log("\n============================================================");
      console.log("       KHỞI TẠO TÀI KHOẢN ADMIN THÀNH CÔNG!");
      console.log("============================================================");
      console.log(`Email đăng nhập:    ${emailNormalized}`);
      console.log(`Mật khẩu:           ${passwordInput}`);
      console.log(`Vai trò (Role):     ADMIN (Super Admin)`);
      console.log(`Khóa bí mật 2FA:    ${totpSecret}`);
      console.log("------------------------------------------------------------");
      console.log("HƯỚNG DẪN CÀI ĐẶT GOOGLE AUTHENTICATOR:");
      console.log("1. Mở ứng dụng Google Authenticator trên điện thoại.");
      console.log("2. Bấm dấu [+] -> Chọn 'Nhập khóa thiết lập' (Enter a setup key).");
      console.log(`3. Tên tài khoản:    Banking Admin (${emailNormalized})`);
      console.log(`4. Khóa của bạn:    ${totpSecret}`);
      console.log("5. Dạng khóa:       Dựa trên thời gian (Time-based).");
      console.log("============================================================\n");
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("LỖI khi khởi tạo Admin:", error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
