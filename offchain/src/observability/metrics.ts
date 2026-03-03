export interface MetricPoint {
  name: string;
  labels: Record<string, string>;
  value: number;
}

function serializeLabels(labels: Record<string, string>): string {
  const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([k, v]) => `${k}=${v}`).join(",");
}

function key(name: string, labels: Record<string, string>): string {
  const encoded = serializeLabels(labels);
  return encoded ? `${name}|${encoded}` : name;
}

export class TalosMetrics {
  private readonly counters = new Map<string, MetricPoint>();

  increment(name: string, labels: Record<string, string> = {}, by = 1): void {
    const metricKey = key(name, labels);
    const point = this.counters.get(metricKey) ?? {
      name,
      labels,
      value: 0,
    };
    point.value += by;
    this.counters.set(metricKey, point);
  }

  observeDurationMs(
    name: string,
    durationMs: number,
    labels: Record<string, string> = {},
  ): void {
    this.increment(`${name}_count`, labels, 1);
    this.increment(`${name}_sum_ms`, labels, durationMs);
  }

  snapshot(): MetricPoint[] {
    return [...this.counters.values()].map((item) => ({ ...item, labels: { ...item.labels } }));
  }
}
