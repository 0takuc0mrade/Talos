import test from "node:test";
import assert from "node:assert/strict";
import { TalosExecutionGuardrails } from "./policy.js";

const sampleInput = {
  payerAddress: "0x111",
  payeeAddress: "0x222",
  tokenAddress: "0xaaa",
  amount: 100n,
  taskCommitment: "0xabc",
  deadline: 1_800_000_000,
  signature: ["0x1", "0x2"],
  targetAgentId: 1n,
  score: 80,
};

test("TalosExecutionGuardrails blocks paused mode", () => {
  const guardrails = new TalosExecutionGuardrails({ paused: true });
  assert.throws(() => guardrails.assertCanExecute(sampleInput), /paused/);
});

test("TalosExecutionGuardrails enforces token amount cap", () => {
  const guardrails = new TalosExecutionGuardrails({
    maxAmountByToken: { "0xaaa": 50n },
  });
  assert.throws(() => guardrails.assertCanExecute(sampleInput), /exceeds cap/);
});

test("TalosExecutionGuardrails enforces rate limits", () => {
  let nowMs = 1_700_000_000_000;
  const guardrails = new TalosExecutionGuardrails({
    nowMs: () => nowMs,
    payerRateLimit: { maxCalls: 1, windowMs: 1_000 },
  });

  guardrails.assertCanExecute(sampleInput);
  assert.throws(() => guardrails.assertCanExecute(sampleInput), /payer rate limit exceeded/);

  nowMs += 2_000;
  guardrails.assertCanExecute(sampleInput);
});
