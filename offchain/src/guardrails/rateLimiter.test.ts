import test from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowRateLimiter } from "./rateLimiter.js";

test("SlidingWindowRateLimiter enforces and resets over time", () => {
  const limiter = new SlidingWindowRateLimiter({ maxCalls: 2, windowMs: 1_000 });
  const now = 1_700_000_000_000;

  assert.equal(limiter.tryConsume("k", now), true);
  assert.equal(limiter.tryConsume("k", now + 10), true);
  assert.equal(limiter.tryConsume("k", now + 20), false);
  assert.equal(limiter.tryConsume("k", now + 1_500), true);
});
