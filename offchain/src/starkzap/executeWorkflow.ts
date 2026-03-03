import { Contract, cairo } from "starknet";
import type { WorkflowExecutionInput } from "../types.js";

type FeeMode = "sponsored" | "user_pays";

interface WalletLike {
  getAccount?: () => unknown;
  execute: (calls: unknown[], options?: { feeMode?: FeeMode }) => Promise<{
    hash?: string;
    transaction_hash?: string;
  }>;
}

export interface ExecuteWorkflowInput extends WorkflowExecutionInput {
  account?: unknown;
  wallet?: WalletLike;
  feeMode?: FeeMode;
  coreAddress: string;
  coreAbi: unknown;
}

export interface ExecuteWorkflowResult {
  transactionHash: string;
  raw: unknown;
}

export async function executeWorkflowViaStarkzap(
  input: ExecuteWorkflowInput,
): Promise<ExecuteWorkflowResult> {
  if (input.score < 0 || input.score > 100) {
    throw new Error("score must be in range 0..100");
  }
  if (input.deadline <= 0) {
    throw new Error("deadline must be a positive unix timestamp");
  }
  if (!input.account && !input.wallet) {
    throw new Error("either account or wallet is required");
  }

  const providerOrAccount = input.account ?? input.wallet?.getAccount?.();
  const contract = new Contract({
    abi: input.coreAbi as any,
    address: input.coreAddress,
    providerOrAccount: providerOrAccount as any,
  });
  const cairoAmount = cairo.uint256(input.amount.toString());

  if (input.wallet) {
    const call = (contract as any).populate("execute_agent_workflow", [
      input.payerAddress,
      input.payeeAddress,
      input.tokenAddress,
      cairoAmount,
      input.taskCommitment,
      input.deadline,
      input.signature,
      input.targetAgentId,
      input.score,
    ]);
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

  const res = await (contract as any).execute_agent_workflow(
    input.payerAddress,
    input.payeeAddress,
    input.tokenAddress,
    cairoAmount,
    input.taskCommitment,
    input.deadline,
    input.signature,
    input.targetAgentId,
    input.score,
  );

  const transactionHash =
    (res?.transaction_hash as string | undefined) ??
    (res?.transactionHash as string | undefined) ??
    "";

  return {
    transactionHash,
    raw: res,
  };
}
