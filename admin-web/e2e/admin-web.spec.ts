import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { generateTotp } from "../../backend/dist/mfa/crypto.js";

type Credential = { email: string; password: string; secret: string };
const operations: Credential = {
  email: "browser-operations@example.test",
  password: "Browser-Operations-password!",
  secret: "JBSWY3DPEHPK3PXP",
};
const control: Credential = {
  email: "browser-control@example.test",
  password: "Browser-Control-password!",
  secret: "KRUGS4ZANFZSAYJA",
};
const support: Credential = {
  email: "browser-support@example.test",
  password: "Browser-Support-password!",
  secret: "MFRGGZDFMZTWQ2LK",
};
const admin: Credential = {
  email: "browser-admin@example.test",
  password: "Browser-Admin-password!",
  secret: "ONSWG4TFOQ======",
};

async function login(page: Page, credential: Credential): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Đăng nhập quản trị" })).toBeVisible();
  await page.getByTestId("staff-email").fill(credential.email);
  await page.getByTestId("staff-password").fill(credential.password);
  await page.getByRole("button", { name: "Tiếp tục với MFA" }).click();
  await expect(page.getByTestId("staff-mfa")).toBeVisible();
  await page.getByTestId("staff-mfa").fill(generateTotp(credential.secret, Date.now() - 30_000));
  await page.getByRole("button", { name: "Xác thực và vào Admin" }).click();
  await expect(page.getByRole("heading", { name: "Điểm kiểm soát" })).toBeVisible();
}

async function inlineRelogin(page: Page, credential: Credential, timeOffset = 0): Promise<void> {
  await expect(page.getByRole("heading", { name: "Đăng nhập quản trị" })).toBeVisible();
  await page.getByTestId("staff-email").fill(credential.email);
  await page.getByTestId("staff-password").fill(credential.password);
  await page.getByRole("button", { name: "Tiếp tục với MFA" }).click();
  await expect(page.getByTestId("staff-mfa")).toBeVisible();
  await page.getByTestId("staff-mfa").fill(generateTotp(credential.secret, Date.now() + timeOffset));
  await page.getByRole("button", { name: "Xác thực và vào Admin" }).click();
  await expect(page.getByRole("button", { name: "Đăng xuất" })).toBeVisible();
}

async function approveAction(
  page: Page,
  actionType: string,
  secret: string,
  reason: string
): Promise<void> {
  const row = page.getByRole("button", { name: new RegExp(actionType) }).first();
  await expect(row).toBeVisible();
  await row.click();
  await page.getByTestId("checker-reason").fill(reason);
  const approve = page.getByTestId("approve-action");
  await approve.click();
  const stepUp = page.getByTestId("step-up-mfa");
  if (await stepUp.isVisible().catch(() => false)) {
    await stepUp.fill(generateTotp(secret, Date.now()));
    await approve.click();
  }
  await expect(approve).toHaveCount(0);
}

async function requestApplication(page: Page, applicationType: "KYC" | "CREDIT"): Promise<void> {
  const row = page.locator("tr").filter({ hasText: new RegExp(`^${applicationType}`) }).first();
  await row.getByRole("button", { name: /Tiếp nhận|Claim/ }).click();
  await row.getByTestId("application-decision").click();
  const modal = page.locator(".modal");
  await modal.getByLabel("Reason code").fill(`BROWSER_E2E_${applicationType}_REVIEW`);
  await modal.getByLabel("Ticket reference").fill(`BROWSER-${applicationType}`);
  await modal.getByRole("button", { name: "Gửi vào Approval Inbox" }).click();
}

async function pageCheckReviewAndSubmit(page: Page, kind: string): Promise<void> {
  await page.getByLabel("Ticket reference").fill(`TICKET-${kind}`);
  await page.getByTestId("review-account-action").click();
  await expect(page.getByTestId("review-box")).toBeVisible();
  await page.getByTestId("submit-account-action").click();
}

