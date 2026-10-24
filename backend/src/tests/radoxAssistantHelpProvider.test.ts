import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  DEFAULT_RADOX_BASE_URL,
  DEFAULT_RADOX_MODEL,
  RadoxAssistantHelpProvider,
  validateRadoxApiKey,
  validateRadoxBaseUrl,
  validateRadoxModel,
} from "../assistant/radoxHelpProvider.js";
import { resolveRuntimeAssistantConfig } from "../assistant/runtimeAssistantConfig.js";
import { AssistantHelpService } from "../assistant/helpService.js";
import { resolveAssistantConfig } from "../assistant/helpConfig.js";

type MockHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
) => void | Promise<void>;

class MockRadoxServer {
  public server: http.Server;
  public handler: MockHandler = () => {};
  public requestCount = 0;
  public requests: Array<{
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }> = [];

  constructor() {
    this.server = http.createServer(async (req, res) => {
      this.requestCount++;
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", async () => {
        const body = Buffer.concat(chunks).toString("utf8");
        this.requests.push({
          method: req.method ?? "",
          url: req.url ?? "",
          headers: req.headers,
          body,
        });
        try {
          await this.handler(req, res, body);
        } catch {
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: "handler error" }));
          }
        }
      });
    });
  }

  async start(): Promise<string> {
    return new Promise((resolve) => {
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server.address() as AddressInfo;
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  reset(): void {
    this.requestCount = 0;
    this.requests = [];
    this.handler = () => {};
  }
}

test("Radox Provider Technical Test Suite", async (suite) => {
  const mockServer = new MockRadoxServer();
  const mockBaseUrl = await mockServer.start();

  suite.after(async () => {
    await mockServer.close();
  });

  const samplePrompt = "You are NOVA banking assistant.";
  const sampleKnowledge = "Transfers are instantaneous within NOVA.";
  const sampleQuestion = "Làm thế nào để chuyển tiền?";
  const mockApiKey = "rdx-test-secret-key-12345";

  await suite.test("R-01: Gửi request đúng chuẩn OpenAI và nhận phản hồi thành công", async () => {
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Bạn có thể vào mục Chuyển tiền từ màn hình chính.",
              },
              finish_reason: "stop",
            },
          ],
        }),
      );
    };

    const provider = new RadoxAssistantHelpProvider({
      baseUrl: mockBaseUrl,
      apiKey: mockApiKey,
      model: "gemini-3.6-flash",
    });

    const output = await provider.generateHelpResponse(samplePrompt, sampleKnowledge, sampleQuestion);
    assert.equal(output.text, "Bạn có thể vào mục Chuyển tiền từ màn hình chính.");
    assert.equal(output.finishReason, "stop");
    assert.equal(output.toolCallsDetected, false);

    assert.equal(mockServer.requests.length, 1);
    const req = mockServer.requests[0];
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/chat/completions");
    assert.equal(req.headers.authorization, `Bearer ${mockApiKey}`);
    assert.equal(req.headers["content-type"], "application/json");

    const parsedBody = JSON.parse(req.body);
    assert.equal(parsedBody.model, "gemini-3.6-flash");
    assert.equal(parsedBody.stream, false);
    assert.equal(parsedBody.messages.length, 2);
    assert.equal(parsedBody.messages[0].role, "system");
    assert.ok(parsedBody.messages[0].content.includes(samplePrompt));
    assert.ok(parsedBody.messages[0].content.includes(sampleKnowledge));
    assert.equal(parsedBody.messages[1].role, "user");
    assert.equal(parsedBody.messages[1].content, sampleQuestion);
  });

  await suite.test("R-02: Nhận diện tool_calls và gán finishReason=tool_calls", async () => {
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "",
                tool_calls: [{ id: "call_1", type: "function", function: { name: "test" } }],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      );
    };

    const provider = new RadoxAssistantHelpProvider({
      baseUrl: mockBaseUrl,
      apiKey: mockApiKey,
    });

    const output = await provider.generateHelpResponse(samplePrompt, sampleKnowledge, sampleQuestion);
    assert.equal(output.finishReason, "tool_calls");
    assert.equal(output.toolCallsDetected, true);
  });

  await suite.test("R-03: Nhận diện phản hồi bị cắt ngắn do độ dài (finish_reason=length)", async () => {
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Câu trả lời bị ngắt giữa chừn",
              },
              finish_reason: "length",
            },
          ],
        }),
      );
    };

    const provider = new RadoxAssistantHelpProvider({
      baseUrl: mockBaseUrl,
      apiKey: mockApiKey,
    });

    const output = await provider.generateHelpResponse(samplePrompt, sampleKnowledge, sampleQuestion);
    assert.equal(output.finishReason, "length");
  });

  await suite.test("R-04: Xử lý lỗi HTTP 401 Unauthorized không làm lộ secret", async () => {
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: { message: "Invalid API key provided" } }));
    };

    const provider = new RadoxAssistantHelpProvider({
      baseUrl: mockBaseUrl,
      apiKey: mockApiKey,
    });

    await assert.rejects(
      async () => provider.generateHelpResponse(samplePrompt, sampleKnowledge, sampleQuestion),
      (err: Error) => {
        assert.ok(err.message.includes("HTTP status 401"));
        assert.equal(err.message.includes(mockApiKey), false);
        return true;
      },
    );
  });

  await suite.test("R-05: Xử lý AbortSignal khi request timeout", async () => {
    mockServer.reset();
    mockServer.handler = () => new Promise(() => {}); // Hang indefinitely

    const provider = new RadoxAssistantHelpProvider({
      baseUrl: mockBaseUrl,
      apiKey: mockApiKey,
    });

    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);

    await assert.rejects(
      async () => provider.generateHelpResponse(samplePrompt, sampleKnowledge, sampleQuestion, ac.signal),
      (err: Error) => {
        assert.equal(err.name, "AbortError");
        return true;
      },
    );
  });

  await suite.test("R-06: Từ chối phản hồi vượt quá giới hạn bytes", async () => {
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: "A".repeat(1000) } }] }));
    };

    const provider = new RadoxAssistantHelpProvider({
      baseUrl: mockBaseUrl,
      apiKey: mockApiKey,
      maxResponseBytes: 100, // Small limit
    });

    await assert.rejects(
      async () => provider.generateHelpResponse(samplePrompt, sampleKnowledge, sampleQuestion),
      /exceeded maximum allowed bytes/,
    );
  });

  await suite.test("R-07: Kiểm tra tính hợp lệ của Base URL, API Key và Model", () => {
    assert.equal(validateRadoxBaseUrl("https://radoxai.com/v1"), "https://radoxai.com/v1");
    assert.equal(validateRadoxBaseUrl("https://radoxai.com/v1/"), "https://radoxai.com/v1");
    assert.throws(() => validateRadoxBaseUrl("ftp://radoxai.com"), /protocol must be https: or http:/);
    assert.throws(() => validateRadoxBaseUrl("https://user:pass@radoxai.com/v1"), /must not contain credentials/);
    assert.throws(() => validateRadoxBaseUrl("https://radoxai.com/v1?test=1"), /must not contain query parameters/);

    assert.equal(validateRadoxApiKey("key-123"), "key-123");
    assert.throws(() => validateRadoxApiKey(""), /must be a non-empty string/);

    assert.equal(validateRadoxModel("gemini-3.6-flash"), "gemini-3.6-flash");
    assert.throws(() => validateRadoxModel(""), /must be a non-empty string/);
  });

  await suite.test("R-08: resolveRuntimeAssistantConfig xác thực đúng các biến môi trường", () => {
    // 1. Disabled
    const disabledConfig = resolveRuntimeAssistantConfig({ ASSISTANT_ENABLED: "0" });
    assert.equal(disabledConfig.enabled, false);

    // 2. Provider not radox
    assert.throws(
      () => resolveRuntimeAssistantConfig({ ASSISTANT_ENABLED: "1", ASSISTANT_PROVIDER: "other" }),
      /ASSISTANT_PROVIDER must be 'radox'/,
    );

    // 3. Missing API key
    assert.throws(
      () =>
        resolveRuntimeAssistantConfig({
          ASSISTANT_ENABLED: "1",
          ASSISTANT_PROVIDER: "radox",
        }),
      /ASSISTANT_RADOX_API_KEY is required/,
    );

    // 4. Invalid timeout (request <= provider)
    assert.throws(
      () =>
        resolveRuntimeAssistantConfig({
          ASSISTANT_ENABLED: "1",
          ASSISTANT_PROVIDER: "radox",
          ASSISTANT_RADOX_API_KEY: "secret",
          ASSISTANT_PROVIDER_TIMEOUT_MS: "20000",
          ASSISTANT_REQUEST_TIMEOUT_MS: "15000",
        }),
      /must be strictly greater than/,
    );

    // 5. Valid config
    const validConfig = resolveRuntimeAssistantConfig({
      ASSISTANT_ENABLED: "1",
      ASSISTANT_PROVIDER: "radox",
      ASSISTANT_RADOX_API_KEY: "secret",
      ASSISTANT_MODEL: "gpt-5.5",
      ASSISTANT_RADOX_BASE_URL: "https://radoxai.com/v1",
      ASSISTANT_PROVIDER_TIMEOUT_MS: "10000",
      ASSISTANT_REQUEST_TIMEOUT_MS: "15000",
    });
    assert.equal(validConfig.enabled, true);
    assert.ok(validConfig.provider instanceof RadoxAssistantHelpProvider);
    assert.equal(validConfig.providerTimeoutMs, 10000);
    assert.equal(validConfig.requestTimeoutMs, 15000);
  });

  await suite.test("R-09: Tích hợp với AssistantHelpService thành công", async () => {
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({ selectionId: "FAQ-01" }),
              },
              finish_reason: "stop",
            },
          ],
        }),
      );
    };

    const provider = new RadoxAssistantHelpProvider({
      baseUrl: mockBaseUrl,
      apiKey: mockApiKey,
      model: "gemini-3.6-flash",
    });

    const config = resolveAssistantConfig({
      enabled: true,
      provider,
      providerTimeoutMs: 5000,
      requestTimeoutMs: 8000,
    });

    const service = new AssistantHelpService(config);
    const result = await service.executeHelpRequest("Làm sao chuyển tiền?");
    assert.ok(result.length > 0);
  });
});
