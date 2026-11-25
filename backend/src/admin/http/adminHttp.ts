import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";

import { DomainError, invalidRequest, notFound, unauthorized } from "../../errors.js";
import { requireFreshStepUp, requirePermission, requireStaffSession } from "../authorization/authorization.js";
import { ADMIN_ROUTES, type AdminRouteDefinition } from "../authorization/permissionRegistry.js";
import { StaffAuthService } from "../auth/staffAuthService.js";
import { AdminActionEngine } from "../actions/actionEngine.js";
import type { AdminCaseScope, AdminRepository } from "../repositories/adminRepository.js";
import type { RuntimeMetadata } from "../../runtimeMetadata.js";
import { createRequestContext, normalizeRequestId, requestContextHeaders, type RequestContext } from "../../observability/requestContext.js";
import { createStructuredLogger, type StructuredLogger } from "../../observability/logger.js";
import { PrometheusRegistry, registerHttpMetrics } from "../../observability/metrics.js";

const API_PREFIX = "/api/v1";
const MAX_BODY_BYTES = 500_000;
const ACCESS_COOKIE = "__Host-admin_access";
const REFRESH_COOKIE = "__Host-admin_refresh";
const DEV_ACCESS_COOKIE = "admin_access";
const DEV_REFRESH_COOKIE = "admin_refresh";
const CSRF_COOKIE = "admin_csrf";

export type AdminHttpOptions = {
  repository: AdminRepository;
  auth: StaffAuthService;
  actions: AdminActionEngine;
  allowedOrigins?: string[];
  environment?: string;
  commitSha?: string;
  runtimeMetadata?: RuntimeMetadata;
  startupReady?: boolean;
  secureCookies?: boolean;
  metrics?: PrometheusRegistry;
  logger?: StructuredLogger;
  serviceName?: string;
  instrumented?: boolean;
};

function header(request: IncomingMessage, name: string): string | undefined { const value = request.headers[name.toLowerCase()]; return Array.isArray(value) ? value[0] : value; }
function requestId(request: IncomingMessage): string { return normalizeRequestId(header(request, "x-request-id"), "admin"); }
function metricRoute(request: IncomingMessage): string {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (["/livez", "/startupz", "/readyz", "/versionz", "/metrics"].includes(pathname)) return pathname;
  const parts = pathname.split("/").filter(Boolean).slice(0, 6).map((part) => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(part) || /^\d{8,}$/.test(part) || part.length > 48 ? ":id" : part);
  return `/${parts.join("/")}`.slice(0, 64) || "/";
}
function outcomeForStatus(status: number): string { return status >= 500 ? "platform_failure" : status === 401 || status === 403 || status === 429 ? "security_rejection" : status >= 400 ? "domain_rejection" : "success"; }
function instrumentResponse(request: IncomingMessage, response: ServerResponse, options: AdminHttpOptions, context: RequestContext): void {
  const registry = options.metrics;
  if (!registry || typeof (response as unknown as { once?: unknown }).once !== "function") return;
  const startedAt = performance.now();
  const method = (request.method ?? "GET").toUpperCase();
  const route = metricRoute(request);
  registry.add("http_requests_active", 1, { service: options.serviceName ?? "banking-admin-api" });
  let completed = false;
  const complete = (): void => {
    if (completed) return;
    completed = true;
    const status = response.statusCode || 500;
    registry.increment("http_requests_total", 1, { method, route, status_class: `${Math.floor(status / 100)}xx`, outcome: outcomeForStatus(status) });
    registry.observe("http_request_duration_seconds", (performance.now() - startedAt) / 1000, { method, route });
    registry.add("http_requests_active", -1, { service: options.serviceName ?? "banking-admin-api" });
    options.logger?.log(status >= 400 ? "info" : "info", "http_request_completed", { requestId: context.requestId, traceId: context.traceId, spanId: context.spanId, method, route, statusClass: `${Math.floor(status / 100)}xx`, outcome: outcomeForStatus(status), durationMs: Math.round((performance.now() - startedAt) * 100) / 100 });
  };
  response.once("finish", complete);
  response.once("close", complete);
}
function parseCookies(request: IncomingMessage): Record<string, string> { const raw = header(request, "cookie") ?? ""; return Object.fromEntries(raw.split(";").map((part) => part.trim().split("=")).filter(([key, value]) => key && value).map(([key, value]) => [key, decodeURIComponent(value)])); }
function cookie(name: string, value: string, options: { httpOnly?: boolean; maxAge?: number; secure?: boolean } = {}): string { return `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Strict${options.httpOnly ? "; HttpOnly" : ""}${options.secure ? "; Secure" : ""}${options.maxAge === undefined ? "" : `; Max-Age=${options.maxAge}`}`; }
function write(response: ServerResponse, status: number, traceId: string, body?: unknown, headers: Record<string, string> = {}): void { response.statusCode = status; response.setHeader("Content-Type", "application/json; charset=utf-8"); response.setHeader("Cache-Control", "no-store"); response.setHeader("X-Request-ID", traceId); response.setHeader("X-Content-Type-Options", "nosniff"); response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"); response.setHeader("Referrer-Policy", "no-referrer"); for (const [key, value] of Object.entries(headers)) response.setHeader(key, value); if (body === undefined) response.end(); else response.end(JSON.stringify(body)); }
function writeError(response: ServerResponse, traceId: string, error: unknown): void {
  const domain = error instanceof DomainError ? error : new DomainError(500, "INTERNAL_ERROR", "Unexpected server error.");
  let code = domain.code;
  if (domain.status === 401 && domain.code === "UNAUTHORIZED") {
    if (/mfa|totp|challenge/i.test(domain.message)) code = "STAFF_MFA_REQUIRED";
    else if (/expired|invalidated/i.test(domain.message)) code = "STAFF_SESSION_EXPIRED";
    else code = "STAFF_AUTH_REQUIRED";
  }
  write(response, domain.status, traceId, { code, message: domain.message, fieldErrors: domain.fieldErrors, traceId });
}
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> { if (request.method === "GET" || request.method === "HEAD") return {}; const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length; if (size > MAX_BODY_BYTES) throw invalidRequest("Request body is too large."); chunks.push(buffer); } if (size === 0) return {}; let value: unknown; try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw invalidRequest("Request body must be valid JSON."); } if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRequest("Request body must be a JSON object."); return value as Record<string, unknown>; }
function pathMatches(pattern: string, pathname: string): boolean { const left = pattern.split("/"); const right = pathname.split("/"); return left.length === right.length && left.every((part, index) => part.startsWith("{") || part === right[index]); }
function routeFor(method: string, pathname: string): AdminRouteDefinition | null { return ADMIN_ROUTES.find((route) => route.method === method && pathMatches(route.path, pathname)) ?? null; }
function pathParam(pattern: string, pathname: string, name: string): string | null { const left = pattern.split("/"); const right = pathname.split("/"); const index = left.findIndex((part) => part === `{${name}}`); return index >= 0 ? right[index] ?? null : null; }
function requireId(value: string | null, name: string): string { if (!value) throw invalidRequest(`${name} is required.`); return value; }
function requireCommandIdempotency(request: IncomingMessage): string { const value = header(request, "idempotency-key")?.trim() ?? ""; if (value.length < 8 || value.length > 128) throw invalidRequest("Idempotency-Key is required for Admin commands."); return value; }
function requireBodyFields(body: Record<string, unknown>, allowed: readonly string[]): void { const unknown = Object.keys(body).filter((key) => !allowed.includes(key)); if (unknown.length > 0) throw invalidRequest("Request contains unsupported fields.", { [unknown[0]]: "This field is not accepted for this Admin route." }); }
async function auditRead(options: AdminHttpOptions, actorStaffId: string, action: string, targetType: string, targetId: string | null, traceId: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await options.repository.appendAudit({ id: crypto.randomUUID(), actorStaffId, action, targetType, targetId, outcome: "SUCCEEDED", reasonCode: "ADMIN_READ", requestId: null, traceId, correlationId: null, beforeVersion: null, afterVersion: null, metadata });
}
function caseScope(subject: { staffId: string; roles: readonly { role: string; environmentScope?: string; expiresAt?: string | null }[] }, environmentScope = "preview"): AdminCaseScope {
  const activeRoles = subject.roles.filter((assignment) => (assignment.environmentScope ?? environmentScope) === environmentScope && (!assignment.expiresAt || Date.parse(assignment.expiresAt) > Date.now()));
  const scope = activeRoles.some((assignment) => assignment.role === "ADMIN") ? "ADMIN" : activeRoles[0]?.role ?? "OPERATIONS";
  return { staffId: subject.staffId, scope, canSeeAll: scope === "ADMIN" };
}

