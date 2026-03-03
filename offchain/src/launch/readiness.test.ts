import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTalosReadiness } from "./readiness.js";

test("evaluateTalosReadiness reports blocked stage with missing checks", () => {
  const report = evaluateTalosReadiness({
    contractsTested: true,
    sdkTestsPassing: true,
    deploymentConfigured: false,
    indexerEnabled: false,
    guardrailsEnabled: true,
    tracingEnabled: true,
  });

  assert.equal(report.stage, "blocked");
  assert.deepEqual(report.missing.sort(), ["deploymentConfigured", "indexerEnabled"]);
});

test("evaluateTalosReadiness reports mainnet_beta_ready when all checks pass", () => {
  const report = evaluateTalosReadiness({
    contractsTested: true,
    sdkTestsPassing: true,
    deploymentConfigured: true,
    indexerEnabled: true,
    guardrailsEnabled: true,
    tracingEnabled: true,
  });

  assert.equal(report.stage, "mainnet_beta_ready");
  assert.equal(report.missing.length, 0);
});
