import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Account, Contract, RpcProvider, cairo } from "starknet";
import { createTalosAgentRuntime } from "../starkzap/agentRuntime.js";
import type { InjectedStarkzapSigner } from "../starkzap/client.js";
import { computeTaskCommitment } from "../signing/taskCommitment.js";
import { signSettlementPayload } from "../signing/signSettlementPayload.js";

type FeeMode = "sponsored" | "user_pays";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const offchainRoot = path.join(repoRoot, "offchain");

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "core::starknet::contract_address::ContractAddress" },
      { name: "amount", type: "core::integer::u256" },
    ],
    outputs: [{ type: "core::bool" }],
    state_mutability: "external",
  },
];

interface SmokeConfig {
  rpcUrl: string;
  chainId: string;
  network: "mainnet" | "sepolia";
  useStarkzap: boolean;
  walletMode: "signer" | "cartridge";
  feeMode: FeeMode;
  autoEnsureReady: boolean;
  accountAddress?: string;
  identityAddress: string;
  settlementAddress: string;
  coreAddress: string;
  tokenAddress: string;
  payeeAddress?: string;
  amount: bigint;
  score: number;
  deadlineLeadSeconds: number;
  metadataUri: string;
  externalTaskRef: string;
  nonce: string;
  salt?: string;
  skipApprove: boolean;
}

const STARKZAP_TOKEN_HINTS: Record<
  SmokeConfig["network"],
  {
    STRK: string;
    USDC: string;
    WBTC?: string;
  }
> = {
  sepolia: {
    STRK: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    USDC: "0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343",
  },
  mainnet: {
    STRK: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
    USDC: "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
    WBTC: "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",
  },
};

function normalizeHex(value: string): string {
  return `0x${BigInt(value).toString(16)}`;
}

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx < 0) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value || !value.trim()) {
    throw new Error(`missing required env var ${key}`);
  }
  return value.trim();
}

function optionalEnv(key: string): string | undefined {
  const value = process.env[key];
  if (!value || !value.trim()) {
    return undefined;
  }
  return value.trim();
}

function parseBigIntEnv(key: string, fallback: bigint): bigint {
  const value = optionalEnv(key);
  if (!value) {
    return fallback;
  }
  return BigInt(value);
}

