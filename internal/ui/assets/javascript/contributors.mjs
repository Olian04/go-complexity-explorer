// Logic for the per-line "complexity contributor" annotations rendered in
// the inspector's source view: kind/severity classification, recursion
// detection via the call graph, hover messages, and the helper that derives
// the displayable function name from a possibly-method-qualified Go name.

import { state } from "./globals.mjs";

export function isPositionWithinContributor(position, item) {
  const line = position.lineNumber;
  const column = position.column;
  if (line < item.start_line || line > item.end_line) {
    return false;
  }
  if (line === item.start_line && column < item.start_col) {
    return false;
  }
  if (line === item.end_line && column > item.end_col) {
    return false;
  }
  return true;
}

export function normalizeContributorKind(kind) {
  if (kind === "if") {
    return "if";
  }
  if (kind === "for" || kind === "range") {
    return "loop";
  }
  if (kind === "switch" || kind === "type-switch" || kind === "select") {
    return "switch";
  }
  if (kind === "case" || kind === "comm") {
    return "case";
  }
  if (kind === "&&" || kind === "||") {
    return "logic";
  }
  return "other";
}

export function contributorSeverity(kind) {
  if (kind === "cyclic-recursion") {
    return "high";
  }
  if (kind === "recursion") {
    return "medium";
  }
  if (kind === "switch") {
    return "high";
  }
  if (kind === "if" || kind === "loop" || kind === "case") {
    return "medium";
  }
  return "low";
}

export function contributorReason(kind) {
  if (kind === "cyclic-recursion") {
    return "this call participates in an indirect recursion cycle (callee path returns to this function)";
  }
  if (kind === "recursion") {
    return "this function calls itself directly";
  }
  if (kind === "switch") {
    return "multi-branch control flow adds high path complexity";
  }
  if (kind === "if") {
    return "branching condition adds decision paths";
  }
  if (kind === "loop") {
    return "iterative control flow adds cognitive and path complexity";
  }
  if (kind === "case") {
    return "additional branch arm increases branching surface";
  }
  if (kind === "logic") {
    return "compound boolean logic adds decision combinations";
  }
  return "control-flow structure contributes to complexity";
}

export function contributorEmojiClass(kind, severity) {
  return `complexity-glyph-${severity}-${kind}`;
}

export function canReachTarget(startID, targetID, visited = new Set()) {
  if (!startID || !targetID) {
    return false;
  }
  if (startID === targetID) {
    return true;
  }
  if (visited.has(startID)) {
    return false;
  }
  visited.add(startID);
  const next = state.callGraphByCaller.get(startID);
  if (!next) {
    return false;
  }
  for (const candidate of next) {
    if (canReachTarget(candidate, targetID, visited)) {
      return true;
    }
  }
  return false;
}

export function buildRecursionContributors(inspectData) {
  const out = [];
  const callsites = state.callsitesByCaller.get(inspectData.id) || [];
  for (const site of callsites) {
    if (!site?.calleeID || !site.line || !site.column) {
      continue;
    }
    if (site.calleeID === inspectData.id) {
      out.push({
        kind: "recursion",
        start_line: site.line,
        start_col: site.column,
        end_line: site.line,
        end_col: site.column + 1,
      });
      continue;
    }
    if (canReachTarget(site.calleeID, inspectData.id)) {
      out.push({
        kind: "cyclic-recursion",
        start_line: site.line,
        start_col: site.column,
        end_line: site.line,
        end_col: site.column + 1,
      });
    }
  }
  return out;
}

export function buildContributorsByLine(inspectData) {
  const byLine = new Map();
  const seen = new Set();
  for (const item of inspectData.contributors || []) {
    const contributorKey = `${item.kind}:${item.start_line}:${item.start_col}:${item.end_line}:${item.end_col}`;
    if (seen.has(contributorKey)) {
      continue;
    }
    seen.add(contributorKey);
    const line = item.start_line - inspectData.start_line + 1;
    if (!byLine.has(line)) {
      byLine.set(line, []);
    }
    byLine.get(line).push(item);
  }
  return byLine;
}

export function contributorHoverMessage(item, normalizedKind, severity, lineText) {
  return (
    `**${severity.toUpperCase()} ${normalizedKind} contributor**\n` +
    `Code span: \`${item.start_line}:${item.start_col}-${item.end_line}:${item.end_col}\`\n` +
    `Why: ${contributorReason(normalizedKind)}\n` +
    `Code: \`${lineText}\``
  );
}

export function baseFunctionName(functionName) {
  const methodSep = functionName.lastIndexOf(").");
  if (methodSep >= 0) {
    return functionName.slice(methodSep + 2);
  }
  return functionName;
}
