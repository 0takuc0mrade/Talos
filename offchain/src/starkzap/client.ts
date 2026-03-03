import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AgentWalletSigner } from "../types.js";

type FeeMode = "sponsored" | "user_pays";
type DeployMode = "never" | "if_needed" | "always";
export type StarkzapWalletMode = "signer" | "cartridge";

export interface InjectedStarkzapSigner {
  getPubKey: () => Promise<string>;
  signRaw: (hash: string) => Promise<unknown>;
}

export interface StarkzapHeadlessConfig {
  rpcUrl: string;
  chainId: string;
  accountAddress?: string;
  signer?: InjectedStarkzapSigner;
  walletMode?: StarkzapWalletMode;
  cartridgeOptions?: Record<string, unknown>;
  network?: "mainnet" | "sepolia";
  feeMode?: FeeMode;
  deployMode?: DeployMode;
  autoEnsureReady?: boolean;
  useStarkzap?: boolean;
  account?: unknown;
}

export interface StarkzapHeadlessRuntime {
  accountAddress: string;
  chainId: string;
  sdk?: unknown;
  wallet?: unknown;
  signer?: AgentWalletSigner;
  account: unknown;
}

type StarkSDKCtor = new (config: {
  network: "mainnet" | "sepolia";
  rpcUrl: string;
}) => {
  connectCartridge: (
    options?: Record<string, unknown>,
  ) => Promise<{
    address: { toString: () => string } | string;
    ensureReady: (params: { deploy: DeployMode; feeMode: FeeMode }) => Promise<void>;
    getAccount: () => unknown;
  }>;
  connectWallet: (params: {
    account: { signer: InjectedStarkzapSigner };
    feeMode: FeeMode;
  }) => Promise<{
    address: { toString: () => string } | string;
    ensureReady: (params: { deploy: DeployMode; feeMode: FeeMode }) => Promise<void>;
    getAccount: () => unknown;
  }>;
};

let cachedStarkSDKCtor: StarkSDKCtor | undefined;

async function loadStarkSDKCtor(): Promise<StarkSDKCtor> {
  if (cachedStarkSDKCtor) {
    return cachedStarkSDKCtor;
  }

  try {
    const starkzap = await import("starkzap");
    if (starkzap?.StarkSDK) {
      cachedStarkSDKCtor = starkzap.StarkSDK as StarkSDKCtor;
      return cachedStarkSDKCtor;
    }
  } catch (error) {
    const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
    const candidatePaths = [
      path.resolve(runtimeDir, "..", "..", "node_modules", "starkzap", "dist", "src", "sdk.js"),
      path.resolve(process.cwd(), "node_modules", "starkzap", "dist", "src", "sdk.js"),
    ];

    for (const sdkPath of candidatePaths) {
      if (!fs.existsSync(sdkPath)) {
        continue;
      }
      const starkzapSdkModule = await import(pathToFileURL(sdkPath).href);
      if (starkzapSdkModule?.StarkSDK) {
        cachedStarkSDKCtor = starkzapSdkModule.StarkSDK as StarkSDKCtor;
        return cachedStarkSDKCtor;
      }
    }

    const require = createRequire(import.meta.url);
    try {
      const resolvedIndex = require.resolve("starkzap");
      const sdkPath = path.join(path.dirname(resolvedIndex), "sdk.js");
      if (fs.existsSync(sdkPath)) {
        const starkzapSdkModule = await import(pathToFileURL(sdkPath).href);
        if (starkzapSdkModule?.StarkSDK) {
          cachedStarkSDKCtor = starkzapSdkModule.StarkSDK as StarkSDKCtor;
          return cachedStarkSDKCtor;
        }
      }
    } catch {
      // ignore and rethrow original error below with context
    }

    throw error;
  }

  throw new Error("failed to load StarkSDK from starkzap package");
}

function normalizeSignatureValue(value: string | number | bigint): string {
  if (typeof value === "string") {
    if (value.startsWith("0x") || value.startsWith("0X")) {
      return `0x${BigInt(value).toString(16)}`;
    }
    return `0x${BigInt(value).toString(16)}`;
  }
  return `0x${BigInt(value).toString(16)}`;
}

function isSignatureScalar(value: unknown): value is string | number | bigint {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  );
}

