import {
  configureTelemetrySink,
  redactTelemetryProperties,
  recordTelemetryEvent,
  type SafeTelemetryEvent,
} from "@/services/telemetry/safeTelemetry";

describe("safeTelemetry", () => {
  it("keeps only allowlisted primitive properties", () => {
    expect(
      redactTelemetryProperties({
        code: "TIMEOUT",
        status: null,
        method: "GET",
        accessToken: "secret-token",
        password: "secret-password",
        proof: "123456",
        body: { amountMinor: "100000" },
      }),
    ).toEqual({
      code: "TIMEOUT",
      status: null,
      method: "GET",
    });
  });

  it("sends redacted events and normalizes unsafe event names", () => {
    const events: SafeTelemetryEvent[] = [];
    const restore = configureTelemetrySink((event) => events.push(event));

    try {
      recordTelemetryEvent("api_request_failed", {
        code: "INVALID_CREDENTIALS",
        traceId: "trace-1",
        refreshToken: "secret-token",
      });
      recordTelemetryEvent("contains secret", { password: "secret" });
    } finally {
      restore();
    }

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      name: "api_request_failed",
      properties: { code: "INVALID_CREDENTIALS", traceId: "trace-1" },
    });
    expect(events[0]).not.toEqual(expect.objectContaining({ refreshToken: expect.anything() }));
    expect(events[1].name).toBe("unknown");
    expect(events[1].properties).toEqual({});
  });

  it("swallows sink failures", () => {
    const restore = configureTelemetrySink(() => {
      throw new Error("sink unavailable");
    });

    expect(() => recordTelemetryEvent("api_request_failed", { code: "NETWORK_ERROR" })).not.toThrow();
    restore();
  });
});
