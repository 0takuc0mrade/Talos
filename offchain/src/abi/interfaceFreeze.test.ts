import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkInterfaceFreeze,
  extractTraitFunctionSignatures,
  loadInterfaceFreezeManifest,
} from "./interfaceFreeze.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

test("extractTraitFunctionSignatures parses ITalosIdentity signatures", () => {
  const identityPath = path.join(repoRoot, "src", "identity.cairo");
  const source = fs.readFileSync(identityPath, "utf8");

  const signatures = extractTraitFunctionSignatures(source, "ITalosIdentity");
  assert.equal(signatures.length, 4);
  assert.equal(
    signatures[0],
    "fn register_agent( ref self: TContractState, pub_key: felt252, metadata_uri: ByteArray) -> u256;",
  );
});

test("checkInterfaceFreeze passes current manifest", () => {
  const manifestPath = path.join(repoRoot, "docs", "talos-abi-freeze.json");
  const manifest = loadInterfaceFreezeManifest(manifestPath);
  const report = checkInterfaceFreeze(manifest, repoRoot);

  assert.equal(report.mismatches.length, 0);
});

test("checkInterfaceFreeze detects manifest drift", () => {
  const manifestPath = path.join(repoRoot, "docs", "talos-abi-freeze.json");
  const manifest = loadInterfaceFreezeManifest(manifestPath);

  const drifted = {
    ...manifest,
    entries: manifest.entries.map((entry) =>
      entry.trait === "ITalosCore"
        ? {
            ...entry,
            signatures: entry.signatures.filter(
              (signature) => !signature.includes("get_reputation_contract"),
            ),
          }
        : entry
    ),
  };

  const report = checkInterfaceFreeze(drifted, repoRoot);
  assert.equal(report.mismatches.length, 1);
  assert.equal(report.mismatches[0].trait, "ITalosCore");
  assert.match(report.mismatches[0].unexpected.join("\n"), /get_reputation_contract/);
});
