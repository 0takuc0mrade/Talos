import { hash, shortString } from "starknet";
import type { FeltLike, SettlementPayload } from "../types.js";

const U128_MASK = (1n << 128n) - 1n;

function toBigInt(value: FeltLike): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    return BigInt(value);
  }
  if (value.startsWith("0x") || value.startsWith("0X")) {
    return BigInt(value);
  }
  return BigInt(value);
}

function feltHex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

export function splitU256(amount: bigint): { low: bigint; high: bigint } {
  if (amount < 0n) {
    throw new Error("amount must be non-negative");
  }
  return {
    low: amount & U128_MASK,
    high: amount >> 128n,
  };
}

export function buildSettlementHashElements(payload: SettlementPayload): bigint[] {
  const domain = payload.domain ?? "TALOS_SETTLEMENT";
  const version = payload.version ?? "v1";
  const amount = splitU256(payload.amount);

  return [
    BigInt(shortString.encodeShortString(domain)),
    BigInt(shortString.encodeShortString(version)),
    toBigInt(payload.verifyingContract),
    toBigInt(payload.chainId),
    toBigInt(payload.payerAddress),
    toBigInt(payload.payeeAddress),
    toBigInt(payload.tokenAddress),
    amount.low,
    amount.high,
    toBigInt(payload.taskCommitment),
    toBigInt(payload.deadline),
  ];
}

// Must stay aligned with settlement.cairo::compute_mock_message_hash.
export function computeSettlementMessageHash(payload: SettlementPayload): string {
  const elements = buildSettlementHashElements(payload).map(feltHex);
  return hash.computePoseidonHashOnElements(elements);
}
