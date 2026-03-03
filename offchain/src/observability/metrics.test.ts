import test from "node:test";
import assert from "node:assert/strict";
import { TalosMetrics } from "./metrics.js";

test("TalosMetrics increments counters and durations", () => {
  const metrics = new TalosMetrics();
  metrics.increment("payments_total", { token: "usdc" });
  metrics.increment("payments_total", { token: "usdc" }, 2);
  metrics.observeDurationMs("workflow_submit", 150, { token: "usdc" });

  const snapshot = metrics.snapshot();
  const payments = snapshot.find((item) => item.name === "payments_total");
  const durationCount = snapshot.find((item) => item.name === "workflow_submit_count");
  const durationSum = snapshot.find((item) => item.name === "workflow_submit_sum_ms");

  assert.equal(payments?.value, 3);
  assert.equal(durationCount?.value, 1);
  assert.equal(durationSum?.value, 150);
});
