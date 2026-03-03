import test from "node:test";
import assert from "node:assert/strict";
import type { RpcProvider } from "starknet";
import { TalosEventIndexer } from "./eventIndexer.js";
import type { TalosDeploymentConfig } from "../deployment/addressBook.js";

const deployment: TalosDeploymentConfig = {
  network: "sepolia",
  chainId: "0x534e5f5345504f4c4941",
  modules: {
    identity: "0x111",
    settlement: "0x222",
    reputation: "0x333",
    core: "0x444",
  },
  tokens: {
    STRK: "0x555",
    WBTC: "0x666",
    STRKBTC: "0x777",
    USDC: "0x888",
  },
};

test("TalosEventIndexer polls and maps events", async () => {
  let callCount = 0;
  const provider = {
    getEvents: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          events: [
            {
              from_address: "0x111",
              block_number: 123,
              transaction_hash: "0xtx",
              keys: ["0xk1"],
              data: ["0xd1", "0xd2"],
            },
          ],
        };
      }
      return { events: [] };
    },
  } as unknown as RpcProvider;

  const sinkCalls: number[] = [];
  const indexer = new TalosEventIndexer(provider, deployment, {
    sink: (events) => {
      sinkCalls.push(events.length);
    },
  });

  const events = await indexer.pollRange(100, 130);
  assert.equal(events.length, 1);
  assert.equal(events[0].module, "identity");
  assert.equal(events[0].transactionHash, "0xtx");
  assert.equal(sinkCalls.length, 1);
  assert.equal(sinkCalls[0], 1);
});
