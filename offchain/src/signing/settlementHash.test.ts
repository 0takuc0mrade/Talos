import test from "node:test";
import assert from "node:assert/strict";
import { shortString } from "starknet";
import { computeSettlementMessageHash } from "./settlementHash.js";

test("settlement hash vector 1", () => {
  const hash = computeSettlementMessageHash({
    verifyingContract: "0x457",
    chainId: shortString.encodeShortString("SN_SEPOLIA"),
    payerAddress: "0x111",
    payeeAddress: "0x222",
    tokenAddress: "0x333",
    amount: 1_000_000n,
    taskCommitment: "0x0abc123",
    deadline: 1_735_689_600,
  });

  assert.equal(
    hash.toLowerCase(),
    "0x69581519a53d776ef6bb583c847d1418def4ecd056e0cfc31f7bce08533de8f",
  );
});

test("settlement hash vector 2", () => {
  const hash = computeSettlementMessageHash({
    verifyingContract: "0x777",
    chainId: shortString.encodeShortString("SN_MAIN"),
    payerAddress: "0x1001",
    payeeAddress: "0x2002",
    tokenAddress: "0x3003",
    amount: 340282366920938463463374607431768211457n,
    taskCommitment: "0x0555aaa999",
    deadline: 1_800_000_001,
  });

  assert.equal(
    hash.toLowerCase(),
    "0x50691305e7022f55ca1a5074bac007e08584c714c735d8cfdc5121eb538bc9c",
  );
});
