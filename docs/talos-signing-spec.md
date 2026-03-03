# Talos Settlement Signing Spec (MVP)

This document defines the canonical payload that must be signed off-chain and verified on-chain by `TalosSettlement`.

## Purpose

Guarantee that one exact message format is used by:

- Backend agents creating x402 payment proofs.
- `settlement.cairo` verification via `payer_address.is_valid_signature`.

## Canonical Fields

The message hash is Poseidon over the following ordered elements:

1. `domain` = `"TALOS_SETTLEMENT"`
2. `version` = `"v1"`
3. `verifying_contract` = deployed `TalosSettlement` address
4. `chain_id` = Starknet `tx_info.chain_id`
5. `payer_address`
6. `payee_address`
7. `token_address`
8. `amount_low` (u256 low 128 bits)
9. `amount_high` (u256 high 128 bits)
10. `task_commitment` (on-chain field is `task_id`)
11. `deadline` (u64 unix timestamp, seconds)

## Security Invariants

- `verifying_contract` and `chain_id` prevent cross-contract and cross-network replay.
- `task_commitment` + settlement storage prevents same-payment replay.
- `deadline` prevents stale signature reuse.
- Signature verification is delegated to payer account contract (`ISRC6.is_valid_signature`), compatible with Starknet account abstraction.

## Privacy Guidelines (MVP)

- `task_commitment` must be a one-way commitment hash, not plaintext business IDs.
- `task_commitment` must be hex felt and high-entropy (recommended: >= 120 bits).
- No raw sensitive payloads should be emitted in on-chain events.
- Off-chain metadata and task details should be encrypted.
- Recommended commitment helper: `offchain/src/signing/taskCommitment.ts`.
- Enforced policy helper: `offchain/src/privacy/taskCommitmentPolicy.ts`.

### Task Commitment Recipe (Recommended)

Use Poseidon over:

1. `domain` = `"TALOS_TASK"`
2. `version` = `"v1"`
3. `external_task_ref_hash` = Starknet keccak of your internal task ref
4. `nonce`
5. `payer_address`
6. `payee_address`
7. `salt`

Store only the resulting commitment on-chain as `task_id`.

## TypeScript Alignment

Use `offchain/src/signing/settlementHash.ts` as the canonical client implementation.
Any change in `settlement.cairo::compute_mock_message_hash` must be mirrored there and re-tested with fixed vectors.

### Fixed Test Vectors

Vector 1 hash:
`0x69581519a53d776ef6bb583c847d1418def4ecd056e0cfc31f7bce08533de8f`

Vector 2 hash:
`0x50691305e7022f55ca1a5074bac007e08584c714c735d8cfdc5121eb538bc9c`
