interface DurationStats {
  count: number;
  total_ms: number;
  max_ms: number;
}

type CounterMap = Map<string, number>;

const requestCounters: CounterMap = new Map();
const requestDurations: Map<string, DurationStats> = new Map();
const rateLimitCounters: CounterMap = new Map();
const abuseEventCounters: CounterMap = new Map();
const queueEventCounters: CounterMap = new Map();

function incrementCounter(counter: CounterMap, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function mapToSortedEntries(counter: CounterMap): Array<{ key: string; count: number }> {
  return Array.from(counter.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function recordHttpRequestMetric(args: {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}): void {
  const key = `${args.method.toUpperCase()} ${args.path} ${args.statusCode}`;
  incrementCounter(requestCounters, key);

  const durationKey = `${args.method.toUpperCase()} ${args.path}`;
  const existing = requestDurations.get(durationKey) ?? {
    count: 0,
    total_ms: 0,
    max_ms: 0
  };

  existing.count += 1;
  existing.total_ms += args.durationMs;
  existing.max_ms = Math.max(existing.max_ms, args.durationMs);
  requestDurations.set(durationKey, existing);
}

export function recordRateLimitMetric(bucket: string): void {
  incrementCounter(rateLimitCounters, bucket);
}

export function recordAbuseEventMetric(eventName: string): void {
  incrementCounter(abuseEventCounters, eventName);
}

export function recordQueueEventMetric(eventName: string): void {
  incrementCounter(queueEventCounters, eventName);
}

export function getMetricsSnapshot(): {
  uptime_seconds: number;
  requests: Array<{ key: string; count: number }>;
  request_durations: Array<{
    key: string;
    count: number;
    avg_ms: number;
    max_ms: number;
  }>;
  rate_limits: Array<{ key: string; count: number }>;
  abuse_events: Array<{ key: string; count: number }>;
  queue_events: Array<{ key: string; count: number }>;
} {
  return {
    uptime_seconds: Number(process.uptime().toFixed(2)),
    requests: mapToSortedEntries(requestCounters),
    request_durations: Array.from(requestDurations.entries())
      .map(([key, value]) => ({
        key,
        count: value.count,
        avg_ms: Number((value.total_ms / value.count).toFixed(2)),
        max_ms: Number(value.max_ms.toFixed(2))
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    rate_limits: mapToSortedEntries(rateLimitCounters),
    abuse_events: mapToSortedEntries(abuseEventCounters),
    queue_events: mapToSortedEntries(queueEventCounters)
  };
}

export function resetMetricsForTests(): void {
  requestCounters.clear();
  requestDurations.clear();
  rateLimitCounters.clear();
  abuseEventCounters.clear();
  queueEventCounters.clear();
}
