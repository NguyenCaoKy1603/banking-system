import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  DEFAULT_OLLAMA_BASE_URL,
  OllamaAssistantHelpProvider,
  SUPPORTED_OLLAMA_MODEL,
  validateOllamaBaseUrl,
  validateOllamaModel,
} from "../assistant/ollamaHelpProvider.js";
import { resolveRuntimeAssistantConfig } from "../assistant/runtimeAssistantConfig.js";
import { AssistantHelpService } from "../assistant/helpService.js";
import { resolveAssistantConfig } from "../assistant/helpConfig.js";
import { DomainError } from "../errors.js";
import { BankingSystem } from "../bankingSystem.js";
import { createBankingServer } from "../http.js";
import { getAnswerCatalogEntry } from "../assistant/responseCatalog.js";

type MockHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
) => void | Promise<void>;

class MockOllamaServer {
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

test("Ollama Provider Technical Test Suite (O-01 -> O-15)", async (suite) => {
  const mockServer = new MockOllamaServer();
  const mockBaseUrl = await mockServer.start();

  suite.after(async () => {
    await mockServer.close();
  });

  const samplePrompt = "Bạn là trợ lý ảo NOVA của ngân hàng số.";
  const sampleKnowledge = "FAQ-01: Xem số dư tại màn hình chính.";
  const sampleQuestion = "Tôi xem số dư ở đâu?";

  // ---------------------------------------------------------------------------
  // O-01: Request payload structure & options
  // ---------------------------------------------------------------------------
  await suite.test("O-01: Request format POST /api/chat, Content-Type, stream=false, think=false, options", async () => {
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: { role: "assistant", content: "Bạn xem số dư tại màn hình chính (FAQ-01)." },
        done: true,
        done_reason: "stop",
      }));
    };

    const provider = new OllamaAssistantHelpProvider({ baseUrl: mockBaseUrl });
    const output = await provider.generateHelpResponse(samplePrompt, sampleKnowledge, sampleQuestion);

    assert.equal(mockServer.requestCount, 1);
    const recorded = mockServer.requests[0];
    assert.equal(recorded.method, "POST");
    assert.equal(recorded.url, "/api/chat");
    assert.equal(recorded.headers["content-type"], "application/json");

