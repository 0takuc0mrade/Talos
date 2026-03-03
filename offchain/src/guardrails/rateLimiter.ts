export interface RateLimitRule {
  maxCalls: number;
  windowMs: number;
}

function assertRule(rule: RateLimitRule): void {
  if (rule.maxCalls <= 0) {
    throw new Error("rate limit maxCalls must be > 0");
  }
  if (rule.windowMs <= 0) {
    throw new Error("rate limit windowMs must be > 0");
  }
}

// In-memory sliding-window limiter. Suitable for single-process MVP runtime.
export class SlidingWindowRateLimiter {
  private readonly rule: RateLimitRule;
  private readonly buckets = new Map<string, number[]>();

  constructor(rule: RateLimitRule) {
    assertRule(rule);
    this.rule = rule;
  }

  tryConsume(key: string, nowMs: number = Date.now()): boolean {
    const windowStart = nowMs - this.rule.windowMs;
    const bucket = this.buckets.get(key) ?? [];
    const recent = bucket.filter((timestamp) => timestamp > windowStart);

    if (recent.length >= this.rule.maxCalls) {
      this.buckets.set(key, recent);
      return false;
    }

    recent.push(nowMs);
    this.buckets.set(key, recent);
    return true;
  }
}
