import { hash, shortString } from "starknet";
import type { FeltLike } from "../types.js";

export interface TaskCommitmentInput {
  externalTaskRef: string;
  nonce: FeltLike;
  payerAddress: FeltLike;
  payeeAddress: FeltLike;
  salt?: FeltLike;
  domain?: string;
  version?: string;
}

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

function hashExternalRef(externalTaskRef: string): bigint {
  if (!externalTaskRef.trim()) {
    throw new Error("externalTaskRef is required");
  }
  return BigInt(hash.starknetKeccak(externalTaskRef));
}

// Privacy-first commitment for `task_id` / nullifier storage on-chain.
export function computeTaskCommitment(input: TaskCommitmentInput): string {
  const domain = input.domain ?? "TALOS_TASK";
  const version = input.version ?? "v1";
  const salt = toBigInt(input.salt ?? 0n);

  const elements = [
    BigInt(shortString.encodeShortString(domain)),
    BigInt(shortString.encodeShortString(version)),
    hashExternalRef(input.externalTaskRef),
    toBigInt(input.nonce),
    toBigInt(input.payerAddress),
    toBigInt(input.payeeAddress),
    salt,
  ];

  return hash.computePoseidonHashOnElements(elements.map(feltHex));
}
