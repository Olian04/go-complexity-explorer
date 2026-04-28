// Builds the package -> file -> function hierarchy that D3 turns into the
// treemap. Also computes per-tile marker types (`unused` / `external-callback`)
// based on backlinks and reference_backlinks.

import { scoreFunction } from "./scoring.mjs";
import {
  packagePathFromFile,
  isMainEntrypoint,
  looksLikeExternalLibraryCallback,
} from "./packages.mjs";

export function buildHierarchy(functions, model, weights) {
  const pkgMap = new Map();
  for (const fn of functions) {
    const score = scoreFunction(fn, model, weights);
    const packageName = packagePathFromFile(fn.file, fn.package);
    const fileName = fn.file || "(unknown)";

    if (!pkgMap.has(packageName)) {
      pkgMap.set(packageName, new Map());
    }
    const fileMap = pkgMap.get(packageName);
    if (!fileMap.has(fileName)) {
      fileMap.set(fileName, []);
    }

    fileMap.get(fileName).push({
      backlinksCount: (fn.inspect?.backlinks || []).length,
      id: fn.id,
      name: fn.function,
      package: packageName,
      file: fileName,
      cyclomatic: fn.cyclomatic,
      cognitive: fn.cognitive,
      markerType: (() => {
        const backlinksCount = (fn.inspect?.backlinks || []).length;
        const hasFunctionValueReference = (fn.inspect?.reference_backlinks || []).length > 0;
        if (backlinksCount > 0 || isMainEntrypoint(fn.package, fn.function)) {
          return null;
        }
        if (hasFunctionValueReference || looksLikeExternalLibraryCallback(fn.function)) {
          return "external-callback";
        }
        return "unused";
      })(),
      score,
      value: Math.max(score, 0.0001),
    });
  }

  const packages = [];
  for (const [pkg, fileMap] of pkgMap.entries()) {
    const files = [];
    for (const [fileName, functionsInFile] of fileMap.entries()) {
      files.push({
        name: fileName,
        children: functionsInFile.sort((a, b) => b.value - a.value),
      });
    }
    packages.push({
      name: pkg,
      children: files.sort((a, b) => {
        const aSum = a.children.reduce((sum, f) => sum + f.value, 0);
        const bSum = b.children.reduce((sum, f) => sum + f.value, 0);
        return bSum - aSum;
      }),
    });
  }

  return { name: "codebase", children: packages };
}
