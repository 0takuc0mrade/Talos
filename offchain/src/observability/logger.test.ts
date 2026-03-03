import test from "node:test";
import assert from "node:assert/strict";
import { createTalosLogger } from "./logger.js";

test("createTalosLogger redacts sensitive keys", () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (line?: unknown) => {
    lines.push(String(line));
  };

  try {
    const logger = createTalosLogger({ level: "debug" });
    logger.info("payment", {
      signature: ["0x1", "0x2"],
      nested: { privateKey: "0xdeadbeef" },
      safe: "ok",
    });
  } finally {
    console.log = original;
  }

  assert.equal(lines.length, 1);
  assert.match(lines[0], /"signature":"\[REDACTED\]"/);
  assert.match(lines[0], /"privateKey":"\[REDACTED\]"/);
  assert.match(lines[0], /"safe":"ok"/);
});
