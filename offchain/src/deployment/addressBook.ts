export type TalosNetwork = "mainnet" | "sepolia";

export interface TalosModuleAddresses {
  identity: string;
  settlement: string;
  reputation: string;
  core: string;
}

export interface TalosTokenAddresses {
  STRK: string;
  WBTC: string;
  STRKBTC: string;
  USDC: string;
}

export interface TalosDeploymentConfig {
  network: TalosNetwork;
  chainId: string;
  modules: TalosModuleAddresses;
  tokens: TalosTokenAddresses;
}

const CHAIN_ID_BY_NETWORK: Record<TalosNetwork, string> = {
  mainnet: "0x534e5f4d41494e",
  sepolia: "0x534e5f5345504f4c4941",
};

function normalizeHex(value: string): string {
  if (!value || !value.trim()) {
    throw new Error("value cannot be empty");
  }
  return `0x${BigInt(value).toString(16)}`;
}

function assertAddress(name: string, value: string): string {
  const normalized = normalizeHex(value);
  const asBigInt = BigInt(normalized);
  if (asBigInt === 0n) {
    throw new Error(`${name} cannot be zero address`);
  }
  return normalized;
}

function assertUniqueAddresses(addresses: Record<string, string>): void {
  const seen = new Map<string, string>();
  for (const [name, value] of Object.entries(addresses)) {
    const normalized = normalizeHex(value).toLowerCase();
    const existing = seen.get(normalized);
    if (existing) {
      throw new Error(`duplicate address detected: ${name} and ${existing}`);
    }
    seen.set(normalized, name);
  }
}

function asNetwork(value: string | undefined): TalosNetwork {
  const normalized = (value ?? "sepolia").toLowerCase();
  if (normalized === "mainnet" || normalized === "sepolia") {
    return normalized;
  }
  throw new Error(`unsupported TALOS_NETWORK: ${value}`);
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || !value.trim()) {
    throw new Error(`missing required env var ${key}`);
  }
  return value;
}

export function getDefaultChainId(network: TalosNetwork): string {
  return CHAIN_ID_BY_NETWORK[network];
}

export function loadTalosDeploymentFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TalosDeploymentConfig {
  const network = asNetwork(env.TALOS_NETWORK);
  const chainId = normalizeHex(env.STARKNET_CHAIN_ID ?? getDefaultChainId(network));

  const modules: TalosModuleAddresses = {
    identity: assertAddress("TALOS_IDENTITY_ADDRESS", requiredEnv(env, "TALOS_IDENTITY_ADDRESS")),
    settlement: assertAddress(
      "TALOS_SETTLEMENT_ADDRESS",
      requiredEnv(env, "TALOS_SETTLEMENT_ADDRESS"),
    ),
    reputation: assertAddress(
      "TALOS_REPUTATION_ADDRESS",
      requiredEnv(env, "TALOS_REPUTATION_ADDRESS"),
    ),
    core: assertAddress("TALOS_CORE_ADDRESS", requiredEnv(env, "TALOS_CORE_ADDRESS")),
  };

  const tokens: TalosTokenAddresses = {
    STRK: assertAddress("TALOS_TOKEN_STRK_ADDRESS", requiredEnv(env, "TALOS_TOKEN_STRK_ADDRESS")),
    WBTC: assertAddress("TALOS_TOKEN_WBTC_ADDRESS", requiredEnv(env, "TALOS_TOKEN_WBTC_ADDRESS")),
    STRKBTC: assertAddress(
      "TALOS_TOKEN_STRKBTC_ADDRESS",
      requiredEnv(env, "TALOS_TOKEN_STRKBTC_ADDRESS"),
    ),
    USDC: assertAddress("TALOS_TOKEN_USDC_ADDRESS", requiredEnv(env, "TALOS_TOKEN_USDC_ADDRESS")),
  };

  assertUniqueAddresses({
    ...modules,
    ...tokens,
  });

  return {
    network,
    chainId,
    modules,
    tokens,
  };
}

export function tokenAddressList(config: TalosDeploymentConfig): string[] {
  return [config.tokens.STRK, config.tokens.WBTC, config.tokens.STRKBTC, config.tokens.USDC];
}
