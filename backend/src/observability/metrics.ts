type Labels = Record<string, string>;
type MetricType = "counter" | "gauge" | "histogram";

type MetricDefinition = {
  type: MetricType;
  help: string;
  allowedLabels: ReadonlySet<string>;
  buckets: readonly number[];
};

type HistogramSeries = {
  buckets: number[];
  count: number;
  sum: number;
};

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function labelKey(labels: Labels = {}): string {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, value]) => `${label}="${escapeLabel(value)}"`)
    .join(",");
}

function metricKey(name: string, labels: Labels = {}): string {
  const suffix = labelKey(labels);
  return suffix ? `${name}{${suffix}}` : name;
}

function assertMetricName(name: string): void {
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) throw new Error(`Invalid Prometheus metric name: ${name}`);
}

function normalizeLabels(labels: Labels, allowedLabels: ReadonlySet<string>): Labels {
  for (const [name, value] of Object.entries(labels)) {
    if (!allowedLabels.has(name)) throw new Error(`Metric label ${name} is not allowed.`);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Invalid Prometheus label name: ${name}`);
    if (value.length > 64) throw new Error(`Metric label ${name} is too long.`);
  }
  return Object.fromEntries(Object.entries(labels).map(([name, value]) => [name, String(value)]));
}

/** Dependency-free Prometheus registry used by the local preview. */
export class PrometheusRegistry {
  private readonly definitions = new Map<string, MetricDefinition>();
  private readonly values = new Map<string, number>();
  private readonly histograms = new Map<string, HistogramSeries>();

  define(name: string, type: MetricType, help: string, allowedLabels: readonly string[] = [], buckets: readonly number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]): void {
    assertMetricName(name);
    const existing = this.definitions.get(name);
    if (existing && (existing.type !== type || existing.help !== help)) throw new Error(`Metric ${name} was defined inconsistently.`);
    this.definitions.set(name, { type, help, allowedLabels: new Set(allowedLabels), buckets: [...buckets].sort((a, b) => a - b) });
  }

  increment(name: string, value = 1, labels: Labels = {}): void {
    const definition = this.definitions.get(name);
    if (!definition || definition.type !== "counter") throw new Error(`Counter ${name} is not registered.`);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Counter ${name} increment must be non-negative.`);
    const normalized = normalizeLabels(labels, definition.allowedLabels);
    const key = metricKey(name, normalized);
    this.values.set(key, (this.values.get(key) ?? 0) + value);
  }

  set(name: string, value: number, labels: Labels = {}): void {
    const definition = this.definitions.get(name);
    if (!definition || definition.type !== "gauge") throw new Error(`Gauge ${name} is not registered.`);
    const normalized = normalizeLabels(labels, definition.allowedLabels);
    this.values.set(metricKey(name, normalized), Number.isFinite(value) ? value : 0);
  }

  add(name: string, delta: number, labels: Labels = {}): void {
    const definition = this.definitions.get(name);
    if (!definition || definition.type !== "gauge") throw new Error(`Gauge ${name} is not registered.`);
    const normalized = normalizeLabels(labels, definition.allowedLabels);
    const key = metricKey(name, normalized);
    this.values.set(key, (this.values.get(key) ?? 0) + delta);
  }

  observe(name: string, value: number, labels: Labels = {}): void {
    const definition = this.definitions.get(name);
    if (!definition || definition.type !== "histogram") throw new Error(`Histogram ${name} is not registered.`);
    if (!Number.isFinite(value) || value < 0) return;
    const normalized = normalizeLabels(labels, definition.allowedLabels);
    const key = labelKey(normalized);
    const series = this.histograms.get(`${name}|${key}`) ?? { buckets: definition.buckets.map(() => 0), count: 0, sum: 0 };
    definition.buckets.forEach((bucket, index) => { if (value <= bucket) series.buckets[index] += 1; });
    series.count += 1;
    series.sum += value;
    this.histograms.set(`${name}|${key}`, series);
  }

  prometheus(): string {
    const lines: string[] = [];
    for (const [name, definition] of this.definitions) {
      lines.push(`# HELP ${name} ${definition.help}`, `# TYPE ${name} ${definition.type}`);
      if (definition.type === "histogram") {
        for (const [key, series] of this.histograms) {
          if (!key.startsWith(`${name}|`)) continue;
          const labels = key.slice(name.length + 1);
          const parsed = labels ? labels.split(",").filter(Boolean) : [];
          definition.buckets.forEach((bucket, index) => {
            const suffix = [...parsed, `le="${bucket}"`].filter(Boolean).join(",");
            lines.push(`${name}_bucket{${suffix}} ${series.buckets[index] ?? 0}`);
          });
          const suffix = parsed.join(",");
          lines.push(`${name}_bucket{${suffix ? `${suffix},` : ""}le="+Inf"} ${series.count}`, `${name}_sum${suffix ? `{${suffix}}` : ""} ${series.sum}`, `${name}_count${suffix ? `{${suffix}}` : ""} ${series.count}`);
        }
      } else {
        for (const [key, value] of this.values) if (key === name || key.startsWith(`${name}{`)) lines.push(`${key} ${value}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }

  snapshot(): Record<string, number> {
    const snapshot: Record<string, number> = Object.fromEntries(this.values);
    for (const [key, series] of this.histograms) {
      const [name, labels] = key.split("|");
      snapshot[`${name}_count${labels ? `{${labels}}` : ""}`] = series.count;
      snapshot[`${name}_sum${labels ? `{${labels}}` : ""}`] = series.sum;
    }
    return snapshot;
  }
}

type WorkerMetricLabels = Record<string, string>;

/** Backwards-compatible worker registry with histogram support. */
export class WorkerMetrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, { buckets: number[]; count: number; sum: number }>();
  private readonly bounds = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

  increment(name: string, value = 1, labels: WorkerMetricLabels = {}): void {
    const key = metricKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  set(name: string, value: number, labels: WorkerMetricLabels = {}): void {
    this.gauges.set(metricKey(name, labels), Number.isFinite(value) ? value : 0);
  }

  observe(name: string, value: number, labels: WorkerMetricLabels = {}): void {
    if (!Number.isFinite(value) || value < 0) return;
    const key = metricKey(name, labels);
    const series = this.histograms.get(key) ?? { buckets: this.bounds.map(() => 0), count: 0, sum: 0 };
    this.bounds.forEach((bound, index) => { if (value <= bound) series.buckets[index] += 1; });
    series.count += 1;
    series.sum += value;
    this.histograms.set(key, series);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries([
      ...this.counters,
      ...this.gauges,
      ...[...this.histograms].map(([key, series]) => [`${key}_count`, series.count]),
    ]);
  }

  prometheus(): string {
    const lines: string[] = [];
    for (const [metric, value] of [...this.counters, ...this.gauges]) lines.push(`${metric} ${Number.isFinite(value) ? value : 0}`);
    for (const [metric, series] of this.histograms) {
      const brace = metric.indexOf("{");
      const base = brace >= 0 ? metric.slice(0, brace) : metric;
      const labels = brace >= 0 ? metric.slice(brace + 1, -1) : "";
      const suffix = labels ? `${labels},` : "";
      this.bounds.forEach((bound, index) => lines.push(`${base}_bucket{${suffix}le="${bound}"} ${series.buckets[index] ?? 0}`));
      lines.push(`${base}_bucket{${suffix}le="+Inf"} ${series.count}`, `${base}_sum${labels ? `{${labels}}` : ""} ${series.sum}`, `${base}_count${labels ? `{${labels}}` : ""} ${series.count}`);
    }
    return `${lines.join("\n")}\n`;
  }
}

export function registerHttpMetrics(registry: PrometheusRegistry): void {
  registry.define("http_requests_total", "counter", "HTTP requests completed.", ["method", "route", "status_class", "outcome"]);
  registry.define("http_request_duration_seconds", "histogram", "HTTP request duration in seconds.", ["method", "route"], [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]);
  registry.define("http_requests_active", "gauge", "HTTP requests currently in flight.", ["service"]);
}

export function registerBusinessMetrics(registry: PrometheusRegistry): void {
  registry.define("banking_health_checks_total", "counter", "Business health checks completed.", ["status"]);
  registry.define("banking_reconciliation_mismatch", "gauge", "Current business reconciliation mismatch flag.");
  registry.define("banking_outbox_pending_events", "gauge", "Current pending outbox events observed by the API boundary.");
  registry.define("banking_transfer_requests_total", "counter", "Transfer API operations by bounded operation and outcome.", ["operation", "outcome"]);
  registry.define("database_pool_total", "gauge", "Database pool connections currently allocated.");
  registry.define("database_pool_idle", "gauge", "Database pool idle connections.");
  registry.define("database_pool_waiting", "gauge", "Clients waiting for a database pool connection.");
  registry.define("database_pool_max", "gauge", "Configured maximum database pool connections.");
  registry.define("database_query_total", "gauge", "Database queries observed by the API pool wrapper.");
  registry.define("database_query_errors_total", "gauge", "Database query errors observed by the API pool wrapper.");
  registry.define("database_slow_queries_total", "gauge", "Database queries over the configured local slow-query threshold.");
  registry.define("database_last_slow_query_duration_seconds", "gauge", "Duration of the last observed slow database query in seconds.");
}

export type DatabasePoolMetricSnapshot = {
  total: number;
  idle: number;
  waiting: number;
  max: number;
  queryTotal?: number;
  queryErrors?: number;
  slowQueries?: number;
  lastSlowQueryDurationMs?: number;
};

export function collectDatabaseMetrics(registry: PrometheusRegistry, snapshot: DatabasePoolMetricSnapshot | undefined): void {
  if (!snapshot) return;
  registry.set("database_pool_total", snapshot.total);
  registry.set("database_pool_idle", snapshot.idle);
  registry.set("database_pool_waiting", snapshot.waiting);
  registry.set("database_pool_max", snapshot.max);
  registry.set("database_query_total", snapshot.queryTotal ?? 0);
  registry.set("database_query_errors_total", snapshot.queryErrors ?? 0);
  registry.set("database_slow_queries_total", snapshot.slowQueries ?? 0);
  registry.set("database_last_slow_query_duration_seconds", (snapshot.lastSlowQueryDurationMs ?? 0) / 1000);
}
