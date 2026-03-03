import type {
  AgentWalletSigner,
  SettlementPayload,
  WorkflowExecutionInput,
} from "../types.js";
import { signSettlementPayload } from "../signing/signSettlementPayload.js";
import type { ParsedX402Challenge } from "./challenge.js";

export interface BuildWorkflowInput {
  challenge: ParsedX402Challenge;
  verifyingContract: string;
  chainId: string;
  signer: AgentWalletSigner;
  tokenOverride?: string;
}

export interface BuildWorkflowResult {
  messageHash: string;
  workflow: WorkflowExecutionInput;
}

export async function buildWorkflowExecutionInput(
  input: BuildWorkflowInput,
): Promise<BuildWorkflowResult> {
  const tokenAddress = input.tokenOverride ?? input.challenge.tokenAddress;

  const settlementPayload: SettlementPayload = {
    verifyingContract: input.verifyingContract,
    chainId: input.chainId,
    payerAddress: input.challenge.payerAddress,
    payeeAddress: input.challenge.payeeAddress,
    tokenAddress,
    amount: input.challenge.amount,
    taskCommitment: input.challenge.taskCommitment,
    deadline: input.challenge.deadline,
  };

  const signed = await signSettlementPayload(settlementPayload, input.signer);

  return {
    messageHash: signed.messageHash,
    workflow: {
      payerAddress: input.challenge.payerAddress,
      payeeAddress: input.challenge.payeeAddress,
      tokenAddress,
      amount: input.challenge.amount,
      taskCommitment: input.challenge.taskCommitment,
      deadline: input.challenge.deadline,
      signature: signed.signature,
      targetAgentId: input.challenge.targetAgentId,
      score: input.challenge.score,
    },
  };
}
