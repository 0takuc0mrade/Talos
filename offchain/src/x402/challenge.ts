import { assertTaskCommitment } from "../privacy/taskCommitmentPolicy.js";

export interface ParsedX402Challenge {
  payerAddress: string;
  payeeAddress: string;
  tokenAddress: string;
  amount: bigint;
  taskCommitment: string;
  deadline: number;
  targetAgentId: bigint;
  score: number;
  supportedTokens: string[];
}

type RawChallenge = {
  payer?: unknown;
  payer_address?: unknown;
  payee?: unknown;
  payee_address?: unknown;
  token?: unknown;
  token_address?: unknown;
  supported_tokens?: unknown;
  amount?: unknown;
  task_commitment?: unknown;
  task_id?: unknown;
  deadline?: unknown;
  target_agent_id?: unknown;
  score?: unknown;
};

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`x402 challenge field ${field} must be a non-empty string`);
  }
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  throw new Error(`x402 challenge field ${field} must be numeric`);
}

function asBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    return BigInt(value);
  }
  if (typeof value === "string" && value.trim()) {
    return BigInt(value);
  }
  throw new Error(`x402 challenge field ${field} must be bigint-compatible`);
}

function parseRawChallenge(raw: RawChallenge): ParsedX402Challenge {
  const payerAddress = asString(raw.payer_address ?? raw.payer, "payer_address");
  const payeeAddress = asString(raw.payee_address ?? raw.payee, "payee_address");
  const tokenAddress = asString(raw.token_address ?? raw.token, "token_address");
  const taskCommitment = assertTaskCommitment(
    asString(raw.task_commitment ?? raw.task_id, "task_commitment"),
    { fieldName: "task_commitment" },
  );
  const deadline = asNumber(raw.deadline, "deadline");
  const score = asNumber(raw.score ?? 0, "score");
  const targetAgentId = asBigInt(raw.target_agent_id ?? 0, "target_agent_id");
  const amount = asBigInt(raw.amount, "amount");

  if (score < 0 || score > 100) {
    throw new Error("x402 challenge score must be in range 0..100");
  }

  const supportedTokens = Array.isArray(raw.supported_tokens)
    ? raw.supported_tokens
        .filter((item): item is string => typeof item === "string" && item.length > 0)
        .map((item) => item)
    : [];

  return {
    payerAddress,
    payeeAddress,
    tokenAddress,
    amount,
    taskCommitment,
    deadline,
    targetAgentId,
    score,
    supportedTokens,
  };
}

// Default parser for x402 HTTP challenges carried either in header or response JSON.
export async function parseX402Challenge(response: Response): Promise<ParsedX402Challenge> {
  const challengeHeader = response.headers.get("x402-challenge");
  if (challengeHeader) {
    const parsed = JSON.parse(challengeHeader) as RawChallenge;
    return parseRawChallenge(parsed);
  }

  const cloned = response.clone();
  const body = (await cloned.json()) as RawChallenge;
  return parseRawChallenge(body);
}
