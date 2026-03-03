import type { TokenBalance, WorkflowExecutionInput } from "../types.js";
import { registerAgentViaStarkzap, type RegisterAgentResult } from "./registerAgent.js";
import { executeWorkflowViaStarkzap } from "./executeWorkflow.js";
import {
  initStarkzapHeadlessWallet,
  type StarkzapHeadlessConfig,
  type StarkzapHeadlessRuntime,
} from "./client.js";
import {
  createTalosX402InterceptorDeps,
} from "../x402/talosDeps.js";
import type { X402InterceptorDeps } from "../x402/interceptor.js";
import {
  TalosExecutionGuardrails,
  type TalosGuardrailsConfig,
} from "../guardrails/policy.js";
import { TalosMetrics } from "../observability/metrics.js";
import { createTalosLogger, type TalosLogger } from "../observability/logger.js";

type FeeMode = "sponsored" | "user_pays";

export interface TalosAgentRuntimeConfig extends StarkzapHeadlessConfig {
  settlementAddress: string;
  coreAddress: string;
  coreAbi: unknown;
  identityAddress: string;
  identityAbi: unknown;
  feeMode?: FeeMode;
  guardrails?: TalosGuardrailsConfig;
  metrics?: TalosMetrics;
  logger?: TalosLogger;
}

export interface TalosAgentRuntime {
  headless: StarkzapHeadlessRuntime;
  registerAgent: (pubKey: string, metadataUri: string) => Promise<RegisterAgentResult>;
  executeWorkflow: (input: WorkflowExecutionInput) => Promise<string>;
  getMetrics: () => TalosMetrics;
  createX402Deps: (options?: {
    getTokenBalances?: () => Promise<TokenBalance[]>;
    preferredTokenOrder?: string[];
    minReserveByToken?: Record<string, bigint>;
  }) => X402InterceptorDeps;
}

export async function createTalosAgentRuntime(
  config: TalosAgentRuntimeConfig,
): Promise<TalosAgentRuntime> {
  const headless = await initStarkzapHeadlessWallet(config);
  const guardrails = new TalosExecutionGuardrails(config.guardrails);
  const metrics = config.metrics ?? new TalosMetrics();
  const logger = config.logger ?? createTalosLogger();

  const executeWorkflow = async (input: WorkflowExecutionInput): Promise<string> => {
    const start = Date.now();
    guardrails.assertCanExecute(input);
    const result = await executeWorkflowViaStarkzap({
      ...input,
      wallet: headless.wallet as any,
      account: headless.account,
      feeMode: config.feeMode ?? "user_pays",
      coreAddress: config.coreAddress,
      coreAbi: config.coreAbi,
    });
    metrics.increment("talos_workflow_submitted_total", { token: input.tokenAddress.toLowerCase() });
    metrics.observeDurationMs("talos_workflow_submit", Date.now() - start, {
      token: input.tokenAddress.toLowerCase(),
    });
    logger.info("workflow submitted", {
      transactionHash: result.transactionHash,
      token: input.tokenAddress,
      amount: input.amount.toString(),
      targetAgentId: input.targetAgentId.toString(),
    });
    return result.transactionHash;
  };

  return {
    headless,
    registerAgent: async (pubKey: string, metadataUri: string): Promise<RegisterAgentResult> =>
      registerAgentViaStarkzap({
        wallet: headless.wallet as any,
        account: headless.account,
        feeMode: config.feeMode ?? "user_pays",
        identityAddress: config.identityAddress,
        identityAbi: config.identityAbi,
        pubKey,
        metadataUri,
      }),
    executeWorkflow,
    getMetrics: () => metrics,
    createX402Deps: (options) =>
      createTalosX402InterceptorDeps({
        verifyingContract: config.settlementAddress,
        chainId: config.chainId,
        signer: headless.signer ?? {
          signMessageHash: async (): Promise<string[]> => {
            throw new Error("headless signer is not available");
          },
        },
        executeWorkflow,
        getTokenBalances: options?.getTokenBalances,
        preferredTokenOrder: options?.preferredTokenOrder,
        minReserveByToken: options?.minReserveByToken,
      }),
  };
}
