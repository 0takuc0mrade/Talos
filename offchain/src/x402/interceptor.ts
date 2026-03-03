import type { WorkflowExecutionInput } from "../types.js";

export interface X402Challenge {
  payerAddress: string;
  payeeAddress: string;
  tokenAddress: string;
  supportedTokens?: string[];
  amount: bigint;
  taskCommitment: string;
  deadline: number;
  targetAgentId: bigint;
  score: number;
}

export interface X402PaymentProof {
  messageHash?: string;
  signature: string[];
}

export interface X402InterceptorDeps {
  parseChallenge: (response: Response) => Promise<X402Challenge>;
  signChallenge: (challenge: X402Challenge) => Promise<X402PaymentProof>;
  buildWorkflowInput?: (
    challenge: X402Challenge,
    proof: X402PaymentProof,
  ) => Promise<WorkflowExecutionInput>;
  settleOnchain: (input: WorkflowExecutionInput) => Promise<string>;
}

export async function fetchWithX402(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  deps: X402InterceptorDeps,
): Promise<Response> {
  const firstResponse = await fetch(input, init);
  if (firstResponse.status !== 402) {
    return firstResponse;
  }

  const challenge = await deps.parseChallenge(firstResponse);
  const proof = await deps.signChallenge(challenge);

  const workflowInput = deps.buildWorkflowInput
    ? await deps.buildWorkflowInput(challenge, proof)
    : {
        payerAddress: challenge.payerAddress,
        payeeAddress: challenge.payeeAddress,
        tokenAddress: challenge.tokenAddress,
        amount: challenge.amount,
        taskCommitment: challenge.taskCommitment,
        deadline: challenge.deadline,
        signature: proof.signature,
        targetAgentId: challenge.targetAgentId,
        score: challenge.score,
      };

  await deps.settleOnchain(workflowInput);

  const headers = new Headers(init?.headers);
  headers.set("x402-payment-proof", JSON.stringify(proof.signature));
  if (proof.messageHash) {
    headers.set("x402-message-hash", proof.messageHash);
  }
  headers.set("x402-task-commitment", workflowInput.taskCommitment);

  return fetch(input, { ...init, headers });
}
