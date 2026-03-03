import { Contract, RpcProvider, cairo } from "starknet";
import { ERC20_ABI, IDENTITY_ABI, SETTLEMENT_ABI } from "./abis";

export interface TalosAddresses {
  identity: string;
  settlement: string;
  reputation: string;
  core: string;
}

export interface TalosTokens {
  STRK?: string;
  USDC?: string;
  WBTC?: string;
  STRKBTC?: string;
}

export type WalletMode = "starkzap_signer" | "starkzap_cartridge" | "injected";

export interface WalletSession {
  account: unknown;
  address: string;
  mode: WalletMode;
  wallet?: unknown;
}

export interface HumanWalletConnectConfig {
  mode: WalletMode;
  rpcUrl: string;
  network: "sepolia" | "mainnet";
  feeMode: "user_pays" | "sponsored";
  autoEnsureReady: boolean;
}

export interface ActivityEvent {
  module: "identity" | "settlement" | "reputation" | "core";
  txHash: string;
  blockNumber: number;
  fromAddress: string;
  keys: string[];
  data: string[];
}

interface StarkzapSigner {
  getPubKey: () => Promise<string>;
  signRaw: (hash: string) => Promise<unknown>;
}

interface StarkzapWalletLike {
  address: { toString: () => string } | string;
  getAccount: () => unknown;
  ensureReady?: (options: {
    deploy?: "never" | "if_needed" | "always";
    feeMode?: "user_pays" | "sponsored";
  }) => Promise<void>;
}

const MODULE_ORDER: Array<ActivityEvent["module"]> = ["core", "settlement", "reputation", "identity"];

declare global {
  interface Window {
    __TALOS_STARKZAP_SIGNER__?: StarkzapSigner | (() => StarkzapSigner | Promise<StarkzapSigner>);
    __TALOS_STARKZAP_CARTRIDGE_OPTIONS__?: Record<string, unknown>;
    starknet?: {
      enable?: (options?: Record<string, unknown>) => Promise<unknown>;
      account?: unknown;
      selectedAddress?: string;
    };
  }
}

export function normalizeHex(value: string): string {
  return `0x${BigInt(value).toString(16)}`;
}

export function shortHex(value: string, lead = 6, tail = 4): string {
  const normalized = normalizeHex(value);
  if (normalized.length <= lead + tail + 2) {
    return normalized;
  }
  return `${normalized.slice(0, lead + 2)}...${normalized.slice(-tail)}`;
}

function toBigIntU256(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    return BigInt(value);
  }
  if (typeof value === "string") {
    return BigInt(value);
  }
  if (Array.isArray(value) && value.length >= 2) {
    const low = BigInt(value[0] as string | number | bigint);
    const high = BigInt(value[1] as string | number | bigint);
    return low + (high << 128n);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.low !== undefined && record.high !== undefined) {
      return BigInt(record.low as string | number | bigint) +
        (BigInt(record.high as string | number | bigint) << 128n);
    }
  }
  throw new Error("unable to parse u256 value");
}

function parseBool(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    return BigInt(value) !== 0n;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (Array.isArray(value) && value.length > 0) {
    return parseBool(value[0]);
  }
  return false;
}

function assertStarkzapSigner(candidate: unknown): StarkzapSigner {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("Starkzap signer is missing");
  }
  const signer = candidate as Partial<StarkzapSigner>;
  if (typeof signer.getPubKey !== "function" || typeof signer.signRaw !== "function") {
    throw new Error("Invalid Starkzap signer. Expected getPubKey() + signRaw().");
  }
  return signer as StarkzapSigner;
}

async function resolveStarkzapSignerFromWindow(): Promise<StarkzapSigner> {
  const source = window.__TALOS_STARKZAP_SIGNER__;
  if (!source) {
    throw new Error(
      "window.__TALOS_STARKZAP_SIGNER__ is not set. Inject a Privy/Cartridge-compatible signer before connecting.",
    );
  }

  if (typeof source === "function") {
    return assertStarkzapSigner(await source());
  }

  return assertStarkzapSigner(source);
}

async function connectStarkzapWallet(config: HumanWalletConnectConfig): Promise<WalletSession> {
  const starkzap = await import("starkzap");
  if (!starkzap?.StarkSDK) {
    throw new Error("Failed to load StarkSDK from starkzap package.");
  }

  const sdk = new starkzap.StarkSDK({
    network: config.network,
    rpcUrl: config.rpcUrl
  });

  let wallet: StarkzapWalletLike;
  if (config.mode === "starkzap_cartridge") {
    wallet = (await sdk.connectCartridge(window.__TALOS_STARKZAP_CARTRIDGE_OPTIONS__)) as StarkzapWalletLike;
  } else {
    const signer = await resolveStarkzapSignerFromWindow();
    wallet = (await sdk.connectWallet({
      account: { signer: signer as any },
      feeMode: config.feeMode
    })) as StarkzapWalletLike;
  }

  if (config.autoEnsureReady && typeof wallet.ensureReady === "function") {
    await wallet.ensureReady({ deploy: "if_needed", feeMode: config.feeMode });
  }

  const account = wallet.getAccount();
  const walletAddressRaw =
    typeof wallet.address === "string" ? wallet.address : wallet.address?.toString?.();
  const accountAddressRaw = (account as { address?: string } | undefined)?.address;
  const addressRaw = walletAddressRaw ?? accountAddressRaw;

  if (!addressRaw) {
    throw new Error("Unable to resolve Starkzap wallet address.");
  }

  return {
    account,
    address: normalizeHex(String(addressRaw)),
    mode: config.mode,
    wallet
  };
}

