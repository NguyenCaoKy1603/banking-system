/*
 * Local-only OTP capture inbox for the academic preview.
 *
 * It accepts the provider-neutral HTTP OTP contract in memory and never sends
 * messages to the Internet. The code is intentionally available only through
 * the local capture endpoint so a developer can complete a synthetic test
 * registration; it is never written to stdout, a file, or the Outbox.
 */
const http = require("node:http");
const { randomUUID } = require("node:crypto");

const port = Number(process.env.EMAIL_CAPTURE_PORT || 5700);
const messages = [];
const MAX_MESSAGES = 100;

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        reject(new Error("request-too-large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("invalid-json"));
      }
    });
    request.on("error", reject);
  });
}

function validMessage(value) {
  return value &&
    typeof value.deliveryId === "string" && value.deliveryId.length > 0 &&
    typeof value.purpose === "string" && value.purpose.length > 0 &&
    typeof value.destination === "string" && value.destination.length > 0 &&
    typeof value.code === "string" && /^\d{6}$/.test(value.code) &&
    typeof value.expiresAt === "string" && value.expiresAt.length > 0;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);

  if (request.method === "GET" && (url.pathname === "/livez" || url.pathname === "/readyz")) {
    json(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/reset") {
    messages.length = 0;
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/last") {
    json(response, 200, messages[0] || {});
    return;
  }

  if (request.method === "GET" && url.pathname === "/messages") {
    json(response, 200, { messages });
    return;
  }

  if (request.method === "POST" && url.pathname === "/send") {
    try {
      const value = await readJson(request);
      if (!validMessage(value)) {
        json(response, 422, { status: "rejected", code: "INVALID_EMAIL_MESSAGE" });
        return;
      }
      const existing = messages.find((message) => message.deliveryId === value.deliveryId);
      if (existing) {
        json(response, 202, { status: "accepted" }, { "x-provider-message-id": existing.id });
        return;
      }
      const message = {
        id: randomUUID(),
        deliveryId: value.deliveryId,
        purpose: value.purpose,
        destination: value.destination,
        code: value.code,
        expiresAt: value.expiresAt,
      };
      messages.unshift(message);
      if (messages.length > MAX_MESSAGES) messages.length = MAX_MESSAGES;
      json(response, 202, { status: "accepted" }, { "x-provider-message-id": message.id });
    } catch {
      json(response, 400, { status: "rejected", code: "INVALID_EMAIL_MESSAGE" });
    }
    return;
  }

  json(response, 404, { status: "not-found" });
});

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error("EMAIL_CAPTURE_PORT must be a valid TCP port.");
}

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "email_capture_started", port }));
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
