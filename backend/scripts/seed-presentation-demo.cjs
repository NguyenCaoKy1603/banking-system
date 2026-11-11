/**
 * Seed data script for Graduation Thesis Demo (UC-M05, UC-M06, UC-M11/12, UC-M17)
 * Target account: ncaoky160305+testlan1@gmail.com (Nguyen Cao Ky)
 */

const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

// Resolve pg from backend/node_modules
const { Pool } = require(path.resolve(__dirname, "../node_modules/pg"));

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

const targetEmail = process.argv[2] || "ncaoky160305+testlan1@gmail.com";

function sha256Fingerprint(accountNumber) {
  return crypto.createHash("sha256").update(accountNumber).digest("hex");
}

async function main() {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgresql://banking:stage1-local-password@127.0.0.1:5433/banking_preview",
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log(`=== BẮT ĐẦU NẠP DỮ LIỆU DEMO THUYẾT TRÌNH CHO: ${targetEmail} ===`);

    // 1. Tìm thông tin khách hàng chính
    const custRes = await client.query(
      "SELECT id, full_name, email, phone_number FROM customers WHERE email = $1",
      [targetEmail]
    );
    if (custRes.rowCount === 0) {
      throw new Error(`Không tìm thấy khách hàng với email: ${targetEmail}`);
    }
    const customer = custRes.rows[0];
    const customerId = customer.id;
    console.log(`[OK] Khách hàng: ${customer.full_name} (ID: ${customerId})`);

    // 2. Tìm tài khoản thanh toán chính
    const accRes = await client.query(
      "SELECT id, account_number FROM payment_accounts WHERE customer_id = $1 AND status = 'ACTIVE' LIMIT 1",
      [customerId]
    );
    if (accRes.rowCount === 0) {
      throw new Error(`Khách hàng không có tài khoản thanh toán hợp lệ.`);
    }
    const account = accRes.rows[0];
    const accountId = account.id;
    const accountNumber = account.account_number;
    console.log(`[OK] Tài khoản thanh toán: ${accountNumber} (ID: ${accountId})`);

    // 3. Chuẩn bị 2 khách hàng thụ hưởng đối tác trong hệ thống
    // Người nhận 1: STK 970400000001 -> TRAN VAN BINH
    // Người nhận 2: STK 970400000002 -> LE THI CAM TU
    const recipient1AccRes = await client.query(
      "SELECT p.id as account_id, p.account_number, c.id as customer_id FROM payment_accounts p JOIN customers c ON c.id = p.customer_id WHERE p.account_number = '970400000001'"
    );
    const recipient2AccRes = await client.query(
      "SELECT p.id as account_id, p.account_number, c.id as customer_id FROM payment_accounts p JOIN customers c ON c.id = p.customer_id WHERE p.account_number = '970400000002'"
    );

    if (recipient1AccRes.rowCount > 0) {
      const r1 = recipient1AccRes.rows[0];
      await client.query("UPDATE customers SET full_name = 'TRAN VAN BINH' WHERE id = $1", [r1.customer_id]);
      await client.query("UPDATE payment_accounts SET bank_name = 'NOVA Digital Bank' WHERE id = $1", [r1.account_id]);
      console.log(`[OK] Cập nhật đối tác 1: TRAN VAN BINH - STK 970400000001`);
    }

    if (recipient2AccRes.rowCount > 0) {
      const r2 = recipient2AccRes.rows[0];
      await client.query("UPDATE customers SET full_name = 'LE THI CAM TU' WHERE id = $1", [r2.customer_id]);
      await client.query("UPDATE payment_accounts SET bank_name = 'NOVA Digital Bank' WHERE id = $1", [r2.account_id]);
      console.log(`[OK] Cập nhật đối tác 2: LE THI CAM TU - STK 970400000002`);
    }

    const r1 = recipient1AccRes.rows[0];
    const r2 = recipient2AccRes.rows[0];

    // 4. Nạp Danh bạ thụ hưởng (Beneficiaries)
    console.log(`--- Đang nạp danh bạ thụ hưởng (UC-M06) ---`);
    if (r1) {
      const fp1 = sha256Fingerprint("970400000001");
      await client.query(
        `INSERT INTO beneficiaries 
          (id, customer_id, display_name, account_holder_name, masked_account_number, account_number_fingerprint, bank_name, status, created_at, destination_account_id, destination_owner_id)
         VALUES 
          ('b1111111-1111-4111-8111-111111111111', $1, 'Trần Văn Bình (Bạn cùng lớp)', 'TRAN VAN BINH', '•••• 0001', $2, 'NOVA Digital Bank', 'ACTIVE', NOW() - interval '5 days', $3, $4)
         ON CONFLICT (id) DO UPDATE SET 
          display_name = EXCLUDED.display_name,
          account_holder_name = EXCLUDED.account_holder_name,
          status = 'ACTIVE',
          deleted_at = NULL`,
        [customerId, fp1, r1.account_id, r1.customer_id]
      );
      console.log(`[OK] Đã thêm người thụ hưởng: Trần Văn Bình (STK: 970400000001)`);
    }

    if (r2) {
      const fp2 = sha256Fingerprint("970400000002");
      await client.query(
        `INSERT INTO beneficiaries 
          (id, customer_id, display_name, account_holder_name, masked_account_number, account_number_fingerprint, bank_name, status, created_at, destination_account_id, destination_owner_id)
         VALUES 
          ('b2222222-2222-4222-8222-222222222222', $1, 'Lê Thị Cẩm Tú (Thủ quỹ lớp)', 'LE THI CAM TU', '•••• 0002', $2, 'NOVA Digital Bank', 'ACTIVE', NOW() - interval '3 days', $3, $4)
         ON CONFLICT (id) DO UPDATE SET 
          display_name = EXCLUDED.display_name,
          account_holder_name = EXCLUDED.account_holder_name,
          status = 'ACTIVE',
          deleted_at = NULL`,
        [customerId, fp2, r2.account_id, r2.customer_id]
      );
      console.log(`[OK] Đã thêm người thụ hưởng: Lê Thị Cẩm Tú (STK: 970400000002)`);
    }

    // 5. Nạp Sổ tiết kiệm trực tuyến (Savings Deposit) (UC-M11 / UC-M12)
    console.log(`--- Đang nạp sổ tiết kiệm trực tuyến (UC-M11 / UC-M12) ---`);
    const quoteId = "d1111111-1111-4111-8111-111111111111";
    const openingId = "e1111111-1111-4111-8111-111111111111";
    const depositId = "f1111111-1111-4111-8111-111111111111";
    const productId = "00000000-0000-4000-8000-000000000003"; // Tiết kiệm 6 tháng (4.5%/năm)

    // Tạo quote
    await client.query(
      `INSERT INTO savings_quotes
        (id, customer_id, source_account_id, product_id, principal_minor,
         annual_rate_basis_points, interest_days, expected_interest_minor,
         total_at_maturity_minor, currency, term_months, maturity_instruction,
         terms_version, opened_at, maturity_at, expires_at, request_fingerprint, created_at)
       VALUES
        ($1, $2, $3, $4, 10000000, 450, 180, 225000, 10225000, 'VND', 6, 'RENEW_PRINCIPAL_AND_INTEREST',
         '2026-v1', NOW() - interval '15 days', NOW() - interval '15 days' + interval '6 months', NOW() + interval '1 day',
         'fp-demo-savings-quote', NOW() - interval '15 days')
       ON CONFLICT (id) DO NOTHING`,
      [quoteId, customerId, accountId, productId]
    );

    // Tạo opening trước với deposit_id = null
    await client.query(
      `INSERT INTO savings_openings
        (id, customer_id, quote_id, deposit_id, idempotency_key, request_fingerprint, reference, status, created_at, updated_at)
       VALUES
        ($1, $2, $3, NULL, 'idem-demo-savings-001', 'fp-demo-savings-open', 'SAV-2026-000109', 'SUCCEEDED', NOW() - interval '15 days', NOW() - interval '15 days')
       ON CONFLICT (id) DO NOTHING`,
      [openingId, customerId, quoteId]
    );

    // Tạo deposit với opening_id
    await client.query(
      `INSERT INTO savings_deposits
        (id, customer_id, opening_id, source_account_id, product_id, principal_minor,
         annual_rate_basis_points, expected_interest_minor, total_at_maturity_minor, currency,
         term_months, maturity_instruction, terms_version, reference, opened_at, maturity_at,
         status, created_at, updated_at)
       VALUES
        ($1, $2, $3, $4, $5, 10000000, 450, 225000, 10225000, 'VND',
         6, 'RENEW_PRINCIPAL_AND_INTEREST', '2026-v1', 'SAV-2026-000109', NOW() - interval '15 days', NOW() - interval '15 days' + interval '6 months',
         'ACTIVE', NOW() - interval '15 days', NOW() - interval '15 days')
       ON CONFLICT (id) DO UPDATE SET 
         status = 'ACTIVE',
         principal_minor = 10000000,
         expected_interest_minor = 225000,
         total_at_maturity_minor = 10225000`,
      [depositId, customerId, openingId, accountId, productId]
    );

    // Cập nhật lại deposit_id cho opening
    await client.query(
      "UPDATE savings_openings SET deposit_id = $1, status = 'SUCCEEDED' WHERE id = $2",
      [depositId, openingId]
    );
    console.log(`[OK] Đã tạo sổ tiết kiệm 6 tháng: 10.000.000 VND (Mã: SAV-2026-000109)`);

    // 6. Nạp Lịch sử giao dịch (Account Transactions) (UC-M05)
    console.log(`--- Đang nạp lịch sử giao dịch (UC-M05) ---`);
    // Xóa các transaction demo cũ của tài khoản này nếu có để không bị trùng lặp
    await client.query("DELETE FROM account_transactions WHERE account_id = $1", [accountId]);

    const txs = [
      {
        id: "c1111111-1111-4111-8111-111111111111",
        direction: "CREDIT",
        amount_minor: 50000000,
        description: "CONG TY TNHH CONG NGHE NOVA - Chuyen tien luong ky 1 thang 10/2026",
        counterparty: "CONG TY TNHH CONG NGHE NOVA",
        reference: "SAL-20261025-001",
        occurred: "NOW() - interval '16 days'",
        kind: "TRANSFER_IN",
        deposit_id: null,
      },
      {
        id: "c2222222-2222-4222-8222-222222222222",
        direction: "DEBIT",
        amount_minor: 10000000,
        description: "Trich tien mo so tiet kiem truc tuyen ky han 6 thang SAV-2026-000109",
        counterparty: "NOVA Digital Bank - Savings",
        reference: "SAV-OPEN-20261026-001",
        occurred: "NOW() - interval '15 days'",
        kind: "SAVINGS_OPENING",
        deposit_id: depositId,
      },
      {
        id: "c3333333-3333-4333-8333-333333333333",
        direction: "DEBIT",
        amount_minor: 500000,
        description: "Nguyen Cao Ky dong quy hoc tap hoc ky 1",
        counterparty: "LE THI CAM TU",
        reference: "TRF-20261102-042",
        occurred: "NOW() - interval '7 days'",
        kind: "TRANSFER_OUT",
        deposit_id: null,
      },
      {
        id: "c4444444-4444-4444-8444-444444444444",
        direction: "CREDIT",
        amount_minor: 2000000,
        description: "TRAN VAN BINH chuyen tien tra tien an trua va mua sach tham khao",
        counterparty: "TRAN VAN BINH",
        reference: "TRF-20261105-089",
        occurred: "NOW() - interval '4 days'",
        kind: "TRANSFER_IN",
        deposit_id: null,
      },
      {
        id: "c5555555-5555-4555-8555-555555555555",
        direction: "DEBIT",
        amount_minor: 150000,
        description: "Thanh toan tien ca phe va tai lieu do an tot nghiep",
        counterparty: "THE COFFEE HOUSE - Q7",
        reference: "POS-20261108-112",
        occurred: "NOW() - interval '1 day'",
        kind: "PURCHASE",
        deposit_id: null,
      },
    ];

    for (const tx of txs) {
      await client.query(
        `INSERT INTO account_transactions
          (id, account_id, direction, amount_minor, fee_minor, currency, status, description, counterparty_name, reference, occurred_at, created_at, completed_at, savings_deposit_id, kind)
         VALUES
          ($1, $2, $3, $4, 0, 'VND', 'SUCCEEDED', $5, $6, $7, ${tx.occurred}, ${tx.occurred}, ${tx.occurred}, $8, $9)`,
        [tx.id, accountId, tx.direction, tx.amount_minor, tx.description, tx.counterparty, tx.reference, tx.deposit_id, tx.kind]
      );
    }
    console.log(`[OK] Đã nạp 5 giao dịch lịch sử thực tế (Nhận lương, Mở sổ tiết kiệm, Chuyển tiền, v.v.)`);

    // 7. Cập nhật số dư tài khoản thanh toán khớp với lịch sử (41.350.000 VND)
    await client.query(
      `UPDATE payment_accounts
       SET available_minor = 41350000,
           current_minor = 41350000,
           opening_balance_minor = 0,
           updated_at = NOW()
       WHERE id = $1`,
      [accountId]
    );
    console.log(`[OK] Đã cập nhật số dư tài khoản thanh toán: 41.350.000 VND`);

    // 8. Nạp Thông báo trong ứng dụng (Notifications) (UC-M17)
    console.log(`--- Đang nạp thông báo trong ứng dụng (UC-M17) ---`);
    await client.query("DELETE FROM notifications WHERE customer_id = $1", [customerId]);

    const notifs = [
      {
        id: "a1111111-1111-4111-8111-111111111111",
        type: "TRANSFER",
        title: "Biến động số dư: +50.000.000 VND",
        body: "Tài khoản 9704100000010 +50.000.000 VND lúc 09:30. Số dư: 50.000.000 VND. Nội dung: CONG TY TNHH CONG NGHE NOVA - Chuyen tien luong ky 1 thang 10/2026.",
        resource_id: "SAL-20261025-001",
        account_id: accountId,
        deposit_id: null,
        is_read: true,
        created: "NOW() - interval '16 days'",
      },
      {
        id: "a2222222-2222-4222-8222-222222222222",
        type: "SAVINGS",
        title: "Mở sổ tiết kiệm thành công",
        body: "Quý khách đã mở thành công sổ tiết kiệm trực tuyến kỳ hạn 6 tháng, số tiền 10.000.000 VND, lãi suất 4.5%/năm. Mã hợp đồng: SAV-2026-000109.",
        resource_id: depositId,
        account_id: accountId,
        deposit_id: depositId,
        is_read: true,
        created: "NOW() - interval '15 days'",
      },
      {
        id: "a3333333-3333-4333-8333-333333333333",
        type: "TRANSFER",
        title: "Biến động số dư: -500.000 VND",
        body: "Tài khoản 9704100000010 -500.000 VND tới LE THI CAM TU (970400000002). Nội dung: Nguyen Cao Ky dong quy hoc tap hoc ky 1.",
        resource_id: "TRF-20261102-042",
        account_id: accountId,
        deposit_id: null,
        is_read: true,
        created: "NOW() - interval '7 days'",
      },
      {
        id: "a4444444-4444-4444-8444-444444444444",
        type: "TRANSFER",
        title: "Biến động số dư: +2.000.000 VND",
        body: "Tài khoản 9704100000010 +2.000.000 VND từ TRAN VAN BINH (970400000001). Nội dung: TRAN VAN BINH chuyen tien tra tien an trua va mua sach tham khao.",
        resource_id: "TRF-20261105-089",
        account_id: accountId,
        deposit_id: null,
        is_read: false, // Chưa đọc -> hiện chấm đỏ thông báo mới
        created: "NOW() - interval '4 days'",
      },
      {
        id: "a5555555-5555-4555-8555-555555555555",
        type: "SECURITY",
        title: "Cảnh báo an ninh: Đăng nhập thiết bị mới",
        body: "Hệ thống ghi nhận đăng nhập thành công từ thiết bị di động (Google Pixel 8 Pro, IP: 192.168.1.15). Nếu không phải quý khách, vui lòng khóa tài khoản hoặc đổi mật khẩu ngay.",
        resource_id: "SEC-LOG-20261110-01",
        account_id: null,
        deposit_id: null,
        is_read: false, // Chưa đọc -> hiện chấm đỏ thông báo mới
        created: "NOW() - interval '1 day'",
      },
    ];

    for (const notif of notifs) {
      await client.query(
        `INSERT INTO notifications
          (id, customer_id, notification_type, title, body, resource_id, resource_account_id, is_read, created_at, savings_deposit_id)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, ${notif.created}, $9)`,
        [notif.id, customerId, notif.type, notif.title, notif.body, notif.resource_id, notif.account_id, notif.is_read, notif.deposit_id]
      );
    }
    console.log(`[OK] Đã nạp 5 thông báo (Biến động số dư, Sổ tiết kiệm, Cảnh báo an ninh thiết bị)`);

    // 9. Nạp Thẻ tín dụng, Tài khoản tín dụng, Sao kê & Giao dịch thẻ (UC-M14, UC-M15, UC-M16)
    console.log(`--- Đang nạp thẻ tín dụng, sao kê & giao dịch thẻ (UC-M14, UC-M15, UC-M16) ---`);
    const creditAccountId = "e0000000-0000-4000-8000-000000000001";
    const creditAppId = "e0000000-0000-4000-8000-000000000002";
    const creditCardId = "e0000000-0000-4000-8000-000000000003";
    const statementId = "e0000000-0000-4000-8000-000000000004";

    // Xóa dữ liệu credit cũ của customer nếu có
    await client.query("DELETE FROM credit_statement_items WHERE statement_id = $1", [statementId]);
    await client.query("DELETE FROM credit_transactions WHERE credit_account_id = $1", [creditAccountId]);
    await client.query("DELETE FROM credit_statements WHERE credit_account_id = $1", [creditAccountId]);
    await client.query("DELETE FROM credit_cards WHERE customer_id = $1", [customerId]);
    await client.query("DELETE FROM credit_applications WHERE customer_id = $1", [customerId]);
    await client.query("DELETE FROM credit_accounts WHERE customer_id = $1", [customerId]);

    // Tạo credit_account
    await client.query(
      `INSERT INTO credit_accounts
        (id, customer_id, currency, credit_limit_minor, posted_outstanding_minor, pending_authorizations_minor,
         next_statement_at, status, version, updated_at, current_cycle_start_at, cycle_backfill_review_required)
       VALUES
        ($1, $2, 'VND', 20000000, 3500000, 0,
         NOW() + interval '20 days', 'ACTIVE', 1, NOW(), NOW() - interval '10 days', false)`,
      [creditAccountId, customerId]
    );

    // Tạo credit_application (ACTIVE)
    await client.query(
      `INSERT INTO credit_applications
        (id, customer_id, status, requested_limit_minor, approved_limit_minor, request_fingerprint,
         decision_reason_code, decision_at, activated_at, version, created_at, updated_at, credit_account_id)
       VALUES
        ($1, $2, 'ACTIVE', 20000000, 20000000, 'fp-demo-credit-app',
         'CREDIT_APPROVED', NOW() - interval '40 days', NOW() - interval '40 days', 1, NOW() - interval '40 days', NOW() - interval '40 days', $3)`,
      [creditAppId, customerId, creditAccountId]
    );

    // Tạo credit_card (NOVA Visa Platinum)
    await client.query(
      `INSERT INTO credit_cards
        (id, credit_account_id, customer_id, display_name, brand, masked_number, last_four,
         expiry_month, expiry_year, status, updated_at)
       VALUES
        ($1, $2, $3, 'NOVA Visa Platinum', 'VISA', '•••• •••• •••• 8828', '8828',
         12, 2028, 'ACTIVE', NOW() - interval '40 days')`,
      [creditCardId, creditAccountId, customerId]
    );

    // Tạo credit_statement (Kỳ sao kê đã chốt, dư nợ 3.500.000 VND)
    await client.query(
      `INSERT INTO credit_statements
        (id, credit_account_id, cycle_start_at, cycle_end_at, issued_at, due_at,
         opening_balance_minor, purchase_total_minor, refund_total_minor, fee_total_minor, interest_total_minor,
         closing_balance_minor, remaining_amount_due_minor, minimum_payment_due_minor, minimum_payment_remaining_minor,
         paid_amount_minor, status, version)
       VALUES
        ($1, $2, NOW() - interval '40 days', NOW() - interval '10 days', NOW() - interval '10 days', NOW() + interval '10 days',
         0, 3500000, 0, 0, 0,
         3500000, 3500000, 175000, 175000,
         0, 'ISSUED', 1)`,
      [statementId, creditAccountId]
    );

    // Tạo 3 giao dịch chi tiêu thẻ tín dụng
    const creditTxs = [
      {
        id: "e0000000-0000-4000-8000-000000000005",
        description: "Dang ky khoa hoc truc tuyen Coursera Plus",
        merchant: "COURSERA INC",
        amount_minor: 1200000,
        occurred: "NOW() - interval '35 days'",
        posted: "NOW() - interval '34 days'",
      },
      {
        id: "e0000000-0000-4000-8000-000000000006",
        description: "Mua ve may bay Vietnam Airlines SGN - DAD",
        merchant: "VIETNAM AIRLINES",
        amount_minor: 1850000,
        occurred: "NOW() - interval '25 days'",
        posted: "NOW() - interval '24 days'",
      },
      {
        id: "e0000000-0000-4000-8000-000000000007",
        description: "Mua sach giao trinh va tai lieu hoc tap",
        merchant: "FAHASA NGUYEN HUE",
        amount_minor: 450000,
        occurred: "NOW() - interval '15 days'",
        posted: "NOW() - interval '14 days'",
      },
    ];

    for (const ctx of creditTxs) {
      await client.query(
        `INSERT INTO credit_transactions
          (id, credit_account_id, statement_id, type, status, description, merchant_name, amount_minor, debt_effect, occurred_at, posted_at)
         VALUES
          ($1, $2, $3, 'PURCHASE', 'POSTED', $4, $5, $6, 'INCREASE', ${ctx.occurred}, ${ctx.posted})`,
        [ctx.id, creditAccountId, statementId, ctx.description, ctx.merchant, ctx.amount_minor]
      );

      await client.query(
        `INSERT INTO credit_statement_items (statement_id, transaction_id) VALUES ($1, $2)`,
        [statementId, ctx.id]
      );
    }
    console.log(`[OK] Đã tạo Thẻ tín dụng NOVA Visa Platinum (Hạn mức 20tr, Dư nợ 3.5tr, 3 giao dịch sao kê)`);

    // 10. Nạp Hồ sơ Định danh eKYC (UC-M01, UC-M02)
    console.log(`--- Đang nạp hồ sơ định danh eKYC (APPROVED) ---`);
    const kycId = "e0000000-0000-4000-8000-000000000008";
    await client.query("DELETE FROM kyc_applications WHERE customer_id = $1", [customerId]);

    const kycPayload = JSON.stringify({
      fullName: "NGUYEN CAO KY",
      identityNumber: "079203001234",
      address: "19 Nguyễn Hữu Thọ, Phường Tân Phong, Quận 7, TP.HCM",
      documentUri: "synthetic://fixtures/national-id-front.jpg",
    });

    await client.query(
      `INSERT INTO kyc_applications
        (id, customer_id, status, applicant_label, request_fingerprint, decision_reason_code,
         decision_at, version, created_at, updated_at, synthetic_payload, submitted_at)
       VALUES
        ($1, $2, 'APPROVED', 'Nguyen Cao Ky (•••• 1234)', 'fp-kyc-demo-approved', 'AUTO_VERIFIED',
         NOW() - interval '20 days', 1, NOW() - interval '20 days', NOW() - interval '20 days', $3::jsonb, NOW() - interval '20 days')`,
      [kycId, customerId, kycPayload]
    );
    console.log(`[OK] Đã tạo hồ sơ định danh eKYC trạng thái APPROVED (CCCD: •••• 1234)`);

    // 11. Cập nhật ngày tạo của khách hàng demo lên đầu danh sách quản trị
    await client.query(
      `UPDATE customers SET created_at = NOW() WHERE id IN ($1, '9079688c-9b7d-44db-a49c-16ea2e00653b', '0969fc98-62e4-4685-9414-d70abc15fcd1')`,
      [customerId]
    );
    console.log(`[OK] Đã đưa tài khoản demo lên đầu danh sách Admin Web`);

    // 12. Chuẩn bị hồ sơ chờ duyệt trên Admin Web (Trần Văn Bình & Lê Thị Cẩm Tú)
    console.log(`--- Đang chuẩn bị hồ sơ chờ duyệt cho Admin Web (KYC & Tín dụng) ---`);
    // Dọn dẹp hồ sơ rác E2E tester trong danh sách chờ duyệt KYC
    await client.query("DELETE FROM kyc_applications WHERE applicant_label LIKE '%E2E%' OR applicant_label LIKE '%diag%'");

    // Hồ sơ KYC chờ duyệt cho Trần Văn Bình
    const kycPayloadBinh = JSON.stringify({
      fullName: "TRAN VAN BINH",
      identityNumber: "079203005678",
      address: "Số 123 Nguyễn Thị Thập, Phường Tân Phú, Quận 7, TP.HCM",
      documentUri: "synthetic://fixtures/national-id-front.jpg",
    });
    await client.query(
      `INSERT INTO kyc_applications
        (id, customer_id, status, applicant_label, request_fingerprint, version, created_at, updated_at, synthetic_payload, submitted_at)
       VALUES
        ('e0000000-0000-4000-8000-000000000011', '9079688c-9b7d-44db-a49c-16ea2e00653b', 'SUBMITTED', 'Trần Văn Bình (•••• 5678)', 'fp-kyc-tvb-01', 1, NOW(), NOW(), $1::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET status = 'SUBMITTED', created_at = NOW(), updated_at = NOW(), assigned_staff_id = NULL`,
      [kycPayloadBinh]
    );

    // Hồ sơ KYC chờ duyệt cho Lê Thị Cẩm Tú
    const kycPayloadTu = JSON.stringify({
      fullName: "LE THI CAM TU",
      identityNumber: "079203008901",
      address: "Số 456 Huỳnh Tấn Phát, Phường Bình Thuận, Quận 7, TP.HCM",
      documentUri: "synthetic://fixtures/national-id-front.jpg",
    });
    await client.query(
      `INSERT INTO kyc_applications
        (id, customer_id, status, applicant_label, request_fingerprint, version, created_at, updated_at, synthetic_payload, submitted_at)
       VALUES
        ('e0000000-0000-4000-8000-000000000012', '0969fc98-62e4-4685-9414-d70abc15fcd1', 'SUBMITTED', 'Lê Thị Cẩm Tú (•••• 8901)', 'fp-kyc-ltct-01', 1, NOW() - interval '2 minutes', NOW() - interval '2 minutes', $1::jsonb, NOW() - interval '2 minutes')
       ON CONFLICT (id) DO UPDATE SET status = 'SUBMITTED', created_at = NOW() - interval '2 minutes', updated_at = NOW(), assigned_staff_id = NULL`,
      [kycPayloadTu]
    );
    console.log(`[OK] Đã chuẩn bị 2 hồ sơ KYC chờ duyệt: Trần Văn Bình & Lê Thị Cẩm Tú`);

    // Hồ sơ Tín dụng chờ duyệt cho Lê Thị Cẩm Tú (15.000.000 VND) và Trần Văn Bình (30.000.000 VND)
    await client.query(
      `UPDATE credit_applications 
       SET status = 'SUBMITTED', assigned_staff_id = NULL, created_at = NOW(), updated_at = NOW() 
       WHERE id = 'e5e18a25-ac8e-4885-9658-36c0ae359460'`
    );
    await client.query(
      `UPDATE credit_applications 
       SET status = 'SUBMITTED', assigned_staff_id = NULL, created_at = NOW() - interval '2 minutes', updated_at = NOW() 
       WHERE id = '143b8883-6123-4688-9d64-e4780fa06c0a'`
    );
    console.log(`[OK] Đã đưa 2 hồ sơ Thẻ tín dụng chờ duyệt lên đầu danh sách: Lê Thị Cẩm Tú & Trần Văn Bình`);

    await client.query("COMMIT");
    console.log(`\n🎉 HOÀN TẤT NẠP DỮ LIỆU DEMO THUYẾT TRÌNH THÀNH CÔNG!`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("LỖI KHI NẠP SEED DATA:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
