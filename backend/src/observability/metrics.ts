type Labels = Record<string, string>;

function key(name: string, labels: Labels = {}): string {
  const suffix = Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, value]) => `${label}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`)
    .join(",");
  return suffix ? `${name}{${suffix}}` : name;
}

export class WorkerMetrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

  increment(name: string, value = 1, labels: Labels = {}): void {
    const metricKey = key(name, labels);
    this.counters.set(metricKey, (this.counters.get(metricKey) ?? 0) + value);
  }

  set(name: string, value: number, labels: Labels = {}): void {
    this.gauges.set(key(name, labels), value);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.counters, ...this.gauges]);
  }

  prometheus(): string {
    const lines: string[] = [];
    for (const [metric, value] of [...this.counters, ...this.gauges]) {
      lines.push(`${metric} ${Number.isFinite(value) ? value : 0}`);
    }
    return `${lines.join("\n")}\n`;
  }
}
