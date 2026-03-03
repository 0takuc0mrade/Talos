import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, RpcProvider } from "starknet";

type TalosModuleName = "identity" | "settlement" | "reputation" | "core";

interface VerifyConfig {
  rpcUrl: string;
  identityAddress: string;
  settlementAddress: string;
  reputationAddress: string;
  coreAddress: string;
  txHashes: string[];
  waitRetries: number;
  waitRetryIntervalMs: number;
  waitLifeCycleRetries: number;
}

interface ParsedTalosEvent {
  module: TalosModuleName;
  eventName: string;
  payload: Record<string, unknown>;
  blockNumber?: number;
  blockHash?: string;
  transactionHash?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const offchainRoot = path.join(repoRoot, "offchain");

const METADATA_KEYS = new Set(["block_hash", "block_number", "transaction_hash"]);
const ADDRESS_LIKE_FIELD = /(?:^|_)(owner|payer|payee|token|admin|address|contract_address)(?:$|_)/i;

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

function normalizeHex(value: string): string {
  return `0x${BigInt(value).toString(16)}`;
}

function isNumberish(value: unknown): value is string | number | bigint {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  );
}

function formatPrimitiveForKey(key: string | undefined, value: unknown): unknown {
  if (!isNumberish(value)) {
    return value;
  }

  if (typeof value === "bigint") {
    if (key && ADDRESS_LIKE_FIELD.test(key)) {
      return normalizeHex(value.toString());
    }
    return value.toString();
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return String(value);
    }
    if (key && ADDRESS_LIKE_FIELD.test(key)) {
      return normalizeHex(value.toString());
    }
    return value;
  }

  if (key && ADDRESS_LIKE_FIELD.test(key)) {
    try {
      return normalizeHex(value);
    } catch {
      return value;
    }
  }
  return value;
}

function formatPayloadForDisplay(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => formatPayloadForDisplay(entry));
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = formatPayloadForDisplay(v, k);
    }
    return out;
  }

  return formatPrimitiveForKey(key, value);
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

