import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";

import { AdminActionEngine } from "../admin/actions/actionEngine.js";
import { StaffAuthService } from "../admin/auth/staffAuthService.js";
import { createAdminServer } from "../admin/http/adminHttp.js";
import { InMemoryAdminRepository } from "../admin/repositories/adminRepository.js";
import { LocalDevelopmentKeyEncryptionAdapter, generateTotp } from "../mfa/crypto.js";

type HttpResult = { status: number; body: Record<string, unknown> | undefined; response: Response };

function mergeCookies(current: string, response: Response): string {
  const header = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = header.getSetCookie?.() ?? (response.headers.get("set-cookie")?.split(/,(?=[^;]+=)/u) ?? []);
  const jar = new Map<string, string>();
  for (const item of current.split(";")) {
    const [name, ...value] = item.trim().split("=");
    if (name && value.length > 0) jar.set(name, value.join("="));
  }
  for (const item of setCookies) {
    const [pair] = item.split(";");
    const [name, ...value] = pair.trim().split("=");
    if (name && value.length > 0) jar.set(name, value.join("="));
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function readResult(response: Response): Promise<HttpResult> {
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : undefined, response };
}

test("Admin directly creates an active Operations account with verified MFA and idempotent retry", async (t) => {
  const repository = new InMemoryAdminRepository();
  await repository.initialize();
  let clockValue = Math.floor(Date.now() / 30_000) * 30_000;
  const encryption = new LocalDevelopmentKeyEncryptionAdapter(Buffer.alloc(32, 37), "staff-create-test-v1");
  const auth = new StaffAuthService({ repository, encryption, clock: () => clockValue, environmentScope: "preview" });

  const adminSecret = "JBSWY3DPEHPK3PXP";
  const adminInvite = await auth.invite({ email: "staff-creation-admin@example.test", employeeCode: "CREATE-ADMIN", displayName: "Staff Creation Admin", role: "ADMIN" });
  await auth.activate({ inviteToken: adminInvite.token, password: "staff-creation-admin-password", totpSecret: adminSecret });
  const operationsSecret = "KRUGS4ZANFZSAYJA";
  const operationsInvite = await auth.invite({ email: "staff-creation-ops@example.test", employeeCode: "CREATE-OPS", displayName: "Staff Creation Operations", role: "OPERATIONS" });
  await auth.activate({ inviteToken: operationsInvite.token, password: "staff-creation-ops-password", totpSecret: operationsSecret });

  const server = createAdminServer({
    repository,
    auth,
    actions: new AdminActionEngine(repository),
    allowedOrigins: [],
    environment: "development",
    secureCookies: false,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await repository.close();
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const request = async (path: string, init: RequestInit = {}, cookieJar = ""): Promise<HttpResult> => {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (cookieJar) headers.set("cookie", cookieJar);
    return readResult(await fetch(`${baseUrl}${path}`, { ...init, headers }));
  };
  const body = (value: Record<string, unknown>) => JSON.stringify(value);
  const login = async (email: string, password: string, secret: string, deviceId: string, mfaRequired = true) => {
    const challenge = await request("/api/v1/admin/auth/login", { method: "POST", headers: { "x-device-id": deviceId }, body: body({ email, password }) });
    if (!mfaRequired) {
      assert.equal(challenge.status, 200);
      assert.equal(challenge.body?.mfaRequired, false);
      return { cookies: mergeCookies("", challenge.response), csrf: String(challenge.body?.csrfToken) };
    }
    assert.equal(challenge.status, 202);
    assert.equal(challenge.body?.mfaRequired, true);
    const verified = await request("/api/v1/admin/auth/mfa/verify", {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: body({ challengeId: String(challenge.body?.challengeId), code: generateTotp(secret, clockValue) }),
    });
    assert.equal(verified.status, 200);
    return { cookies: mergeCookies("", verified.response), csrf: String(verified.body?.csrfToken) };
  };

  const admin = await login("staff-creation-admin@example.test", "staff-creation-admin-password", adminSecret, "staff-create-admin-device");
  const operations = await login("staff-creation-ops@example.test", "staff-creation-ops-password", operationsSecret, "staff-create-ops-device", false);
  const setupPath = "/api/v1/admin/staff/operations-accounts/mfa-setup";
  const createPath = "/api/v1/admin/staff/operations-accounts";

  const deniedSetup = await request(setupPath, {
    method: "POST",
    headers: { "x-csrf-token": operations.csrf },
    body: body({ email: "new-operations@example.test" }),
  }, operations.cookies);
  assert.equal(deniedSetup.status, 409);
  assert.equal(deniedSetup.body?.code, "ADMIN_PERMISSION_DENIED");

  const setup = await request(setupPath, {
    method: "POST",
    headers: { "x-csrf-token": admin.csrf },
    body: body({ email: "new-operations@example.test" }),
  }, admin.cookies);
  assert.equal(setup.status, 200);
  const setupData = setup.body?.mfaSetup as { manualSetupKey: string; otpauthUri: string };
  assert.match(setupData.manualSetupKey, /^[A-Z2-7]{32}$/);
  assert.match(setupData.otpauthUri, /new-operations%40example\.test/i);

  const mfaCode = generateTotp(setupData.manualSetupKey, clockValue);
  const accountBody = {
    email: "new-operations@example.test",
    employeeCode: "NEW-OPS-01",
    displayName: "New Operations Staff",
    password: "new-operations-password-2026",
    mfaSecret: setupData.manualSetupKey,
    mfaCode,
  };
  const key = "direct-staff-create-001";
  const createRequest = (payload: Record<string, unknown>) => request(createPath, {
    method: "POST",
    headers: { "x-csrf-token": admin.csrf, "Idempotency-Key": key },
    body: body(payload),
  }, admin.cookies);

  const wrongCode = mfaCode === "000000" ? "000001" : "000000";
  const invalidSetup = await createRequest({ ...accountBody, mfaCode: wrongCode });
  assert.equal(invalidSetup.status, 422);
  assert.equal(await repository.findStaffByEmail(accountBody.email), null);

  const created = await createRequest(accountBody);
  assert.equal(created.status, 201);
  assert.equal(created.body?.replayed, false);
  const createdStaff = created.body?.staff as { id: string; status: string; roles: Array<{ role: string }>; mfaEnrolled: boolean };
  assert.equal(createdStaff.status, "ACTIVE");
  assert.deepEqual(createdStaff.roles.map((role) => role.role), ["OPERATIONS"]);
  assert.equal(createdStaff.mfaEnrolled, true);

  const replay = await createRequest(accountBody);
  assert.equal(replay.status, 200);
  assert.equal(replay.body?.replayed, true);
  assert.equal((replay.body?.staff as { id: string }).id, createdStaff.id);
  const changedReplay = await createRequest({ ...accountBody, displayName: "Changed Identity" });
  assert.equal(changedReplay.status, 409);
  assert.equal(changedReplay.body?.code, "IDEMPOTENCY_CONFLICT");

  const stored = await repository.findStaffByEmail(accountBody.email);
  assert.equal(stored?.status, "ACTIVE");
  assert.equal(stored?.roles.length, 1);
  assert.equal(stored?.roles[0]?.role, "OPERATIONS");
  assert.equal(stored?.passwordDigest === accountBody.password, false);
  const audit = (await repository.listAudit()).find((event) => event.action === "STAFF_OPERATIONS_ACCOUNT_CREATED");
  assert.ok(audit);
  assert.equal(audit.actorStaffId, (await repository.findStaffByEmail("staff-creation-admin@example.test"))?.id);
  assert.doesNotMatch(JSON.stringify(audit.metadata), new RegExp(`${setupData.manualSetupKey}|${accountBody.password}|${mfaCode}`));

  const newLogin = await request("/api/v1/admin/auth/login", { method: "POST", headers: { "x-device-id": "new-operations-device" }, body: body({ email: accountBody.email, password: accountBody.password }) });
  assert.equal(newLogin.status, 200);
  assert.equal(newLogin.body?.mfaRequired, false);
  assert.equal(newLogin.body?.challengeId, undefined);
  const signedIn = await request("/api/v1/admin/me", {}, mergeCookies("", newLogin.response));
  assert.equal(signedIn.status, 200);
  const signedInStaff = signedIn.body?.staff as { roles: Array<{ role: string }> };
  assert.deepEqual(signedInStaff.roles.map((role) => role.role), ["OPERATIONS"]);
});
