import type {
  AgentWalletSigner,
  SettlementPayload,
  SettlementSignature,
} from "../types.js";
import { computeSettlementMessageHash } from "./settlementHash.js";

function normalizeFelt(value: string): string {
  if (!value) {
    throw new Error("signature element is empty");
  }
  if (value.startsWith("0x") || value.startsWith("0X")) {
    return `0x${BigInt(value).toString(16)}`;
  }
  return `0x${BigInt(value).toString(16)}`;
}

export async function signSettlementPayload(
  payload: SettlementPayload,
  signer: AgentWalletSigner,
): Promise<SettlementSignature> {
  if (!signer?.signMessageHash) {
    throw new Error("signer.signMessageHash is required");
  }

  const messageHash = computeSettlementMessageHash(payload);
  const signature = await signer.signMessageHash(messageHash);

  if (!Array.isArray(signature) || signature.length === 0) {
    throw new Error("empty signature from signer");
  }

  return {
    messageHash,
    signature: signature.map(normalizeFelt),
  };
}
