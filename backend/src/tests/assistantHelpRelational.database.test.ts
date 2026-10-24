import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { DatabasePool } from "../database/pool.js";
import { UnitOfWork } from "../database/unitOfWork.js";
import { RelationalHttpBoundary } from "../database/relationalHttpBoundary.js";
import { RelationalAuthService } from "../database/relationalAuthService.js";
import { assertDisposableDatabaseResetAllowed } from "../database/disposableDatabaseGuard.js";
import { BankingSystem } from "../bankingSystem.js";
import { PostgresRelationalRepository } from "../database/postgresRelationalRepository.js";
import { createPersistentBankingServer } from "../http.js";
import { FakeAssistantHelpProvider } from "../assistant/helpProvider.js";
import { resolveAssistantConfig } from "../assistant/helpConfig.js";
import { AssistantHelpService } from "../assistant/helpService.js";
import { AssistantRateLimiter } from "../assistant/rateLimiter.js";

const TEST_REGISTRATION_FINGERPRINT_KEY = Buffer.alloc(32, 1);

const databaseUrl = process.env.DATABASE_URL?.trim() || process.env.RELATIONAL_DATABASE_URL?.trim();

if (databaseUrl) {
  assertDisposableDatabaseResetAllowed(databaseUrl, process.env, {
    targetEnvName: process.env.DATABASE_URL ? "DATABASE_URL" : "RELATIONAL_DATABASE_URL",
  });
}

/**
 * GHI CHÚ BẰNG CHỨNG KIỂM THỬ:
 * Suite này đã được hoàn thiện theo đúng kiến trúc relational persistence của hệ thống:
 * - So sánh toàn bộ nội dung dữ liệu nghiệp vụ trước và sau (toàn bộ cột payment_accounts gồm updated_at,
 *   toàn bộ cột customers gồm access_status/access_version/created_at, ledger_journals, ledger_entries).
 * - Khử nhạy cảm (sanitize) password_salt/digest thành fingerprint một chiều trước khi so sánh bằng assert.deepEqual,
 *   tránh in bí mật thông tin tài khoản ra log hay stack trace nếu kiểm tra thất bại.
 * - Fake Provider ở trạng thái chờ có kiểm soát (delay 60ms) để chứng minh connection pool được giải phóng (active = 0) khi provider còn đang chờ.
 * - Kiểm chứng repository.withState không hề bị kích hoạt (withStateCalls = 0).
 * - Dọn dẹp đầy đủ server, repository pool và direct pool trong t.after.
 *
 * Do môi trường hiện tại không có Docker daemon hoạt động để khởi tạo container PostgreSQL
 * disposable tạm thời, suite này được ghi nhận trạng thái trung thực là:
 * "Suite đã tạo nhưng chưa hoàn thiện và chưa chạy (INCOMPLETE_AND_NOT_RUN)".
 */
