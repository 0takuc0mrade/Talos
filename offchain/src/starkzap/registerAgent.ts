import { Contract } from "starknet";

type FeeMode = "sponsored" | "user_pays";

interface WalletLike {
  getAccount?: () => unknown;
  execute: (calls: unknown[], options?: { feeMode?: FeeMode }) => Promise<{
    hash?: string;
    transaction_hash?: string;
  }>;
}

export interface RegisterAgentInput {
  account?: unknown;
  wallet?: WalletLike;
  feeMode?: FeeMode;
  identityAddress: string;
  identityAbi: unknown;
  pubKey: string;
  metadataUri: string;
}

export interface RegisterAgentResult {
  transactionHash: string;
  raw: unknown;
}

// SDK-agnostic contract invoke helper.
// Any Starkzap account object compatible with starknet.js Contract invocation can be used.
export async function registerAgentViaStarkzap(
  input: RegisterAgentInput,
): Promise<RegisterAgentResult> {
  if (!input.pubKey) {
    throw new Error("pubKey is required");
  }
  if (!input.metadataUri) {
    throw new Error("metadataUri is required");
  }
  if (!input.account && !input.wallet) {
    throw new Error("either account or wallet is required");
  }

  const providerOrAccount = input.account ?? input.wallet?.getAccount?.();
  const contract = new Contract({
    abi: input.identityAbi as any,
    address: input.identityAddress,
    providerOrAccount: providerOrAccount as any,
  });

  if (input.wallet) {
    const call = (contract as any).populate("register_agent", [input.pubKey, input.metadataUri]);
    const tx = await input.wallet.execute([call], { feeMode: input.feeMode ?? "user_pays" });
    const transactionHash =
      (tx?.hash as string | undefined) ??
      (tx?.transaction_hash as string | undefined) ??
      "";
    return {
      transactionHash,
      raw: tx,
    };
  }

  const res = await (contract as any).register_agent(input.pubKey, input.metadataUri);

  const transactionHash =
    (res?.transaction_hash as string | undefined) ??
    (res?.transactionHash as string | undefined) ??
    "";

  return {
    transactionHash,
    raw: res,
  };
}
