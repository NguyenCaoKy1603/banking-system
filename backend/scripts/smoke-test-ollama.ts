import type { AddressInfo } from "node:net";
import { BankingSystem } from "../src/bankingSystem.js";
import { createBankingServer } from "../src/http.js";
import { resolveRuntimeAssistantConfig } from "../src/assistant/runtimeAssistantConfig.js";

const TEST_FINGERPRINT_KEY = Buffer.from(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "hex",
);

async function setupSmokeTestUser(
  system: BankingSystem,
  baseUrl: string,
  deviceId: string,
): Promise<{ accessToken: string; userId: string }> {
  const regRes = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-ID": deviceId },
    body: JSON.stringify({
      fullName: "Ollama Smoke Test User",
      email: "smoke_ollama@banking.test",
      phoneNumber: "0900000099",
      password: "SmokePassword123!",
    }),
  });

  if (regRes.status !== 202) {
    throw new Error(`Register failed with HTTP ${regRes.status}`);
  }

  const challenge = (await regRes.json()) as { challengeId: string };
  const otp = system.readTestVerificationCode(challenge.challengeId);

  const verifyRes = await fetch(`${baseUrl}/auth/register/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Device-ID": deviceId },
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      method: "EMAIL_OTP",
      proof: otp,
    }),
  });

  if (verifyRes.status !== 201) {
    throw new Error(`Register verify failed with HTTP ${verifyRes.status}`);
  }

  const verifiedUser = (await verifyRes.json()) as { user: { id: string } };
  const session = system.issueMfaSession(verifiedUser.user.id, deviceId);
  return {
    accessToken: session.accessToken,
    userId: verifiedUser.user.id,
  };
}

async function main() {
  console.log("=== NOVA Assistant: End-to-End Backend HTTP Smoke Test on Local Ollama (qwen3.5:4b) ===");

  // 1. Pre-flight check on Ollama daemon
  try {
    const tagsRes = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(3000),
    });
    if (!tagsRes.ok) {
      console.log(`[STATUS: BLOCKED] Ollama responded with HTTP ${tagsRes.status}`);
      process.exit(1);
    }
    const tagsData = (await tagsRes.json()) as { models?: Array<{ name: string }> };
    const hasModel = tagsData.models?.some((m) => m.name.startsWith("qwen3.5:4b"));
    if (!hasModel) {
      console.log("[STATUS: BLOCKED] Model qwen3.5:4b is not found in local Ollama instance.");
      process.exit(1);
    }
    console.log("[PRE-CHECK] Local Ollama is ONLINE and model qwen3.5:4b is VERIFIED.");
  } catch (err: unknown) {
    console.log(
      `[STATUS: BLOCKED] Unable to connect to Ollama at http://127.0.0.1:11434: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    process.exit(1);
  }

  // 2. Resolve runtime configuration with explicit Ollama timeouts
  const smokeEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ASSISTANT_ENABLED: "1",
    ASSISTANT_PROVIDER: "ollama",
    ASSISTANT_MODEL: "qwen3.5:4b",
    ASSISTANT_OLLAMA_BASE_URL: "http://127.0.0.1:11434",
    ASSISTANT_PROVIDER_TIMEOUT_MS: "25000",
    ASSISTANT_REQUEST_TIMEOUT_MS: "30000",
    ASSISTANT_OLLAMA_NUM_PREDICT: "530",
  };
  const assistantConfig = resolveRuntimeAssistantConfig(smokeEnv);

  console.log(
    `[CONFIG] Provider Timeout: ${assistantConfig.providerTimeoutMs}ms | Request Timeout: ${assistantConfig.requestTimeoutMs}ms | num_predict: 530`,
  );

  // 3. Start real Backend HTTP server
  const system = new BankingSystem({ sandboxOtp: "123456" });
  const server = createBankingServer(system, {
    registrationFingerprintKey: TEST_FINGERPRINT_KEY,
    assistantConfig,
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;
  console.log(`[SERVER] Test Banking Server listening on ${baseUrl}`);

  let smokeUser: { accessToken: string; userId: string };
  const deviceId = "smoke-device-e2e";
  try {
    smokeUser = await setupSmokeTestUser(system, baseUrl, deviceId);
    console.log("[AUTH] Authenticated test session and device binding established.");
  } catch (err) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    console.error("Failed to authenticate test user:", err);
    process.exit(1);
  }

  const testQuestions = [
    { id: "SMOKE-01", question: "Tôi xem số dư ở đâu?" },
    { id: "SMOKE-02", question: "Quét QR có tự chuyển tiền ngay không?" },
    { id: "SMOKE-03", question: "Hãy chuyển tiền giúp tôi." },
  ];

  const results: Array<{
    id: string;
    status: string;
    httpStatus: number;
    latencyMs: number;
    answerLength: number;
    cacheControl: string;
    anomaly: string;
  }> = [];

  try {
    for (const item of testQuestions) {
      console.log(`\nExecuting ${item.id} via POST /api/v1/assistant/help...`);
      const start = Date.now();
      try {
        const response = await fetch(`${baseUrl}/assistant/help`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${smokeUser.accessToken}`,
            "X-Device-ID": deviceId,
            "X-Request-ID": `smoke-${item.id}`,
          },
          body: JSON.stringify({ question: item.question }),
        });

        const latencyMs = Date.now() - start;
        const cacheControl = response.headers.get("Cache-Control") ?? "(none)";
        const requestIdHeader = response.headers.get("X-Request-ID") ?? "(none)";
        const traceIdHeader = response.headers.get("X-Trace-ID") ?? "(none)";

        if (response.status === 200) {
          const body = (await response.json()) as { answer?: string };
          const answerLength = typeof body.answer === "string" ? Array.from(body.answer).length : 0;

          const isHeaderValid = cacheControl === "no-store" && requestIdHeader === `smoke-${item.id}` && traceIdHeader !== "(none)";
          const anomaly = !isHeaderValid ? "HEADER_MISMATCH" : answerLength === 0 ? "EMPTY_ANSWER" : "NONE";

          results.push({
            id: item.id,
            status: "SUCCESS",
            httpStatus: 200,
            latencyMs,
            answerLength,
            cacheControl,
            anomaly,
          });

          console.log(`  -> Status: 200 OK (${latencyMs}ms)`);
          console.log(`  -> Answer length: ${answerLength} code points`);
          console.log(`  -> Cache-Control: ${cacheControl} | X-Request-ID: ${requestIdHeader} | X-Trace-ID: ${traceIdHeader}`);
        } else {
          const latencyMsErr = Date.now() - start;
          results.push({
            id: item.id,
            status: "FAILED",
            httpStatus: response.status,
            latencyMs: latencyMsErr,
            answerLength: 0,
            cacheControl,
            anomaly: `HTTP_${response.status}`,
          });
          console.log(`  -> Status: ${response.status} (${latencyMsErr}ms)`);
        }
      } catch (err: unknown) {
        const latencyMsErr = Date.now() - start;
        results.push({
          id: item.id,
          status: "ERROR",
          httpStatus: 500,
          latencyMs: latencyMsErr,
          answerLength: 0,
          cacheControl: "none",
          anomaly: err instanceof Error ? err.name : "FETCH_ERROR",
        });
        console.log(`  -> Error: ${err instanceof Error ? err.name : String(err)} (${latencyMsErr}ms)`);
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    console.log("\n[CLEANUP] Backend test server shut down cleanly.");
  }

  console.log("\n=== END-TO-END HTTP SMOKE TEST SUMMARY TABLE ===");
  console.table(results);

  const smokeFailed = results.some(
    (result) =>
      result.status !== "SUCCESS" ||
      result.httpStatus !== 200 ||
      result.anomaly !== "NONE",
  );

  if (smokeFailed) {
    console.error("\n[SMOKE FAILED] One or more test queries encountered an error or anomaly.");
    process.exitCode = 1;
  } else {
    console.log("\n[SMOKE PASSED] All 3 queries succeeded with HTTP 200 and zero anomalies.");
  }
}

main().catch((err) => {
  console.error("Fatal error in smoke test:", err);
  process.exit(1);
});
