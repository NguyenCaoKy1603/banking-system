import { expect, test, type Page } from "@playwright/test";

import { generateTotp } from "../../backend/dist/mfa/crypto.js";

type Credential = { email: string; password: string; secret: string };
const operations: Credential = { email: "browser-operations@example.test", password: "Browser-Operations-password!", secret: "JBSWY3DPEHPK3PXP" };
const control: Credential = { email: "browser-control@example.test", password: "Browser-Control-password!", secret: "KRUGS4ZANFZSAYJA" };
const support: Credential = { email: "browser-support@example.test", password: "Browser-Support-password!", secret: "MFRGGZDFMZTWQ2LK" };
const admin: Credential = { email: "browser-admin@example.test", password: "Browser-Admin-password!", secret: "ONSWG4TFOQ======" };

async function login(page: Page, credential: Credential): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Đăng nhập quản trị" })).toBeVisible();
  await page.getByTestId("staff-email").fill(credential.email);
  await page.getByTestId("staff-password").fill(credential.password);
  await page.getByRole("button", { name: "Tiếp tục với MFA" }).click();
  await expect(page.getByTestId("staff-mfa")).toBeVisible();
  // Login accepts the previous timestep; the following current timestep is
  // then reserved for the fresh step-up required by the first approval.
  await page.getByTestId("staff-mfa").fill(generateTotp(credential.secret, Date.now() - 30_000));
  await page.getByRole("button", { name: "Xác thực và vào Admin" }).click();
  await expect(page.getByRole("heading", { name: "Điểm kiểm soát" })).toBeVisible();
}

async function approveAction(page: Page, actionType: string, secret: string, reason: string): Promise<void> {
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
  await row.getByRole("button", { name: "Claim" }).click();
  await row.getByTestId("application-decision").click();
  const modal = page.locator(".modal");
  await modal.getByLabel("Reason code").fill(`BROWSER_E2E_${applicationType}_REVIEW`);
  await modal.getByLabel("Ticket reference").fill(`BROWSER-${applicationType}`);
  await modal.getByRole("button", { name: "Gửi vào Approval Inbox" }).click();
}

test("Admin Web covers P0 maker-checker operations and recovery surfaces", async ({ browser }) => {
  const maker = await browser.newPage();
  const controlPage = await browser.newPage();
  const supportPage = await browser.newPage();
  const adminPage = await browser.newPage();
  try {
    await login(maker, operations);

    await maker.getByRole("button", { name: "Khách hàng" }).click();
    await maker.getByTestId("customer-search").fill("browser-e2e@example.test");
    await maker.getByRole("button", { name: "Tìm kiếm" }).click();
    await expect(maker.getByText("Browser E2E Customer")).toBeVisible();
    await maker.getByRole("button", { name: "Xem tài khoản" }).click();
    await maker.getByTestId("funding-request").click();
    await maker.getByTestId("funding-amount").fill("2500");
    await maker.getByTestId("action-reason").fill("BROWSER_E2E_FUNDING");
    await maker.getByLabel("Ticket reference").fill("BROWSER-001");
    await maker.getByRole("button", { name: "Tạo yêu cầu four-eyes" }).click();

    // Funding changes the account version. Approve it before creating the
    // next account mutation so the later block request captures version 2.
    await login(controlPage, control);
    // The checker was already on the inbox for the initial funding approval;
    // leave and re-enter it to fetch requests created by the other fixtures.
    await controlPage.getByRole("button", { name: "Tổng quan" }).click();
    await controlPage.getByRole("button", { name: "Approval Inbox" }).click();
    await approveAction(controlPage, "SIMULATION_FUNDING", control.secret, "BROWSER_E2E_CONTROL_FUNDING");

    await login(supportPage, support);
    await supportPage.getByRole("button", { name: "Khách hàng" }).click();
    await supportPage.getByTestId("customer-search").fill("browser-e2e@example.test");
    await supportPage.getByRole("button", { name: "Tìm kiếm" }).click();
    await supportPage.getByRole("button", { name: "Xem tài khoản" }).click();
    await supportPage.getByTestId("account-block-request").click();
    await supportPage.getByTestId("action-reason").fill("BROWSER_E2E_ACCOUNT_BLOCK");
    await supportPage.getByLabel("Ticket reference").fill("BROWSER-002");
    await supportPage.getByRole("button", { name: "Tạo yêu cầu four-eyes" }).click();

    await maker.getByRole("button", { name: "Giao dịch chờ" }).click();
    await expect(maker.getByText("BROWSER-TRANSFER-001")).toBeVisible();
    await maker.getByTestId("transfer-reason").fill("BROWSER_E2E_TRANSFER_REVIEW");
    await maker.getByRole("button", { name: "Cancel request" }).click();

    await maker.getByRole("button", { name: "KYC / Credit" }).click();
    await expect(maker.getByText(/KYC ·/)).toBeVisible();
    await requestApplication(maker, "KYC");
    await requestApplication(maker, "CREDIT");

    await maker.getByRole("button", { name: "Fraud cases" }).click();
    await expect(maker.getByText(/Synthetic browser fraud report/)).toBeVisible();
    await maker.getByRole("button", { name: "Claim" }).click();
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

    await login(adminPage, admin);
    await adminPage.getByRole("button", { name: "Staff / Roles" }).click();
    const supportRow = adminPage.locator("tr").filter({ hasText: "browser-support@example.test" });
    await expect(supportRow).toBeVisible();
    await supportRow.getByRole("button", { name: "Disable request" }).click();

    await controlPage.getByRole("button", { name: "Tổng quan" }).click();
    await controlPage.getByRole("button", { name: "Approval Inbox" }).click();
    await approveAction(controlPage, "ACCOUNT_BLOCK", control.secret, "BROWSER_E2E_CONTROL_BLOCK");
    await approveAction(controlPage, "KYC_DECISION", control.secret, "BROWSER_E2E_CONTROL_KYC");
    await approveAction(controlPage, "CREDIT_DECISION", control.secret, "BROWSER_E2E_CONTROL_CREDIT");
    await approveAction(controlPage, "TRANSFER_OPERATION", control.secret, "BROWSER_E2E_CONTROL_TRANSFER");
    await approveAction(controlPage, "FRAUD_ACTION", control.secret, "BROWSER_E2E_CONTROL_FRAUD");
    await approveAction(controlPage, "OUTBOX_REQUEUE", control.secret, "BROWSER_E2E_CONTROL_OUTBOX");
    await approveAction(controlPage, "JOB_RETRY", control.secret, "BROWSER_E2E_CONTROL_JOB");
    await approveAction(controlPage, "STAFF_DISABLE", control.secret, "BROWSER_E2E_CONTROL_DISABLE");

    await controlPage.getByRole("button", { name: "Khách hàng" }).click();
    await controlPage.getByTestId("customer-search").fill("browser-e2e@example.test");
    await controlPage.getByRole("button", { name: "Tìm kiếm" }).click();
    await controlPage.getByRole("button", { name: "Xem tài khoản" }).click();
    await expect(controlPage.getByText("102.500 VND")).toBeVisible();

    await supportPage.reload();
    await expect(supportPage.getByRole("heading", { name: "Đăng nhập quản trị" })).toBeVisible();
  } finally {
    await maker.close();
    await controlPage.close();
    await supportPage.close();
    await adminPage.close();
  }
});
