import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { AdminBootstrapService, type AdminBootstrapStaffInput } from "../admin/auth/adminBootstrapService.js";
import { HttpAdminInvitationProvider, type AdminInvitationDeliveryInput, type AdminInvitationDeliveryPort, type AdminInvitationProviderHealth, createRuntimeAdminInvitationProvider } from "../admin/auth/adminInvitationProvider.js";
import { StaffAuthService } from "../admin/auth/staffAuthService.js";
import { InMemoryAdminRepository } from "../admin/repositories/adminRepository.js";
import { LocalDevelopmentKeyEncryptionAdapter } from "../mfa/crypto.js";
import { hashOpaqueToken } from "../security.js";
import type { SecretProvider } from "../secrets/SecretProvider.js";

const staff: readonly [AdminBootstrapStaffInput] = [
  { email: "admin@example.test", employeeCode: "ADMIN-BOOT", displayName: "Initial Admin", role: "ADMIN" },
];

class RecordingInvitationProvider implements AdminInvitationDeliveryPort {
  readonly messages: AdminInvitationDeliveryInput[] = [];

  constructor(private readonly failAt?: number) {}

  async send(input: AdminInvitationDeliveryInput) {
    this.messages.push({ ...input });
    if (this.failAt !== undefined && this.messages.length === this.failAt) return { status: "FAILED" as const, reason: "capture-provider-failure" };
    return { status: "SENT" as const, providerMessageId: `capture-${this.messages.length}` };
  }

  health(): AdminInvitationProviderHealth {
    return { provider: "http", status: "ok", configured: true, credentialConfigured: false };
  }
}

function authFor(repository: InMemoryAdminRepository): StaffAuthService {
  return new StaffAuthService({ repository, encryption: new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 91), "admin-bootstrap-test"), environmentScope: "staging" });
}

function serviceFor(repository: InMemoryAdminRepository, delivery: AdminInvitationDeliveryPort, overrides: Partial<Pick<AdminBootstrapStaffInput, "email">> = {}) {
  const auth = authFor(repository);
  const configuredStaff: readonly [AdminBootstrapStaffInput] = [
    { ...staff[0], ...(overrides.email ? { email: overrides.email } : {}) },
  ];
  return new AdminBootstrapService({ repository, auth, delivery, activationUrl: "http://localhost:5173/admin/activate", isProductionLike: false, reservedBy: `test:${randomUUID()}`, staff: configuredStaff });
}

test("admin bootstrap needs and delivers only one one-use Admin invitation", async () => {
  const repository = new InMemoryAdminRepository();
  await repository.initialize();
  const delivery = new RecordingInvitationProvider();
  const result = await serviceFor(repository, delivery).run();

  assert.equal(result.event, "admin_bootstrap_completed");
  assert.equal(result.invitations.length, 1);
  assert.deepEqual(result.invitations.map((invitation) => invitation.role), ["ADMIN"]);
  assert.equal(delivery.messages.length, 1);
  assert.ok(!JSON.stringify(result).includes(delivery.messages[0]!.invitationToken));
  assert.ok(await repository.findInviteByHash(hashOpaqueToken(delivery.messages[0]!.invitationToken)));
  await assert.rejects(() => serviceFor(repository, new RecordingInvitationProvider()).run(), /active staff/i);
});

test("single Admin activation is audited and consumes its invitation once", async () => {
  const repository = new InMemoryAdminRepository();
  await repository.initialize();
  const delivery = new RecordingInvitationProvider();
  const auth = authFor(repository);
  await new AdminBootstrapService({ repository, auth, delivery, activationUrl: "http://localhost:5173/admin/activate", isProductionLike: false, staff }).run();
  const first = delivery.messages[0]!;
  const firstActivation = await auth.activate({ inviteToken: first.invitationToken, password: "Admin-bootstrap-password-2026!", totpSecret: "JBSWY3DPEHPK3PXP" });
  assert.equal((await repository.findStaffById(firstActivation.staffId))?.roles[0]?.role, "ADMIN");
  await assert.rejects(() => auth.activate({ inviteToken: first.invitationToken, password: "Admin-bootstrap-password-2026!", totpSecret: "JBSWY3DPEHPK3PXP" }), /invalid or expired/i);
  const activationAudits = (await repository.listAudit(50)).filter((event) => event.action === "STAFF_INVITE_ACTIVATED");
  assert.equal(activationAudits.length, 1);
  assert.equal(activationAudits[0]?.targetId, firstActivation.staffId);
});

