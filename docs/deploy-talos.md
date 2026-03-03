# Talos Contract Deployment

Use the deployment script to declare, deploy, and wire all Talos modules in sequence.

Script:

`scripts/deploy_talos.sh`

## What It Does

1. Builds contracts with `scarb build` (unless `SKIP_BUILD=1`).
2. Declares `TalosIdentity`, `TalosSettlement`, `TalosReputation`, `TalosCore`.
3. Deploys contracts in this order:
   - `TalosIdentity`
   - `TalosSettlement(admin)`
   - `TalosReputation(core_protocol=0x0, admin)` (temporary)
   - `TalosCore(identity, settlement, reputation)`
4. Wires modules post-deploy:
   - `settlement.set_core_protocol(core)`
   - `reputation.set_core_protocol(core)`
5. Optionally whitelists tokens in settlement:
   - `TALOS_TOKEN_STRK_ADDRESS`
   - `TALOS_TOKEN_WBTC_ADDRESS`
   - `TALOS_TOKEN_STRKBTC_ADDRESS`
   - `TALOS_TOKEN_USDC_ADDRESS`
6. Writes discovered addresses to `offchain/.env.deployed` (or `OUTPUT_ENV_FILE`).

## Required Environment

At minimum, provide `TALOS_ADMIN` one of these ways:

```bash
export TALOS_ADMIN=<your_account_address>
```

or enter it interactively when the script prompts.

Network selection (pick one). If neither is set, the script prompts interactively:

```bash
export STARKNET_RPC_URL=<rpc_url>
# or
export STARKNET_NETWORK=sepolia
```

`SNCAST_PROFILE` can be set in env, or entered when prompted (defaults to `default`):

```bash
export SNCAST_PROFILE=default
```

Optional predeclared class hashes (to skip `declare` calls on reruns):

```bash
export TALOS_IDENTITY_CLASS_HASH=0x...
export TALOS_SETTLEMENT_CLASS_HASH=0x...
export TALOS_REPUTATION_CLASS_HASH=0x...
export TALOS_CORE_CLASS_HASH=0x...
```

Optional RPC throttling retries (useful on public Sepolia RPC):

```bash
export SNCAST_MAX_RETRIES=8
export SNCAST_RETRY_DELAY_SECONDS=10
```

Optional token whitelist:

```bash
export TALOS_TOKEN_STRK_ADDRESS=0x...
export TALOS_TOKEN_WBTC_ADDRESS=0x...
export TALOS_TOKEN_STRKBTC_ADDRESS=0x...
export TALOS_TOKEN_USDC_ADDRESS=0x...
```

## Run

From repo root:

```bash
./scripts/deploy_talos.sh
```

## Post-Deploy Finalization

After deployment, use:

`scripts/finalize_talos.sh`

This script automates:
1. Admin ownership verification on settlement/reputation.
2. Core wiring verification and repair (`set_core_protocol`) if needed.
3. Token whitelist verification and auto-whitelisting.
   - Uses Starkzap-aligned defaults for common tokens:
     - `sepolia`: STRK + native USDC
     - `mainnet`: STRK + WBTC + native USDC
   - `strkBTC` remains optional.
   - Any provided token address is pre-validated on-chain (`decimals()` call) before whitelist.
4. Offchain env generation to `offchain/.env` (or `OFFCHAIN_ENV_FILE`).
5. Optional offchain validation (`npm --prefix offchain run check` + `npm --prefix offchain test`).

Default inputs:
1. Reads deployment addresses from `offchain/.env.deployed` (or `DEPLOYED_ENV_FILE`).
2. Prompts for missing required runtime values (`STARKNET_RPC_URL`, STRK/USDC when not preset).
3. Optional tokens (`WBTC`, `strkBTC`) are read from env if provided; otherwise skipped.

Run:

```bash
./scripts/finalize_talos.sh
```

Optional:

```bash
export DEPLOYED_ENV_FILE=offchain/.env.deployed
export OFFCHAIN_ENV_FILE=offchain/.env
export RUN_OFFCHAIN_VALIDATION=1
```

## Important Notes

1. The account used by `sncast` should match `TALOS_ADMIN` if you want the script to complete post-deploy wiring and token whitelisting in one run.
2. If you use a different admin address, deploy will succeed but admin-only wiring calls can fail.
