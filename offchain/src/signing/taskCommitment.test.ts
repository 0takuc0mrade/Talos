import test from "node:test";
import assert from "node:assert/strict";
import { computeTaskCommitment } from "./taskCommitment.js";

test("task commitment is deterministic", () => {
  const first = computeTaskCommitment({
    externalTaskRef: "invoice-42",
    nonce: "0xabc",
    payerAddress: "0x111",
    payeeAddress: "0x222",
    salt: "0x555",
  });

  const second = computeTaskCommitment({
    externalTaskRef: "invoice-42",
    nonce: "0xabc",
    payerAddress: "0x111",
    payeeAddress: "0x222",
    salt: "0x555",
  });

  assert.equal(first, second);
});

test("task commitment changes with salt", () => {
  const first = computeTaskCommitment({
    externalTaskRef: "invoice-42",
    nonce: "0xabc",
    payerAddress: "0x111",
    payeeAddress: "0x222",
    salt: "0x555",
  });

  const second = computeTaskCommitment({
    externalTaskRef: "invoice-42",
    nonce: "0xabc",
    payerAddress: "0x111",
    payeeAddress: "0x222",
    salt: "0x556",
  });

  assert.notEqual(first, second);
});
