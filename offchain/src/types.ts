export type FeltLike = string | number | bigint;

export interface U256Like {
  low: FeltLike;
  high: FeltLike;
}

export interface SettlementPayload {
  verifyingContract: FeltLike;
  chainId: FeltLike;
  payerAddress: FeltLike;
  payeeAddress: FeltLike;
  tokenAddress: FeltLike;
  amount: bigint;
  taskCommitment: FeltLike;
  deadline: number | bigint;
  domain?: string;
  version?: string;
}

export interface WorkflowExecutionInput {
  payerAddress: string;
  payeeAddress: string;
  tokenAddress: string;
  amount: bigint;
  taskCommitment: string;
  deadline: number;
  signature: string[];
  targetAgentId: bigint;
  score: number;
}

export interface SettlementSignature {
  messageHash: string;
  signature: string[];
}

export interface AgentWalletSigner {
  signMessageHash: (messageHash: string) => Promise<string[]>;
}

export interface TokenBalance {
  tokenAddress: string;
  balance: bigint;
}
