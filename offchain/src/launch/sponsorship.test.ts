import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGasSponsorshipReadiness } from "./sponsorship.js";

test("evaluateGasSponsorshipReadiness accepts cartridge sponsored mode", () => {
  const report = evaluateGasSponsorshipReadiness({
    walletMode: "cartridge",
    feeMode: "sponsored",
  });
  assert.equal(report.ready, true);
  assert.equal(report.reasons.length, 0);
});

test("evaluateGasSponsorshipReadiness rejects user_pays mode", () => {
  const report = evaluateGasSponsorshipReadiness({
    walletMode: "cartridge",
    feeMode: "user_pays",
  });
  assert.equal(report.ready, false);
  assert.match(report.reasons.join(" "), /feeMode must be 'sponsored'/);
});

test("evaluateGasSponsorshipReadiness requires paymaster for signer mode", () => {
  const report = evaluateGasSponsorshipReadiness({
    walletMode: "signer",
    feeMode: "sponsored",
    paymasterServiceConfigured: false,
  });
  assert.equal(report.ready, false);
  assert.match(report.reasons.join(" "), /paymasterServiceConfigured/);
});