test.describe.serial("Admin Web Real Implementation Verification (R-01 to R-10)", () => {
  let makerContext: BrowserContext;
  let controlContext: BrowserContext;
  let adminContext: BrowserContext;
  let supportContext: BrowserContext;
  let maker: Page;
  let controlPage: Page;
  let adminPage: Page;
  let supportPage: Page;

  test.beforeAll(async ({ browser }) => {
    makerContext = await browser.newContext();
    controlContext = await browser.newContext();
    adminContext = await browser.newContext();
    supportContext = await browser.newContext();

    maker = await makerContext.newPage();
    controlPage = await controlContext.newPage();
    adminPage = await adminContext.newPage();
    supportPage = await supportContext.newPage();

    // Authenticate each role once to avoid TOTP replay window rejection
    await login(maker, operations);
    await login(controlPage, control);
    await login(adminPage, admin);
    await login(supportPage, support);
  });

  test.afterAll(async () => {
    await makerContext?.close();
    await controlContext?.close();
    await adminContext?.close();
    await supportContext?.close();
  });

  // -----------------------------------------------------------------------------
  // R-01: Form input -> Review Step -> Submit
  // Assertion: No POST prior to review; snapshot is displayed accurately; submit sends reviewed body.
  // -----------------------------------------------------------------------------
  test("R-01: Form input -> Review Step -> Submit", async () => {
    await maker.getByRole("button", { name: "Khách hàng" }).click();
    await maker.getByTestId("customer-search").fill("browser-e2e@example.test");
    await maker.getByRole("button", { name: "Tìm kiếm" }).click();
    await expect(maker.getByText("Browser E2E Customer")).toBeVisible();
    await maker.getByRole("button", { name: "Xem tài khoản" }).click();

    let postCount = 0;
    const urlPattern = "**/admin/accounts/*/funding-requests";
    await maker.route(urlPattern, (route) => {
      if (route.request().method() === "POST") {
        postCount++;
      }
      return route.continue();
    });

    try {
      await maker.getByTestId("funding-request").click();
      await maker.getByTestId("funding-amount").fill("2500");
      await maker.getByTestId("action-reason").fill("R01_OPERATIONS_FUNDING");
      await maker.getByLabel("Ticket reference").fill("TICKET-R01");
      await maker.getByLabel("Mô tả chi tiết").fill("Funding test R-01");

      // Click Review
      await maker.getByTestId("review-account-action").click();
      await expect(maker.getByTestId("review-box")).toBeVisible();
      // Verify NO POST has occurred yet
      expect(postCount).toBe(0);

      // Verify review snapshot contents
      await expect(maker.getByTestId("review-box")).toContainText("2.500 VND");
      await expect(maker.getByTestId("review-box")).toContainText("R01_OPERATIONS_FUNDING");
      await expect(maker.getByTestId("review-box")).toContainText("TICKET-R01");

      // Submit Four-Eyes command
      await maker.getByTestId("submit-account-action").click();
      await expect(maker.getByText(/Đã tạo yêu cầu FUND thành công/)).toBeVisible();
      expect(postCount).toBe(1);
    } finally {
      await maker.unroute(urlPattern);
    }
  });

  // -----------------------------------------------------------------------------
  // R-02: Server committed mutation, first response dropped -> retry
  // Assertion: Both requests share identical path, body, and idempotency key. Retry returns same action.
  // -----------------------------------------------------------------------------
  test("R-02: Server committed mutation, first response dropped -> retry uses stable key", async () => {
    await maker.getByRole("button", { name: "Khách hàng" }).click();
    await maker.getByTestId("customer-search").fill("browser-e2e@example.test");
    await maker.getByRole("button", { name: "Tìm kiếm" }).click();
    await maker.getByRole("button", { name: "Xem tài khoản" }).click();

    const interceptedKeys: string[] = [];
    const interceptedBodies: string[] = [];
    let committedActionId = "";
    let attempt = 0;
    const urlPattern = "**/admin/accounts/*/funding-requests";

    await maker.route(urlPattern, async (route) => {
      if (route.request().method() === "POST") {
        attempt++;
        interceptedKeys.push(route.request().headers()["idempotency-key"] || "");
        interceptedBodies.push(route.request().postData() || "");

        if (attempt === 1) {
          // Let the server commit the request
          const res = await route.fetch();
          const json = await res.json();
          committedActionId = json?.action?.id;
          // Drop the response to simulate network failure
          await route.abort("failed");
          return;
        }
      }
      return route.continue();
    });

    try {
      await maker.getByTestId("funding-request").click();
      await maker.getByTestId("funding-amount").fill("3000");
      await maker.getByTestId("action-reason").fill("R02_FUNDING_RETRY");
      await maker.getByLabel("Ticket reference").fill("TICKET-R02");

      await maker.getByTestId("review-account-action").click();
      await maker.getByTestId("submit-account-action").click();

      // Indeterminate notice appears due to dropped response
      await expect(maker.getByTestId("indeterminate-notice")).toBeVisible();
      await expect(maker.getByTestId("submit-account-action")).toContainText("Gửi lại (Giữ nguyên khóa xử lý)");

      // Retry the submission
      await maker.getByTestId("submit-account-action").click();
      await expect(maker.getByText(/Đã tạo yêu cầu FUND thành công/)).toBeVisible();
      expect(committedActionId).toBeTruthy();
      await expect(maker.getByText(new RegExp(`Mã: ${committedActionId}`))).toBeVisible();

      // Verify: Exactly 2 POSTs occurred with the EXACT same idempotency key and payload
      expect(interceptedKeys.length).toBe(2);
      expect(interceptedKeys[0]).toBeTruthy();
      expect(interceptedKeys[1]).toBe(interceptedKeys[0]);
      expect(interceptedBodies[1]).toBe(interceptedBodies[0]);

      // Verify via CONTROL session: Exactly ONE action was created in fixture server matching committedActionId
      const approvalsRes = await controlPage.request.get("/api/v1/admin/approvals");
      const approvalsJson = await approvalsRes.json();
      const r02Actions = (approvalsJson.items || []).filter(
        (a: { payload?: { reasonCode?: string }; id?: string }) =>
          a.payload?.reasonCode === "R02_FUNDING_RETRY" || a.id === committedActionId
      );
      expect(r02Actions.length).toBe(1);
      expect(r02Actions[0].id).toBe(committedActionId);
    } finally {
      await maker.unroute(urlPattern);
    }
  });

  // -----------------------------------------------------------------------------
  // R-03: Indeterminate state survives modal close, tab switch, and keeps stable snapshot
  // -----------------------------------------------------------------------------
  test("R-03: Indeterminate state survives modal close, tab switch, and keeps stable snapshot", async () => {
    await maker.getByRole("button", { name: "Khách hàng" }).click();
    await maker.getByTestId("customer-search").fill("browser-e2e@example.test");
    await maker.getByRole("button", { name: "Tìm kiếm" }).click();
    await maker.getByRole("button", { name: "Xem tài khoản" }).click();

    let shouldDrop = true;
    let savedKey = "";
    const urlPattern = "**/admin/accounts/*/funding-requests";

    await maker.route(urlPattern, async (route) => {
      if (route.request().method() === "POST" && shouldDrop) {
        savedKey = route.request().headers()["idempotency-key"] || "";
        await route.fetch();
        await route.abort("failed");
        return;
      }
      return route.continue();
    });

    try {
      await maker.getByTestId("funding-request").click();
      await maker.getByTestId("funding-amount").fill("3500");
      await maker.getByTestId("action-reason").fill("R03_INTENT_PERSIST");
      await maker.getByLabel("Ticket reference").fill("TICKET-R03");

      await maker.getByTestId("review-account-action").click();
      await maker.getByTestId("submit-account-action").click();
      await expect(maker.getByTestId("indeterminate-notice")).toBeVisible();

      // 'Quay lại chỉnh sửa' is disabled/hidden during indeterminate state to protect payload
      await expect(maker.getByRole("button", { name: "Quay lại chỉnh sửa" })).toHaveCount(0);

      // Close the modal
      await maker.getByRole("button", { name: "Đóng" }).click();
      // Banner warning about pending indeterminate intent appears
      await expect(maker.getByTestId("pending-intents-banner")).toBeVisible();

      // Switch tab away and back
      await maker.getByRole("button", { name: "Tổng quan" }).click();
      await maker.getByRole("button", { name: "Khách hàng" }).click();
      await expect(maker.getByTestId("pending-intents-banner")).toBeVisible();

      // Reopen the modal for the same account
      await maker.getByTestId("customer-search").fill("browser-e2e@example.test");
      await maker.getByRole("button", { name: "Tìm kiếm" }).click();
      await expect(maker.getByText("Browser E2E Customer")).toBeVisible();
      await maker.getByRole("button", { name: "Xem tài khoản" }).click();
      await maker.getByTestId("funding-request").click();

      // Verify: Modal opens directly into INDETERMINATE state with identical key!
      await expect(maker.getByTestId("indeterminate-notice")).toBeVisible();
      await expect(maker.getByTestId("indeterminate-notice")).toContainText(savedKey);
      await expect(maker.getByTestId("funding-amount")).toHaveValue("3500");

      // Allow next retry to succeed
      shouldDrop = false;
      await maker.getByTestId("submit-account-action").click();
      await expect(maker.getByText(/Đã tạo yêu cầu FUND thành công/)).toBeVisible();
      await expect(maker.getByTestId("pending-intents-banner")).toHaveCount(0);
    } finally {
      await maker.unroute(urlPattern);
    }
  });

  // -----------------------------------------------------------------------------
  // R-04: Determinate business error allows correction, resets review, and generates fresh key
  // -----------------------------------------------------------------------------
  test("R-04: Determinate business error allows correction, resets review, and generates fresh key", async () => {
    await maker.getByRole("button", { name: "Khách hàng" }).click();
    await maker.getByTestId("customer-search").fill("browser-e2e@example.test");
    await maker.getByRole("button", { name: "Tìm kiếm" }).click();
    await maker.getByRole("button", { name: "Xem tài khoản" }).click();

    let firstKey = "";
    let secondKey = "";
    let attempt = 0;
    const urlPattern = "**/admin/accounts/*/funding-requests";

    await maker.route(urlPattern, (route) => {
      attempt++;
      if (attempt === 1) {
        firstKey = route.request().headers()["idempotency-key"] || "";
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          json: {
            code: "FUNDING_LIMIT_EXCEEDED",
            message: "Số tiền cấp vượt quá hạn mức tối đa cho phép.",
          },
        });
      }
      secondKey = route.request().headers()["idempotency-key"] || "";
      return route.continue();
    });

    try {
      await maker.getByTestId("funding-request").click();
      await maker.getByTestId("funding-amount").fill("999999999");
      await maker.getByTestId("action-reason").fill("R04_OVERLIMIT");
      await maker.getByLabel("Ticket reference").fill("TICKET-R04");

      await maker.getByTestId("review-account-action").click();
      await maker.getByTestId("submit-account-action").click();

      // Determinate business error is displayed
      await expect(maker.getByText(/Số tiền cấp vượt quá hạn mức/)).toBeVisible();

      // User corrects the payload (amount)
      await maker.getByTestId("funding-amount").fill("500");
      // Review step is required again
      await expect(maker.getByTestId("review-account-action")).toBeVisible();
      await maker.getByTestId("review-account-action").click();

      // Submit corrected intent
      await maker.getByTestId("submit-account-action").click();
      await expect(maker.getByText(/Đã tạo yêu cầu FUND thành công/)).toBeVisible();

      // Fresh key was generated for the corrected payload
      expect(secondKey).toBeTruthy();
      expect(secondKey).not.toBe(firstKey);
    } finally {
      await maker.unroute(urlPattern);
    }
  });

  // -----------------------------------------------------------------------------
  // R-05: POST succeeds but subsequent GET reload fails -> preserves success notice and retry only fetches GET
  // -----------------------------------------------------------------------------
  test("R-05: POST succeeds but subsequent GET reload fails", async () => {
    await maker.getByRole("button", { name: "Khách hàng" }).click();
    await maker.getByTestId("customer-search").fill("browser-e2e@example.test");
    await maker.getByRole("button", { name: "Tìm kiếm" }).click();
    await maker.getByRole("button", { name: "Xem tài khoản" }).click();

    let postDone = false;
    let getRetryCount = 0;
    let postRetryCount = 0;
    const accountsUrlPattern = "**/admin/customers/*/accounts";
    const postUrlPattern = "**/admin/accounts/*/funding-requests";

    await maker.route(accountsUrlPattern, (route) => {
      if (route.request().method() === "GET") {
        if (postDone) {
          getRetryCount++;
          return route.fulfill({
            status: 500,
            contentType: "application/json",
            json: { message: "Server error on reload" },
          });
        }
      }
      return route.continue();
    });

    await maker.route(postUrlPattern, (route) => {
      if (route.request().method() === "POST") {
        if (postDone) {
          postRetryCount++;
        }
        postDone = true;
      }
      return route.continue();
    });

    try {
      await maker.getByTestId("funding-request").click();
      await maker.getByTestId("funding-amount").fill("1500");
      await maker.getByTestId("action-reason").fill("R05_GET_FAILURE");
      await maker.getByLabel("Ticket reference").fill("TICKET-R05");

      await maker.getByTestId("review-account-action").click();
      await maker.getByTestId("submit-account-action").click();

      // Command success notice remains clearly visible
      await expect(maker.getByText(/Đã tạo yêu cầu FUND thành công/)).toBeVisible();
      // Separate GET error notice appears
      await expect(maker.getByText(/Server error on reload|Yêu cầu thất bại \(500\)/)).toBeVisible();

      // Click retry on the notice
      await maker.getByRole("button", { name: "Thử lại" }).click();

      // Only GET was retried, NO duplicate POST was emitted!
      expect(getRetryCount).toBeGreaterThanOrEqual(2);
      expect(postRetryCount).toBe(0);
    } finally {
      await maker.unroute(accountsUrlPattern);
      await maker.unroute(postUrlPattern);
    }
  });

  // -----------------------------------------------------------------------------
  // R-06: Active deadline and corrupted response JSON classified as indeterminate
  // -----------------------------------------------------------------------------
  test("R-06: Active deadline and corrupted response JSON classified as indeterminate", async () => {
    await maker.getByRole("button", { name: "Khách hàng" }).click();
    await maker.getByTestId("customer-search").fill("browser-e2e@example.test");
    await maker.getByRole("button", { name: "Tìm kiếm" }).click();
    await maker.getByRole("button", { name: "Xem tài khoản" }).click();

    const urlPattern = "**/admin/accounts/*/funding-requests";

    // --- Branch 1: Active deadline timeout (override 1200ms) ---
    await maker.evaluate(() => {
      (window as unknown as { __ADMIN_TIMEOUT_MS__?: number }).__ADMIN_TIMEOUT_MS__ = 1200;
    });

    let delayedResolve: (() => void) | null = null;
    await maker.route(urlPattern, async (route) => {
      // Simulate hanging request that exceeds 1200ms timeout
      await new Promise<void>((resolve) => {
        delayedResolve = resolve;
        setTimeout(resolve, 2500);
      });
      try {
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ action: { id: "act-late" } }),
        });
      } catch {
        // Route may already be aborted by client-side timeout
      }
    });

    try {
      await maker.getByTestId("funding-request").click();
      await maker.getByTestId("funding-amount").fill("2000");
      await maker.getByTestId("action-reason").fill("R06_TIMEOUT_DEADLINE");
      await maker.getByLabel("Ticket reference").fill("TICKET-R06-TIMEOUT");

      await maker.getByTestId("review-account-action").click();
      await maker.getByTestId("submit-account-action").click();

      // UI exits busy state and classifies error as indeterminate timeout
      await expect(maker.getByTestId("indeterminate-notice")).toBeVisible();
      await expect(maker.getByText(/quá thời gian chờ \(Timeout\)/)).toBeVisible();
      await expect(maker.getByText(/Đã tạo yêu cầu FUND thành công/)).toHaveCount(0);

      // Cleanly discard intent
      await maker.getByRole("button", { name: "Đã đối soát xong: Hủy ý định & Tạo thao tác mới" }).click();
      await maker.getByRole("button", { name: "Đóng" }).click();
    } finally {
      if (delayedResolve) (delayedResolve as () => void)();
      try {
        await maker.unroute(urlPattern);
      } catch {
        /* ignore */
      }
      try {
        await maker.evaluate(() => {
          delete (window as unknown as { __ADMIN_TIMEOUT_MS__?: number }).__ADMIN_TIMEOUT_MS__;
        });
      } catch {
        /* ignore */
      }
    }

    // --- Branch 2: Corrupted response JSON / missing action data ---
    await maker.route(urlPattern, (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "<<THIS_IS_CORRUPTED_HTML_OR_TRUNCATED_JSON>>",
      });
    });

    try {
      await maker.getByTestId("funding-request").click();
      await maker.getByTestId("funding-amount").fill("2000");
      await maker.getByTestId("action-reason").fill("R06_CORRUPT_JSON");
      await maker.getByLabel("Ticket reference").fill("TICKET-R06-CORRUPT");

      await maker.getByTestId("review-account-action").click();
      await maker.getByTestId("submit-account-action").click();

      // UI exits busy state and classifies error as indeterminate invalid response
      await expect(maker.getByTestId("indeterminate-notice")).toBeVisible();
      await expect(maker.getByText(/phản hồi không hợp lệ/)).toBeVisible();
      await expect(maker.getByText(/Đã tạo yêu cầu FUND thành công/)).toHaveCount(0);

      // Discard indeterminate intent cleanly
      await maker.getByRole("button", { name: "Đã đối soát xong: Hủy ý định & Tạo thao tác mới" }).click();
      await maker.getByRole("button", { name: "Đóng" }).click();
    } finally {
      try {
        await maker.unroute(urlPattern);
      } catch {
        /* ignore */
      }
    }

    // --- Branch 3: Valid 200 JSON but empty body {} lacking action ID -> indeterminate retry succeeds ---
    let branch3PostCount = 0;
    const branch3Keys: string[] = [];
    const branch3Bodies: string[] = [];
    await maker.route(urlPattern, async (route) => {
      if (route.request().method() === "POST") {
        branch3PostCount++;
        branch3Keys.push(route.request().headers()["idempotency-key"] || "");
        branch3Bodies.push(route.request().postData() || "");
        if (branch3PostCount === 1) {
          // Empty JSON body: valid JSON syntax, but missing required action ID!
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: "{}",
          });
        }
        // Retry returns valid action ID
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ action: { id: "act-r06-retry-success" } }),
        });
      }
      return route.continue();
    });

    try {
      await maker.getByTestId("funding-request").click();
      await maker.getByTestId("funding-amount").fill("2000");
      await maker.getByTestId("action-reason").fill("R06_EMPTY_JSON");
      await maker.getByLabel("Ticket reference").fill("TICKET-R06-EMPTY");

      await maker.getByTestId("review-account-action").click();
      await maker.getByTestId("submit-account-action").click();

      // UI exits busy state and classifies empty body as indeterminate invalid response
      await expect(maker.getByTestId("indeterminate-notice")).toBeVisible();
      await expect(maker.getByText(/thiếu mã yêu cầu|phản hồi không hợp lệ/)).toBeVisible();
      await expect(maker.getByText(/Đã tạo yêu cầu FUND thành công/)).toHaveCount(0);
      expect(branch3PostCount).toBe(1); // No auto-replay!

      // Snapshot and stable key are preserved
      await expect(maker.getByTestId("submit-account-action")).toContainText("Gửi lại (Giữ nguyên khóa xử lý)");

      // User retries
      await maker.getByTestId("submit-account-action").click();

      // Retry succeeds with valid action ID
      await expect(maker.getByText(/Đã tạo yêu cầu FUND thành công/)).toBeVisible();
      await expect(maker.getByText(/act-r06-retry-success/)).toBeVisible();

      // Verify stable key and payload on retry
      expect(branch3PostCount).toBe(2);
      expect(branch3Keys.length).toBe(2);
      expect(branch3Keys[1]).toBe(branch3Keys[0]);
      expect(branch3Bodies[1]).toBe(branch3Bodies[0]);

      // Dismiss the success notice before proceeding to next branch
      const successNotice = maker.locator(".notice.success");
      if (await successNotice.isVisible().catch(() => false)) {
        await successNotice.getByRole("button", { name: "Đóng" }).click();
        await expect(successNotice).toHaveCount(0);
      }
    } finally {
      await maker.unroute(urlPattern);
    }

    // --- Branch 4: Response with empty action object {"action": {}} ---
    await maker.route(urlPattern, (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ action: {} }),
      });
    });

    try {
      await maker.getByTestId("funding-request").click();
      await maker.getByTestId("funding-amount").fill("2000");
      await maker.getByTestId("action-reason").fill("R06_EMPTY_ACTION_OBJ");
      await maker.getByLabel("Ticket reference").fill("TICKET-R06-ACTION-EMPTY");

      await maker.getByTestId("review-account-action").click();
      await maker.getByTestId("submit-account-action").click();

      // UI exits busy state and classifies as indeterminate invalid response
      await expect(maker.getByTestId("indeterminate-notice")).toBeVisible();
      await expect(maker.getByText(/thiếu mã yêu cầu|phản hồi không hợp lệ/)).toBeVisible();
      await expect(maker.getByText(/Đã tạo yêu cầu FUND thành công/)).toHaveCount(0);

      // Cleanly discard intent
      await maker.getByRole("button", { name: "Đã đối soát xong: Hủy ý định & Tạo thao tác mới" }).click();
      await maker.getByRole("button", { name: "Đóng" }).click();
    } finally {
      await maker.unroute(urlPattern);
    }
  });

  // -----------------------------------------------------------------------------
  // R-07: Slow customer accounts response never overwrites active customer state
  // -----------------------------------------------------------------------------
  test("R-07: Slow customer accounts response never overwrites active customer state", async () => {
    await maker.getByRole("button", { name: "Khách hàng" }).click();
    await maker.getByTestId("customer-search").fill("e2e");

    const [searchResponse] = await Promise.all([
      maker.waitForResponse(
        (r) => r.url().includes("/admin/customers") && r.request().method() === "GET"
      ),
      maker.getByRole("button", { name: "Tìm kiếm" }).click(),
    ]);

    const searchData = (await searchResponse.json()) as { items: Array<{ id: string; fullName: string }> };
    const custA = (searchData.items || []).find((c) => c.fullName === "Browser E2E Customer");
    const custB = (searchData.items || []).find((c) => c.fullName === "Second Synthetic Customer");

    // Strictly assert both synthetic customers exist and have distinct IDs
    expect(custA).toBeTruthy();
    expect(custB).toBeTruthy();
    expect(custA?.id).toBeTruthy();
    expect(custB?.id).toBeTruthy();
    expect(custA?.id).not.toBe(custB?.id);
    const custAId = custA!.id;
    const custBId = custB!.id;

    await expect(maker.getByText("Browser E2E Customer")).toBeVisible();
    await expect(maker.getByText("Second Synthetic Customer")).toBeVisible();

    const accountsPatternA = `**/admin/customers/${custAId}/accounts`;

    // --- Part 1: Open A (slow) -> Open B (fast) ---
    let signalAHeld: () => void = () => {};
    const aHeldPromise = new Promise<void>((resolve) => {
      signalAHeld = resolve;
    });
    let releaseA: () => void = () => {};
    const aGatePromise = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let aIntercepted = false;

    await maker.route(accountsPatternA, async (route) => {
      if (route.request().method() === "GET") {
        aIntercepted = true;
        signalAHeld();
        await aGatePromise;
        try {
          await route.continue();
        } catch {
          // Client may have aborted the request
        }
        return;
      }
      return route.continue();
    });

    try {
      // 1. Click customer A (slow)
      const custACard = maker.locator(".customer-card").filter({ hasText: "Browser E2E Customer" });
      await custACard.getByRole("button", { name: "Xem tài khoản" }).click();

      // 2. Await explicit signal confirming request A was sent and intercepted before touching B
      await aHeldPromise;
      expect(aIntercepted).toBe(true);

      // 3. Immediately click customer B (fast)
      const custBCard = maker.locator(".customer-card").filter({ hasText: "Second Synthetic Customer" });
      await custBCard.getByRole("button", { name: "Xem tài khoản" }).click();

      // 4. B finishes first
      await expect(maker.getByText("Danh sách tài khoản: Second Synthetic Customer")).toBeVisible();
      await expect(maker.getByText("Second Current Account")).toBeVisible();
      await expect(maker.getByText("200.000 VND")).toBeVisible();
      await expect(maker.getByText(/9002/)).toBeVisible();

      // 5. Release A, wait for either response or client abort
      releaseA();
      await maker
        .waitForResponse((r) => r.url().includes(`/admin/customers/${custAId}/accounts`), {
          timeout: 4000,
        })
        .catch(() => {
          // Aborted by client or completed
        });

      // 6. Assertion: Active customer MUST REMAIN Customer B with B's accounts!
      await expect(maker.getByText("Danh sách tài khoản: Second Synthetic Customer")).toBeVisible();
      await expect(maker.getByText("Second Current Account")).toBeVisible();
      await expect(maker.getByText(/9002/)).toBeVisible();
      await expect(maker.getByText("Browser E2E Current Account")).toHaveCount(0);
      await expect(maker.getByText(/9001/)).toHaveCount(0);

      // 7. Verify opening modal targets Account B
      await maker.getByTestId("funding-request").click();
      await expect(maker.locator(".modal").getByText(/Second Current Account/)).toBeVisible();
      await expect(maker.locator(".modal").getByText(/9002/)).toBeVisible();
      await maker.locator(".modal").getByRole("button", { name: "Đóng" }).click();
    } finally {
      releaseA();
      try {
        await maker.unroute(accountsPatternA);
      } catch {
        /* ignore */
      }
    }

    // --- Part 2: Reload A (slow) -> Switch to B (fast) -> Assert modal action targets Account B ---
    // First, select Customer A and let it load completely
    const custACard = maker.locator(".customer-card").filter({ hasText: "Browser E2E Customer" });
    await custACard.getByRole("button", { name: "Xem tài khoản" }).click();
    await expect(maker.getByText("Danh sách tài khoản: Browser E2E Customer")).toBeVisible();
    await expect(maker.getByText("Browser E2E Current Account")).toBeVisible();
    await expect(maker.getByText(/9001/)).toBeVisible();

    let signalReloadAHeld: () => void = () => {};
    const reloadAHeldPromise = new Promise<void>((resolve) => {
      signalReloadAHeld = resolve;
    });
    let releaseReloadA: () => void = () => {};
    const reloadAGatePromise = new Promise<void>((resolve) => {
      releaseReloadA = resolve;
    });
    let reloadAIntercepted = false;

    await maker.route(accountsPatternA, async (route) => {
      if (route.request().method() === "GET") {
        reloadAIntercepted = true;
        signalReloadAHeld();
        await reloadAGatePromise;
        try {
          await route.continue();
        } catch {
          // Client may have aborted the request
        }
        return;
      }
      return route.continue();
    });

    try {
      // 1. Trigger reload for A (delayed)
      await maker.getByTestId("reload-accounts").click();

      // 2. Await confirmation that reload request for A is held
      await reloadAHeldPromise;
      expect(reloadAIntercepted).toBe(true);

      // 3. While reload A is delayed, switch to Customer B
      const custBCard = maker.locator(".customer-card").filter({ hasText: "Second Synthetic Customer" });
      await custBCard.getByRole("button", { name: "Xem tài khoản" }).click();

      // 4. Verify B's accounts are displayed
      await expect(maker.getByText("Danh sách tài khoản: Second Synthetic Customer")).toBeVisible();
      await expect(maker.getByText("Second Current Account")).toBeVisible();
      await expect(maker.getByText(/9002/)).toBeVisible();

      // 5. Release reload A
      releaseReloadA();
      await maker
        .waitForResponse((r) => r.url().includes(`/admin/customers/${custAId}/accounts`), {
          timeout: 4000,
        })
        .catch(() => {
          // Aborted by client or completed
        });

      // 6. Verify B's accounts are STILL displayed
      await expect(maker.getByText("Danh sách tài khoản: Second Synthetic Customer")).toBeVisible();
      await expect(maker.getByText("Second Current Account")).toBeVisible();
      await expect(maker.getByText(/9002/)).toBeVisible();
      await expect(maker.getByText("Browser E2E Current Account")).toHaveCount(0);

      // 7. Click funding action on Account B: verify modal targets Account B!
      await maker.getByTestId("funding-request").click();
      await expect(maker.locator(".modal").getByText(/Second Current Account/)).toBeVisible();
      await expect(maker.locator(".modal").getByText(/9002/)).toBeVisible();
      await maker.locator(".modal").getByRole("button", { name: "Đóng" }).click();
    } finally {
      releaseReloadA();
      try {
        await maker.unroute(accountsPatternA);
      } catch {
        /* ignore */
      }
    }
  });

  // -----------------------------------------------------------------------------
  // R-08: Decision 'Từ chối' (REJECT) preserved through step-up MFA and Enter submission
  // -----------------------------------------------------------------------------
  test("R-08: Decision 'Từ chối' (REJECT) preserved through step-up MFA and Enter submission", async () => {
    await controlPage.getByRole("button", { name: "Tổng quan" }).click();
    await controlPage.getByRole("button", { name: "Approval Inbox" }).click();

    const row = controlPage.locator(".action-row").first();
    await expect(row).toBeVisible();
    await row.click();

    await controlPage.getByTestId("checker-reason").fill("REJECT_VIA_ENTER");

    let rejectCalled = false;
    let approveCalled = false;

    const rejectPattern = "**/admin/approvals/*/reject";
    const approvePattern = "**/admin/approvals/*/approve";

    await controlPage.route(rejectPattern, (route) => {
      rejectCalled = true;
      return route.continue();
    });
    await controlPage.route(approvePattern, (route) => {
      approveCalled = true;
      return route.continue();
    });

    try {
      // Click 'Từ chối'
      await controlPage.getByTestId("reject-action").click();

      // Step-up MFA input appears
      const stepUp = controlPage.getByTestId("step-up-mfa");
      await expect(stepUp).toBeVisible();
      await expect(controlPage.getByTestId("step-up-decision-banner")).toContainText("TỪ CHỐI");

      // Enter TOTP and press Enter key
      await stepUp.fill(generateTotp(control.secret, Date.now()));
      await stepUp.press("Enter");

      await expect(controlPage.getByText(/Đã từ chối yêu cầu/)).toBeVisible();
      expect(rejectCalled).toBe(true);
      expect(approveCalled).toBe(false);
    } finally {
      await controlPage.unroute(rejectPattern);
      await controlPage.unroute(approvePattern);
    }
  });

  // -----------------------------------------------------------------------------
  // R-09: ADMIN with audit.read cannot approve actions without explicit action permission; CONTROL can
  // -----------------------------------------------------------------------------
  test("R-09: ADMIN with audit.read cannot approve actions without action permission; CONTROL can", async () => {
    // 0. Maker creates a dedicated SIMULATION_FUNDING action
    await maker.getByRole("button", { name: "Khách hàng" }).click();
    await maker.getByTestId("customer-search").fill("browser-e2e@example.test");
    await maker.getByRole("button", { name: "Tìm kiếm" }).click();
    const custCard = maker.locator(".customer-card").filter({ hasText: "Browser E2E Customer" });
    await expect(custCard).toBeVisible();
    await custCard.getByRole("button", { name: "Xem tài khoản" }).click();
    await maker.getByTestId("funding-request").click();
    await maker.getByTestId("funding-amount").fill("1500");
    await maker.getByTestId("action-reason").fill("R09_FUNDING_APPROVAL");
    await maker.getByLabel("Ticket reference").fill("TICKET-R09");
    await maker.getByTestId("review-account-action").click();
    await maker.getByTestId("submit-account-action").click();
    await expect(maker.getByText(/Đã tạo yêu cầu FUND thành công/)).toBeVisible();

    // 1. ADMIN (holds audit.read, but lacks simulation-funding.approve)
    await adminPage.getByRole("button", { name: "Tổng quan" }).click();
    await adminPage.getByRole("button", { name: "Approval Inbox" }).click();
    await adminPage.getByRole("button", { name: "Làm mới danh sách" }).click();
    const adminFundingRow = adminPage.locator(".action-row").filter({ hasText: "SIMULATION_FUNDING" }).first();
    await expect(adminFundingRow).toBeVisible();
    await adminFundingRow.click();

    // Verify permission denied notice and disabled buttons
    await expect(adminPage.getByTestId("permission-denied-notice")).toBeVisible();
    await expect(adminPage.getByTestId("approve-action")).toBeDisabled();
    await expect(adminPage.getByTestId("reject-action")).toBeDisabled();
    await adminPage.getByRole("button", { name: "Đóng" }).click();

    // 2. CONTROL (holds simulation-funding.approve)
    await controlPage.getByRole("button", { name: "Tổng quan" }).click();
    await controlPage.getByRole("button", { name: "Approval Inbox" }).click();
    await controlPage.getByRole("button", { name: "Làm mới danh sách" }).click();
    const ctrlFundingRow = controlPage.locator(".action-row").filter({ hasText: "SIMULATION_FUNDING" }).first();
    await expect(ctrlFundingRow).toBeVisible();
    await ctrlFundingRow.click();

    // Verify NO permission denied notice
    await expect(controlPage.getByTestId("permission-denied-notice")).toHaveCount(0);
    await controlPage.getByTestId("checker-reason").fill("CONTROL_PERMITTED_R09");
    await expect(controlPage.getByTestId("approve-action")).toBeEnabled();

    // Execute approval with Step-up MFA
    await controlPage.getByTestId("approve-action").click();
    const stepUpInput = controlPage.getByTestId("step-up-mfa");
    if (await stepUpInput.isVisible().catch(() => false)) {
      await stepUpInput.fill(generateTotp(control.secret, Date.now()));
      await controlPage.getByTestId("approve-action").click();
    }
    await expect(controlPage.getByText(/Đã phê duyệt yêu cầu.*thành công/)).toBeVisible();
  });

  // -----------------------------------------------------------------------------
  // R-10: Customer access lock/unlock indeterminate failure retries with stable key without duplicate request
  // -----------------------------------------------------------------------------
  test("R-10: Customer access lock/unlock indeterminate retry uses stable key", async () => {
    await maker.getByRole("button", { name: "Khách hàng" }).click();
    await maker.getByTestId("customer-search").fill("browser-e2e@example.test");
    await maker.getByRole("button", { name: "Tìm kiếm" }).click();

    const customerCard = maker.locator(".customer-card").filter({ hasText: "Browser E2E Customer" });
    await customerCard.getByTestId("customer-lock-request").click();

    const interceptedKeys: string[] = [];
    let attempt = 0;
    const urlPattern = "**/admin/customers/*/access-lock-requests";

    await maker.route(urlPattern, async (route) => {
      attempt++;
      interceptedKeys.push(route.request().headers()["idempotency-key"] || "");

      if (attempt === 1) {
        // Let real server commit
        await route.fetch();
        // Drop response
        await route.abort("failed");
        return;
      }
      return route.continue();
    });

    try {
      // Review step
      await maker.getByTestId("review-customer-action").click();
      await expect(maker.getByTestId("customer-review-box")).toBeVisible();

      // First submit -> encounters dropped response
      await maker.getByTestId("submit-customer-action").click();
      await expect(maker.getByTestId("indeterminate-customer-notice")).toBeVisible();
      await expect(maker.getByTestId("submit-customer-action")).toContainText("Gửi lại (Giữ nguyên khóa xử lý)");

      // Retry
      await maker.getByTestId("submit-customer-action").click();
      await expect(maker.getByText(/Đã tạo yêu cầu khóa truy cập khách hàng thành công/)).toBeVisible();

      expect(interceptedKeys.length).toBe(2);
      expect(interceptedKeys[1]).toBe(interceptedKeys[0]);
    } finally {
      await maker.unroute(urlPattern);
    }
  });

  // -----------------------------------------------------------------------------
  // R-11: Session isolation prevents late callbacks from leaking across logout/login
  // Covers: Account & Customer actions, late success (202) & indeterminate (503) callbacks,
  // and logout race condition protection (delayed logout response cannot destroy new session)
  // -----------------------------------------------------------------------------
  test("R-11: Session isolation prevents late callbacks from leaking across logout/login", async () => {
    // --- Sub-case A: Account Action - Late success response arriving after logout and login as Staff B (support) ---
    // Also tests that delayed logout API response does not wipe newly established session (logout epoch guard)
    await maker.getByRole("button", { name: "Khách hàng" }).click();
    await maker.getByTestId("customer-search").fill("browser-e2e@example.test");
    await maker.getByRole("button", { name: "Tìm kiếm" }).click();
    await maker.getByRole("button", { name: "Xem tài khoản" }).click();

    let signalAccountPostHeld: () => void = () => {};
    const accountPostHeldPromise = new Promise<void>((resolve) => {
      signalAccountPostHeld = resolve;
    });
    let releaseLateAccountPost: () => void = () => {};
    const lateAccountGatePromise = new Promise<void>((resolve) => {
      releaseLateAccountPost = resolve;
    });
    let accountPostIntercepted = false;

    // Route interceptor to hold the logout API call and verify logout race condition protection
    let signalLogoutHeld: () => void = () => {};
    const logoutHeldPromise = new Promise<void>((resolve) => {
      signalLogoutHeld = resolve;
    });
    let releaseLogout: () => void = () => {};
    const logoutGatePromise = new Promise<void>((resolve) => {
      releaseLogout = resolve;
    });

    const accountUrlPattern = "**/admin/accounts/*/funding-requests";
    await maker.route(accountUrlPattern, async (route) => {
      if (route.request().method() === "POST") {
        accountPostIntercepted = true;
        signalAccountPostHeld();
        await lateAccountGatePromise;
        try {
          await route.fulfill({
            status: 202,
            contentType: "application/json",
            body: JSON.stringify({ action: { id: "act-late-leak-test" } }),
          });
        } catch {
          // Client may have aborted
        }
        return;
      }
      return route.continue();
    });

    const logoutUrlPattern = "**/admin/auth/logout";
    await maker.route(logoutUrlPattern, async (route) => {
      if (route.request().method() === "POST") {
        signalLogoutHeld();
        // Fetch the REAL response from the fixture server (includes Set-Cookie: Max-Age=0)
        const response = await route.fetch();
        await logoutGatePromise;
        // Fulfill with the REAL response so the browser receives the real Set-Cookie headers
        await route.fulfill({ response });
        return;
      }
      return route.continue();
    });

    try {
      await maker.getByTestId("funding-request").click();
      await maker.getByTestId("funding-amount").fill("7777");
      await maker.getByTestId("action-reason").fill("R11_SESSION_LEAK_CHECK");
      await maker.getByLabel("Ticket reference").fill("TICKET-R11-A");
      await maker.getByTestId("review-account-action").click();
      await maker.getByTestId("submit-account-action").click();

      // 1. Await confirmation that request reached network boundary
      await accountPostHeldPromise;
      expect(accountPostIntercepted).toBe(true);

      // 2. Perform UI logout while request is still pending
      await maker.getByRole("button", { name: "Đăng xuất" }).click();
      await expect(maker.getByRole("heading", { name: "Đăng nhập quản trị" })).toBeVisible();

      // 3. Confirm logout API request was sent and is held at network boundary
      await logoutHeldPromise;

      // 4. Fill login credentials for Staff B (support) while logout response is still held
      await maker.getByTestId("staff-email").fill(support.email);
      await maker.getByTestId("staff-password").fill(support.password);

      // Track whether POST /admin/auth/login has been dispatched
      let loginPostDispatched = false;
      const loginUrlPattern = "**/admin/auth/login";
      await maker.route(loginUrlPattern, (route) => {
        if (route.request().method() === "POST") {
          loginPostDispatched = true;
        }
        return route.continue();
      });

      // Support clicks "Tiếp tục với MFA" -> triggers ensureLoggedOut coordination
      const clickMfaPromise = maker.getByRole("button", { name: "Tiếp tục với MFA" }).click();

      // PROOF 1: Assert that login operation has started (button enters busy state "Đang kiểm tra…")
      // but POST /admin/auth/login has NOT been dispatched because ensureLoggedOut is holding it back!
      await expect(maker.getByRole("button", { name: "Đang kiểm tra…" })).toBeVisible();
      // Brief pause to prove that without ensureLoggedOut(), the fetch would have fired immediately
      await maker.waitForTimeout(200);
      expect(loginPostDispatched).toBe(false);

      // Release the REAL fixture logout response (delivers real Set-Cookie: maxAge=0)
      // Once released, ensureLoggedOut completes, and POST /admin/auth/login is allowed to dispatch!
      const [logoutResponse] = await Promise.all([
        maker.waitForResponse((r) => r.url().includes("/auth/logout") && r.request().method() === "POST"),
        (async () => {
          releaseLogout();
        })(),
      ]);
      expect(logoutResponse.status()).toBe(204);

      // Wait for POST /admin/auth/login to be dispatched and response received
      await maker.waitForResponse((r) => r.url().includes("/auth/login") && r.request().method() === "POST");
      expect(loginPostDispatched).toBe(true);

      await clickMfaPromise;
      await maker.unroute(loginUrlPattern);

      // Complete MFA verification for Support
      await expect(maker.getByTestId("staff-mfa")).toBeVisible();
      await maker.getByTestId("staff-mfa").fill(generateTotp(support.secret, Date.now()));
      await maker.getByRole("button", { name: "Xác thực và vào Admin" }).click();
      await expect(maker.getByRole("button", { name: "Đăng xuất" })).toBeVisible();

      // 5. CRITICAL VERIFICATION: Prove that Support session cookies survived and are 100% active
      // by calling /admin/me with credentials: "include" and asserting the correct staff member!
      const meData = await maker.evaluate(async () => {
        const res = await fetch("/api/v1/admin/me", { credentials: "include" });
        return { status: res.status, data: await res.json() };
      });
      expect(meData.status).toBe(200);
      expect(meData.data.staff.email).toBe("browser-support@example.test");
      expect(meData.data.staff.displayName).toBe("Browser Support");

      // 6. Release the late funding request belonging to previous operations session
      // Event-based synchronization: strict waitForResponse without catch() swallowing
      const [fundingResponse] = await Promise.all([
        maker.waitForResponse((r) => r.url().includes("/accounts/") && r.url().includes("/funding-requests")),
        (async () => {
          releaseLateAccountPost();
        })(),
      ]);
      expect(fundingResponse.status()).toBe(202);

      // 7. Assert: Staff B session is strictly isolated from operations
      await expect(maker.locator("[data-testid='pending-intents-banner']")).toHaveCount(0);
      await expect(maker.getByText(/act-late-leak-test/)).toHaveCount(0);
      await expect(maker.getByText(/Đã tạo yêu cầu FUND thành công/)).toHaveCount(0);

      // Opening modal on same target must show clean blank form, NOT restored from old session
      await maker.getByRole("button", { name: "Khách hàng" }).click();
      await maker.getByTestId("customer-search").fill("browser-e2e@example.test");
      await maker.getByRole("button", { name: "Tìm kiếm" }).click();
      await maker.getByRole("button", { name: "Xem tài khoản" }).click();

      // Ensure funding button is absent for Support (RBAC verified) and no restored intent
      await expect(maker.getByTestId("funding-request")).toHaveCount(0);
      await expect(maker.getByTestId("indeterminate-notice")).toHaveCount(0);

      // Support can open account-block-request, showing clean blank form
      await maker.getByTestId("account-block-request").click();
      await expect(maker.getByTestId("action-reason")).toHaveValue("");
      await maker.locator(".modal").getByRole("button", { name: "Đóng" }).click();
    } finally {
      releaseLateAccountPost();
      releaseLogout();
      await maker.unroute(accountUrlPattern);
      await maker.unroute(logoutUrlPattern);
    }

    // --- Sub-case B: Customer Action - Late 503 response AND hanging logout timeout/abort branch ---
    // Tests: 1) Late 503 classified as INDETERMINATE
    //        2) Logout hanging past 3s timeout -> abort branch triggers -> login completes safely
    //        3) Late release of hung logout response cannot corrupt new session
    const customerCard = maker.locator(".customer-card").filter({ hasText: "Browser E2E Customer" });
    await customerCard.getByTestId("customer-lock-request").click();

    let signalCustomerPostHeld: () => void = () => {};
    const customerPostHeldPromise = new Promise<void>((resolve) => {
      signalCustomerPostHeld = resolve;
    });
    let releaseLateCustomerPost: () => void = () => {};
    const lateCustomerGatePromise = new Promise<void>((resolve) => {
      releaseLateCustomerPost = resolve;
    });
    let customerPostIntercepted = false;

    const customerUrlPattern = "**/admin/customers/*/access-lock-requests";
    await maker.route(customerUrlPattern, async (route) => {
      if (route.request().method() === "POST") {
        customerPostIntercepted = true;
        signalCustomerPostHeld();
        await lateCustomerGatePromise;
        try {
          // 503 → classified as INDETERMINATE by isIndeterminateError, triggering pending intent storage
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ code: "GATEWAY_ERROR", message: "Service temporarily unavailable" }),
          });
        } catch {
          // Client may have aborted
        }
        return;
      }
      return route.continue();
    });

    // Install interceptor to HANG Support's logout request and test the 3-second abort timeout branch
    let signalHungLogoutHeld: () => void = () => {};
    const hungLogoutHeldPromise = new Promise<void>((resolve) => {
      signalHungLogoutHeld = resolve;
    });
    let releaseHungLogout: () => void = () => {};
    const hungLogoutGatePromise = new Promise<void>((resolve) => {
      releaseHungLogout = resolve;
    });

    const hungLogoutUrlPattern = "**/admin/auth/logout";
    await maker.route(hungLogoutUrlPattern, async (route) => {
      if (route.request().method() === "POST") {
        signalHungLogoutHeld();
        const response = await route.fetch();
        await hungLogoutGatePromise;
        try {
          await route.fulfill({ response });
        } catch {}
        return;
      }
      return route.continue();
    });

    try {
      await maker.getByTestId("review-customer-action").click();
      await maker.getByTestId("submit-customer-action").click();

      await customerPostHeldPromise;
      expect(customerPostIntercepted).toBe(true);

      // Support logs out (UI immediately shows login form; logout request is HUNG)
      await maker.getByRole("button", { name: "Đăng xuất" }).click();
      await expect(maker.getByRole("heading", { name: "Đăng nhập quản trị" })).toBeVisible();

      // Wait until hung logout is intercepted and held
      await hungLogoutHeldPromise;

      // Operations logs in while logout is still hanging
      await maker.getByTestId("staff-email").fill(operations.email);
      await maker.getByTestId("staff-password").fill(operations.password);

      // Install listener to detect client abort on the hung logout request
      let hungLogoutAborted = false;
      const onHungLogoutFailed = (req: any) => {
        if (req.url().includes("/auth/logout") && req.method() === "POST") {
          hungLogoutAborted = true;
        }
      };
      maker.on("requestfailed", onHungLogoutFailed);

      // Operations clicks "Tiếp tục với MFA":
      // ensureLoggedOut() waits for the hung logout and releases after bounded drain timeout
      const coordStart = Date.now();
      await maker.getByRole("button", { name: "Tiếp tục với MFA" }).click();

      // MFA input appears: hung logout does not block login indefinitely
      await expect(maker.getByTestId("staff-mfa")).toBeVisible({ timeout: 10000 });
      const coordElapsed = Date.now() - coordStart;
      // Assert login waited for logout drain (bounded wait, not proceeding prematurely)
      expect(coordElapsed).toBeGreaterThanOrEqual(2800);

      // Assert hung logout was cancelled/aborted (requestfailed) as login proceeded
      expect(hungLogoutAborted).toBe(true);
      maker.off("requestfailed", onHungLogoutFailed);

      await maker.getByTestId("staff-mfa").fill(generateTotp(operations.secret, Date.now()));
      await maker.getByRole("button", { name: "Xác thực và vào Admin" }).click();
      await expect(maker.getByRole("button", { name: "Đăng xuất" })).toBeVisible();

      // NOW release the hung logout response (delivering 204 Set-Cookie: maxAge=0 from fixture)
      // Because client aborted it on timeout, this old response cannot wipe Operations's cookies!
      releaseHungLogout();

      // Release late 503 response AFTER new session is active
      // Event-based synchronization: strict waitForResponse without catch() swallowing
      const [late503Response] = await Promise.all([
        maker.waitForResponse((r) => r.url().includes("/access-lock-requests")),
        (async () => {
          releaseLateCustomerPost();
        })(),
      ]);
      expect(late503Response.status()).toBe(503);

      // Assert: No error/intent/banner leaked from previous session into operations session
      await expect(maker.locator("[data-testid='pending-intents-banner']")).toHaveCount(0);
      await expect(maker.getByText(/Service temporarily unavailable/)).toHaveCount(0);
      await expect(maker.getByTestId("indeterminate-customer-notice")).toHaveCount(0);

      // Verify Operations session cookies are intact and valid even after late hung logout was released!
      const opsMeData = await maker.evaluate(async () => {
        const res = await fetch("/api/v1/admin/me", { credentials: "include" });
        return { status: res.status, data: await res.json() };
      });
      expect(opsMeData.status).toBe(200);
      expect(opsMeData.data.staff.email).toBe("browser-operations@example.test");
    } finally {
      releaseLateCustomerPost();
      releaseHungLogout();
      await maker.unroute(customerUrlPattern);
      await maker.unroute(hungLogoutUrlPattern);
    }
  });

  // -----------------------------------------------------------------------------
  // Comprehensive P0 Regression Suite
  // -----------------------------------------------------------------------------
  test("Admin Web covers P0 maker-checker operations and recovery surfaces", async () => {
    await maker.setViewportSize({ width: 768, height: 768 });
    await expect(maker.locator(".sidebar")).toBeVisible();
    await maker.setViewportSize({ width: 1366, height: 768 });

    // Verify Maker (Operations) cannot access Approval Inbox
    await maker.goto("/#/approvals");
    await expect(maker.getByText(/Approval Inbox chỉ dành cho/)).toBeVisible();

    await maker.getByRole("button", { name: "Giao dịch chờ" }).click();
    await expect(maker.getByText("BROWSER-TRANSFER-001")).toBeVisible();
    await maker.getByTestId("transfer-reason").fill("BROWSER_E2E_TRANSFER_REVIEW");
    await maker.getByRole("button", { name: "Cancel request" }).click();

    await maker.getByRole("button", { name: "Hồ sơ KYC", exact: true }).click();
    await expect(maker.getByText(/KYC ·/)).toBeVisible();
    await requestApplication(maker, "KYC");

    await maker.getByRole("button", { name: "Hồ sơ tín dụng", exact: true }).click();
    await expect(maker.getByText(/CREDIT ·/)).toBeVisible();
    await requestApplication(maker, "CREDIT");

    await maker.getByRole("button", { name: "Fraud cases" }).click();
    await expect(maker.getByText(/Synthetic browser fraud report/)).toBeVisible();
    await maker.getByRole("button", { name: /Tiếp nhận|Claim/ }).click();
    await maker.getByTestId("fraud-note").fill("Reviewed synthetic evidence; no secrets.");
    await maker.getByRole("button", { name: "Ghi chú case đầu tiên" }).click();
    await maker.getByRole("button", { name: "Resolution request" }).click();
    await maker.locator(".modal").getByLabel("Reason code").fill("BROWSER_E2E_FRAUD_REVIEW");
    await maker.locator(".modal").getByRole("button", { name: "Gửi yêu cầu RESOLVE" }).click();

    await maker.getByRole("button", { name: "Outbox / Jobs" }).click();
    await expect(maker.getByText(/transfer\.succeeded/)).toBeVisible();
    await maker.getByTestId("outbox-reason").fill("BROWSER_E2E_RETRY");
    await maker.getByRole("button", { name: "Requeue request" }).click();
    await maker.getByRole("button", { name: "Retry job request" }).click();

    await adminPage.getByRole("button", { name: "Staff / Roles" }).click();
    const supportRow = adminPage.locator("tr").filter({ hasText: "browser-support@example.test" });
    await expect(supportRow).toBeVisible();
    await supportRow.getByRole("button", { name: "Disable request" }).click();

    await controlPage.getByRole("button", { name: "Tổng quan" }).click();
    await controlPage.getByRole("button", { name: "Approval Inbox" }).click();
    await approveAction(controlPage, "KYC_DECISION", control.secret, "BROWSER_E2E_CONTROL_KYC");
    await approveAction(controlPage, "CREDIT_DECISION", control.secret, "BROWSER_E2E_CONTROL_CREDIT");
    await approveAction(controlPage, "TRANSFER_OPERATION", control.secret, "BROWSER_E2E_CONTROL_TRANSFER");
    await approveAction(controlPage, "FRAUD_ACTION", control.secret, "BROWSER_E2E_CONTROL_FRAUD");
    await approveAction(controlPage, "OUTBOX_REQUEUE", control.secret, "BROWSER_E2E_CONTROL_OUTBOX");
    await approveAction(controlPage, "JOB_RETRY", control.secret, "BROWSER_E2E_CONTROL_JOB");
    await approveAction(controlPage, "STAFF_DISABLE", control.secret, "BROWSER_E2E_CONTROL_DISABLE");

    await supportPage.reload();
    await expect(supportPage.getByRole("heading", { name: "Đăng nhập quản trị" })).toBeVisible();
  });
});
