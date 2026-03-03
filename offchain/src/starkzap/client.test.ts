import test from "node:test";
import assert from "node:assert/strict";
import { initStarkzapHeadlessWallet } from "./client.js";

const baseConfig = {
  rpcUrl: "http://localhost:0",
  chainId: "0x534e5f5345504f4c4941",
  accountAddress: "0x123",
  account: {},
  useStarkzap: false as const,
};

test("initStarkzapHeadlessWallet normalizes signRaw object {r,s}", async () => {
  const runtime = await initStarkzapHeadlessWallet({
    ...baseConfig,
    signer: {
      getPubKey: async () => "0x1",
      signRaw: async () => ({ r: 10n, s: 11n, recovery: 0 }),
    },
  });

  const signature = await runtime.signer!.signMessageHash("0xabc");
  assert.deepEqual(signature, ["0xa", "0xb"]);
});

test("initStarkzapHeadlessWallet normalizes signRaw nested {signature:[...]}", async () => {
  const runtime = await initStarkzapHeadlessWallet({
    ...baseConfig,
    signer: {
      getPubKey: async () => "0x1",
      signRaw: async () => ({ signature: ["0x15", "0x16"] }),
    },
  });

  const signature = await runtime.signer!.signMessageHash("0xabc");
  assert.deepEqual(signature, ["0x15", "0x16"]);
});

test("initStarkzapHeadlessWallet keeps array signatures", async () => {
  const runtime = await initStarkzapHeadlessWallet({
    ...baseConfig,
    signer: {
      getPubKey: async () => "0x1",
      signRaw: async () => ["0x20", 33n],
    },
  });

  const signature = await runtime.signer!.signMessageHash("0xabc");
  assert.deepEqual(signature, ["0x20", "0x21"]);
});