async function connectInjectedWallet(): Promise<WalletSession> {
  const wallet = window.starknet;
  if (!wallet) {
    throw new Error("No Starknet wallet found. Install ArgentX or Braavos.");
  }

  if (typeof wallet.enable === "function") {
    await wallet.enable({ showModal: true });
  }

  const account = wallet.account;
  const addressRaw = wallet.selectedAddress ?? (account as { address?: string } | undefined)?.address;
  if (!account || !addressRaw) {
    throw new Error("Wallet connection failed.");
  }

  return {
    account,
    address: normalizeHex(String(addressRaw)),
    mode: "injected"
  };
}

export async function connectHumanWallet(config: HumanWalletConnectConfig): Promise<WalletSession> {
  if (config.mode === "injected") {
    return connectInjectedWallet();
  }
  return connectStarkzapWallet(config);
}

export function makeProvider(rpcUrl: string): RpcProvider {
  return new RpcProvider({ nodeUrl: rpcUrl });
}

export async function getAgentCount(provider: RpcProvider, identityAddress: string): Promise<bigint> {
  const contract = new Contract({
    abi: IDENTITY_ABI as any,
    address: identityAddress,
    providerOrAccount: provider as any
  });

  const countRaw = await (contract as any).get_agent_count();
  return toBigIntU256(countRaw);
}

export async function registerAgent(
  account: unknown,
  identityAddress: string,
  pubKey: string,
  metadataUri: string
): Promise<string> {
  const contract = new Contract({
    abi: IDENTITY_ABI as any,
    address: identityAddress,
    providerOrAccount: account as any
  });

  const result = await (contract as any).register_agent(pubKey, metadataUri);
  const hash = (result?.transaction_hash ?? result?.transactionHash ?? result?.hash) as string | undefined;
  if (!hash) {
    throw new Error("register_agent did not return a transaction hash");
  }
  return normalizeHex(hash);
}

export async function approveToken(
  account: unknown,
  tokenAddress: string,
  spenderAddress: string,
  rawAmount: bigint
): Promise<string> {
  const contract = new Contract({
    abi: ERC20_ABI as any,
    address: tokenAddress,
    providerOrAccount: account as any
  });

  const result = await (contract as any).approve(spenderAddress, cairo.uint256(rawAmount.toString()));
  const hash = (result?.transaction_hash ?? result?.transactionHash ?? result?.hash) as string | undefined;
  if (!hash) {
    throw new Error("approve did not return a transaction hash");
  }
  return normalizeHex(hash);
}

export async function checkTokenSupported(
  provider: RpcProvider,
  settlementAddress: string,
  tokenAddress: string
): Promise<boolean> {
  const contract = new Contract({
    abi: SETTLEMENT_ABI as any,
    address: settlementAddress,
    providerOrAccount: provider as any
  });

  const supported = await (contract as any).is_supported_token(tokenAddress);
  return parseBool(supported);
}

export async function getRecentActivity(
  provider: RpcProvider,
  addresses: TalosAddresses,
  lookbackBlocks = 140,
  chunkSize = 20
): Promise<ActivityEvent[]> {
  const latest = await provider.getBlockNumber();
  const from = Math.max(0, latest - lookbackBlocks);

  const moduleMap: Array<[ActivityEvent["module"], string]> = [
    ["identity", addresses.identity],
    ["settlement", addresses.settlement],
    ["reputation", addresses.reputation],
    ["core", addresses.core]
  ];

  const events: ActivityEvent[] = [];

  for (const [module, address] of moduleMap) {
    const response = await provider.getEvents({
      address,
      from_block: { block_number: from },
      to_block: { block_number: latest },
      chunk_size: chunkSize
    } as any);

    const rawEvents = ((response as Record<string, unknown>).events ?? []) as Array<Record<string, unknown>>;

    for (const event of rawEvents) {
      const txHash = event.transaction_hash ? normalizeHex(String(event.transaction_hash)) : "";
      const blockNumber = Number(event.block_number ?? 0);
      const fromAddress = event.from_address ? normalizeHex(String(event.from_address)) : normalizeHex(address);
      const keys = Array.isArray(event.keys) ? event.keys.map((v) => normalizeHex(String(v))) : [];
      const data = Array.isArray(event.data) ? event.data.map((v) => String(v)) : [];

      events.push({
        module,
        txHash,
        blockNumber,
        fromAddress,
        keys,
        data
      });
    }
  }

  events.sort((a, b) => {
    if (b.blockNumber !== a.blockNumber) {
      return b.blockNumber - a.blockNumber;
    }
    return MODULE_ORDER.indexOf(a.module) - MODULE_ORDER.indexOf(b.module);
  });

  return events.slice(0, 40);
}
