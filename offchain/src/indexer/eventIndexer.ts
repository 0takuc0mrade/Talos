import { selector, type RpcProvider } from "starknet";
import type { TalosDeploymentConfig } from "../deployment/addressBook.js";
import { createTalosLogger, type TalosLogger } from "../observability/logger.js";
import { TalosMetrics } from "../observability/metrics.js";

export interface TalosIndexedEvent {
  module: "identity" | "settlement" | "reputation" | "core";
  eventName: string;
  blockNumber?: number;
  transactionHash: string;
  contractAddress: string;
  keys: string[];
  data: string[];
}

export interface TalosEventIndexerOptions {
  chunkSize?: number;
  logger?: TalosLogger;
  metrics?: TalosMetrics;
  sink?: (events: TalosIndexedEvent[]) => Promise<void> | void;
}

type ModuleName = TalosIndexedEvent["module"];

const EVENTS_BY_MODULE: Record<ModuleName, string[]> = {
  identity: ["AgentRegistered", "MetadataUpdated"],
  settlement: [
    "CoreProtocolSet",
    "AdminTransferred",
    "SupportedTokenAdded",
    "SupportedTokenRemoved",
    "PaymentSettled",
  ],
  reputation: ["FeedbackSubmitted"],
  core: ["WorkflowExecuted"],
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item));
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export class TalosEventIndexer {
  private readonly provider: RpcProvider;
  private readonly deployment: TalosDeploymentConfig;
  private readonly chunkSize: number;
  private readonly logger: TalosLogger;
  private readonly metrics: TalosMetrics;
  private readonly sink?: (events: TalosIndexedEvent[]) => Promise<void> | void;

  constructor(
    provider: RpcProvider,
    deployment: TalosDeploymentConfig,
    options: TalosEventIndexerOptions = {},
  ) {
    this.provider = provider;
    this.deployment = deployment;
    this.chunkSize = options.chunkSize ?? 100;
    this.logger = options.logger ?? createTalosLogger();
    this.metrics = options.metrics ?? new TalosMetrics();
    this.sink = options.sink;
  }

  getMetrics(): TalosMetrics {
    return this.metrics;
  }

  async pollRange(
    fromBlock: number,
    toBlock: number | "latest" = "latest",
  ): Promise<TalosIndexedEvent[]> {
    const startedAt = Date.now();
    const indexed: TalosIndexedEvent[] = [];

    for (const [module, eventNames] of Object.entries(EVENTS_BY_MODULE) as [ModuleName, string[]][]) {
      const address = this.deployment.modules[module];
      for (const eventName of eventNames) {
        const selectorHex = selector.getSelectorFromName(eventName);
        const events = await this.fetchEvents(address, fromBlock, toBlock, selectorHex);
        for (const event of events) {
          indexed.push({
            module,
            eventName,
            blockNumber: asOptionalNumber((event as Record<string, unknown>).block_number),
            transactionHash: String((event as Record<string, unknown>).transaction_hash ?? ""),
            contractAddress: String((event as Record<string, unknown>).from_address ?? address),
            keys: asStringArray((event as Record<string, unknown>).keys),
            data: asStringArray((event as Record<string, unknown>).data),
          });
        }
        if (events.length > 0) {
          this.metrics.increment("talos_indexed_events_total", { module, event: eventName }, events.length);
        }
      }
    }

    if (indexed.length > 0 && this.sink) {
      await this.sink(indexed);
    }

    this.metrics.observeDurationMs("talos_indexer_poll", Date.now() - startedAt, {
      result: indexed.length > 0 ? "events" : "empty",
    });
    this.logger.info("indexer poll complete", {
      fromBlock,
      toBlock,
      indexedCount: indexed.length,
    });

    return indexed;
  }

  private async fetchEvents(
    address: string,
    fromBlock: number,
    toBlock: number | "latest",
    eventSelector: string,
  ): Promise<unknown[]> {
    let continuationToken: string | undefined;
    const out: unknown[] = [];

    while (true) {
      const response = await this.provider.getEvents({
        address,
        from_block: { block_number: fromBlock },
        to_block: toBlock === "latest" ? "latest" : { block_number: toBlock },
        keys: [[eventSelector]],
        chunk_size: this.chunkSize,
        continuation_token: continuationToken,
      } as any);

      const events = ((response as Record<string, unknown>).events ?? []) as unknown[];
      out.push(...events);

      continuationToken = (response as Record<string, unknown>).continuation_token as string | undefined;
      if (!continuationToken) {
        break;
      }
    }

    return out;
  }
}