test("concurrent activation of one invitation has exactly one winner", async () => {
  const repository = new InMemoryAdminRepository();
  await repository.initialize();
  const auth = authFor(repository);
  const invite = await auth.invite({ email: "concurrent@example.test", employeeCode: "CONCURRENT-BOOT", displayName: "Concurrent", role: "ADMIN" });
  const outcomes = await Promise.allSettled([
    auth.activate({ inviteToken: invite.token, password: "Concurrent-password-2026!", totpSecret: "JBSWY3DPEHPK3PXP" }),
    auth.activate({ inviteToken: invite.token, password: "Concurrent-password-2026!", totpSecret: "JBSWY3DPEHPK3PXP" }),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
});

test("failed invitation delivery burns created invites and permits a safe retry", async () => {
  const repository = new InMemoryAdminRepository();
  await repository.initialize();
  const failedDelivery = new RecordingInvitationProvider(1);
  await assert.rejects(() => serviceFor(repository, failedDelivery).run(), /delivery failed/i);
  assert.equal((await repository.listStaff()).length, 0);
  assert.equal(await repository.findInviteByHash(hashOpaqueToken(failedDelivery.messages[0]!.invitationToken)), null);

  const retryDelivery = new RecordingInvitationProvider();
  const retry = await serviceFor(repository, retryDelivery).run();
  assert.equal(retry.invitations.length, 1);
  assert.equal(retryDelivery.messages.length, 1);
});

test("HTTP invitation provider uses bearer auth, retries transient errors, and returns redacted health", async () => {
  let attempt = 0;
  let requestBody: Record<string, unknown> | undefined;
  const provider = new HttpAdminInvitationProvider({
    endpoint: "http://127.0.0.1:8025/invitations",
    bearerToken: "capture-bearer",
    timeoutMs: 100,
    maxAttempts: 2,
    retryDelayMs: 0,
    allowedDomains: new Set(["example.test"]),
    fetchImpl: async (_url, init) => {
      attempt += 1;
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return attempt === 1 ? new Response(null, { status: 503 }) : new Response(null, { status: 202, headers: { "x-provider-message-id": "capture-42" } });
    },
  });
  const result = await provider.send({ deliveryId: "delivery-1", purpose: "STAFF_INVITATION", destination: "admin@example.test", displayName: "Admin", role: "ADMIN", invitationToken: "opaque-token", activationUrl: "http://localhost:5173/admin/activate", expiresAt: "2026-08-27T00:00:00.000Z" });
  assert.deepEqual(result, { status: "SENT", providerMessageId: "capture-42" });
  assert.equal(attempt, 2);
  assert.equal(requestBody?.token, "opaque-token");
  assert.deepEqual(provider.health(), { provider: "http", status: "ok", configured: true, credentialConfigured: true });
});

test("production invitation provider requires managed bearer and HTTPS test-domain configuration", async () => {
  const secretProvider: SecretProvider = {
    async getSecret() { return { value: "managed-token", version: "staging-v1", source: "managed" }; },
    async getSecretVersion() { return "staging-v1"; },
    async refresh() {},
  };
  const provider = await createRuntimeAdminInvitationProvider({
    environment: "staging",
    isProductionLike: true,
    secretProvider,
    env: { ADMIN_INVITATION_PROVIDER_URL: "https://mail.example.test/send", ADMIN_INVITATION_ALLOWED_DOMAINS: "example.test" },
  });
  assert.equal(provider.health().credentialConfigured, true);
  await assert.rejects(
    createRuntimeAdminInvitationProvider({ environment: "staging", isProductionLike: true, secretProvider, env: { ADMIN_INVITATION_PROVIDER_URL: "http://mail.example.test/send", ADMIN_INVITATION_ALLOWED_DOMAINS: "example.test" } }),
    /requires HTTPS/i,
  );
});