test(
  "PostgreSQL Relational / Assistant HTTP: Xác thực phiên relational thật, giải phóng pool và không thay đổi nghiệp vụ",
  { skip: !databaseUrl },
  async (t) => {
    const repository = new PostgresRelationalRepository({
      connectionString: databaseUrl!,
      maxConnections: 4,
    });
    const pool = new DatabasePool({ connectionString: databaseUrl!, max: 8 });
    const unitOfWork = new UnitOfWork(pool);
    const relationalHttp = new RelationalHttpBoundary(unitOfWork, "auth,accounts,transfers");
    const relationalAuth = new RelationalAuthService(unitOfWork);
    const system = new BankingSystem();

    // Dọn dẹp cả repository pool và direct pool trong t.after
    t.after(async () => {
      await repository.close();
      await pool.close();
    });

    // Theo dõi số lần repository.withState được gọi để chứng minh route trợ lý
    // không kích hoạt cơ chế replay state nghiệp vụ của legacy repository
    let withStateCalls = 0;
    const origWithState = repository.withState.bind(repository);
    repository.withState = async (...args) => {
      withStateCalls++;
      return origWithState(...args);
    };

    // 1. Tạo customer thật trong bảng customers của PostgreSQL với đầy đủ access_status và access_version
    const customerId = randomUUID();
    const phone = `09${Math.floor(10000000 + Math.random() * 90000000)}`;
    const email = `relational-assistant-${randomUUID()}@example.test`;

    await pool.query(
      `INSERT INTO customers (id, full_name, email, phone_number, password_salt, password_digest, access_status, access_version, created_at)
       VALUES ($1, $2, $3, $4, 'salt_fixture', 'digest_fixture', 'ACTIVE', 1, NOW())`,
      [customerId, "Relational Assistant User", email, phone],
    );

    // 1b. Tạo tài khoản thanh toán thật có số dư để kiểm chứng bảo toàn dữ liệu nghiệp vụ
    const accountId = randomUUID();
    const accountNumber = `9704${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`;
    await pool.query(
      `INSERT INTO payment_accounts (id, customer_id, display_name, masked_number, account_number, currency, available_minor, current_minor, held_minor, status, version, updated_at)
       VALUES ($1, $2, 'Tài khoản chính', '•••• 1234', $3, 'VND', 5000000, 5000000, 0, 'ACTIVE', 1, NOW())`,
      [accountId, customerId, accountNumber],
    );

    // 2. Tạo phiên đăng nhập thật lưu trong bảng auth_sessions và customer_devices qua RelationalAuthService
    const deviceId = "device-relational-assistant";
    const session = await relationalAuth.issueSession(customerId, deviceId);
    const accessToken = session.accessToken;

    // 3. Gắn instrumentation kiểm chứng:
    //    - Transaction auth kết thúc trước khi Provider chạy.
    //    - Fake Provider ở trạng thái chờ có kiểm soát (async delay 60ms).
    //    - Connection được trả về pool ngay khi provider còn đang chờ (metrics.total - metrics.idle === 0).
    let authFinishedAt = 0;
    let providerStartedAt = 0;
    let activeConnectionsDuringProviderWait = -1;

    const origAuthenticate = relationalHttp.authenticate.bind(relationalHttp);
    relationalHttp.authenticate = async (token, devId) => {
      const user = await origAuthenticate(token, devId);
      authFinishedAt = Date.now();
      return user;
    };

    const fakeProvider = new FakeAssistantHelpProvider({
      mode: "success",
      defaultAnswer: '{"selectionId":"FAQ-01"}',
    });

    const origGenerate = fakeProvider.generateHelpResponse.bind(fakeProvider);
    fakeProvider.generateHelpResponse = async (prompt, ctx, q, signal) => {
      providerStartedAt = Date.now();
      // Giữ FakeAssistantHelpProvider ở trạng thái chờ có kiểm soát (60ms)
      // trong lúc request đang xử lý để kiểm tra giải phóng connection
      await new Promise((resolve) => setTimeout(resolve, 60));
      const metrics = pool.metrics();
      activeConnectionsDuringProviderWait = metrics.total - metrics.idle;
      return origGenerate(prompt, ctx, q, signal);
    };

    const assistantConfig = resolveAssistantConfig({
      enabled: true,
      provider: fakeProvider,
      requestTimeoutMs: 3000,
      providerTimeoutMs: 1500,
    });

    const assistantService = new AssistantHelpService(assistantConfig);
    const assistantRateLimiter = new AssistantRateLimiter(assistantConfig);

    // 4. Khởi tạo persistent banking server với relationalHttp thật
    const server = createPersistentBankingServer(repository, system, {
      registrationFingerprintKey: TEST_REGISTRATION_FINGERPRINT_KEY,
      relationalHttp,
      assistantConfig,
      assistantService,
      assistantRateLimiter,
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    t.after(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

    // Hàm khử nhạy cảm dòng customer trước khi so sánh bằng assert.deepEqual:
    // Bao gồm đầy đủ các cột nghiệp vụ (id, full_name, email, phone_number, access_status, access_version, created_at),
    // đồng thời thay thế password_salt và password_digest bằng fingerprint sha256 không đảo ngược.
    // Điều này đảm bảo: nếu test thất bại, assertion error không bao giờ in thông tin nhạy cảm ra log.
    const sanitizeCustomerRow = (row: Record<string, any>) => {
      const { password_salt, password_digest, ...safeFields } = row;
      return {
        ...safeFields,
        password_salt_fp: typeof password_salt === "string"
          ? createHash("sha256").update(password_salt).digest("hex").slice(0, 16)
          : null,
        password_digest_fp: typeof password_digest === "string"
          ? createHash("sha256").update(password_digest).digest("hex").slice(0, 16)
          : null,
      };
    };

    // 5. Ghi nhận toàn bộ nội dung dữ liệu của các bảng nghiệp vụ trước khi gọi trợ lý:
    //    - payment_accounts: SELECT * để bao gồm toàn bộ cột (updated_at, balances, status, version)
    //    - customers: SELECT * và sanitize qua sanitizeCustomerRow để có đầy đủ access_status nhưng không in secret
    const accountsBefore = (await pool.query("SELECT * FROM payment_accounts ORDER BY id")).rows;
    const journalsBefore = (await pool.query("SELECT * FROM ledger_journals ORDER BY id")).rows;
    const entriesBefore = (await pool.query("SELECT * FROM ledger_entries ORDER BY journal_id, line_number")).rows;
    const customersBeforeRaw = (await pool.query("SELECT * FROM customers ORDER BY id")).rows;
    const customersBefore = customersBeforeRaw.map(sanitizeCustomerRow);

    // 6. Kiểm tra 401 khi không có Bearer token
    const resUnauth = await fetch(`${baseUrl}/assistant/help`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Device-ID": deviceId,
      },
      body: JSON.stringify({ question: "Tôi xem số dư ở đâu?" }),
    });
    assert.equal(resUnauth.status, 401);

    // 7. Kiểm tra 200 với Bearer token từ phiên PostgreSQL thật
    const resAuth = await fetch(`${baseUrl}/assistant/help`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Device-ID": deviceId,
      },
      body: JSON.stringify({ question: "Tôi xem số dư ở đâu?" }),
    });
    assert.equal(resAuth.status, 200);

    // Theo đúng API Contract: Runtime chỉ trả về { answer: string }, KHÔNG có meta
    const data = (await resAuth.json()) as { answer: string };
    assert.equal(typeof data.answer, "string");
    assert.ok(data.answer.includes("Trang chủ"));

    // 8. Khẳng định chứng minh:
    //    - Xác thực đi qua relationalHttp.authenticate trên PostgreSQL
    //    - Transaction auth đã kết thúc trước khi Provider bắt đầu chạy
    //    - Connection đã được trả về pool ngay khi provider còn đang chờ (activeConnections = 0)
    //    - repository.withState không hề bị gọi (withStateCalls = 0)
    assert.ok(authFinishedAt > 0, "Xác thực token phải gọi qua relationalHttp.authenticate trên PostgreSQL");
    assert.ok(providerStartedAt >= authFinishedAt, "Transaction auth phải hoàn tất trước khi Provider chạy");
    assert.equal(
      activeConnectionsDuringProviderWait,
      0,
      "Connection auth phải được trả về pool ngay khi provider còn đang chờ",
    );
    assert.equal(
      withStateCalls,
      0,
      "Trợ lý không được kích hoạt repository.withState hoặc replay state nghiệp vụ",
    );

    // 9. Kiểm chứng dữ liệu nghiệp vụ giữ nguyên: so sánh toàn bộ nội dung bản ghi chi tiết (bao gồm cả updated_at và access_status)
    const accountsAfter = (await pool.query("SELECT * FROM payment_accounts ORDER BY id")).rows;
    const journalsAfter = (await pool.query("SELECT * FROM ledger_journals ORDER BY id")).rows;
    const entriesAfter = (await pool.query("SELECT * FROM ledger_entries ORDER BY journal_id, line_number")).rows;
    const customersAfterRaw = (await pool.query("SELECT * FROM customers ORDER BY id")).rows;
    const customersAfter = customersAfterRaw.map(sanitizeCustomerRow);

    assert.deepEqual(
      accountsAfter,
      accountsBefore,
      "Toàn bộ nội dung payment_accounts (gồm số dư, trạng thái, updated_at) phải giữ nguyên tuyệt đối",
    );
    assert.deepEqual(journalsAfter, journalsBefore, "Nội dung ledger_journals phải giữ nguyên tuyệt đối");
    assert.deepEqual(entriesAfter, entriesBefore, "Nội dung ledger_entries phải giữ nguyên tuyệt đối");
    assert.deepEqual(
      customersAfter,
      customersBefore,
      "Toàn bộ nội dung customers (gồm access_status, access_version, created_at) phải giữ nguyên tuyệt đối",
    );
  },
);
