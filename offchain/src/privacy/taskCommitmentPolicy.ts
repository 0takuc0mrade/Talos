export interface TaskCommitmentPolicy {
  minBitLength?: number;
  fieldName?: string;
}

const MAX_FELT252 = (1n << 252n) - 1n;
export const DEFAULT_TASK_COMMITMENT_MIN_BITS = 120;

function parseCommitmentBigInt(value: string, fieldName: string): bigint {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} cannot be empty`);
  }
  if (!trimmed.startsWith("0x") && !trimmed.startsWith("0X")) {
    throw new Error(`${fieldName} must be a hex felt string (0x...)`);
  }

  let parsed: bigint;
  try {
    parsed = BigInt(trimmed);
  } catch {
    throw new Error(`${fieldName} must be a valid hex felt string`);
  }

  if (parsed <= 0n) {
    throw new Error(`${fieldName} must be non-zero`);
  }
  if (parsed > MAX_FELT252) {
    throw new Error(`${fieldName} exceeds felt252 range`);
  }

  return parsed;
}

export function bitLength(value: bigint): number {
  return value === 0n ? 0 : value.toString(2).length;
}

export function assertTaskCommitment(value: string, policy: TaskCommitmentPolicy = {}): string {
  const fieldName = policy.fieldName ?? "taskCommitment";
  const parsed = parseCommitmentBigInt(value, fieldName);
  const minBitLength = policy.minBitLength ?? DEFAULT_TASK_COMMITMENT_MIN_BITS;
  if (minBitLength > 0 && bitLength(parsed) < minBitLength) {
    throw new Error(
      `${fieldName} must be a high-entropy commitment (>= ${minBitLength} bits).`,
    );
  }
  return `0x${parsed.toString(16)}`;
}
