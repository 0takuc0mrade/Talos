import test from "node:test";
import assert from "node:assert/strict";
import { createTalosX402InterceptorDeps } from "./talosDeps.js";

const TASK_COMMITMENT =
  "0x12ab34cd56ef7890ab12cd34ef56ab7890cd12ef34ab56cd78ef90ab12cd34";

test("createTalosX402InterceptorDeps selects token from policy before signing", async () => {
  const deps = createTalosX402InterceptorDeps({
    verifyingContract: "0x457",
    chainId: "0x534e5f5345504f4c4941",
    signer: {
      signMessageHash: async () => ["0x1", "0x2"],
    },
    executeWorkflow: async () => "0xtx",
    getTokenBalances: async () => [
      { tokenAddress: "0xaaa", balance: 100n },
      { tokenAddress: "0xbbb", balance: 1000n },
    ],
    preferredTokenOrder: ["0xbbb", "0xaaa"],
  });

  const response = new Response(null, {
    status: 402,
    headers: {
      "x402-challenge": JSON.stringify({
        payer_address: "0x111",
        payee_address: "0x222",
        token_address: "0xaaa",
        supported_tokens: ["0xaaa", "0xbbb"],
        amount: "50",
        task_commitment: TASK_COMMITMENT,
        deadline: 1735689600,
        target_agent_id: "9",
        score: 90,
      }),
    },
  });

  const challenge = await deps.parseChallenge(response);
  assert.equal(challenge.tokenAddress, "0xbbb");

  const proof = await deps.signChallenge(challenge);
  assert.equal(proof.signature.length, 2);
  assert.ok(proof.messageHash?.startsWith("0x"));
});
