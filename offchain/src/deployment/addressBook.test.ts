import test from "node:test";
import assert from "node:assert/strict";
import { getDefaultChainId, loadTalosDeploymentFromEnv, tokenAddressList } from "./addressBook.js";

function sampleEnv(): NodeJS.ProcessEnv {
  return {
    TALOS_NETWORK: "sepolia",
    STARKNET_CHAIN_ID: getDefaultChainId("sepolia"),
    TALOS_IDENTITY_ADDRESS: "0x111",
    TALOS_SETTLEMENT_ADDRESS: "0x222",
    TALOS_REPUTATION_ADDRESS: "0x333",
    TALOS_CORE_ADDRESS: "0x444",
    TALOS_TOKEN_STRK_ADDRESS: "0x555",
    TALOS_TOKEN_WBTC_ADDRESS: "0x666",
    TALOS_TOKEN_STRKBTC_ADDRESS: "0x777",
    TALOS_TOKEN_USDC_ADDRESS: "0x888",
  };
}

test("loadTalosDeploymentFromEnv normalizes and validates addresses", () => {
  const deployment = loadTalosDeploymentFromEnv(sampleEnv());
  assert.equal(deployment.network, "sepolia");
  assert.equal(deployment.modules.identity, "0x111");
  assert.deepEqual(tokenAddressList(deployment), ["0x555", "0x666", "0x777", "0x888"]);
});

test("loadTalosDeploymentFromEnv rejects duplicate addresses", () => {
  const env = sampleEnv();
  env.TALOS_TOKEN_USDC_ADDRESS = env.TALOS_TOKEN_STRK_ADDRESS;

  assert.throws(
    () => loadTalosDeploymentFromEnv(env),
    /duplicate address detected/,
  );
});
