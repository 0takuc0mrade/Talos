# Talos Ops + Launch Checklist (MVP)

This checklist maps directly to remaining delivery steps (deployment wiring, observability, guardrails, staged rollout).

## 0) Interface Freeze + Signing Surface Lock

- Keep `docs/talos-abi-freeze.json` as the canonical ABI manifest.
- Run freeze checker:
  - `npm --prefix ./offchain run check:abi-freeze`
- Include freeze checker in CI before deploy/finalize.

## 1) Deployment Wiring

- Fill all required vars in `offchain/.env`:
  - Module addresses: `TALOS_IDENTITY_ADDRESS`, `TALOS_SETTLEMENT_ADDRESS`, `TALOS_REPUTATION_ADDRESS`, `TALOS_CORE_ADDRESS`
  - Token addresses: `TALOS_TOKEN_STRK_ADDRESS`, `TALOS_TOKEN_WBTC_ADDRESS`, `TALOS_TOKEN_STRKBTC_ADDRESS`, `TALOS_TOKEN_USDC_ADDRESS`
- Load/validate with SDK helper:
  - `loadTalosDeploymentFromEnv(...)` from `offchain/src/deployment/addressBook.ts`
- Confirm settlement token whitelist on-chain matches the same addresses.

## 2) Guardrails

- Enable runtime policy checks:
  - `TalosExecutionGuardrails` in `offchain/src/guardrails/policy.ts`
- Enforce commitment privacy policy:
  - `assertTaskCommitment(...)` in `offchain/src/privacy/taskCommitmentPolicy.ts`
  - Reject non-hex or low-entropy task commitments before signing/submission.
- Recommended baseline:
  - `minDeadlineLeadSeconds = 30`
  - `maxDeadlineHorizonSeconds = 900`
  - `taskCommitmentMinBits >= 120`
  - per-token max amount caps
  - payer + global rate limits
- Incident mode:
  - Set `paused=true` policy to hard stop workflow execution.

## 3) Privacy-safe Observability

- Use redacting logger:
  - `createTalosLogger(...)` in `offchain/src/observability/logger.ts`
- Track runtime health:
  - `TalosMetrics` counters/timers in `offchain/src/observability/metrics.ts`
- Avoid logging:
  - raw signatures
  - private keys
  - plaintext task/business payloads
  - low-entropy/raw `task_id` values (only commitment hashes)

## 3.1) Gas Sponsorship Readiness

- Evaluate with:
  - `evaluateGasSponsorshipReadiness(...)` in `offchain/src/launch/sponsorship.ts`
- MVP target:
  - `feeMode = sponsored`
  - `walletMode = cartridge` (built-in sponsorship), or
  - `walletMode = signer` with explicit paymaster service configured.

## 4) Event Indexing

- Run index polling using:
  - `TalosEventIndexer` in `offchain/src/indexer/eventIndexer.ts`
- Minimum indexed events:
  - Identity: `AgentRegistered`, `MetadataUpdated`
  - Settlement: `PaymentSettled`, token/admin changes
  - Reputation: `FeedbackSubmitted`
  - Core: `WorkflowExecuted`

## 5) Staged Rollout

### Testnet Pilot

- Run full CI:
  - `snforge test`
  - `npm --prefix ./offchain run check`
  - `npm --prefix ./offchain run check:abi-freeze`
  - `npm --prefix ./offchain test`
- Execute live flow:
  - register agent
  - x402 challenge/settlement
  - reputation submission
  - indexed event visibility

### Mainnet Beta

- Restrict to allowlisted agents/accounts first.
- Keep conservative rate limits + amount caps.
- Monitor:
  - workflow success/failure ratio
  - failure reason breakdown
  - token utilization mix
