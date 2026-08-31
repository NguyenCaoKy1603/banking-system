/*
 * Local-only invitation inbox for the Admin Web rehearsal.
 *
 * This process intentionally keeps messages in memory. It is a deterministic
 * HTTP capture endpoint for local preview, not an email service and not a
 * staging/production delivery mechanism. It never writes invitation tokens to
 * stdout or a file; the token is rendered only when a developer opens the
 * local inbox in a browser.
 */
const http = require("node:http");
const { randomUUID } = require("node:crypto");

const port = Number(process.env.INVITATION_CAPTURE_PORT || 8025);
const messages = [];
const MAX_MESSAGES = 100;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 64 * 1024) {
        reject(new Error("request-too-large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch { reject(new Error("invalid-json")); }
    });
    request.on("error", reject);
  });
}

function activationHref(activationUrl, token) {
  const url = new URL(String(activationUrl));
  url.searchParams.set("token", String(token));
  return url.toString();
}

function inboxHtml() {
  const rows = messages.map((message) => {
    const href = activationHref(message.activationUrl, message.token);
    return `<article class="message"><h2>${escapeHtml(message.displayName)} · ${escapeHtml(message.role)}</h2><p>To: ${escapeHtml(message.destination)}</p><p>Expires: ${escapeHtml(message.expiresAt)}</p><p><a href="${escapeHtml(href)}">Mở liên kết kích hoạt staff</a></p></article>`;
  }).join("\n");
  return `<!doctype html><meta charset="utf-8"><title>Local invitation inbox</title><style>body{font:16px system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 20px;background:#f6f7f9;color:#17202a}.message{background:white;border:1px solid #d8dee4;border-radius:10px;padding:18px;margin:16px 0}a{color:#0969da}.notice{padding:12px;background:#fff8c5;border:1px solid #d4a72c;border-radius:8px}</style><h1>Local invitation inbox</h1><p class="notice">Chỉ dùng cho local preview. Liên kết chứa token một lần và không được chia sẻ.</p>${rows || "<p>Chưa có invitation nào.</p>"}`;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  if (request.method === "GET" && (url.pathname === "/livez" || url.pathname === "/readyz")) {
    json(response, 200, { status: "ok" });
    return;
  }
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/inbox")) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(inboxHtml());
    return;
  }
  if (request.method === "POST" && url.pathname === "/invitations") {
    try {
      const body = await readJson(request);
      const required = ["deliveryId", "purpose", "destination", "displayName", "role", "token", "activationUrl", "expiresAt"];
      if (required.some((key) => typeof body[key] !== "string" || body[key].length === 0) || body.purpose !== "STAFF_INVITATION") {
        json(response, 422, { status: "rejected", code: "INVALID_INVITATION" });
        return;
      }
      const existing = messages.find((message) => message.deliveryId === body.deliveryId);
      if (existing) {
        json(response, 202, { status: "accepted" }, { "x-provider-message-id": existing.id });
        return;
      }
      const message = {
        id: randomUUID(),
        deliveryId: body.deliveryId,
        destination: body.destination,
        displayName: body.displayName,
        role: body.role,
        token: body.token,
        activationUrl: body.activationUrl,
        expiresAt: body.expiresAt,
      };
      messages.unshift(message);
      if (messages.length > MAX_MESSAGES) messages.length = MAX_MESSAGES;
      json(response, 202, { status: "accepted" }, { "x-provider-message-id": message.id });
    } catch (error) {
      json(response, 400, { status: "rejected", code: error instanceof Error ? error.message : "INVALID_REQUEST" });
    }
    return;
  }
  json(response, 404, { status: "not-found" });
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "admin_invitation_capture_started", port }));
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
