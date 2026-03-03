import test from "node:test";
import assert from "node:assert/strict";
import { selectSettlementToken } from "./tokenPolicy.js";

test("selectSettlementToken honors preferred order when balance is sufficient", () => {
  const selected = selectSettlementToken({
    amount: 50n,
    supportedTokens: ["0xaaa", "0xbbb"],
    preferredOrder: ["0xbbb", "0xaaa"],
    balances: [
      { tokenAddress: "0xaaa", balance: 100n },
      { tokenAddress: "0xbbb", balance: 100n },
    ],
  });

  assert.equal(selected, "0xbbb");
});

test("selectSettlementToken falls back to highest balance token", () => {
  const selected = selectSettlementToken({
    amount: 20n,
    supportedTokens: ["0xaaa", "0xbbb", "0xccc"],
    balances: [
      { tokenAddress: "0xaaa", balance: 40n },
      { tokenAddress: "0xbbb", balance: 10n },
      { tokenAddress: "0xccc", balance: 80n },
    ],
  });

  assert.equal(selected, "0xccc");
});

test("selectSettlementToken enforces reserve and throws when no token can pay", () => {
  assert.throws(
    () =>
      selectSettlementToken({
        amount: 90n,
        supportedTokens: ["0xaaa"],
        balances: [{ tokenAddress: "0xaaa", balance: 100n }],
        minReserveByToken: { "0xaaa": 20n },
      }),
    /no supported token has sufficient balance/,
  );
});
