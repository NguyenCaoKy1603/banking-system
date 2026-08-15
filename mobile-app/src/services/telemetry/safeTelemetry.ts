export type SafeTelemetryPrimitive = string | number | boolean | null;

export type SafeTelemetryEvent = {
  name: string;
  properties: Record<string, SafeTelemetryPrimitive>;
  occurredAt: number;
};

export type TelemetrySink = (event: SafeTelemetryEvent) => void;

const ALLOWED_PROPERTY_KEYS = new Set([
  "code",
  "durationMs",
  "feature",
  "method",
  "outcome",
  "retry",
  "screen",
  "source",
  "status",
  "traceId",
]);

let telemetrySink: TelemetrySink = () => undefined;

function isSafePrimitive(value: unknown): value is SafeTelemetryPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function redactTelemetryProperties(
  properties: Record<string, unknown>,
): Record<string, SafeTelemetryPrimitive> {
  const redacted: Record<string, SafeTelemetryPrimitive> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (ALLOWED_PROPERTY_KEYS.has(key) && isSafePrimitive(value)) {
      redacted[key] = value;
    }
  }

  return redacted;
}

export function configureTelemetrySink(sink: TelemetrySink): () => void {
  const previousSink = telemetrySink;
  telemetrySink = sink;

  return () => {
    telemetrySink = previousSink;
  };
}

export function recordTelemetryEvent(
  name: string,
  properties: Record<string, unknown> = {},
): void {
  const safeName = /^[a-z0-9_.-]+$/i.test(name) ? name : "unknown";
  const event: SafeTelemetryEvent = {
    name: safeName,
    properties: redactTelemetryProperties(properties),
    occurredAt: Date.now(),
  };

  try {
    telemetrySink(event);
  } catch {
    // Telemetry must never change the banking operation's result.
  }
}