function parseNumberEnv(key: string, fallback: number): number {
  const value = optionalEnv(key);
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid numeric env var ${key}`);
  }
  return parsed;
}

function parseBoolEnv(key: string, fallback: boolean): boolean {
  const value = optionalEnv(key);
  if (!value) {
    return fallback;
  }
  const normalized = value.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y";
}

function parseWalletMode(value: string | undefined): "signer" | "cartridge" {
  const normalized = (value ?? "signer").toLowerCase();
  if (normalized === "signer" || normalized === "starkzap_signer") {
    return "signer";
  }
  if (normalized === "cartridge" || normalized === "starkzap_cartridge") {
    return "cartridge";
  }
  throw new Error(`unsupported TALOS_SMOKE_WALLET_MODE/TALOS_WALLET_MODE: ${value}`);
}

function resolveAddressFromSncastAccountsFile(): string | undefined {
  const accountsFile =
    optionalEnv("TALOS_SMOKE_ACCOUNTS_FILE") ??
    path.join(process.env.HOME ?? "", ".starknet_accounts", "starknet_open_zeppelin_accounts.json");
  const accountNetwork = optionalEnv("TALOS_SMOKE_ACCOUNT_NETWORK") ?? "alpha-sepolia";
  const accountName = optionalEnv("TALOS_SMOKE_ACCOUNT_NAME") ?? "talos_admin";

  if (!accountsFile || !fs.existsSync(accountsFile)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(accountsFile, "utf8")) as Record<string, unknown>;
    const byNetwork = parsed[accountNetwork] as Record<string, unknown> | undefined;
    const account = byNetwork?.[accountName] as Record<string, unknown> | undefined;
    const address = account?.address;
    if (typeof address === "string" && address.trim()) {
      return address.trim();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function defaultTokenAddressFromEnv(): string | undefined {
  return (
    optionalEnv("TALOS_SMOKE_TOKEN_ADDRESS") ??
    optionalEnv("TALOS_TOKEN_STRK_ADDRESS") ??
    optionalEnv("TALOS_TOKEN_USDC_ADDRESS") ??
    optionalEnv("TALOS_TOKEN_WBTC_ADDRESS") ??
    optionalEnv("TALOS_TOKEN_STRKBTC_ADDRESS")
  );
}

function defaultNetwork(value: string | undefined): "mainnet" | "sepolia" {
  const normalized = (value ?? "sepolia").toLowerCase();
  if (normalized === "mainnet" || normalized === "sepolia") {
    return normalized;
  }
  throw new Error(`unsupported network: ${value}`);
}

function loadContractAbi(contractName: "TalosIdentity" | "TalosCore"): unknown {
  const releaseArtifact = path.join(repoRoot, "target", "release", `talos_${contractName}.contract_class.json`);
  const devArtifact = path.join(repoRoot, "target", "dev", `talos_${contractName}.contract_class.json`);
  const artifactPath = fs.existsSync(releaseArtifact) ? releaseArtifact : devArtifact;
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`artifact not found for ${contractName}; run scarb build first`);
  }
  const parsed = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as { abi?: unknown };
  if (!parsed.abi) {
    throw new Error(`abi not found in ${artifactPath}`);
  }
  return parsed.abi;
}

async function loadInjectedSigner(): Promise<InjectedStarkzapSigner> {
  const modulePath = requiredEnv("TALOS_SMOKE_SIGNER_MODULE");
  const exportName = optionalEnv("TALOS_SMOKE_SIGNER_EXPORT") ?? "default";
  const resolvedPath = path.isAbsolute(modulePath) ? modulePath : path.resolve(repoRoot, modulePath);
  let signerModule: Record<string, unknown>;
  try {
    signerModule = (await import(pathToFileURL(resolvedPath).href)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `failed to load TALOS_SMOKE_SIGNER_MODULE at ${resolvedPath}. ` +
        `Create that file and export a signer object (getPubKey + signRaw). ` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let candidate: unknown = signerModule[exportName];
  if (typeof candidate === "function") {
    candidate = await (candidate as () => unknown | Promise<unknown>)();
  }
  if (!candidate || typeof candidate !== "object") {
    throw new Error("loaded signer is invalid");
  }

  const signer = candidate as Partial<InjectedStarkzapSigner>;
  if (typeof signer.getPubKey !== "function" || typeof signer.signRaw !== "function") {
    throw new Error("signer must expose getPubKey() and signRaw(hash)");
  }

  return signer as InjectedStarkzapSigner;
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
    const asRecord = value as Record<string, unknown>;
    if (asRecord.low !== undefined && asRecord.high !== undefined) {
      const low = BigInt(asRecord.low as string | number | bigint);
      const high = BigInt(asRecord.high as string | number | bigint);
      return low + (high << 128n);
    }
  }
  throw new Error("failed to parse u256 value");
}

function txHashFromResult(result: unknown): string {
  if (!result || typeof result !== "object") {
    return "";
  }
  const asRecord = result as Record<string, unknown>;
  const hash = asRecord.transaction_hash ?? asRecord.transactionHash ?? asRecord.hash;
  if (!hash) {
    return "";
  }
  return String(hash);
}

async function waitForTransaction(
  provider: RpcProvider,
  txHash: string,
  label: string,
): Promise<void> {
  if (!txHash) {
    throw new Error(`missing transaction hash for ${label}`);
  }
  await provider.waitForTransaction(txHash);
}

async function ensureContractDeployed(
  provider: RpcProvider,
  address: string,
  label: string,
  network: SmokeConfig["network"],
): Promise<void> {
  try {
    await provider.getClassHashAt(address);
  } catch (error) {
    let hint = "";
    if (label === "Token contract") {
      const tokenHint = STARKZAP_TOKEN_HINTS[network];
      hint =
        ` Starkzap ${network} presets: STRK=${tokenHint.STRK}, USDC=${tokenHint.USDC}` +
        (tokenHint.WBTC ? `, WBTC=${tokenHint.WBTC}` : "");
    }
    throw new Error(
      `${label} address is not deployed on current RPC/network: ${address}. ` +
        `Use a deployed ${label.toLowerCase()} address for this network.` +
        hint +
        ` ` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function loadSmokeConfigFromEnv(): SmokeConfig {
  const useStarkzap = parseBoolEnv("TALOS_SMOKE_USE_STARKZAP", false);
  const network = defaultNetwork(optionalEnv("TALOS_NETWORK") ?? optionalEnv("STARKNET_NETWORK"));
  const walletMode = parseWalletMode(
    optionalEnv("TALOS_SMOKE_WALLET_MODE") ?? optionalEnv("TALOS_WALLET_MODE"),
  );
  const tokenAddress = defaultTokenAddressFromEnv();
  if (!tokenAddress) {
    throw new Error(
      "missing token address; set TALOS_SMOKE_TOKEN_ADDRESS or TALOS_TOKEN_USDC_ADDRESS/STRK/WBTC/STRKBTC",
    );
  }

  const score = parseNumberEnv("TALOS_SMOKE_SCORE", 90);
  if (score < 0 || score > 100) {
    throw new Error("TALOS_SMOKE_SCORE must be in range 0..100");
  }

  const deadlineLeadSeconds = parseNumberEnv("TALOS_SMOKE_DEADLINE_SECONDS", 900);
  if (deadlineLeadSeconds <= 0) {
    throw new Error("TALOS_SMOKE_DEADLINE_SECONDS must be > 0");
  }

  const accountAddress =
    optionalEnv("TALOS_AGENT_ACCOUNT_ADDRESS") ??
    optionalEnv("TALOS_SMOKE_ACCOUNT_ADDRESS") ??
    optionalEnv("TALOS_ADMIN") ??
    resolveAddressFromSncastAccountsFile();

  return {
    rpcUrl: requiredEnv("STARKNET_RPC_URL"),
    chainId: requiredEnv("STARKNET_CHAIN_ID"),
    network,
    useStarkzap,
    walletMode,
    feeMode: (optionalEnv("TALOS_FEE_MODE") as FeeMode | undefined) ?? "user_pays",
    autoEnsureReady: parseBoolEnv("TALOS_AUTO_ENSURE_READY", false),
    accountAddress,
    identityAddress: requiredEnv("TALOS_IDENTITY_ADDRESS"),
    settlementAddress: requiredEnv("TALOS_SETTLEMENT_ADDRESS"),
    coreAddress: requiredEnv("TALOS_CORE_ADDRESS"),
    tokenAddress,
    payeeAddress: optionalEnv("TALOS_SMOKE_PAYEE_ADDRESS"),
    amount: parseBigIntEnv("TALOS_SMOKE_AMOUNT", 1n),
    score,
    deadlineLeadSeconds,
    metadataUri: optionalEnv("TALOS_SMOKE_METADATA_URI") ?? `ipfs://talos/smoke/${Date.now()}`,
    externalTaskRef: optionalEnv("TALOS_SMOKE_TASK_REF") ?? `smoke-${Date.now()}`,
    nonce: optionalEnv("TALOS_SMOKE_NONCE") ?? `${Date.now()}`,
    salt: optionalEnv("TALOS_SMOKE_SALT"),
    skipApprove: parseBoolEnv("TALOS_SMOKE_SKIP_APPROVE", false),
  };
}

