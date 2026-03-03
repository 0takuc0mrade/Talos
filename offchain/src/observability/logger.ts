export interface TalosLogger {
  info: (message: string, context?: unknown) => void;
  warn: (message: string, context?: unknown) => void;
  error: (message: string, context?: unknown) => void;
  debug: (message: string, context?: unknown) => void;
}

export interface TalosLoggerOptions {
  redactedKeys?: string[];
  level?: "debug" | "info" | "warn" | "error";
}

const DEFAULT_REDACTED_KEYS = new Set([
  "signature",
  "privateKey",
  "paymentProof",
  "rawPayload",
  "metadataUri",
  "authorization",
]);

const LEVEL_ORDER: Record<NonNullable<TalosLoggerOptions["level"]>, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function shouldLog(current: keyof typeof LEVEL_ORDER, target: keyof typeof LEVEL_ORDER): boolean {
  return LEVEL_ORDER[target] >= LEVEL_ORDER[current];
}

function redactValue(
  value: unknown,
  redactedKeys: Set<string>,
  depth: number,
): unknown {
  if (depth > 5) {
    return "[MAX_DEPTH]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, redactedKeys, depth + 1));
  }

  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input)) {
      if (redactedKeys.has(key)) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = redactValue(item, redactedKeys, depth + 1);
      }
    }
    return output;
  }

  return value;
}

export function createTalosLogger(options: TalosLoggerOptions = {}): TalosLogger {
  const level = options.level ?? "info";
  const redactedKeys = new Set(
    [...DEFAULT_REDACTED_KEYS, ...(options.redactedKeys ?? [])].map((item) => item.trim()),
  );

  const write = (target: keyof typeof LEVEL_ORDER, message: string, context?: unknown): void => {
    if (!shouldLog(level, target)) {
      return;
    }

    const payload = context === undefined ? undefined : redactValue(context, redactedKeys, 0);
    const line = payload === undefined
      ? `[${target.toUpperCase()}] ${message}`
      : `[${target.toUpperCase()}] ${message} ${JSON.stringify(payload)}`;
    // eslint-disable-next-line no-console
    console.log(line);
  };

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
  };
}
