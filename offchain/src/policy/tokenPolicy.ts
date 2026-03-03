import type { TokenBalance } from "../types.js";

export interface TokenSelectionInput {
  amount: bigint;
  supportedTokens: string[];
  balances: TokenBalance[];
  preferredOrder?: string[];
  minReserveByToken?: Record<string, bigint>;
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function indexByToken(balances: TokenBalance[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const balance of balances) {
    out.set(normalizeAddress(balance.tokenAddress), balance.balance);
  }
  return out;
}

function canSpend(
  token: string,
  amount: bigint,
  balances: Map<string, bigint>,
  minReserveByToken: Record<string, bigint>,
): boolean {
  const balance = balances.get(token) ?? 0n;
  const reserve = minReserveByToken[token] ?? 0n;
  if (reserve < 0n) {
    throw new Error(`minReserve for token ${token} cannot be negative`);
  }
  return balance >= amount + reserve;
}

// Deterministic token selector for x402 settlement.
export function selectSettlementToken(input: TokenSelectionInput): string {
  if (input.amount <= 0n) {
    throw new Error("amount must be greater than zero");
  }

  const supported = [...new Set(input.supportedTokens.map(normalizeAddress))];
  if (supported.length === 0) {
    throw new Error("supportedTokens cannot be empty");
  }

  const preferred = (input.preferredOrder ?? []).map(normalizeAddress);
  const balancesByToken = indexByToken(input.balances);
  const minReserveByToken: Record<string, bigint> = {};
  for (const [token, reserve] of Object.entries(input.minReserveByToken ?? {})) {
    minReserveByToken[normalizeAddress(token)] = reserve;
  }

  for (const token of preferred) {
    if (!supported.includes(token)) {
      continue;
    }
    if (canSpend(token, input.amount, balancesByToken, minReserveByToken)) {
      return token;
    }
  }

  const fallback = [...supported]
    .filter((token) => canSpend(token, input.amount, balancesByToken, minReserveByToken))
    .sort((a, b) => {
      const aBalance = balancesByToken.get(a) ?? 0n;
      const bBalance = balancesByToken.get(b) ?? 0n;
      if (aBalance === bBalance) {
        return a.localeCompare(b);
      }
      return aBalance > bBalance ? -1 : 1;
    });

  if (fallback.length === 0) {
    throw new Error("no supported token has sufficient balance");
  }

  return fallback[0];
}
