export type TalosFeeMode = "sponsored" | "user_pays";
export type TalosWalletMode = "signer" | "cartridge";

export interface GasSponsorshipInput {
  walletMode: TalosWalletMode;
  feeMode: TalosFeeMode;
  paymasterServiceConfigured?: boolean;
}

export interface GasSponsorshipReadiness {
  ready: boolean;
  reasons: string[];
}

export function evaluateGasSponsorshipReadiness(
  input: GasSponsorshipInput,
): GasSponsorshipReadiness {
  const reasons: string[] = [];

  if (input.feeMode !== "sponsored") {
    reasons.push("feeMode must be 'sponsored' for gasless MVP UX");
  }

  // Cartridge has built-in sponsored execution. Signer mode requires explicit paymaster path.
  if (input.walletMode === "signer" && !input.paymasterServiceConfigured) {
    reasons.push("paymasterServiceConfigured must be true in signer mode");
  }

  return {
    ready: reasons.length === 0,
    reasons,
  };
}
