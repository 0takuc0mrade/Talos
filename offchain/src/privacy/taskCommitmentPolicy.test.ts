import test from "node:test";
import assert from "node:assert/strict";
import { assertTaskCommitment } from "./taskCommitmentPolicy.js";

const VALID_COMMITMENT = "0x12ab34cd56ef7890ab12cd34ef56ab7890cd12ef34ab56cd78ef90ab12cd34";

test("assertTaskCommitment accepts high-entropy felt hex", () => {
  const normalized = assertTaskCommitment(VALID_COMMITMENT);
  assert.equal(normalized, VALID_COMMITMENT.toLowerCase());
});

test("assertTaskCommitment rejects non-hex/plaintext values", () => {
  assert.throws(
    () => assertTaskCommitment("task-42"),
    /hex felt string/,
  );
});

test("assertTaskCommitment rejects low-entropy felt values", () => {
  assert.throws(
    () => assertTaskCommitment("0xabc"),
    /high-entropy commitment/,
  );
});

test("assertTaskCommitment allows custom minimum bit length", () => {
  const normalized = assertTaskCommitment("0xabc", { minBitLength: 8 });
  assert.equal(normalized, "0xabc");
});
