import test from "node:test";
import assert from "node:assert/strict";
import { shortString } from "starknet";
import { computeSettlementMessageHash } from "./settlementHash.js";
import { signSettlementPayload } from "./signSettlementPayload.js";

test("signSettlementPayload returns message hash + normalized signature", async () => {
  const payload = {
    verifyingContract: "0x457",
    chainId: shortString.encodeShortString("SN_SEPOLIA"),
    payerAddress: "0x111",
    payeeAddress: "0x222",
    tokenAddress: "0x333",
    amount: 1_000_000n,
    taskCommitment: "0xabc123",
    deadline: 1_735_689_600,
  };

  const expectedHash = computeSettlementMessageHash(payload);
  const result = await signSettlementPayload(payload, {
    signMessageHash: async (messageHash) => {
      assert.equal(messageHash, expectedHash);
      return ["1", "0x2"];
    },
  });

  assert.equal(result.messageHash, expectedHash);
  assert.deepEqual(result.signature, ["0x1", "0x2"]);
});
