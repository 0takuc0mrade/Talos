# Talos SDK (MVP Scaffold)

This folder contains the first implementation batch for the Talos SDK offchain runtime:

- Canonical settlement hash builder aligned with `settlement.cairo`.
- Canonical settlement signer helper.
- Privacy-first `task_commitment` helper.
- Deployment address book loader for per-network module/token wiring.
- Runtime guardrails (pause/rate-limit/deadline/amount caps).
- Privacy-safe observability (redacting logger + in-memory metrics).
- Basic event indexing helper for Talos contract events.
- Starkzap-compatible invoke scaffolds for:
  - agent registration via `identity.register_agent`
  - atomic workflow via `core.execute_agent_workflow`
- x402 runtime helpers to parse challenges, sign payloads, select tokens, and execute settlement.

## What Is Implemented

1. `src/signing/settlementHash.ts`
   - Canonical Poseidon hash elements and splitter for `u256`.

2. `src/signing/signSettlementPayload.ts`
   - Computes canonical hash and signs it with a pluggable signer.

3. `src/signing/taskCommitment.ts`
   - Generates salted task commitments for on-chain replay/nullifier usage.

4. `src/starkzap/registerAgent.ts`
   - SDK-agnostic invoke helper for `register_agent`.

5. `src/starkzap/executeWorkflow.ts`
   - SDK-agnostic invoke helper for `execute_agent_workflow`.
   - Enforces score bounds and sends Cairo `u256` correctly.

6. `src/policy/tokenPolicy.ts`
   - Multi-token selector by supported set, preferences, reserves, and balances.

7. `src/x402/interceptor.ts`
   - Reusable request wrapper for x402 challenge/settlement retry flow.

8. `src/x402/challenge.ts` + `src/x402/talosDeps.ts`
   - Default challenge parser and Talos-specific dependency builder.
   - Supports token selection before signing for STRK/WBTC/strkBTC/USDC style flows.

9. `src/starkzap/agentRuntime.ts`
   - One-step runtime wiring for:
     - Starkzap headless wallet bootstrap
     - `identity.register_agent`
     - `core.execute_agent_workflow`
     - x402 interceptor dependencies
   - Adds guardrail checks + submission metrics.

10. `src/deployment/addressBook.ts`
   - Loads module/token addresses from env and validates uniqueness.

11. `src/guardrails/policy.ts`
   - Blocks execution when paused or policy thresholds are violated.

12. `src/observability/logger.ts` + `src/observability/metrics.ts`
   - Redaction-safe logs and in-memory counters/timers.

13. `src/indexer/eventIndexer.ts`
   - Polls Talos module events for dashboard/API indexing.

## How To Use

0. Deploy/wire contracts (before running agent flows):
   - See [docs/deploy-talos.md](../docs/deploy-talos.md)

1. Install dependencies:

```bash
cd offchain
npm install
```

Or from repo root:

```bash
npm --prefix ./offchain install
```

2. Implement your Starkzap account adapter (account object compatible with `starknet.js Contract` invokes).
   - Choose wallet mode:
     - `walletMode: "signer"` for headless/server flows (recommended for x402 signing).
     - `walletMode: "cartridge"` for web interactive flows.

3. Wire your challenge parser and signer into the x402 interceptor.
   - `createTalosX402InterceptorDeps(...)` provides the standard Talos wiring.

4. Run type-check:

```bash
npm run check
```

Or from repo root:

```bash
npm --prefix ./offchain run check
```

5. Run tests:

```bash
npm --prefix ./offchain test
```

6. Run one-command smoke flow (register agent + execute workflow):

```bash
npm --prefix ./offchain run smoke
```

7. Decode Talos events from transaction hash(es):

```bash
# pass hashes as CLI args
npm --prefix ./offchain run verify -- \
  0x6f8330813257dc97e190705e315b8aa28218499eec840d631f6eeb0dd4bb84f \
  0x7f51d3740a9b606d5d2c8065b36009bfd033e274dd0fa0fd202e3a742973a68

# or via env
export TALOS_VERIFY_TX_HASHES=0xabc,0xdef
npm --prefix ./offchain run verify
```

Optional verify env:

```bash
export TALOS_VERIFY_WAIT_RETRIES=8
export TALOS_VERIFY_WAIT_INTERVAL_MS=1500
export TALOS_VERIFY_LIFECYCLE_RETRIES=2
```