async function main(): Promise<void> {
  const envFileInput = optionalEnv("TALOS_SMOKE_ENV_FILE") ?? path.join(offchainRoot, ".env");
  const envFile = path.isAbsolute(envFileInput)
    ? envFileInput
    : path.resolve(repoRoot, envFileInput);
  loadEnvFile(envFile);

  const config = loadSmokeConfigFromEnv();
  const signer = config.walletMode === "signer" || !config.useStarkzap
    ? await loadInjectedSigner()
    : undefined;
  const identityAbi = loadContractAbi("TalosIdentity");
  const coreAbi = loadContractAbi("TalosCore");
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });

  const runtimeConfig: Parameters<typeof createTalosAgentRuntime>[0] = {
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    network: config.network,
    accountAddress: config.accountAddress,
    walletMode: config.walletMode,
    feeMode: config.feeMode,
    autoEnsureReady: config.autoEnsureReady,
    useStarkzap: config.useStarkzap,
    identityAddress: config.identityAddress,
    identityAbi,
    settlementAddress: config.settlementAddress,
    coreAddress: config.coreAddress,
    coreAbi,
  };
  if (signer) {
    runtimeConfig.signer = signer;
  }

  if (!config.useStarkzap) {
    if (!config.accountAddress) {
      throw new Error(
        "missing account address for local-account mode. " +
          "Set TALOS_AGENT_ACCOUNT_ADDRESS or TALOS_SMOKE_ACCOUNT_ADDRESS.",
      );
    }
    if (!signer) {
      throw new Error("local-account mode requires TALOS_SMOKE_SIGNER_MODULE");
    }
    runtimeConfig.account = new Account({
      provider,
      address: config.accountAddress,
      signer: signer as any,
    });
  }

  const runtime = await createTalosAgentRuntime(runtimeConfig);
  const payerAddress = runtime.headless.accountAddress;
  const payeeAddress = config.payeeAddress ?? payerAddress;
  const deadline = Math.floor(Date.now() / 1000) + config.deadlineLeadSeconds;

  await ensureContractDeployed(provider, config.identityAddress, "Identity contract", config.network);
  await ensureContractDeployed(
    provider,
    config.settlementAddress,
    "Settlement contract",
    config.network,
  );
  await ensureContractDeployed(provider, config.coreAddress, "Core contract", config.network);
  await ensureContractDeployed(provider, config.tokenAddress, "Token contract", config.network);

  const identityContract = new Contract({
    abi: identityAbi as any,
    address: config.identityAddress,
    providerOrAccount: provider as any,
  });

  const beforeCountRaw = await (identityContract as any).get_agent_count();
  const beforeCount = toBigIntU256(beforeCountRaw);

  const pubKey = signer ? await signer.getPubKey() : normalizeHex(payerAddress);
  const registerResult = await runtime.registerAgent(pubKey, config.metadataUri);
  await waitForTransaction(provider, registerResult.transactionHash, "register_agent");

  const afterCountRaw = await (identityContract as any).get_agent_count();
  const afterCount = toBigIntU256(afterCountRaw);
  if (afterCount <= beforeCount) {
    throw new Error("agent_count did not increase after register_agent");
  }
  const targetAgentId = afterCount;

  if (!config.skipApprove) {
    const tokenContract = new Contract({
      abi: ERC20_ABI as any,
      address: config.tokenAddress,
      providerOrAccount: runtime.headless.account as any,
    });
    const approveResult = await (tokenContract as any).approve(
      config.settlementAddress,
      cairo.uint256(config.amount.toString()),
    );
    const approveHash = txHashFromResult(approveResult);
    await waitForTransaction(provider, approveHash, "token approve");
  }

  const taskCommitment = computeTaskCommitment({
    externalTaskRef: config.externalTaskRef,
    nonce: config.nonce,
    payerAddress,
    payeeAddress,
    salt: config.salt,
  });

  if (!runtime.headless.signer) {
    throw new Error(
      "headless signer is unavailable. For full x402 smoke use TALOS_SMOKE_WALLET_MODE=signer " +
      "and inject TALOS_SMOKE_SIGNER_MODULE.",
    );
  }

  const signed = await signSettlementPayload(
    {
      verifyingContract: config.settlementAddress,
      chainId: config.chainId,
      payerAddress,
      payeeAddress,
      tokenAddress: config.tokenAddress,
      amount: config.amount,
      taskCommitment,
      deadline,
    },
    runtime.headless.signer,
  );

  const workflowTxHash = await runtime.executeWorkflow({
    payerAddress,
    payeeAddress,
    tokenAddress: config.tokenAddress,
    amount: config.amount,
    taskCommitment,
    deadline,
    signature: signed.signature,
    targetAgentId,
    score: config.score,
  });
  await waitForTransaction(provider, workflowTxHash, "execute_agent_workflow");

  console.log("Talos smoke flow succeeded.");
  console.log(`payer: ${normalizeHex(payerAddress)}`);
  console.log(`payee: ${normalizeHex(payeeAddress)}`);
  console.log(`agent_id: ${targetAgentId.toString()}`);
  console.log(`token: ${normalizeHex(config.tokenAddress)}`);
  console.log(`amount: ${config.amount.toString()}`);
  console.log(`task_commitment: ${taskCommitment}`);
  console.log(`register_tx: ${registerResult.transactionHash}`);
  console.log(`workflow_tx: ${workflowTxHash}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Smoke flow failed: ${message}`);
  process.exit(1);
});