function normalizeSignatureResult(raw: unknown): Array<string | number | bigint> {
  if (Array.isArray(raw)) {
    const values = raw.filter(isSignatureScalar);
    if (values.length === 0) {
      throw new Error("signRaw returned an empty signature array");
    }
    return values;
  }

  if (isSignatureScalar(raw)) {
    return [raw];
  }

  if (raw && typeof raw === "object") {
    const asRecord = raw as Record<string, unknown>;

    const nested = asRecord.signature;
    if (Array.isArray(nested)) {
      const values = nested.filter(isSignatureScalar);
      if (values.length === 0) {
        throw new Error("signRaw returned an empty nested signature array");
      }
      return values;
    }

    if (nested && typeof nested === "object") {
      const nestedRecord = nested as Record<string, unknown>;
      if (isSignatureScalar(nestedRecord.r) && isSignatureScalar(nestedRecord.s)) {
        return [nestedRecord.r, nestedRecord.s];
      }
    }

    if (isSignatureScalar(asRecord.r) && isSignatureScalar(asRecord.s)) {
      return [asRecord.r, asRecord.s];
    }
  }

  throw new Error("unsupported signRaw return type; expected [r,s], {r,s}, or {signature:[...]}");
}

function buildHashSigner(signer: InjectedStarkzapSigner): AgentWalletSigner {
  return {
    signMessageHash: async (messageHash: string): Promise<string[]> => {
      const signature = normalizeSignatureResult(await signer.signRaw(messageHash));
      return signature.map((item: string | number | bigint) => normalizeSignatureValue(item));
    },
  };
}

// MVP scaffold: keep SDK initialization isolated behind one function.
export async function initStarkzapHeadlessWallet(
  config: StarkzapHeadlessConfig,
): Promise<StarkzapHeadlessRuntime> {
  if (!config.rpcUrl) {
    throw new Error("rpcUrl is required");
  }
  if (!config.chainId) {
    throw new Error("chainId is required");
  }

  if (config.account) {
    if (!config.accountAddress) {
      throw new Error("accountAddress is required when passing a custom account instance");
    }
    if (!config.signer) {
      throw new Error("signer is required when passing a custom account instance (x402 signing)");
    }

    return {
      accountAddress: config.accountAddress,
      chainId: config.chainId,
      signer: buildHashSigner(config.signer),
      account: config.account,
    };
  }

  if (config.useStarkzap ?? true) {
    const walletMode = config.walletMode ?? "cartridge";
    if (walletMode === "cartridge" && typeof globalThis.window === "undefined") {
      throw new Error(
        "walletMode=cartridge requires a web runtime. Use walletMode=signer for Node/headless agents.",
      );
    }
    const StarkSDK = await loadStarkSDKCtor();
    const sdk = new StarkSDK({
      network: config.network ?? "sepolia",
      rpcUrl: config.rpcUrl,
    });
    const feeMode = config.feeMode ?? "user_pays";
    const wallet =
      walletMode === "cartridge"
        ? await sdk.connectCartridge(config.cartridgeOptions ?? {})
        : await (async () => {
            if (!config.signer) {
              throw new Error(
                "signer is required in walletMode=signer (inject from Privy/Cartridge/KMS/HSM)",
              );
            }
            return sdk.connectWallet({
              account: { signer: config.signer as any },
              feeMode,
            });
          })();

    if (config.autoEnsureReady ?? false) {
      await wallet.ensureReady({
        deploy: config.deployMode ?? "if_needed",
        feeMode,
      });
    }

    const walletAddress =
      typeof wallet.address === "string" ? wallet.address : wallet.address.toString();
    if (
      config.accountAddress &&
      walletAddress.toLowerCase() !== config.accountAddress.toLowerCase()
    ) {
      throw new Error(
        `configured accountAddress (${config.accountAddress}) does not match Starkzap wallet address (${walletAddress})`,
      );
    }

    return {
      accountAddress: walletAddress,
      chainId: config.chainId,
      sdk,
      wallet,
      signer: config.signer ? buildHashSigner(config.signer) : undefined,
      account: wallet.getAccount(),
    };
  }

  throw new Error("useStarkzap=false without custom account is not supported");
}
