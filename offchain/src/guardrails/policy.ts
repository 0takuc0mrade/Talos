import type { WorkflowExecutionInput } from "../types.js";
import { SlidingWindowRateLimiter, type RateLimitRule } from "./rateLimiter.js";

export interface TalosGuardrailsConfig {
  paused?: boolean | (() => boolean);
  globalRateLimit?: RateLimitRule;
  payerRateLimit?: RateLimitRule;
  maxAmountByToken?: Record<string, bigint>;
  minDeadlineLeadSeconds?: number;
  maxDeadlineHorizonSeconds?: number;
  nowMs?: () => number;
}

function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function ensurePositiveAmount(value: bigint): void {
  if (value <= 0n) {
    throw new Error("payment amount must be positive");
  }
}

function ensureScoreRange(score: number): void {
  if (score < 0 || score > 100) {
    throw new Error("score must be in range 0..100");
  }
}

function asBool(value: TalosGuardrailsConfig["paused"]): boolean {
  if (typeof value === "function") {
    return value();
  }
  return Boolean(value);
}

export class TalosExecutionGuardrails {
  private readonly config: TalosGuardrailsConfig;
  private readonly globalLimiter?: SlidingWindowRateLimiter;
  private readonly payerLimiter?: SlidingWindowRateLimiter;

  constructor(config: TalosGuardrailsConfig = {}) {
    this.config = config;
    this.globalLimiter = config.globalRateLimit
      ? new SlidingWindowRateLimiter(config.globalRateLimit)
      : undefined;
    this.payerLimiter = config.payerRateLimit
      ? new SlidingWindowRateLimiter(config.payerRateLimit)
      : undefined;
  }

  assertCanExecute(input: WorkflowExecutionInput): void {
    if (asBool(this.config.paused)) {
      throw new Error("talos execution is paused");
    }

    ensurePositiveAmount(input.amount);
    ensureScoreRange(input.score);

    const nowMs = this.config.nowMs?.() ?? Date.now();
    const deadlineMs = input.deadline * 1000;
    if (deadlineMs <= nowMs) {
      throw new Error("workflow deadline is already expired");
    }

    if (this.config.minDeadlineLeadSeconds !== undefined) {
      const minLeadMs = this.config.minDeadlineLeadSeconds * 1000;
      if (deadlineMs - nowMs < minLeadMs) {
        throw new Error("workflow deadline lead time below configured minimum");
      }
    }

    if (this.config.maxDeadlineHorizonSeconds !== undefined) {
      const maxHorizonMs = this.config.maxDeadlineHorizonSeconds * 1000;
      if (deadlineMs - nowMs > maxHorizonMs) {
        throw new Error("workflow deadline exceeds configured maximum horizon");
      }
    }

    const token = normalizeAddress(input.tokenAddress);
    const cap = this.config.maxAmountByToken?.[token];
    if (cap !== undefined && input.amount > cap) {
      throw new Error(`workflow amount exceeds cap for token ${token}`);
    }

    if (this.globalLimiter && !this.globalLimiter.tryConsume("global", nowMs)) {
      throw new Error("global rate limit exceeded");
    }

    if (this.payerLimiter) {
      const payerKey = normalizeAddress(input.payerAddress);
      if (!this.payerLimiter.tryConsume(payerKey, nowMs)) {
        throw new Error(`payer rate limit exceeded for ${payerKey}`);
      }
    }
  }
}
