import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkInterfaceFreeze,
  loadInterfaceFreezeManifest,
} from "../abi/interfaceFreeze.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

function resolveManifestPath(value: string | undefined): string {
  if (!value || !value.trim()) {
    return path.join(repoRoot, "docs", "talos-abi-freeze.json");
  }
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function main(): void {
  const manifestPath = resolveManifestPath(process.env.TALOS_ABI_FREEZE_MANIFEST);
  const manifest = loadInterfaceFreezeManifest(manifestPath);
  const report = checkInterfaceFreeze(manifest, repoRoot);

  if (report.mismatches.length === 0) {
    console.log(
      `ABI freeze check passed (${report.manifestVersion}) using ${path.relative(repoRoot, manifestPath)}.`,
    );
    return;
  }

  console.error(
    `ABI freeze check failed (${report.manifestVersion}) with ${report.mismatches.length} mismatched trait(s).`,
  );
  for (const mismatch of report.mismatches) {
    console.error(`\n[${mismatch.trait}] ${mismatch.file}`);
    if (mismatch.missing.length > 0) {
      console.error("  Missing signatures:");
      for (const signature of mismatch.missing) {
        console.error(`    - ${signature}`);
      }
    }
    if (mismatch.unexpected.length > 0) {
      console.error("  Unexpected signatures:");
      for (const signature of mismatch.unexpected) {
        console.error(`    - ${signature}`);
      }
    }
    if (mismatch.orderChanged) {
      console.error("  Order changed: signatures match as a set but not in declaration order.");
    }
  }
  process.exit(1);
}

main();
