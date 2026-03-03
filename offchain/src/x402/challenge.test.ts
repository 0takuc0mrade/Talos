import test from "node:test";
import assert from "node:assert/strict";
import { parseX402Challenge } from "./challenge.js";

test("parseX402Challenge supports x402-challenge header JSON", async () => {
  const headerPayload = JSON.stringify({
    payer_address: "0x111",
    payee_address: "0x222",
    token_address: "0x333",
    supported_tokens: ["0x333", "0x444"],
    amount: "1000000",
    task_commitment: "0xabc",
    deadline: 1735689600,
    target_agent_id: "7",
    score: 88,
  });

  const response = new Response(null, {
    status: 402,
    headers: { "x402-challenge": headerPayload },
  });

  const parsed = await parseX402Challenge(response);
  assert.equal(parsed.payerAddress, "0x111");
  assert.equal(parsed.tokenAddress, "0x333");
  assert.equal(parsed.amount, 1000000n);
  assert.equal(parsed.taskCommitment, "0xabc");
  assert.equal(parsed.targetAgentId, 7n);
  assert.equal(parsed.score, 88);
  assert.deepEqual(parsed.supportedTokens, ["0x333", "0x444"]);
});

test("parseX402Challenge supports body JSON fallback", async () => {
  const response = new Response(
    JSON.stringify({
      payer: "0x111",
      payee: "0x222",
      token: "0x333",
      amount: "100",
      task_id: "0xabc",
      deadline: "1735689600",
      target_agent_id: "2",
    }),
    { status: 402, headers: { "content-type": "application/json" } },
  );

  const parsed = await parseX402Challenge(response);
  assert.equal(parsed.payerAddress, "0x111");
  assert.equal(parsed.taskCommitment, "0xabc");
  assert.equal(parsed.score, 0);
});
