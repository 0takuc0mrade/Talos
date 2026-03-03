import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const starkzapSrcDir = path.join(rootDir, "node_modules", "starkzap", "dist", "src");

function normalizePathFromFileUrlPath(fileUrlPath) {
  // On Linux this is already a normal absolute path, but keep this helper
  // so the script remains predictable across environments.
  return decodeURIComponent(fileUrlPath);
}

function hasResolvableExtension(specifier) {
  const ext = path.extname(specifier);
  return ext === ".js" || ext === ".json" || ext === ".node" || ext === ".mjs" || ext === ".cjs";
}

function patchRelativeSpecifier(specifier, fromDir) {
  if (!(specifier.startsWith("./") || specifier.startsWith("../"))) {
    return specifier;
  }

  const resolvedBase = path.resolve(fromDir, specifier);
  const resolvedAsFile = `${resolvedBase}.js`;
  const resolvedAsIndex = path.join(resolvedBase, "index.js");

  if (hasResolvableExtension(specifier)) {
    if (specifier.endsWith(".js")) {
      const literalPath = path.resolve(fromDir, specifier);
      if (fs.existsSync(literalPath)) {
        return specifier;
      }

      const withoutJs = specifier.slice(0, -3);
      const fallbackIndex = path.resolve(fromDir, withoutJs, "index.js");
      if (fs.existsSync(fallbackIndex)) {
        return `${withoutJs}/index.js`;
      }
    }
    return specifier;
  }

  if (fs.existsSync(resolvedAsFile)) {
    return `${specifier}.js`;
  }
  if (fs.existsSync(resolvedAsIndex)) {
    return `${specifier}/index.js`;
  }

  return `${specifier}.js`;
}

function patchFile(filePath) {
  const fromDir = path.dirname(filePath);
  const source = fs.readFileSync(filePath, "utf8");
  let updated = source;

  updated = updated.replace(
    /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
    (match, prefix, specifier, suffix) =>
      `${prefix}${patchRelativeSpecifier(specifier, fromDir)}${suffix}`,
  );

  updated = updated.replace(
    /(import\(\s*["'])(\.\.?\/[^"']+)(["']\s*\))/g,
    (match, prefix, specifier, suffix) =>
      `${prefix}${patchRelativeSpecifier(specifier, fromDir)}${suffix}`,
  );

  if (updated !== source) {
    fs.writeFileSync(filePath, updated);
    return true;
  }
  return false;
}

function walkJsFiles(dirPath, out) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const absPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkJsFiles(absPath, out);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(absPath);
    }
  }
}

function main() {
  const normalizedRoot = normalizePathFromFileUrlPath(rootDir);
  const srcDir = normalizePathFromFileUrlPath(starkzapSrcDir);

  if (!fs.existsSync(srcDir)) {
    console.log("patch-starkzap: skipped (starkzap dist/src not found)");
    return;
  }

  const files = [];
  walkJsFiles(srcDir, files);

  let patchedCount = 0;
  for (const file of files) {
    if (patchFile(file)) {
      patchedCount += 1;
    }
  }

  console.log(
    `patch-starkzap: completed in ${normalizedRoot}, patched ${patchedCount} file(s) under ${srcDir}`,
  );
}

main();