function setAuthCookies(response: ServerResponse, tokens: { accessToken: string; refreshToken: string; csrfToken: string; expiresInSeconds: number }, secure: boolean): void {
  const accessName = secure ? ACCESS_COOKIE : DEV_ACCESS_COOKIE;
  const refreshName = secure ? REFRESH_COOKIE : DEV_REFRESH_COOKIE;
  response.setHeader("Set-Cookie", [cookie(accessName, tokens.accessToken, { httpOnly: true, maxAge: tokens.expiresInSeconds, secure }), cookie(refreshName, tokens.refreshToken, { httpOnly: true, maxAge: 8 * 60 * 60, secure }), cookie(CSRF_COOKIE, tokens.csrfToken, { maxAge: tokens.expiresInSeconds, secure })]);
}

export async function handleAdminRequest(request: IncomingMessage, response: ServerResponse, options: AdminHttpOptions, requestContext?: RequestContext): Promise<void> {
  const context = requestContext ?? createRequestContext(request, "admin");
  const traceId = context.requestId;
  for (const [name, value] of Object.entries(requestContextHeaders(context))) response.setHeader(name, value);
  if (!options.instrumented) instrumentResponse(request, response, options, context);
  const origin = header(request, "origin");
  if (origin && options.allowedOrigins?.length && !options.allowedOrigins.includes(origin)) { writeError(response, traceId, new DomainError(403, "CORS_ORIGIN_DENIED", "Admin origin is not allowed.")); return; }
  const fetchSite = header(request, "sec-fetch-site");
  if (fetchSite === "cross-site" && origin && !options.allowedOrigins?.includes(origin)) { writeError(response, traceId, new DomainError(403, "CORS_ORIGIN_DENIED", "Cross-site Admin request is not allowed.")); return; }
  if (origin && options.allowedOrigins?.includes(origin)) { response.setHeader("Access-Control-Allow-Origin", origin); response.setHeader("Access-Control-Allow-Credentials", "true"); response.setHeader("Vary", "Origin"); }
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "OPTIONS") { write(response, 204, traceId, undefined, { "Access-Control-Allow-Origin": origin ?? "null", "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token, X-Request-ID, Idempotency-Key, traceparent, tracestate", "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS" }); return; }
  const metadata = options.runtimeMetadata ?? {
    service: "banking-admin-api",
    releaseId: process.env.RELEASE_ID?.trim() || "local",
    commitSha: (options.commitSha ?? process.env.BUILD_COMMIT_SHA?.trim()) || "local",
    imageDigest: process.env.IMAGE_DIGEST?.trim() || "unknown",
    environment: options.environment ?? "development",
    moneyMode: process.env.BANKING_MONEY_MODE?.trim() || "virtual",
    schemaVersion: process.env.SCHEMA_VERSION?.trim() || "unknown",
    migrationSetDigest: process.env.MIGRATION_SET_DIGEST?.trim() || "unknown",
    apiContractDigest: process.env.API_CONTRACT_DIGEST?.trim() || "unknown",
    builtAt: process.env.BUILD_CREATED_AT?.trim() || null,
    startedAt: new Date().toISOString(),
  } satisfies RuntimeMetadata;
  if (url.pathname === "/livez") { write(response, 200, traceId, { ...metadata, status: "ok" }); return; }
  if (url.pathname === "/startupz") { const ready = options.startupReady !== false; write(response, ready ? 200 : 503, traceId, { ...metadata, status: ready ? "ok" : "starting" }); return; }
  if (url.pathname === "/versionz") { write(response, 200, traceId, metadata); return; }
  if (url.pathname === "/metrics" && options.metrics) { response.statusCode = 200; response.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8"); response.end(options.metrics.prometheus()); return; }
  if (url.pathname === "/readyz") {
    try {
      await options.repository.initialize();
      write(response, 200, traceId, {
        service: "banking-admin-api",
        status: "ready",
      });
    } catch {
      writeError(response, traceId, new DomainError(503, "PERSISTENCE_UNAVAILABLE", "Admin persistence is unavailable."));
    }
    return;
  }
  if (!url.pathname.startsWith(`${API_PREFIX}/admin`)) { writeError(response, traceId, notFound("Admin API route not found.")); return; }
  const pathname = url.pathname.slice(API_PREFIX.length);
  const route = routeFor(request.method ?? "GET", pathname);
  if (!route) { writeError(response, traceId, notFound("Admin API route not found.")); return; }
  const authorizationScope = ["staging", "production-like", "production"].includes(options.environment ?? "") ? "production" : "preview";
  let authContext: Awaited<ReturnType<StaffAuthService["authenticate"]>> | null = null;
  try {
    const body = await readJson(request);
    const cookies = parseCookies(request);
    const accessToken = cookies[ACCESS_COOKIE] ?? cookies[DEV_ACCESS_COOKIE];
    const isAuthRoute = pathname.startsWith("/admin/auth/");
    if (!isAuthRoute || pathname === "/admin/auth/step-up" || pathname === "/admin/auth/logout") {
      if (!accessToken) throw unauthorized("Staff session is required.");
      authContext = await options.auth.authenticate(accessToken);
    }
    if (route.permission && authContext) {
      requirePermission(authContext.subject, route.permission, authorizationScope);
    }
    if (route.stateChanging && !pathname.startsWith("/admin/auth/login") && !pathname.startsWith("/admin/auth/mfa/verify") && !pathname.startsWith("/admin/auth/activate") && !pathname.startsWith("/admin/auth/refresh")) {
      if (!accessToken) throw unauthorized("Staff session is required.");
      await options.auth.verifyCsrf(accessToken, header(request, "x-csrf-token") ?? "");
    }

    if (request.method === "POST" && pathname === "/admin/auth/login") {
      requireBodyFields(body, ["email", "password"]);
      const result = await options.auth.beginLogin(String(body.email ?? ""), String(body.password ?? ""), header(request, "x-device-id"), header(request, "x-forwarded-for"));
      if (result.mfaRequired) { write(response, 202, traceId, result); return; }
      setAuthCookies(response, result.tokens, options.secureCookies ?? false);
      const permissionSubject = { staffId: result.staff.id, status: result.staff.status, authorizationVersion: result.staff.authorizationVersion, roles: result.staff.roles, mfaVerifiedAt: null, stepUpVerifiedAt: null };
      const permissions = [...(await import("../authorization/permissionRegistry.js")).resolvePermissions(permissionSubject, authorizationScope)];
      write(response, 200, traceId, { mfaRequired: false, staff: { id: result.staff.id, employeeCode: result.staff.employeeCode, displayName: result.staff.displayName, email: result.staff.emailNormalized, status: result.staff.status, roles: result.staff.roles }, permissions, csrfToken: result.tokens.csrfToken, expiresInSeconds: result.tokens.expiresInSeconds });
      return;
    }
    if (request.method === "POST" && pathname === "/admin/auth/mfa/verify") { requireBodyFields(body, ["challengeId", "code"]); const result = await options.auth.verifyLoginMfa(String(body.challengeId ?? ""), String(body.code ?? ""), header(request, "x-device-id"), header(request, "x-forwarded-for")); setAuthCookies(response, result.tokens, options.secureCookies ?? false); write(response, 200, traceId, { staff: { id: result.staff.id, employeeCode: result.staff.employeeCode, displayName: result.staff.displayName, email: result.staff.emailNormalized, roles: result.staff.roles }, csrfToken: result.tokens.csrfToken, expiresInSeconds: result.tokens.expiresInSeconds }); return; }
    if (request.method === "POST" && pathname === "/admin/auth/activate") { requireBodyFields(body, ["inviteToken", "password", "totpSecret"]); const result = await options.auth.activate({ inviteToken: String(body.inviteToken ?? ""), password: String(body.password ?? ""), totpSecret: typeof body.totpSecret === "string" ? body.totpSecret : undefined }); write(response, 200, traceId, result); return; }
    if (request.method === "POST" && pathname === "/admin/auth/step-up") { requireBodyFields(body, ["code"]); await options.auth.stepUp(accessToken!, String(body.code ?? "")); write(response, 204, traceId); return; }
    if (request.method === "POST" && pathname === "/admin/auth/refresh") { requireBodyFields(body, []); const result = await options.auth.refresh(cookies[REFRESH_COOKIE] ?? cookies[DEV_REFRESH_COOKIE] ?? ""); setAuthCookies(response, result, options.secureCookies ?? false); write(response, 200, traceId, { csrfToken: result.csrfToken, expiresInSeconds: result.expiresInSeconds }); return; }
    if (request.method === "POST" && pathname === "/admin/auth/logout") { requireCommandIdempotency(request); requireBodyFields(body, []); await options.auth.logout(accessToken!); const secure = options.secureCookies ?? false; response.setHeader("Set-Cookie", [cookie(secure ? ACCESS_COOKIE : DEV_ACCESS_COOKIE, "", { httpOnly: true, maxAge: 0, secure }), cookie(secure ? REFRESH_COOKIE : DEV_REFRESH_COOKIE, "", { httpOnly: true, maxAge: 0, secure }), cookie(CSRF_COOKIE, "", { maxAge: 0, secure })]); write(response, 204, traceId); return; }
    if (request.method === "GET" && pathname === "/admin/me") { const context = requireStaffSession(authContext?.subject); write(response, 200, traceId, { staff: { id: authContext!.staff.id, employeeCode: authContext!.staff.employeeCode, email: authContext!.staff.emailNormalized, displayName: authContext!.staff.displayName, status: context.status, roles: context.roles }, permissions: [...(await import("../authorization/permissionRegistry.js")).resolvePermissions(context, authorizationScope)] }); return; }
    if (request.method === "GET" && pathname === "/admin/me/sessions") { write(response, 200, traceId, { items: (await options.auth.listSessions(accessToken!)).map((session) => ({ id: session.id, createdAt: session.lastSeenAt, idleExpiresAt: session.idleExpiresAt, absoluteExpiresAt: session.absoluteExpiresAt, revoked: Boolean(session.revokedAt) })) }); return; }
    if (request.method === "DELETE" && pathname.startsWith("/admin/me/sessions/")) { requireCommandIdempotency(request); const sessionId = requireId(pathParam(route.path, pathname, "sessionId"), "sessionId"); const ownSessions = await options.auth.listSessions(accessToken!); if (!ownSessions.some((session) => session.id === sessionId)) throw notFound("Staff session not found."); await options.repository.revokeSession(sessionId, "self-revoke"); write(response, 204, traceId); return; }
    if (request.method === "GET" && pathname === "/admin/roles") { write(response, 200, traceId, { items: await options.repository.listRoles() }); return; }
    if (request.method === "GET" && pathname === "/admin/permissions") { write(response, 200, traceId, { items: await options.repository.listPermissions() }); return; }
    if (request.method === "GET" && pathname === "/admin/staff") { const items = (await options.repository.listStaff()).map((staff) => ({ id: staff.id, employeeCode: staff.employeeCode, email: staff.emailNormalized, displayName: staff.displayName, status: staff.status, roles: staff.roles, mfaEnrolled: Boolean(staff.mfaEnrolledAt), createdAt: staff.createdAt })); await auditRead(options, authContext!.staff.id, "STAFF_LIST_READ", "STAFF", null, traceId, { resultCount: items.length }); write(response, 200, traceId, { items }); return; }
    if (request.method === "GET" && pathname.startsWith("/admin/staff/") && !pathname.includes("/role-change") && !pathname.includes("/disable")) { const staffId = requireId(pathParam(route.path, pathname, "staffId"), "staffId"); const staff = await options.repository.findStaffById(staffId); if (!staff) throw notFound("Staff not found."); await auditRead(options, authContext!.staff.id, "STAFF_DETAIL_READ", "STAFF", staffId, traceId); write(response, 200, traceId, { staff: { id: staff.id, employeeCode: staff.employeeCode, email: staff.emailNormalized, displayName: staff.displayName, status: staff.status, roles: staff.roles, mfaEnrolled: Boolean(staff.mfaEnrolledAt), createdAt: staff.createdAt } }); return; }
    if (request.method === "POST" && pathname === "/admin/staff/operations-accounts/mfa-setup") { requireBodyFields(body, ["email"]); const result = options.auth.beginOperationsMfaSetup(String(body.email ?? "")); write(response, 200, traceId, result); return; }
    if (request.method === "POST" && pathname === "/admin/staff/operations-accounts") {
      const commandKey = requireCommandIdempotency(request);
      requireBodyFields(body, ["email", "employeeCode", "displayName", "password", "mfaSecret", "mfaCode"]);
      const result = await options.auth.createOperationsAccount({
        email: String(body.email ?? ""),
        employeeCode: String(body.employeeCode ?? ""),
        displayName: String(body.displayName ?? ""),
        password: String(body.password ?? ""),
        mfaSecret: String(body.mfaSecret ?? ""),
        mfaCode: String(body.mfaCode ?? ""),
        creatorStaffId: authContext!.staff.id,
        environmentScope: authorizationScope,
        idempotencyKey: commandKey,
        traceId,
      });
      const staff = result.staff;
      write(response, result.replayed ? 200 : 201, traceId, {
        replayed: result.replayed,
        staff: { id: staff.id, employeeCode: staff.employeeCode, email: staff.emailNormalized, displayName: staff.displayName, status: staff.status, roles: staff.roles, mfaEnrolled: Boolean(staff.mfaEnrolledAt), createdAt: staff.createdAt },
      });
      return;
    }
    if (request.method === "GET" && pathname === "/admin/customers") { const items = await options.repository.findCustomers(url.searchParams.get("q") ?? ""); await options.repository.appendAudit({ id: crypto.randomUUID(), actorStaffId: authContext!.staff.id, action: "CUSTOMER_SEARCH_READ", targetType: "CUSTOMER", targetId: null, outcome: "SUCCEEDED", reasonCode: "MASKED_READ", requestId: null, traceId, correlationId: null, beforeVersion: null, afterVersion: null, metadata: { resultCount: items.length } }); write(response, 200, traceId, { items }); return; }
    if (request.method === "GET" && pathname.startsWith("/admin/customers/") && pathname.endsWith("/accounts")) { const customerId = requireId(pathParam(route.path, pathname, "customerId"), "customerId"); const items = await options.repository.listCustomerAccounts(customerId); await options.repository.appendAudit({ id: crypto.randomUUID(), actorStaffId: authContext!.staff.id, action: "CUSTOMER_ACCOUNTS_READ", targetType: "CUSTOMER", targetId: customerId, outcome: "SUCCEEDED", reasonCode: "ACCOUNT_READ", requestId: null, traceId, correlationId: null, beforeVersion: null, afterVersion: null, metadata: { resultCount: items.length } }); write(response, 200, traceId, { items }); return; }
    if (request.method === "GET" && pathname.startsWith("/admin/customers/")) { const customerId = requireId(pathParam(route.path, pathname, "customerId"), "customerId"); const customer = await options.repository.findCustomer(customerId); if (!customer) throw notFound("Customer not found."); await options.repository.appendAudit({ id: crypto.randomUUID(), actorStaffId: authContext!.staff.id, action: "CUSTOMER_READ_MASKED", targetType: "CUSTOMER", targetId: customerId, outcome: "SUCCEEDED", reasonCode: "MASKED_READ", requestId: null, traceId, correlationId: null, beforeVersion: null, afterVersion: null, metadata: {} }); write(response, 200, traceId, { customer }); return; }
    if (request.method === "GET" && pathname.startsWith("/admin/accounts/") && pathname.endsWith("/transactions")) { const accountId = requireId(pathParam(route.path, pathname, "accountId"), "accountId"); const items = await options.repository.listAccountTransactions(accountId, Number(url.searchParams.get("limit") ?? 100)); await options.repository.appendAudit({ id: crypto.randomUUID(), actorStaffId: authContext!.staff.id, action: "ACCOUNT_TRANSACTIONS_READ", targetType: "ACCOUNT", targetId: accountId, outcome: "SUCCEEDED", reasonCode: "TRANSACTION_READ", requestId: null, traceId, correlationId: null, beforeVersion: null, afterVersion: null, metadata: { resultCount: items.length } }); write(response, 200, traceId, { items }); return; }
    if (request.method === "GET" && pathname.startsWith("/admin/accounts/")) { const accountId = requireId(pathParam(route.path, pathname, "accountId"), "accountId"); const account = await options.repository.findAccount(accountId); if (!account) throw notFound("Account not found."); await options.repository.appendAudit({ id: crypto.randomUUID(), actorStaffId: authContext!.staff.id, action: "ACCOUNT_READ", targetType: "ACCOUNT", targetId: accountId, outcome: "SUCCEEDED", reasonCode: "ACCOUNT_READ", requestId: null, traceId, correlationId: null, beforeVersion: null, afterVersion: null, metadata: {} }); write(response, 200, traceId, { account }); return; }
    if (request.method === "POST" && pathname.includes("/access-lock-requests")) { const customerId = requireId(pathParam(route.path, pathname, "customerId"), "customerId"); const action = await options.actions.create({ subject: authContext!.subject, actionType: "CUSTOMER_ACCESS_LOCK", targetType: "CUSTOMER", targetId: customerId, body, idempotencyKey: header(request, "idempotency-key") ?? "", traceId }); write(response, 202, traceId, { action }); return; }
    if (request.method === "POST" && pathname.includes("/access-unlock-requests")) { const customerId = requireId(pathParam(route.path, pathname, "customerId"), "customerId"); const action = await options.actions.create({ subject: authContext!.subject, actionType: "CUSTOMER_ACCESS_UNLOCK", targetType: "CUSTOMER", targetId: customerId, body, idempotencyKey: header(request, "idempotency-key") ?? "", traceId }); write(response, 202, traceId, { action }); return; }
    if (request.method === "POST" && pathname.includes("/block-requests")) { const accountId = requireId(pathParam(route.path, pathname, "accountId"), "accountId"); const action = await options.actions.create({ subject: authContext!.subject, actionType: "ACCOUNT_BLOCK", targetType: "ACCOUNT", targetId: accountId, body, idempotencyKey: header(request, "idempotency-key") ?? "", traceId }); write(response, 202, traceId, { action }); return; }
    if (request.method === "POST" && pathname.includes("/unblock-requests")) { const accountId = requireId(pathParam(route.path, pathname, "accountId"), "accountId"); const action = await options.actions.create({ subject: authContext!.subject, actionType: "ACCOUNT_UNBLOCK", targetType: "ACCOUNT", targetId: accountId, body, idempotencyKey: header(request, "idempotency-key") ?? "", traceId }); write(response, 202, traceId, { action }); return; }
    if (request.method === "POST" && pathname.endsWith("/funding-requests")) { const accountId = requireId(pathParam(route.path, pathname, "accountId"), "accountId"); const action = await options.actions.create({ subject: authContext!.subject, actionType: "SIMULATION_FUNDING", targetType: "ACCOUNT", targetId: accountId, body, idempotencyKey: header(request, "idempotency-key") ?? "", traceId }); write(response, 202, traceId, { action }); return; }
    if (request.method === "POST" && pathname.endsWith("/funding-reversal-requests")) { const accountId = requireId(pathParam(route.path, pathname, "accountId"), "accountId"); const action = await options.actions.create({ subject: authContext!.subject, actionType: "SIMULATION_FUNDING_REVERSAL", targetType: "ACCOUNT", targetId: accountId, body, idempotencyKey: header(request, "idempotency-key") ?? "", traceId }); write(response, 202, traceId, { action }); return; }
    if (request.method === "GET" && pathname === "/admin/approvals") { const items = await options.repository.listActions("PENDING_APPROVAL", caseScope(authContext!.subject, authorizationScope)); await auditRead(options, authContext!.staff.id, "ADMIN_APPROVAL_QUEUE_READ", "ADMIN_ACTION", null, traceId, { resultCount: items.length }); write(response, 200, traceId, { items }); return; }
    if (request.method === "GET" && pathname.startsWith("/admin/approvals/")) { const requestId = requireId(pathParam(route.path, pathname, "requestId"), "requestId"); const action = await options.repository.findAction(requestId); if (!action) throw notFound("Admin action not found."); await auditRead(options, authContext!.staff.id, "ADMIN_APPROVAL_READ", "ADMIN_ACTION", requestId, traceId); write(response, 200, traceId, { action }); return; }
    if (request.method === "POST" && pathname.endsWith("/approve")) { requireCommandIdempotency(request); requireBodyFields(body, ["fingerprint", "version", "reasonCode", "decision", "comment"]); const action = await options.actions.approve({ subject: authContext!.subject, requestId: requireId(pathParam(route.path, pathname, "requestId"), "requestId"), body, traceId }); write(response, 200, traceId, { action, receipt: { actionId: action.id, resourceId: action.resultResourceId, status: action.status } }); return; }
    if (request.method === "POST" && pathname.endsWith("/reject")) { requireCommandIdempotency(request); requireBodyFields(body, ["fingerprint", "version", "reasonCode", "comment"]); const action = await options.actions.reject({ subject: authContext!.subject, requestId: requireId(pathParam(route.path, pathname, "requestId"), "requestId"), body, traceId }); write(response, 200, traceId, { action }); return; }
    if (request.method === "POST" && pathname.endsWith("/cancel")) { requireCommandIdempotency(request); requireBodyFields(body, []); const action = await options.actions.cancel(authContext!.subject, requireId(pathParam(route.path, pathname, "requestId"), "requestId"), traceId); write(response, 200, traceId, { action }); return; }
    if (request.method === "GET" && pathname === "/admin/audit-events") {
      const limit = Number(url.searchParams.get("limit") ?? 100);
      const actorType = url.searchParams.get("actorType") || undefined;
      const items = await options.repository.listAudit(limit, actorType);
      await options.repository.appendAudit({ id: crypto.randomUUID(), actorStaffId: authContext!.staff.id, action: "AUDIT_READ", targetType: "AUDIT", targetId: null, outcome: "SUCCEEDED", reasonCode: "AUDIT_READ", requestId: null, traceId, correlationId: null, beforeVersion: null, afterVersion: null, metadata: { resultCount: items.length, actorType: actorType ?? "ALL" } });
      write(response, 200, traceId, { items });
      return;
    }
    if (request.method === "GET" && pathname.startsWith("/admin/operations/outbox/summary")) { const summary = await options.repository.outboxSummary(); await auditRead(options, authContext!.staff.id, "OUTBOX_SUMMARY_READ", "OUTBOX", null, traceId, summary); write(response, 200, traceId, { summary }); return; }
    if (request.method === "GET" && pathname === "/admin/applications") { const items = await options.repository.listApplications(undefined, caseScope(authContext!.subject, authorizationScope)); await auditRead(options, authContext!.staff.id, "APPLICATION_QUEUE_READ", "APPLICATION", null, traceId, { resultCount: items.length }); write(response, 200, traceId, { items }); return; }
    if (request.method === "GET" && pathname.startsWith("/admin/kyc-applications/") && !pathname.endsWith("/claim") && !pathname.endsWith("/review-recommendations")) { const applicationId = requireId(pathParam(route.path, pathname, "applicationId"), "applicationId"); const application = await options.repository.findApplication("KYC", applicationId, caseScope(authContext!.subject, authorizationScope)); if (!application) throw notFound("KYC application not found."); await auditRead(options, authContext!.staff.id, "KYC_APPLICATION_READ", "KYC_APPLICATION", applicationId, traceId); write(response, 200, traceId, { application }); return; }
    if (request.method === "POST" && pathname.endsWith("/kyc-applications/" + pathParam(route.path, pathname, "applicationId") + "/claim")) { requireCommandIdempotency(request); requireBodyFields(body, []); const applicationId = requireId(pathParam(route.path, pathname, "applicationId"), "applicationId"); const application = await options.repository.claimApplication("KYC", applicationId, authContext!.staff.id); await options.repository.appendAudit({ id: crypto.randomUUID(), actorStaffId: authContext!.staff.id, action: "KYC_CASE_CLAIMED", targetType: "KYC_APPLICATION", targetId: applicationId, outcome: "SUCCEEDED", reasonCode: "CASE_CLAIM", requestId: null, traceId, correlationId: null, beforeVersion: application.version - 1, afterVersion: application.version, metadata: {} }); write(response, 200, traceId, { application }); return; }
    if (request.method === "POST" && pathname.includes("/kyc-applications/") && pathname.endsWith("/review-recommendations")) { const applicationId = requireId(pathParam(route.path, pathname, "applicationId"), "applicationId"); const action = await options.actions.create({ subject: authContext!.subject, actionType: "KYC_DECISION", targetType: "KYC_APPLICATION", targetId: applicationId, body, idempotencyKey: header(request, "idempotency-key") ?? "", traceId }); write(response, 202, traceId, { action }); return; }
    if (request.method === "GET" && pathname.startsWith("/admin/credit-applications/") && !pathname.endsWith("/claim") && !pathname.endsWith("/review-recommendations")) { const applicationId = requireId(pathParam(route.path, pathname, "applicationId"), "applicationId"); const application = await options.repository.findApplication("CREDIT", applicationId, caseScope(authContext!.subject, authorizationScope)); if (!application) throw notFound("Credit application not found."); await auditRead(options, authContext!.staff.id, "CREDIT_APPLICATION_READ", "CREDIT_APPLICATION", applicationId, traceId); write(response, 200, traceId, { application }); return; }
    if (request.method === "POST" && pathname.includes("/credit-applications/") && pathname.endsWith("/claim")) { requireCommandIdempotency(request); requireBodyFields(body, []); const applicationId = requireId(pathParam(route.path, pathname, "applicationId"), "applicationId"); const application = await options.repository.claimApplication("CREDIT", applicationId, authContext!.staff.id); await options.repository.appendAudit({ id: crypto.randomUUID(), actorStaffId: authContext!.staff.id, action: "CREDIT_CASE_CLAIMED", targetType: "CREDIT_APPLICATION", targetId: applicationId, outcome: "SUCCEEDED", reasonCode: "CASE_CLAIM", requestId: null, traceId, correlationId: null, beforeVersion: application.version - 1, afterVersion: application.version, metadata: {} }); write(response, 200, traceId, { application }); return; }
    if (request.method === "POST" && pathname.includes("/credit-applications/") && pathname.endsWith("/review-recommendations")) { const applicationId = requireId(pathParam(route.path, pathname, "applicationId"), "applicationId"); const action = await options.actions.create({ subject: authContext!.subject, actionType: "CREDIT_DECISION", targetType: "CREDIT_APPLICATION", targetId: applicationId, body, idempotencyKey: header(request, "idempotency-key") ?? "", traceId }); write(response, 202, traceId, { action }); return; }
    if (request.method === "GET" && pathname === "/admin/transfers") { const items = await options.repository.listTransfers(url.searchParams.get("status") ?? undefined); await auditRead(options, authContext!.staff.id, "TRANSFER_QUEUE_READ", "TRANSFER", null, traceId, { resultCount: items.length }); write(response, 200, traceId, { items }); return; }
    if (request.method === "GET" && pathname.startsWith("/admin/transfers/") && pathname.endsWith("/timeline")) { const transferId = requireId(pathParam(route.path, pathname, "transferId"), "transferId"); const transfer = await options.repository.findTransfer(transferId); if (!transfer) throw notFound("Transfer not found."); const timeline = await options.repository.listTransferTimeline(transferId); await auditRead(options, authContext!.staff.id, "TRANSFER_TIMELINE_READ", "TRANSFER", transferId, traceId, { resultCount: timeline.length }); write(response, 200, traceId, { transfer, timeline }); return; }
    if (request.method === "GET" && pathname.startsWith("/admin/transfers/")) { const transferId = requireId(pathParam(route.path, pathname, "transferId"), "transferId"); const transfer = await options.repository.findTransfer(transferId); if (!transfer) throw notFound("Transfer not found."); await auditRead(options, authContext!.staff.id, "TRANSFER_DETAIL_READ", "TRANSFER", transferId, traceId); write(response, 200, traceId, { transfer }); return; }
    if (request.method === "POST" && pathname.includes("/transfers/") && pathname.endsWith("/retry-requests")) { const transferId = requireId(pathParam(route.path, pathname, "transferId"), "transferId"); const action = await options.actions.create({ subject: authContext!.subject, actionType: "TRANSFER_OPERATION", targetType: "TRANSFER", targetId: transferId, body: { ...body, operation: "RETRY" }, idempotencyKey: header(request, "idempotency-key") ?? "", traceId }); write(response, 202, traceId, { action }); return; }
    if (request.method === "POST" && pathname.includes("/transfers/") && pathname.endsWith("/cancel-requests")) { const transferId = requireId(pathParam(route.path, pathname, "transferId"), "transferId"); const action = await options.actions.create({ subject: authContext!.subject, actionType: "TRANSFER_OPERATION", targetType: "TRANSFER", targetId: transferId, body: { ...body, operation: "CANCEL" }, idempotencyKey: header(request, "idempotency-key") ?? "", traceId }); write(response, 202, traceId, { action }); return; }
    if (request.method === "POST" && pathname.includes("/transfers/") && pathname.endsWith("/reversal-requests")) { const transferId = requireId(pathParam(route.path, pathname, "transferId"), "transferId"); const action = await options.actions.create({ subject: authContext!.subject, actionType: "TRANSFER_OPERATION", targetType: "TRANSFER", targetId: transferId, body: { ...body, operation: "REVERSAL" }, idempotencyKey: header(request, "idempotency-key") ?? "", traceId }); write(response, 202, traceId, { action }); return; }
    if (request.method === "GET" && pathname === "/admin/anomalies") { const items = await options.repository.listAnomalies(url.searchParams.get("status") ?? undefined); await auditRead(options, authContext!.staff.id, "ANOMALY_QUEUE_READ", "TRANSACTION_ANOMALY", null, traceId, { resultCount: items.length }); write(response, 200, traceId, { items }); return; }
    if (request.method === "POST" && pathname.startsWith("/admin/anomalies/") && pathname.endsWith("/resolve")) { requireCommandIdempotency(request); requireBodyFields(body, ["reasonCode", "comment"]); const anomalyId = requireId(pathParam(route.path, pathname, "anomalyId"), "anomalyId"); const anomaly = await options.repository.resolveAnomaly({ id: anomalyId, staffId: authContext!.staff.id, reasonCode: String(body.reasonCode ?? ""), comment: typeof body.comment === "string" ? body.comment : null, traceId }); write(response, 200, traceId, { anomaly }); return; }
    if (request.method === "GET" && pathname === "/admin/operations/outbox/events") { const items = await options.repository.listOutboxEvents(url.searchParams.get("status") ?? undefined); await auditRead(options, authContext!.staff.id, "OUTBOX_EVENTS_READ", "OUTBOX", null, traceId, { resultCount: items.length }); write(response, 200, traceId, { items }); return; }
    if (request.method === "GET" && pathname.startsWith("/admin/operations/outbox/events/")) { const eventId = requireId(pathParam(route.path, pathname, "eventId"), "eventId"); const event = await options.repository.findOutboxEvent(eventId); if (!event) throw notFound("Outbox event not found."); await auditRead(options, authContext!.staff.id, "OUTBOX_EVENT_READ", "OUTBOX_EVENT", eventId, traceId); write(response, 200, traceId, { event }); return; }
    if (request.method === "GET" && pathname === "/admin/operations/outbox/dead-letters") { const items = await options.repository.listOutboxEvents("DEAD"); await auditRead(options, authContext!.staff.id, "OUTBOX_DEAD_LETTERS_READ", "OUTBOX", null, traceId, { resultCount: items.length }); write(response, 200, traceId, { items }); return; }
    if (request.method === "POST" && pathname.endsWith("/requeue-requests")) { const eventId = requireId(pathParam(route.path, pathname, "eventId"), "eventId"); const action = await options.actions.create({ subject: authContext!.subject, actionType: "OUTBOX_REQUEUE", targetType: "OUTBOX_EVENT", targetId: eventId, body, idempotencyKey: header(request, "idempotency-key") ?? "", traceId }); write(response, 202, traceId, { action }); return; }
    if (request.method === "GET" && pathname === "/admin/operations/jobs") { const items = await options.repository.listJobs(url.searchParams.get("status") ?? undefined); await auditRead(options, authContext!.staff.id, "JOBS_READ", "JOB", null, traceId, { resultCount: items.length }); write(response, 200, traceId, { items }); return; }
    if (request.method === "GET" && pathname.startsWith("/admin/operations/jobs/")) { const jobId = requireId(pathParam(route.path, pathname, "jobId"), "jobId"); const job = await options.repository.findJob(jobId); if (!job) throw notFound("Job not found."); await auditRead(options, authContext!.staff.id, "JOB_READ", "JOB", jobId, traceId); write(response, 200, traceId, { job }); return; }
    if (request.method === "POST" && pathname.endsWith("/retry-requests")) { const jobId = requireId(pathParam(route.path, pathname, "jobId"), "jobId"); const action = await options.actions.create({ subject: authContext!.subject, actionType: "JOB_RETRY", targetType: "JOB", targetId: jobId, body, idempotencyKey: header(request, "idempotency-key") ?? "", traceId }); write(response, 202, traceId, { action }); return; }
    if (request.method === "GET" && pathname.startsWith("/admin/audit-exports/")) { const exportId = requireId(pathParam(route.path, pathname, "exportId"), "exportId"); const items = await options.repository.listAudit(100); await options.repository.appendAudit({ id: crypto.randomUUID(), actorStaffId: authContext!.staff.id, action: "AUDIT_EXPORT_READ", targetType: "AUDIT_EXPORT", targetId: exportId, outcome: "SUCCEEDED", reasonCode: "AUDIT_EXPORT", requestId: null, traceId, correlationId: null, beforeVersion: null, afterVersion: null, metadata: { resultCount: items.length } }); write(response, 200, traceId, { status: "REFERENCE_EXPORT_PENDING", items }); return; }
    if (request.method === "GET" && pathname.startsWith("/admin/audit-events/")) { const events = await options.repository.listAudit(1000); const eventId = requireId(pathParam(route.path, pathname, "eventId"), "eventId"); const event = events.find((item) => item.id === eventId); if (!event) throw notFound("Audit event not found."); await options.repository.appendAudit({ id: crypto.randomUUID(), actorStaffId: authContext!.staff.id, action: "AUDIT_DETAIL_READ", targetType: "AUDIT_EVENT", targetId: eventId, outcome: "SUCCEEDED", reasonCode: "AUDIT_READ", requestId: null, traceId, correlationId: null, beforeVersion: null, afterVersion: null, metadata: {} }); write(response, 200, traceId, { event }); return; }
    if (request.method === "POST" && pathname === "/admin/audit-export-requests") { requireCommandIdempotency(request); requireBodyFields(body, ["reasonCode"]); const reasonCode = typeof body.reasonCode === "string" ? body.reasonCode : ""; if (!/^[A-Z0-9_-]{3,64}$/.test(reasonCode)) throw invalidRequest("A normalized reason code is required."); await options.repository.appendAudit({ id: crypto.randomUUID(), actorStaffId: authContext!.staff.id, action: "AUDIT_EXPORT_REQUESTED", targetType: "AUDIT", targetId: null, outcome: "PENDING", reasonCode, requestId: null, traceId, correlationId: null, beforeVersion: null, afterVersion: null, metadata: {} }); write(response, 202, traceId, { status: "REFERENCE_EXPORT_PENDING" }); return; }
    if (request.method === "GET" && pathname === "/admin/control-policy") {
      const policy = await options.repository.getControlPolicy();
      await auditRead(options, authContext!.staff.id, "CONTROL_POLICY_READ", "CONTROL_POLICY", "singleton", traceId);
      write(response, 200, traceId, { policy });
      return;
    }
    if (request.method === "PATCH" && pathname === "/admin/control-policy") {
      requireFreshStepUp(authContext!.subject);
      const policy = await options.repository.updateControlPolicy(body, authContext!.staff.id, traceId);
      write(response, 200, traceId, { policy });
      return;
    }
    if (request.method === "GET" && pathname === "/admin/operations/ledger-reconciliation") {
      const reconciliation = await options.repository.reconcileLedger();
      await auditRead(options, authContext!.staff.id, "LEDGER_RECONCILIATION_READ", "LEDGER", null, traceId, {
        status: reconciliation.status,
        unbalancedJournalCount: reconciliation.unbalancedJournalCount,
        discrepancyMinor: reconciliation.discrepancyMinor,
      });
      write(response, 200, traceId, { reconciliation });
      return;
    }
    if (request.method === "POST" && pathname.includes("/staff/") && pathname.endsWith("/role-change-requests")) { const staffId = requireId(pathParam(route.path, pathname, "staffId"), "staffId"); const action = await options.actions.create({ subject: authContext!.subject, actionType: "STAFF_ROLE_CHANGE", targetType: "STAFF", targetId: staffId, body, idempotencyKey: header(request, "idempotency-key") ?? "", traceId }); write(response, 202, traceId, { action }); return; }
    if (request.method === "POST" && pathname.includes("/staff/") && pathname.endsWith("/disable-requests")) { const staffId = requireId(pathParam(route.path, pathname, "staffId"), "staffId"); const action = await options.actions.create({ subject: authContext!.subject, actionType: "STAFF_DISABLE", targetType: "STAFF", targetId: staffId, body, idempotencyKey: header(request, "idempotency-key") ?? "", traceId }); write(response, 202, traceId, { action }); return; }
    throw notFound("Admin API route is not implemented for this reference dataset.");
  } catch (error: unknown) {
    if (authContext?.staff?.id && error instanceof DomainError && error.code === "ADMIN_PERMISSION_DENIED") {
      try {
        await options.repository.appendAudit({ id: crypto.randomUUID(), actorStaffId: authContext.staff.id, action: "ADMIN_PERMISSION_DENIED", targetType: "ADMIN_ROUTE", targetId: url.pathname, outcome: "DENIED", reasonCode: error.code, requestId: null, traceId, correlationId: null, beforeVersion: null, afterVersion: null, metadata: {} });
      } catch {
        // Never mask the authorization response if audit persistence is unavailable.
      }
    }
    writeError(response, traceId, error);
  }
}

export function createAdminServer(options: AdminHttpOptions): Server {
  const metrics = options.metrics ?? new PrometheusRegistry();
  registerHttpMetrics(metrics);
  const resolvedOptions: AdminHttpOptions = {
    ...options,
    metrics,
    logger: options.logger ?? createStructuredLogger({ service: options.serviceName ?? "banking-admin-api" }),
    serviceName: options.serviceName ?? "banking-admin-api",
    instrumented: true,
  };
  return createServer((request, response) => {
    const context = createRequestContext(request, "admin");
    for (const [name, value] of Object.entries(requestContextHeaders(context))) response.setHeader(name, value);
    instrumentResponse(request, response, resolvedOptions, context);
    void handleAdminRequest(request, response, resolvedOptions, context);
  });
}