function parsePositiveNumberEnv(key: string, fallback: number): number {
  const value = optionalEnv(key);
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid positive numeric env var ${key}`);
  }
  return parsed;
}

function parseTxHashesFromInputs(args: string[], envValue?: string): string[] {
  const argHashes = args.map((v) => v.trim()).filter((v) => v.length > 0);
  if (argHashes.length > 0) {
    return argHashes.map(normalizeHex);
  }

  if (!envValue) {
    return [];
  }

  return envValue
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
    .map(normalizeHex);
}

function loadContractAbi(
  contractName: "TalosIdentity" | "TalosSettlement" | "TalosReputation" | "TalosCore",
): unknown {
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

function loadVerifyConfig(argv: string[]): VerifyConfig {
  const envFileInput = optionalEnv("TALOS_VERIFY_ENV_FILE") ?? path.join(offchainRoot, ".env");
  const envFile = path.isAbsolute(envFileInput)
    ? envFileInput
    : path.resolve(repoRoot, envFileInput);
  loadEnvFile(envFile);

  const txHashes = parseTxHashesFromInputs(
    argv.slice(2),
    optionalEnv("TALOS_VERIFY_TX_HASHES"),
  );
  if (txHashes.length === 0) {
    throw new Error(
      "missing transaction hashes. Pass hashes as CLI args or set TALOS_VERIFY_TX_HASHES=0xabc,0xdef",
    );
  }

  return {
    rpcUrl: requiredEnv("STARKNET_RPC_URL"),
    identityAddress: requiredEnv("TALOS_IDENTITY_ADDRESS"),
    settlementAddress: requiredEnv("TALOS_SETTLEMENT_ADDRESS"),
    reputationAddress: requiredEnv("TALOS_REPUTATION_ADDRESS"),
    coreAddress: requiredEnv("TALOS_CORE_ADDRESS"),
    txHashes,
    waitRetries: parsePositiveNumberEnv("TALOS_VERIFY_WAIT_RETRIES", 8),
    waitRetryIntervalMs: parsePositiveNumberEnv("TALOS_VERIFY_WAIT_INTERVAL_MS", 1500),
    waitLifeCycleRetries: parsePositiveNumberEnv("TALOS_VERIFY_LIFECYCLE_RETRIES", 2),
  };
}

function decodeModuleEvents(
  module: TalosModuleName,
  contract: Contract,
  receipt: unknown,
): ParsedTalosEvent[] {
  const parsed = contract.parseEvents(receipt as any) as Array<Record<string, unknown>>;
  const out: ParsedTalosEvent[] = [];

  for (const item of parsed) {
    const eventName = Object.keys(item).find((k) => !METADATA_KEYS.has(k));
    if (!eventName) {
      continue;
    }

    const payload = item[eventName];
    if (!payload || typeof payload !== "object") {
      continue;
    }

    const blockNumber =
      typeof item.block_number === "number"
        ? item.block_number
        : typeof item.block_number === "string"
          ? Number(item.block_number)
          : undefined;

    out.push({
      module,
      eventName,
      payload: payload as Record<string, unknown>,
      blockNumber: Number.isFinite(blockNumber as number) ? blockNumber : undefined,
      blockHash: item.block_hash ? String(item.block_hash) : undefined,
      transactionHash: item.transaction_hash ? String(item.transaction_hash) : undefined,
    });
  }

  return out;
}

function printTxSummary(txHash: string, events: ParsedTalosEvent[]): void {
  console.log(`\n=== ${txHash} ===`);
  if (events.length === 0) {
    console.log("No Talos events decoded in this receipt.");
    return;
  }

  for (const event of events) {
    const txRef = event.transactionHash ? normalizeHex(event.transactionHash) : txHash;
    const formattedPayload = formatPayloadForDisplay(event.payload);
    console.log(
      `[${event.module}] ${event.eventName} @ block ${event.blockNumber ?? "?"} (tx ${txRef})`,
    );
    console.log(JSON.stringify(formattedPayload, null, 2));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchReceiptWithRetries(
  provider: RpcProvider,
  txHash: string,
  retries: number,
  retryIntervalMs: number,
): Promise<Awaited<ReturnType<RpcProvider["getTransactionReceipt"]>>> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await provider.getTransactionReceipt(txHash);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(retryIntervalMs);
      }
    }
  }

  const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `failed to fetch transaction receipt for ${txHash} after ${retries} attempts: ${errorMessage}`,
  );
}

async function main(): Promise<void> {
  const config = loadVerifyConfig(process.argv);
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });

  const identity = new Contract({
    abi: loadContractAbi("TalosIdentity") as any,
    address: config.identityAddress,
    providerOrAccount: provider as any,
  });
  const settlement = new Contract({
    abi: loadContractAbi("TalosSettlement") as any,
    address: config.settlementAddress,
    providerOrAccount: provider as any,
  });
  const reputation = new Contract({
    abi: loadContractAbi("TalosReputation") as any,
    address: config.reputationAddress,
    providerOrAccount: provider as any,
  });
  const core = new Contract({
    abi: loadContractAbi("TalosCore") as any,
    address: config.coreAddress,
    providerOrAccount: provider as any,
  });

  for (const txHash of config.txHashes) {
    const receipt = await fetchReceiptWithRetries(
      provider,
      txHash,
      config.waitRetries + config.waitLifeCycleRetries,
      config.waitRetryIntervalMs,
    );

    const receiptStatus = receipt.statusReceipt;
    if (receiptStatus !== "SUCCEEDED") {
      console.log(`\n=== ${txHash} ===`);
      console.log(`Receipt status: ${receiptStatus}`);
      continue;
    }

    const allEvents = [
      ...decodeModuleEvents("identity", identity, receipt),
      ...decodeModuleEvents("settlement", settlement, receipt),
      ...decodeModuleEvents("reputation", reputation, receipt),
      ...decodeModuleEvents("core", core, receipt),
    ];
    printTxSummary(txHash, allEvents);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Verify failed: ${message}`);
  process.exit(1);
});
