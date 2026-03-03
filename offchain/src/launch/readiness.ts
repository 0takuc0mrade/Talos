export interface TalosReadinessInput {
  contractsTested: boolean;
  sdkTestsPassing: boolean;
  deploymentConfigured: boolean;
  indexerEnabled: boolean;
  guardrailsEnabled: boolean;
  tracingEnabled: boolean;
}

export type TalosLaunchStage = "blocked" | "testnet_ready" | "mainnet_beta_ready";

export interface TalosReadinessReport {
  stage: TalosLaunchStage;
  checks: TalosReadinessInput;
  missing: string[];
}

export function evaluateTalosReadiness(input: TalosReadinessInput): TalosReadinessReport {
  const missing: string[] = [];

  if (!input.contractsTested) missing.push("contractsTested");
  if (!input.sdkTestsPassing) missing.push("sdkTestsPassing");
  if (!input.deploymentConfigured) missing.push("deploymentConfigured");
  if (!input.indexerEnabled) missing.push("indexerEnabled");
  if (!input.guardrailsEnabled) missing.push("guardrailsEnabled");
  if (!input.tracingEnabled) missing.push("tracingEnabled");

  if (missing.length > 0) {
    return {
      stage: "blocked",
      checks: input,
      missing,
    };
  }

  return {
    stage: "mainnet_beta_ready",
    checks: input,
    missing,
  };
}