    const body = JSON.parse(recorded.body);
    assert.equal(body.model, "qwen3.5:4b");
    assert.equal(body.stream, false);
    assert.equal(body.think, false);
    assert.deepEqual(body.options, {
      temperature: 0.1,
      num_ctx: 8192,
      num_predict: 530,
    });
    assert.equal(output.text, "Bạn xem số dư tại màn hình chính (FAQ-01).");
  });

  // ---------------------------------------------------------------------------
  // O-02: Messages array order and isolation
  // ---------------------------------------------------------------------------
  await suite.test("O-02: messages chứa đúng system prompt, knowledgeContext và question; đúng thứ tự", async () => {
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: { role: "assistant", content: "Phản hồi chuẩn." },
        done: true,
        done_reason: "stop",
      }));
    };

    const provider = new OllamaAssistantHelpProvider({ baseUrl: mockBaseUrl });
    await provider.generateHelpResponse(samplePrompt, sampleKnowledge, sampleQuestion);

    const body = JSON.parse(mockServer.requests[0].body);
    assert.equal(Array.isArray(body.messages), true);
    assert.equal(body.messages.length, 3);
    assert.deepEqual(body.messages[0], { role: "system", content: samplePrompt });
    assert.deepEqual(body.messages[1], { role: "system", content: sampleKnowledge });
    assert.deepEqual(body.messages[2], { role: "user", content: sampleQuestion });

    // Không chứa rubric, fixture hay Part B/C/D
    const payloadStr = mockServer.requests[0].body;
    assert.equal(payloadStr.includes("rubric"), false);
    assert.equal(payloadStr.includes("Phần B"), false);
    assert.equal(payloadStr.includes("Phần C"), false);
    assert.equal(payloadStr.includes("Phần D"), false);
  });

  // ---------------------------------------------------------------------------
  // O-03: No Authorization header or auth credentials in outbound payload
  // ---------------------------------------------------------------------------
  await suite.test("O-03: Không có Authorization header, token, deviceId, customerId hoặc AuthUser", async () => {
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: { role: "assistant", content: "OK" },
        done: true,
        done_reason: "stop",
      }));
    };

    const provider = new OllamaAssistantHelpProvider({ baseUrl: mockBaseUrl });
    await provider.generateHelpResponse(samplePrompt, sampleKnowledge, sampleQuestion);

    const recorded = mockServer.requests[0];
    assert.equal(recorded.headers["authorization"], undefined);
    assert.equal(recorded.headers["x-device-id"], undefined);
    assert.equal(recorded.headers["x-customer-id"], undefined);

    const payloadStr = recorded.body;
    assert.equal(payloadStr.includes("bearer"), false);
    assert.equal(payloadStr.includes("customerId"), false);
    assert.equal(payloadStr.includes("deviceId"), false);
    assert.equal(payloadStr.includes("AuthUser"), false);
  });

  // ---------------------------------------------------------------------------
  // O-04: Valid response mapping to AssistantHelpOutput
  // ---------------------------------------------------------------------------
  await suite.test("O-04: Response done=true, done_reason=stop được map thành AssistantHelpOutput hợp lệ", async () => {
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: { role: "assistant", content: "Hướng dẫn chuyển tiền chi tiết." },
        done: true,
        done_reason: "stop",
      }));
    };

    const provider = new OllamaAssistantHelpProvider({ baseUrl: mockBaseUrl });
    const output = await provider.generateHelpResponse(samplePrompt, sampleKnowledge, sampleQuestion);

    assert.equal(output.text, "Hướng dẫn chuyển tiền chi tiết.");
    assert.equal(output.finishReason, "stop");
    assert.equal(output.toolCallsDetected, false);
  });

  // ---------------------------------------------------------------------------
  // O-05: tool_calls detection and rejection
  // ---------------------------------------------------------------------------
  await suite.test("O-05: tool_calls bị phát hiện và bị Output Guard từ chối (502)", async () => {
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: {
          role: "assistant",
          content: "Tôi sẽ thực hiện chuyển tiền.",
          tool_calls: [{ function: { name: "transfer_money", arguments: {} } }],
        },
        done: true,
        done_reason: "stop",
      }));
    };

    const provider = new OllamaAssistantHelpProvider({ baseUrl: mockBaseUrl });
    const directOutput = await provider.generateHelpResponse(samplePrompt, sampleKnowledge, sampleQuestion);
    assert.equal(directOutput.finishReason, "tool_calls");
    assert.equal(directOutput.toolCallsDetected, true);

    const service = new AssistantHelpService(resolveAssistantConfig({ enabled: true, provider }));
    await assert.rejects(
      async () => service.executeHelpRequest(sampleQuestion),
      (err: unknown) => {
        assert.ok(err instanceof DomainError);
        assert.equal(err.status, 502);
        assert.equal(err.code, "ASSISTANT_PROVIDER_ERROR");
        assert.equal(err.message, "Assistant provider attempted an unauthorized tool call.");
        return true;
      },
    );
  });

  // ---------------------------------------------------------------------------
  // O-06: done_reason=length mapping and rejection
  // ---------------------------------------------------------------------------
  await suite.test("O-06: done_reason=length được map thành finishReason=length và bị từ chối (502)", async () => {
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: { role: "assistant", content: "Câu trả lời bị cắt ngang..." },
        done: true,
        done_reason: "length",
      }));
    };

    const provider = new OllamaAssistantHelpProvider({ baseUrl: mockBaseUrl });
    const directOutput = await provider.generateHelpResponse(samplePrompt, sampleKnowledge, sampleQuestion);
    assert.equal(directOutput.finishReason, "length");

    const service = new AssistantHelpService(resolveAssistantConfig({ enabled: true, provider }));
    await assert.rejects(
      async () => service.executeHelpRequest(sampleQuestion),
      (err: unknown) => {
        assert.ok(err instanceof DomainError);
        assert.equal(err.status, 502);
        assert.equal(err.code, "ASSISTANT_PROVIDER_ERROR");
        return true;
      },
    );
  });

  // ---------------------------------------------------------------------------
  // O-07: Malformed, incomplete, non-string, or empty content fail-closed
  // ---------------------------------------------------------------------------
  await suite.test("O-07: done=false, thiếu done_reason, content sai kiểu, content rỗng, JSON malformed đều fail-closed", async () => {
    const provider = new OllamaAssistantHelpProvider({ baseUrl: mockBaseUrl });
    const service = new AssistantHelpService(resolveAssistantConfig({ enabled: true, provider }));

    // 1. done = false
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: { role: "assistant", content: "Chưa hoàn tất" },
        done: false,
      }));
    };
    await assert.rejects(async () => service.executeHelpRequest(sampleQuestion), DomainError);

    // 2. done_reason lạ
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: { role: "assistant", content: "Lý do lạ" },
        done: true,
        done_reason: "unexpected_reason",
      }));
    };
    await assert.rejects(async () => service.executeHelpRequest(sampleQuestion), DomainError);

    // 3. Thiếu message
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ done: true, done_reason: "stop" }));
    };
    await assert.rejects(async () => service.executeHelpRequest(sampleQuestion), DomainError);

    // 4. Content sai kiểu (number thay vì string)
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: { role: "assistant", content: 123456 },
        done: true,
        done_reason: "stop",
      }));
    };
    await assert.rejects(async () => service.executeHelpRequest(sampleQuestion), DomainError);

    // 5. Content rỗng
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: { role: "assistant", content: "   " },
        done: true,
        done_reason: "stop",
      }));
    };
    await assert.rejects(async () => service.executeHelpRequest(sampleQuestion), (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal(err.status, 502);
      assert.equal(err.message, "Assistant provider returned an empty response.");
      return true;
    });

    // 6. JSON malformed
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{ invalid json string");
    };
    await assert.rejects(async () => service.executeHelpRequest(sampleQuestion), DomainError);
  });

  // ---------------------------------------------------------------------------
  // O-08: HTTP 400, 404, 429, 500 do not leak raw error body
  // ---------------------------------------------------------------------------
  await suite.test("O-08: HTTP 400, 404, 429 và 500 không làm lộ raw error/body ra response công khai", async () => {
    const errorStatuses = [400, 404, 429, 500];
    const sensitiveOllamaSecret = "INTERNAL_OLLAMA_DATABASE_PASSWORD_LEAK";

    for (const status of errorStatuses) {
      mockServer.reset();
      mockServer.handler = (_req, res) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: sensitiveOllamaSecret, status }));
      };

      const provider = new OllamaAssistantHelpProvider({ baseUrl: mockBaseUrl });
      const service = new AssistantHelpService(resolveAssistantConfig({ enabled: true, provider }));

      await assert.rejects(
        async () => service.executeHelpRequest(sampleQuestion),
        (err: unknown) => {
          assert.ok(err instanceof DomainError);
          assert.equal(err.status, 502);
          assert.equal(err.code, "ASSISTANT_PROVIDER_ERROR");
          assert.equal(err.message, "Assistant service failed to generate a response.");
          // Tuyệt đối không chứa secret từ mock server
          assert.equal(JSON.stringify(err).includes(sensitiveOllamaSecret), false);
          return true;
        },
      );
    }
  });

  // ---------------------------------------------------------------------------
  // O-09: AbortSignal cancels fetch immediately
  // ---------------------------------------------------------------------------
  await suite.test("O-09: AbortSignal hủy fetch thật; không chờ phản hồi treo và không unhandled rejection", async () => {
    mockServer.reset();
    mockServer.handler = (_req, _res) => {
      // Treo kết nối không trả lời
    };

    const provider = new OllamaAssistantHelpProvider({ baseUrl: mockBaseUrl });
    const abortController = new AbortController();

    const start = Date.now();
    const callPromise = provider.generateHelpResponse(
      samplePrompt,
      sampleKnowledge,
      sampleQuestion,
      abortController.signal,
    );

    // Hủy sau 30ms
    setTimeout(() => abortController.abort(), 30);

    await assert.rejects(
      async () => callPromise,
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.name, "AbortError");
        return true;
      },
    );

    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `Hủy phải diễn ra tức thì, thực tế mất ${elapsed}ms`);
  });

  // ---------------------------------------------------------------------------
  // O-10: Single call only, no retry on error
  // ---------------------------------------------------------------------------
  await suite.test("O-10: Provider chỉ gọi đúng một lần; không retry khi lỗi 5xx", async () => {
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "temporary server error" }));
    };

    const provider = new OllamaAssistantHelpProvider({ baseUrl: mockBaseUrl });
    await assert.rejects(async () => provider.generateHelpResponse(samplePrompt, sampleKnowledge, sampleQuestion));

    assert.equal(mockServer.requestCount, 1);
  });

  // ---------------------------------------------------------------------------
  // O-11: Redirect from mock server is rejected (not followed)
  // ---------------------------------------------------------------------------
  await suite.test("O-11: Redirect từ mock server bị từ chối và không được follow", async () => {
    mockServer.reset();
    let redirectDestinationHit = false;

    mockServer.handler = (req, res) => {
      if (req.url === "/api/chat") {
        res.writeHead(302, { Location: "/api/redirected-chat" });
        res.end();
      } else if (req.url === "/api/redirected-chat") {
        redirectDestinationHit = true;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          message: { role: "assistant", content: "redirected answer" },
          done: true,
          done_reason: "stop",
        }));
      }
    };

    const provider = new OllamaAssistantHelpProvider({ baseUrl: mockBaseUrl });
    await assert.rejects(
      async () => provider.generateHelpResponse(samplePrompt, sampleKnowledge, sampleQuestion),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );

    assert.equal(redirectDestinationHit, false, "Điểm redirect không bao giờ được phép bị gọi.");
  });

  // ---------------------------------------------------------------------------
  // O-12: Reject remote, LAN, 0.0.0.0, credentials, query params, hash & cloud models
  // ---------------------------------------------------------------------------
  await suite.test("O-12: URL remote, LAN, 0.0.0.0, URL có credentials/query/fragment và model cloud bị từ chối", () => {
    // 1. URL checks
    assert.throws(() => validateOllamaBaseUrl("https://127.0.0.1:11434"), /protocol must be http:/);
    assert.throws(() => validateOllamaBaseUrl("http://192.168.1.100:11434"), /hostname must strictly be 127.0.0.1/);
    assert.throws(() => validateOllamaBaseUrl("http://0.0.0.0:11434"), /hostname must strictly be 127.0.0.1/);
    assert.throws(() => validateOllamaBaseUrl("http://localhost:11434"), /hostname must strictly be 127.0.0.1/);
    assert.throws(() => validateOllamaBaseUrl("http://host.docker.internal:11434"), /hostname must strictly be 127.0.0.1/);
    assert.equal(
      validateOllamaBaseUrl("http://host.docker.internal:11434", { allowDockerHostInternal: true }),
      "http://host.docker.internal:11434",
    );
    assert.throws(
      () => validateOllamaBaseUrl("http://192.168.1.100:11434", { allowDockerHostInternal: true }),
      /hostname must strictly be 127.0.0.1/,
    );
    assert.throws(() => validateOllamaBaseUrl("http://admin:pass@127.0.0.1:11434"), /must not contain credentials/);
    assert.throws(() => validateOllamaBaseUrl("http://127.0.0.1:11434?token=secret"), /must not contain query parameters/);
    assert.throws(() => validateOllamaBaseUrl("http://127.0.0.1:11434#section"), /must not contain hash fragments/);
    assert.throws(() => validateOllamaBaseUrl("http://127.0.0.1:11434/api/chat"), /must not contain custom paths/);
    assert.throws(() => validateOllamaBaseUrl("http://127.0.0.1:0"), /port is invalid/);
    assert.throws(() => validateOllamaBaseUrl("http://127.0.0.1:99999"), /Invalid Ollama base URL format/);

    // Hợp lệ
    assert.equal(validateOllamaBaseUrl("http://127.0.0.1:11434"), "http://127.0.0.1:11434");
    assert.equal(validateOllamaBaseUrl("http://127.0.0.1:11434/"), "http://127.0.0.1:11434");

    // 2. Model checks
    assert.throws(() => validateOllamaModel("qwen3.5:4b-cloud"), /Cloud models\/tags are strictly forbidden/);
    assert.throws(() => validateOllamaModel("cloud-model"), /Cloud models\/tags are strictly forbidden/);
    assert.throws(() => validateOllamaModel("llama3"), /Unsupported Ollama model/);
    assert.throws(() => validateOllamaModel("gpt-4"), /Unsupported Ollama model/);
    assert.throws(() => validateOllamaModel(""), /non-empty string/);

    // Hợp lệ
    assert.equal(validateOllamaModel("qwen3.5:4b"), "qwen3.5:4b");
  });

  // ---------------------------------------------------------------------------
  // O-13: When Assistant disabled, provider is not created or called
  // ---------------------------------------------------------------------------
  await suite.test("O-13: Khi Assistant disabled, provider không được tạo hoặc gọi", () => {
    // 1. Explicitly 0
    const config0 = resolveRuntimeAssistantConfig({ ASSISTANT_ENABLED: "0" });
    assert.equal(config0.enabled, false);
    assert.equal(config0.provider, undefined);

    // 2. Undefined
    const configUndef = resolveRuntimeAssistantConfig({});
    assert.equal(configUndef.enabled, false);
    assert.equal(configUndef.provider, undefined);

    // 3. Other string
    const configOther = resolveRuntimeAssistantConfig({ ASSISTANT_ENABLED: "true" });
    assert.equal(configOther.enabled, false);
    assert.equal(configOther.provider, undefined);
  });

  // ---------------------------------------------------------------------------
  // O-14: Fail-closed on invalid or missing runtime configuration (no fallback)
  // ---------------------------------------------------------------------------
  await suite.test("O-14: Khi Assistant enabled nhưng provider/model/base URL thiếu hoặc sai, runtime config fail-closed", () => {
    // 1. Missing or invalid ASSISTANT_PROVIDER
    assert.throws(
      () => resolveRuntimeAssistantConfig({ ASSISTANT_ENABLED: "1", ASSISTANT_PROVIDER: "fake" }),
      /ASSISTANT_PROVIDER must be 'ollama'/,
    );
    assert.throws(
      () => resolveRuntimeAssistantConfig({ ASSISTANT_ENABLED: "1" }),
      /ASSISTANT_PROVIDER must be 'ollama'/,
    );

    // 2. Missing or invalid ASSISTANT_MODEL
    assert.throws(
      () => resolveRuntimeAssistantConfig({
        ASSISTANT_ENABLED: "1",
        ASSISTANT_PROVIDER: "ollama",
        ASSISTANT_MODEL: "llama3",
      }),
      /Unsupported Ollama model: 'llama3'/,
    );
    assert.throws(
      () => resolveRuntimeAssistantConfig({
        ASSISTANT_ENABLED: "1",
        ASSISTANT_PROVIDER: "ollama",
        ASSISTANT_MODEL: "",
      }),
      /ASSISTANT_MODEL is required/,
    );

    // 3. Invalid ASSISTANT_OLLAMA_BASE_URL
    assert.throws(
      () => resolveRuntimeAssistantConfig({
        ASSISTANT_ENABLED: "1",
        ASSISTANT_PROVIDER: "ollama",
        ASSISTANT_MODEL: "qwen3.5:4b",
        ASSISTANT_OLLAMA_BASE_URL: "https://remote.com",
      }),
      /Ollama base URL protocol must be http:/,
    );
    assert.throws(
      () => resolveRuntimeAssistantConfig({
        ASSISTANT_ENABLED: "1",
        ASSISTANT_PROVIDER: "ollama",
        ASSISTANT_MODEL: "qwen3.5:4b",
        ASSISTANT_OLLAMA_BASE_URL: "http://host.docker.internal:11434",
        ASSISTANT_ALLOW_DOCKER_HOST: "1",
        BANKING_ENV: "production-like",
      }),
      /ASSISTANT_ALLOW_DOCKER_HOST=1 is allowed only when BANKING_ENV is development or preview/,
    );
    assert.throws(
      () => resolveRuntimeAssistantConfig({
        ASSISTANT_ENABLED: "1",
        ASSISTANT_PROVIDER: "ollama",
        ASSISTANT_MODEL: "qwen3.5:4b",
        ASSISTANT_OLLAMA_BASE_URL: "http://host.docker.internal:11434",
      }),
      /hostname must strictly be 127.0.0.1/,
    );

    // 4. Invalid timeout configurations
    assert.throws(
      () => resolveRuntimeAssistantConfig({
        ASSISTANT_ENABLED: "1",
        ASSISTANT_PROVIDER: "ollama",
        ASSISTANT_MODEL: "qwen3.5:4b",
        ASSISTANT_PROVIDER_TIMEOUT_MS: "invalid",
      }),
      /ASSISTANT_PROVIDER_TIMEOUT_MS must be a positive integer/,
    );
    assert.throws(
      () => resolveRuntimeAssistantConfig({
        ASSISTANT_ENABLED: "1",
        ASSISTANT_PROVIDER: "ollama",
        ASSISTANT_MODEL: "qwen3.5:4b",
        ASSISTANT_PROVIDER_TIMEOUT_MS: "0",
      }),
      /ASSISTANT_PROVIDER_TIMEOUT_MS must be a positive integer/,
    );
    assert.throws(
      () => resolveRuntimeAssistantConfig({
        ASSISTANT_ENABLED: "1",
        ASSISTANT_PROVIDER: "ollama",
        ASSISTANT_MODEL: "qwen3.5:4b",
        ASSISTANT_REQUEST_TIMEOUT_MS: "-100",
      }),
      /ASSISTANT_REQUEST_TIMEOUT_MS must be a positive integer/,
    );
    assert.throws(
      () => resolveRuntimeAssistantConfig({
        ASSISTANT_ENABLED: "1",
        ASSISTANT_PROVIDER: "ollama",
        ASSISTANT_MODEL: "qwen3.5:4b",
        ASSISTANT_PROVIDER_TIMEOUT_MS: "30000",
        ASSISTANT_REQUEST_TIMEOUT_MS: "20000",
      }),
      /must be strictly greater than/,
    );
    assert.throws(
      () => resolveRuntimeAssistantConfig({
        ASSISTANT_ENABLED: "1",
        ASSISTANT_PROVIDER: "ollama",
        ASSISTANT_MODEL: "qwen3.5:4b",
        ASSISTANT_PROVIDER_TIMEOUT_MS: "25000",
        ASSISTANT_REQUEST_TIMEOUT_MS: "25000",
      }),
      /must be strictly greater than/,
    );

    // 5. Hợp lệ hoàn chỉnh với mặc định
    const validConfig = resolveRuntimeAssistantConfig({
      ASSISTANT_ENABLED: "1",
      ASSISTANT_PROVIDER: "ollama",
      ASSISTANT_MODEL: "qwen3.5:4b",
      ASSISTANT_OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    });
    assert.equal(validConfig.enabled, true);
    assert.equal(validConfig.providerTimeoutMs, 25000);
    assert.equal(validConfig.requestTimeoutMs, 30000);
    assert.ok(validConfig.provider instanceof OllamaAssistantHelpProvider);

    const dockerPreviewConfig = resolveRuntimeAssistantConfig({
      ASSISTANT_ENABLED: "1",
      ASSISTANT_PROVIDER: "ollama",
      ASSISTANT_MODEL: "qwen3.5:4b",
      ASSISTANT_OLLAMA_BASE_URL: "http://host.docker.internal:11434",
      ASSISTANT_ALLOW_DOCKER_HOST: "1",
      BANKING_ENV: "preview",
    });
    assert.equal(dockerPreviewConfig.enabled, true);
    assert.equal(
      (dockerPreviewConfig.provider as OllamaAssistantHelpProvider).baseUrl,
      "http://host.docker.internal:11434",
    );

    // 6. Hợp lệ với custom timeout
    const customTimeoutConfig = resolveRuntimeAssistantConfig({
      ASSISTANT_ENABLED: "1",
      ASSISTANT_PROVIDER: "ollama",
      ASSISTANT_MODEL: "qwen3.5:4b",
      ASSISTANT_PROVIDER_TIMEOUT_MS: "28000",
      ASSISTANT_REQUEST_TIMEOUT_MS: "35000",
    });
    assert.equal(customTimeoutConfig.providerTimeoutMs, 28000);
    assert.equal(customTimeoutConfig.requestTimeoutMs, 35000);

    // 7. Hợp lệ với cấu hình numPredict tùy chỉnh
    const customNumPredictConfig = resolveRuntimeAssistantConfig({
      ASSISTANT_ENABLED: "1",
      ASSISTANT_PROVIDER: "ollama",
      ASSISTANT_MODEL: "qwen3.5:4b",
      ASSISTANT_OLLAMA_NUM_PREDICT: "600",
    });
    assert.equal(
      (customNumPredictConfig.provider as OllamaAssistantHelpProvider & { numPredict: number }).numPredict,
      600,
    );

    // 8. Thất bại khi ASSISTANT_OLLAMA_NUM_PREDICT không hợp lệ
    assert.throws(
      () =>
        resolveRuntimeAssistantConfig({
          ASSISTANT_ENABLED: "1",
          ASSISTANT_PROVIDER: "ollama",
          ASSISTANT_MODEL: "qwen3.5:4b",
          ASSISTANT_OLLAMA_NUM_PREDICT: "not-a-number",
        }),
      /ASSISTANT_OLLAMA_NUM_PREDICT must be a positive integer/,
    );
  });

  // ---------------------------------------------------------------------------
  // O-15: Safe rejection of oversized response
  // ---------------------------------------------------------------------------
  await suite.test("O-15: Response vượt giới hạn byte bị từ chối an toàn", async () => {
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      // Trả về chuỗi lớn hơn giới hạn byte 200 bytes
      const bigPayload = JSON.stringify({
        message: { role: "assistant", content: "A".repeat(500) },
        done: true,
        done_reason: "stop",
      });
      res.end(bigPayload);
    };

    const provider = new OllamaAssistantHelpProvider({
      baseUrl: mockBaseUrl,
      maxResponseBytes: 200, // giới hạn nhỏ 200 bytes
    });

    const service = new AssistantHelpService(resolveAssistantConfig({ enabled: true, provider }));

    await assert.rejects(
      async () => service.executeHelpRequest(sampleQuestion),
      (err: unknown) => {
        assert.ok(err instanceof DomainError);
        assert.equal(err.status, 502);
        assert.equal(err.code, "ASSISTANT_PROVIDER_ERROR");
        assert.equal(err.message, "Assistant service failed to generate a response.");
        return true;
      },
    );
  });

  // ---------------------------------------------------------------------------
  // O-16: End-to-End Backend HTTP runtime transmits num_predict=530 to Ollama mock
  // ---------------------------------------------------------------------------
  await suite.test("O-16: Luồng Backend HTTP thật nhận và gửi đúng num_predict=530 tới Ollama endpoint", async () => {
    mockServer.reset();
    mockServer.handler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        message: { role: "assistant", content: '{"selectionId":"FAQ-01"}' },
        done: true,
        done_reason: "stop",
      }));
    };

    const system = new BankingSystem({ sandboxOtp: "123456" });
    const assistantConfig = resolveRuntimeAssistantConfig({
      ASSISTANT_ENABLED: "1",
      ASSISTANT_PROVIDER: "ollama",
      ASSISTANT_MODEL: "qwen3.5:4b",
      ASSISTANT_OLLAMA_BASE_URL: mockBaseUrl,
      ASSISTANT_PROVIDER_TIMEOUT_MS: "25000",
      ASSISTANT_REQUEST_TIMEOUT_MS: "30000",
    });

    const server = createBankingServer(system, {
      registrationFingerprintKey: Buffer.from(
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "hex",
      ),
      assistantConfig,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;

    try {
      const regRes = await fetch(`${baseUrl}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Device-ID": "test-device-http-runtime" },
        body: JSON.stringify({
          fullName: "Runtime NumPredict User",
          email: "numpredict_test@banking.test",
          phoneNumber: "0900000077",
          password: "Password123!",
        }),
      });
      assert.equal(regRes.status, 202);
      const challenge = (await regRes.json()) as { challengeId: string };
      const otp = system.readTestVerificationCode(challenge.challengeId);
      const verifyRes = await fetch(`${baseUrl}/auth/register/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Device-ID": "test-device-http-runtime" },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          method: "EMAIL_OTP",
          proof: otp,
        }),
      });
      assert.equal(verifyRes.status, 201);
      const verifiedUser = (await verifyRes.json()) as { user: { id: string } };
      const session = system.issueMfaSession(verifiedUser.user.id, "test-device-http-runtime");

      const helpRes = await fetch(`${baseUrl}/assistant/help`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
          "X-Device-ID": "test-device-http-runtime",
          "X-Request-ID": "test-req-http-530",
        },
        body: JSON.stringify({ question: "Xem số dư ở đâu?" }),
      });

      assert.equal(helpRes.status, 200);
      const helpBody = (await helpRes.json()) as { answer: string };
      assert.equal(helpBody.answer, getAnswerCatalogEntry("FAQ-01")?.answer);

      assert.equal(mockServer.requestCount, 1);
      const recorded = mockServer.requests[0]!;
      const payload = JSON.parse(recorded.body);
      assert.equal(payload.options.num_predict, 530);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
