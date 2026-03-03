import fs from "node:fs";
import path from "node:path";

export interface InterfaceFreezeEntry {
  file: string;
  trait: string;
  signatures: string[];
}

export interface InterfaceFreezeManifest {
  version: string;
  entries: InterfaceFreezeEntry[];
}

export interface InterfaceFreezeMismatch {
  file: string;
  trait: string;
  expected: string[];
  actual: string[];
  missing: string[];
  unexpected: string[];
  orderChanged: boolean;
}

export interface InterfaceFreezeReport {
  manifestVersion: string;
  checkedAt: string;
  mismatches: InterfaceFreezeMismatch[];
}

function normalizeSignature(signature: string): string {
  return signature.replace(/\s+/g, " ").replace(/,\s*\)/g, ")").trim();
}

function extractTraitBody(source: string, trait: string): string {
  const traitIndex = source.indexOf(`pub trait ${trait}`);
  if (traitIndex < 0) {
    throw new Error(`trait not found: ${trait}`);
  }

  const openBraceIndex = source.indexOf("{", traitIndex);
  if (openBraceIndex < 0) {
    throw new Error(`trait body not found: ${trait}`);
  }

  let depth = 1;
  for (let index = openBraceIndex + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBraceIndex + 1, index);
      }
    }
  }

  throw new Error(`unterminated trait body: ${trait}`);
}

export function extractTraitFunctionSignatures(source: string, trait: string): string[] {
  const body = extractTraitBody(source, trait);
  const segments = body.split(";");
  const signatures: string[] = [];

  for (const segment of segments) {
    const candidate = segment.trim();
    if (!candidate.startsWith("fn ")) {
      continue;
    }
    signatures.push(normalizeSignature(`${candidate};`));
  }

  return signatures;
}

export function loadInterfaceFreezeManifest(manifestPath: string): InterfaceFreezeManifest {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as InterfaceFreezeManifest;

  if (!parsed.version || !Array.isArray(parsed.entries)) {
    throw new Error(`invalid interface freeze manifest: ${manifestPath}`);
  }

  return parsed;
}

export function checkInterfaceFreeze(
  manifest: InterfaceFreezeManifest,
  repoRoot: string,
): InterfaceFreezeReport {
  const mismatches: InterfaceFreezeMismatch[] = [];

  for (const entry of manifest.entries) {
    const filePath = path.resolve(repoRoot, entry.file);
    const source = fs.readFileSync(filePath, "utf8");
    const actual = extractTraitFunctionSignatures(source, entry.trait);
    const expected = entry.signatures.map((item) => normalizeSignature(item));

    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const missing = expected.filter((item) => !actualSet.has(item));
    const unexpected = actual.filter((item) => !expectedSet.has(item));
    const orderChanged =
      actual.length === expected.length &&
      missing.length === 0 &&
      unexpected.length === 0 &&
      expected.some((item, index) => actual[index] !== item);

    if (missing.length > 0 || unexpected.length > 0 || orderChanged) {
      mismatches.push({
        file: entry.file,
        trait: entry.trait,
        expected,
        actual,
        missing,
        unexpected,
        orderChanged,
      });
    }
  }

  return {
    manifestVersion: manifest.version,
    checkedAt: new Date().toISOString(),
    mismatches,
  };
}