Required smoke env:

```bash
# produced by scripts/finalize_talos.sh
export TALOS_SMOKE_ENV_FILE=offchain/.env

# SDK wallet mode default is cartridge (web runtime)
export TALOS_WALLET_MODE=cartridge

# smoke flow defaults to signer (needed for canonical x402 hash signing)
export TALOS_SMOKE_WALLET_MODE=signer

# only required in signer mode (or when useStarkzap=false)
# module path (relative to repo root or absolute) exporting:
# { getPubKey(): Promise<string>, signRaw(hash): Promise<Array<string|number|bigint>> }
export TALOS_SMOKE_SIGNER_MODULE=offchain/your-signer-adapter.js
export TALOS_SMOKE_SIGNER_EXPORT=default
```

Optional smoke env:

```bash
export TALOS_SMOKE_TOKEN_ADDRESS=<defaults to STRK then USDC/WBTC/strkBTC env order>
export TALOS_SMOKE_PAYEE_ADDRESS=<defaults to payer>
export TALOS_SMOKE_AMOUNT=1
export TALOS_SMOKE_SCORE=90
export TALOS_SMOKE_DEADLINE_SECONDS=900
export TALOS_SMOKE_SKIP_APPROVE=false
```

Token address note:
- If you run on `sepolia`, Starkzap token presets use:
  - `STRK`: `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`
  - `USDC`: `0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343`

Local dev shortcut:

```bash
# Uses offchain/your-signer-adapter.js to read private key from your sncast accounts file
export TALOS_SMOKE_SIGNER_MODULE=offchain/your-signer-adapter.js
export TALOS_SMOKE_ACCOUNT_NETWORK=alpha-sepolia
export TALOS_SMOKE_ACCOUNT_NAME=talos_admin
```

## Headless Agent Quickstart

```ts
import { createTalosAgentRuntime, fetchWithX402 } from "talos-sdk";
import { PrivySigner } from "starkzap"; // or your own KMS/HSM signer adapter

const runtime = await createTalosAgentRuntime({
  rpcUrl: process.env.STARKNET_RPC_URL!,
  chainId: process.env.STARKNET_CHAIN_ID!,
  network: "sepolia",
  walletMode: "signer",
  signer: new PrivySigner({
    // inject signer config from your auth/KMS layer
    walletId: "...",
    publicKey: "...",
    serverUrl: "...",
  }),
  feeMode: "sponsored",
  autoEnsureReady: true,
  identityAddress: process.env.TALOS_IDENTITY_ADDRESS!,
  identityAbi,
  settlementAddress: process.env.TALOS_SETTLEMENT_ADDRESS!,
  coreAddress: process.env.TALOS_CORE_ADDRESS!,
  coreAbi,
  guardrails: {
    minDeadlineLeadSeconds: 30,
    maxDeadlineHorizonSeconds: 900,
    maxAmountByToken: {
      [process.env.TALOS_TOKEN_USDC_ADDRESS!.toLowerCase()]: 1_000_000n,
    },
  },
});

const x402Deps = runtime.createX402Deps();
const response = await fetchWithX402("https://peer-agent.example.com/task", {}, x402Deps);
```

## Roadmap

1. Keep current settlement signing as stable `v1` (canonical Poseidon hash + `is_valid_signature`).
2. Add SNIP-12 typed-data signing as `v2` for better wallet UX and interoperability.
3. Preserve replay-binding fields in `v2`: `chain_id`, `verifying_contract`, `task_id`, `deadline`.
4. Ship dual support (`v1` + `v2`) with fixed Cairo/TS test vectors before changing defaults.
5. Deprecate `v1` only after production monitoring confirms `v2` parity.

## Notes

- No private key is read from `.env` by the SDK runtime.
- SDK default wallet mode is `cartridge`; set `walletMode: "signer"` for Node/headless agents.
- In `walletMode=signer`, inject a signer object (`getPubKey` + `signRaw`) from Privy/KMS/HSM.
- In `walletMode=cartridge`, signer injection is optional for tx execution, but raw-hash x402 signing still needs a signer bridge.
- This runtime keeps Starkzap integration adapter-driven so you can swap provider-specific APIs cleanly.
- Use the same signing payload fields as `docs/talos-signing-spec.md`.
- If `settlement.cairo` hash logic changes, update `src/signing/settlementHash.ts` immediately.
