import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

import { AdminActionEngine } from "../../backend/dist/admin/actions/actionEngine.js";
import { StaffAuthService } from "../../backend/dist/admin/auth/staffAuthService.js";
import { createAdminServer } from "../../backend/dist/admin/http/adminHttp.js";
import { InMemoryAdminRepository } from "../../backend/dist/admin/repositories/adminRepository.js";
import { LocalDevelopmentKeyEncryptionAdapter } from "../../backend/dist/mfa/crypto.js";

const apiHost = "127.0.0.1";
const webHost = "127.0.0.1";
const webPort = 5174;
const createdAt = new Date().toISOString();
const customerId = randomUUID();
const accountId = randomUUID();
const kycId = randomUUID();
const creditId = randomUUID();
const transferId = randomUUID();
const fraudId = randomUUID();
const jobId = randomUUID();
const deadEventId = randomUUID();

const repository = new InMemoryAdminRepository({
  customers: [{
    id: customerId,
    fullName: "Browser E2E Customer",
    email: "browser-e2e@example.test",
    phoneNumber: "0900000001",
    accessStatus: "ACTIVE",
    accessVersion: 1,
    createdAt,
  }],
  accounts: [{
    id: accountId,
    customerId,
    displayName: "Browser E2E Current Account",
    maskedNumber: "****9001",
    bankName: "Reference",
    availableMinor: "100000",
    currentMinor: "100000",
    heldMinor: "0",
    status: "ACTIVE",
    version: 1,
    updatedAt: createdAt,
  }],
  applications: [
    { id: kycId, applicationType: "KYC", customerId, status: "SUBMITTED", version: 1, requestFingerprint: "browser-kyc", assignedStaffId: null, decisionReasonCode: null, applicantLabel: "Synthetic KYC applicant", createdAt, updatedAt: createdAt },
    { id: creditId, applicationType: "CREDIT", customerId, status: "SUBMITTED", version: 1, requestFingerprint: "browser-credit", assignedStaffId: null, decisionReasonCode: null, requestedLimitMinor: "500000", approvedLimitMinor: null, applicantLabel: "Synthetic credit applicant", createdAt, updatedAt: createdAt },
  ],
  transfers: [{ id: transferId, customerId, sourceAccountId: accountId, reference: "BROWSER-TRANSFER-001", amountMinor: "1000", feeMinor: "10", currency: "VND", status: "PENDING", version: 1, lastErrorCode: null, createdAt, updatedAt: createdAt }],
  fraudCases: [{ id: fraudId, customerId, accountId, transactionId: randomUUID(), reasonPreview: "Synthetic browser fraud report", status: "RECEIVED", severity: "HIGH", assignedStaffId: null, resolutionCode: null, version: 1, createdAt, updatedAt: createdAt }],
  jobs: [{ id: jobId, jobType: "REFERENCE_RECONCILIATION", status: "DEAD", attempts: 3, lastErrorCode: "PROVIDER_TIMEOUT", leaseExpiresAt: null, createdAt, updatedAt: createdAt }],
  outboxEvents: [{ id: deadEventId, eventType: "transfer.succeeded", aggregateId: transferId, aggregateType: "transfer", aggregateVersion: 1, eventVersion: 1, status: "DEAD", attempts: 3, requeueable: true, occurredAt: createdAt, updatedAt: createdAt, payload: { eventId: deadEventId, eventType: "transfer.succeeded" } }],
});
await repository.initialize();

const encryption = new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 23), "admin-web-e2e");
const auth = new StaffAuthService({ repository, encryption, environmentScope: "preview" });
const credentials = {
  operations: { email: "browser-operations@example.test", employeeCode: "BROWSER-OPS", displayName: "Browser Operations", role: "OPERATIONS", password: "Browser-Operations-password!", secret: "JBSWY3DPEHPK3PXP" },
  control: { email: "browser-control@example.test", employeeCode: "BROWSER-CTRL", displayName: "Browser Control", role: "CONTROL", password: "Browser-Control-password!", secret: "KRUGS4ZANFZSAYJA" },
  support: { email: "browser-support@example.test", employeeCode: "BROWSER-SUP", displayName: "Browser Support", role: "SUPPORT", password: "Browser-Support-password!", secret: "MFRGGZDFMZTWQ2LK" },
  admin: { email: "browser-admin@example.test", employeeCode: "BROWSER-ADMIN", displayName: "Browser Admin", role: "ADMIN", password: "Browser-Admin-password!", secret: "ONSWG4TFOQ======" },
};
for (const item of Object.values(credentials)) {
  const invite = await auth.invite({ email: item.email, employeeCode: item.employeeCode, displayName: item.displayName, role: item.role });
  await auth.activate({ inviteToken: invite.token, password: item.password, totpSecret: item.secret });
}

const actions = new AdminActionEngine(repository, auth);
const apiServer = createAdminServer({
  repository,
  auth,
  actions,
  allowedOrigins: [`http://${webHost}:${webPort}`],
  environment: "development",
  commitSha: "admin-web-e2e",
  secureCookies: false,
});
await new Promise((resolve) => apiServer.listen(0, apiHost, resolve));
const apiPort = apiServer.address().port;
process.env.VITE_ADMIN_API_URL = `http://${apiHost}:${apiPort}/api/v1`;

const vite = await createViteServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  server: { host: webHost, port: webPort, strictPort: true },
});
await vite.listen();

const closeServer = (server) => new Promise((resolve) => server.close(() => resolve()));
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await vite.close();
  await closeServer(apiServer);
  await repository.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
console.log("ADMIN_WEB_E2E_READY");
