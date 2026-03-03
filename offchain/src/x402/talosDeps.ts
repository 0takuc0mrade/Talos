import type { TokenBalance, WorkflowExecutionInput } from "../types.js";
import { selectSettlementToken } from "../policy/tokenPolicy.js";
import { signSettlementPayload } from "../signing/signSettlementPayload.js";
import { parseX402Challenge } from "./challenge.js";
import type { X402Challenge, X402InterceptorDeps } from "./interceptor.js";

export interface CreateTalosX402DepsInput {
  verifyingContract: string;
  chainId: string;
  signer: {
    signMessageHash: (messageHash: string) => Promise<string[]>;
  };
  executeWorkflow: (input: WorkflowExecutionInput) => Promise<string>;
  getTokenBalances?: () => Promise<TokenBalance[]>;
  preferredTokenOrder?: string[];
  minReserveByToken?: Record<string, bigint>;
}

async function chooseTokenForChallenge(
  challenge: X402Challenge,
  deps: CreateTalosX402DepsInput,
): Promise<string> {
  if (!deps.getTokenBalances || !challenge.supportedTokens || challenge.supportedTokens.length === 0) {
    return challenge.tokenAddress;
  }

  const balances = await deps.getTokenBalances();
  return selectSettlementToken({
    amount: challenge.amount,
    supportedTokens: challenge.supportedTokens,
    balances,
    preferredOrder: deps.preferredTokenOrder,
    minReserveByToken: deps.minReserveByToken,
  });
}

export function createTalosX402InterceptorDeps(
  deps: CreateTalosX402DepsInput,
): X402InterceptorDeps {
  return {
    parseChallenge: async (response: Response): Promise<X402Challenge> => {
      const parsed = await parseX402Challenge(response);
      const selectedToken = await chooseTokenForChallenge(
        {
          payerAddress: parsed.payerAddress,
          payeeAddress: parsed.payeeAddress,
          tokenAddress: parsed.tokenAddress,
          supportedTokens: parsed.supportedTokens,
          amount: parsed.amount,
          taskCommitment: parsed.taskCommitment,
          deadline: parsed.deadline,
          targetAgentId: parsed.targetAgentId,
          score: parsed.score,
        },
        deps,
      );

      return {
        payerAddress: parsed.payerAddress,
        payeeAddress: parsed.payeeAddress,
        tokenAddress: selectedToken,
        supportedTokens: parsed.supportedTokens,
        amount: parsed.amount,
        taskCommitment: parsed.taskCommitment,
        deadline: parsed.deadline,
        targetAgentId: parsed.targetAgentId,
        score: parsed.score,
      };
    },
    signChallenge: async (challenge) => {
      return signSettlementPayload(
        {
          verifyingContract: deps.verifyingContract,
          chainId: deps.chainId,
          payerAddress: challenge.payerAddress,
          payeeAddress: challenge.payeeAddress,
          tokenAddress: challenge.tokenAddress,
          amount: challenge.amount,
          taskCommitment: challenge.taskCommitment,
          deadline: challenge.deadline,
        },
        deps.signer,
      );
    },
    settleOnchain: async (input) => deps.executeWorkflow(input),
  };
}
