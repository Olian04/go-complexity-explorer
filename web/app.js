const DATA_PATH = "./api/complexity";

const modelSelect = document.getElementById("model-select");
const packageFilterOpenEl = document.getElementById("package-filter-open");
const packageFilterLabelEl = document.getElementById("package-filter-label");
const packageFilterBackdropEl = document.getElementById("package-filter-modal-backdrop");
const packageFilterTableEl = document.getElementById("package-filter-table");
const packageFilterCloseEl = document.getElementById("package-filter-close");
const packageFilterSelectAllEl = document.getElementById("package-filter-select-all");
const packageFilterSelectNoneEl = document.getElementById("package-filter-select-none");
const packageFilterCancelEl = document.getElementById("package-filter-cancel");
const packageFilterApplyEl = document.getElementById("package-filter-apply");
const cycloWeightInput = document.getElementById("cyclo-weight");
const cognWeightInput = document.getElementById("cogn-weight");
const weightControls = document.querySelectorAll(".weight-control");
const statusEl = document.getElementById("status");
const chartEl = document.getElementById("chart");
const tooltipEl = document.getElementById("tooltip");
const infoTooltipEl = document.getElementById("info-tooltip");
const inspectBackdropEl = document.getElementById("inspect-modal-backdrop");
const inspectModalEl = document.getElementById("inspect-modal");
const inspectCloseEl = document.getElementById("inspect-close");
const inspectTitleEl = document.getElementById("inspect-title");
const inspectMetaEl = document.getElementById("inspect-meta");
const inspectWarningEl = document.getElementById("inspect-warning");
const inspectBacklinksEl = document.getElementById("inspect-backlinks");
const inspectReferenceFromSectionEl = document.getElementById("inspect-reference-from-section");
const inspectReferenceFromEl = document.getElementById("inspect-reference-from");
const inspectEditorEl = document.getElementById("inspect-editor");
const inspectCyclomaticValueEl = document.getElementById("inspect-score-cyclomatic-value");
const inspectCyclomaticBarEl = document.getElementById("inspect-score-cyclomatic-bar");
const inspectCognitiveValueEl = document.getElementById("inspect-score-cognitive-value");
const inspectCognitiveBarEl = document.getElementById("inspect-score-cognitive-bar");

const THRESHOLDS = {
  cyclomatic: { warn: 10, red: 15 },
  cognitive: { warn: 15, red: 20 },
};

let sourceData = null;
let selectedFunctionID = null;
let monacoReadyPromise = null;
let monacoEditor = null;
let monacoModel = null;
let hoverProviderDisposable = null;
let editorDecorations = [];
let editorFunctionLinks = [];
let functionMetricsByID = new Map();
let callGraphByCaller = new Map();
let callsitesByCaller = new Map();
let selectedPackages = new Set();
let draftSelectedPackages = new Set();
let packageRelationships = new Map();
let packageFunctionCount = new Map();
let functionPackagePathByID = new Map();
let activeInfoIcon = null;
let inspectorScrollByHash = new Map();
let currentInspectStateKey = "";

function showInfoTooltip(iconEl, clientX, clientY) {
  if (!infoTooltipEl || !iconEl) {
    return;
  }
  const text = iconEl.getAttribute("data-tooltip") || "";
  if (!text) {
    return;
  }
  activeInfoIcon = iconEl;
  infoTooltipEl.textContent = text;
  infoTooltipEl.classList.remove("hidden");
  positionInfoTooltip(clientX, clientY);
}

function hideInfoTooltip() {
  if (!infoTooltipEl) {
    return;
  }
  activeInfoIcon = null;
  infoTooltipEl.classList.add("hidden");
}

function positionInfoTooltip(clientX, clientY) {
  if (!infoTooltipEl || infoTooltipEl.classList.contains("hidden")) {
    return;
  }
  const margin = 12;
  const offset = 14;
  const width = infoTooltipEl.offsetWidth;
  const height = infoTooltipEl.offsetHeight;

  let x = clientX + offset;
  let y = clientY + offset;
  if (x + width > window.innerWidth - margin) {
    x = Math.max(margin, clientX - width - offset);
  }
  if (y + height > window.innerHeight - margin) {
    y = Math.max(margin, clientY - height - offset);
  }
  infoTooltipEl.style.left = `${x}px`;
  infoTooltipEl.style.top = `${y}px`;
}

function setupInfoTooltips() {
  for (const iconEl of document.querySelectorAll(".inspect-info-icon")) {
    if (iconEl.dataset.tooltipBound === "1") {
      continue;
    }
    iconEl.dataset.tooltipBound = "1";
    iconEl.addEventListener("mouseenter", (event) => {
      showInfoTooltip(iconEl, event.clientX, event.clientY);
    });
    iconEl.addEventListener("mousemove", (event) => {
      if (activeInfoIcon !== iconEl) {
        return;
      }
      positionInfoTooltip(event.clientX, event.clientY);
    });
    iconEl.addEventListener("mouseleave", () => {
      if (activeInfoIcon === iconEl) {
        hideInfoTooltip();
      }
    });
  }
}

function scoreFunction(fn, model, weights) {
  if (model === "cyclomatic") {
    return fn.cyclomatic;
  }
  if (model === "cognitive") {
    return fn.cognitive;
  }
  if (model === "max") {
    return Math.max(fn.cyclomatic, fn.cognitive);
  }
  return fn.cyclomatic * weights.cyclomatic + fn.cognitive * weights.cognitive;
}

function thresholdForModel(model, weights) {
  if (model === "cyclomatic") {
    return THRESHOLDS.cyclomatic;
  }
  if (model === "cognitive") {
    return THRESHOLDS.cognitive;
  }
  if (model === "max") {
    return {
      warn: Math.max(THRESHOLDS.cyclomatic.warn, THRESHOLDS.cognitive.warn),
      red: Math.max(THRESHOLDS.cyclomatic.red, THRESHOLDS.cognitive.red),
    };
  }
  return {
    warn:
      THRESHOLDS.cyclomatic.warn * weights.cyclomatic +
      THRESHOLDS.cognitive.warn * weights.cognitive,
    red:
      THRESHOLDS.cyclomatic.red * weights.cyclomatic +
      THRESHOLDS.cognitive.red * weights.cognitive,
  };
}

function severityColor(score, threshold) {
  if (score >= threshold.red) {
    return "#dc2626";
  }
  if (score >= threshold.warn) {
    return "#eab308";
  }
  return "#16a34a";
}

function severityClass(score, threshold) {
  if (score >= threshold.red) {
    return "high";
  }
  if (score >= threshold.warn) {
    return "medium";
  }
  return "low";
}

function setScoreBar(barEl, valueEl, score, threshold) {
  if (!barEl || !valueEl) {
    return;
  }
  const safeScore = Math.max(0, Number(score) || 0);
  const denom = threshold.red > 0 ? threshold.red : 1;
  const pct = Math.min(100, (safeScore / denom) * 100);
  barEl.classList.remove("low", "medium", "high");
  barEl.classList.add(severityClass(safeScore, threshold));
  barEl.style.width = `${pct}%`;
  valueEl.textContent = `${safeScore} (warn ${threshold.warn}, high ${threshold.red})`;
}

function renderInspectorScores(functionID) {
  const metrics = functionMetricsByID.get(functionID);
  if (!metrics) {
    setScoreBar(inspectCyclomaticBarEl, inspectCyclomaticValueEl, 0, THRESHOLDS.cyclomatic);
    setScoreBar(inspectCognitiveBarEl, inspectCognitiveValueEl, 0, THRESHOLDS.cognitive);
    return;
  }
  setScoreBar(
    inspectCyclomaticBarEl,
    inspectCyclomaticValueEl,
    metrics.cyclomatic,
    THRESHOLDS.cyclomatic,
  );
  setScoreBar(
    inspectCognitiveBarEl,
    inspectCognitiveValueEl,
    metrics.cognitive,
    THRESHOLDS.cognitive,
  );
}

function isMainEntrypoint(packageName, functionName) {
  return packageName === "main" && baseFunctionName(functionName) === "main";
}

function looksLikeExternalLibraryCallback(functionName) {
  if (!functionName || !functionName.includes(").")) {
    return false;
  }
  const method = baseFunctionName(functionName);
  if (!method) {
    return false;
  }
  if (!/^[A-Z]/.test(method)) {
    return false;
  }
  return /^On[A-Z]/.test(method) || /^Handle[A-Z]/.test(method) || /^Hook[A-Z]/.test(method);
}

function packagePathFromFile(filePath, fallbackPackage) {
  if (typeof filePath === "string" && filePath && filePath !== "(unknown)") {
    const normalized = filePath.replaceAll("\\", "/");
    const idx = normalized.lastIndexOf("/");
    if (idx > 0) {
      return normalized.slice(0, idx);
    }
  }
  return fallbackPackage || "(unknown)";
}

function buildHierarchy(functions, model, weights) {
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

function sortedPackageNames(functions) {
  if (packageFunctionCount.size > 0) {
    return [...packageFunctionCount.keys()].sort((a, b) => a.localeCompare(b));
  }
  return [...new Set((functions || []).map((fn) => packagePathFromFile(fn.file, fn.package)))].sort(
    (a, b) => a.localeCompare(b),
  );
}


function buildPackageRelationships() {
  const packageNames = sortedPackageNames(sourceData?.functions || []);
  packageRelationships = new Map(packageNames.map((pkg) => [pkg, new Map()]));
  for (const callee of Object.values(sourceData?.inspect_index || {})) {
    const calleePkg = functionPackagePathByID.get(callee.id) || packagePathFromFile(callee.file, callee.package);
    for (const backlink of callee.backlinks || []) {
      const callerPkg =
        functionPackagePathByID.get(backlink.caller_id) ||
        packagePathFromFile(backlink.caller_file, backlink.caller_package);
      if (!packageRelationships.has(callerPkg)) {
        packageRelationships.set(callerPkg, new Map());
      }
      if (!packageRelationships.has(calleePkg)) {
        packageRelationships.set(calleePkg, new Map());
      }
      if (callerPkg === calleePkg) {
        continue;
      }
      const callerEdges = packageRelationships.get(callerPkg);
      callerEdges.set(calleePkg, (callerEdges.get(calleePkg) || 0) + 1);
      const calleeEdges = packageRelationships.get(calleePkg);
      calleeEdges.set(callerPkg, (calleeEdges.get(callerPkg) || 0) + 1);
    }
  }
}

function packageRelationshipGroups() {
  const visited = new Set();
  const all = [...packageRelationships.keys()].sort((a, b) => a.localeCompare(b));
  const groups = [];
  for (const pkg of all) {
    if (visited.has(pkg)) {
      continue;
    }
    const queue = [pkg];
    const component = [];
    visited.add(pkg);
    while (queue.length > 0) {
      const current = queue.shift();
      component.push(current);
      for (const neighbor of packageRelationships.get(current)?.keys() || []) {
        if (visited.has(neighbor)) {
          continue;
        }
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    component.sort((a, b) => a.localeCompare(b));
    groups.push(component);
  }
  groups.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  return groups;
}

function updatePackageFilterSummary() {
  if (!packageFilterLabelEl) {
    return;
  }
  const total = sortedPackageNames(sourceData?.functions || []).length;
  packageFilterLabelEl.textContent = `Showing ${selectedPackages.size} of ${total} packages`;
}

function packageGroupOrderMap() {
  const groups = packageRelationshipGroups();
  const order = new Map();
  groups.forEach((pkgs, groupIdx) => {
    pkgs.forEach((pkg) => {
      order.set(pkg, groupIdx);
    });
  });
  return order;
}

function renderPackageFilterModal() {
  if (!packageFilterTableEl) {
    return;
  }
  packageFilterTableEl.innerHTML = "";
  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Selected</th>
        <th>Package path</th>
        <th>Functions</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");
  const groupOrder = packageGroupOrderMap();
  const packages = sortedPackageNames(sourceData?.functions || []).sort((a, b) => {
    const groupCmp = (groupOrder.get(a) || 0) - (groupOrder.get(b) || 0);
    if (groupCmp !== 0) {
      return groupCmp;
    }
    return a.localeCompare(b);
  });
  for (const pkg of packages) {
    const tr = document.createElement("tr");
    tr.className = "package-filter-row";
    const selectCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = draftSelectedPackages.has(pkg);
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        draftSelectedPackages.add(pkg);
      } else {
        draftSelectedPackages.delete(pkg);
      }
    });
    selectCell.appendChild(checkbox);
    const pathCell = document.createElement("td");
    pathCell.textContent = pkg;
    const countCell = document.createElement("td");
    countCell.className = "package-filter-count";
    countCell.textContent = String(packageFunctionCount.get(pkg) || 0);
    tr.appendChild(selectCell);
    tr.appendChild(pathCell);
    tr.appendChild(countCell);
    tr.addEventListener("click", () => {
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change"));
    });
    tbody.appendChild(tr);
  }
  packageFilterTableEl.appendChild(table);
}

function openPackageFilterModal() {
  if (!packageFilterBackdropEl) {
    return;
  }
  const allPackages = sortedPackageNames(sourceData?.functions || []);
  draftSelectedPackages = new Set(selectedPackages.size > 0 ? selectedPackages : allPackages);
  renderPackageFilterModal();
  packageFilterBackdropEl.classList.remove("hidden");
}

function closePackageFilterModal() {
  if (!packageFilterBackdropEl) {
    return;
  }
  packageFilterBackdropEl.classList.add("hidden");
}

function applyPackageFilterSelection() {
  selectedPackages = new Set(draftSelectedPackages);
  updatePackageFilterSummary();
  closePackageFilterModal();
  render();
}

function formatScore(score) {
  if (Number.isInteger(score)) {
    return String(score);
  }
  return score.toFixed(2);
}

function parseInspectStateFromHash() {
  const raw = window.location.hash || "";
  if (!raw.startsWith("#")) {
    return null;
  }
  const params = new URLSearchParams(raw.slice(1));
  const inspectID = params.get("inspect");
  if (!inspectID) {
    return null;
  }
  const fromCallerID = params.get("fromCallerID");
  const fromLine = Number(params.get("fromLine") || 0);
  const fromColumn = Number(params.get("fromColumn") || 0);
  return {
    inspectID,
    from: fromCallerID
      ? {
          callerID: fromCallerID,
          line: fromLine > 0 ? fromLine : null,
          column: fromColumn > 0 ? fromColumn : null,
        }
      : null,
  };
}

function buildInspectHashKey(functionID, from = null) {
  const params = new URLSearchParams();
  params.set("inspect", functionID);
  if (from?.callerID) {
    params.set("fromCallerID", from.callerID);
  }
  if (from?.line) {
    params.set("fromLine", String(from.line));
  }
  if (from?.column) {
    params.set("fromColumn", String(from.column));
  }
  return `#${params.toString()}`;
}

function pushInspectHash(functionID, from = null) {
  const nextHash = buildInspectHashKey(functionID, from);
  if (window.location.hash === nextHash) {
    return;
  }
  window.location.hash = nextHash;
}

function clearInspectHash() {
  if (window.location.hash === "") {
    return;
  }
  window.location.hash = "";
}

function inspectHashKey() {
  if (currentInspectStateKey) {
    return currentInspectStateKey;
  }
  const parsed = parseInspectStateFromHash();
  if (parsed?.inspectID) {
    return window.location.hash;
  }
  if (selectedFunctionID) {
    return `#inspect=${encodeURIComponent(selectedFunctionID)}`;
  }
  return "";
}

function saveInspectorScrollState(key = inspectHashKey()) {
  if (!key) {
    return;
  }
  inspectorScrollByHash.set(key, {
    modalScrollTop: inspectModalEl.scrollTop,
    editorScrollTop: monacoEditor ? monacoEditor.getScrollTop() : 0,
  });
}

function restoreInspectorScrollState(key = inspectHashKey()) {
  const state = inspectorScrollByHash.get(key);
  if (!state) {
    inspectModalEl.scrollTop = 0;
    if (monacoEditor) {
      monacoEditor.setScrollTop(0);
    }
    return;
  }
  inspectModalEl.scrollTop = state.modalScrollTop || 0;
  if (monacoEditor) {
    monacoEditor.setScrollTop(state.editorScrollTop || 0);
  }
}

function isPositionWithinContributor(position, item) {
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

function disposeMonacoProviders() {
  if (hoverProviderDisposable) {
    hoverProviderDisposable.dispose();
    hoverProviderDisposable = null;
  }
}

function normalizeContributorKind(kind) {
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

function contributorSeverity(kind) {
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

function contributorReason(kind) {
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

function contributorEmojiClass(kind, severity) {
  return `complexity-glyph-${severity}-${kind}`;
}

function canReachTarget(startID, targetID, visited = new Set()) {
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
  const next = callGraphByCaller.get(startID);
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

function buildRecursionContributors(inspectData) {
  const out = [];
  const callsites = callsitesByCaller.get(inspectData.id) || [];
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

function buildContributorsByLine(inspectData) {
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

function contributorHoverMessage(item, normalizedKind, severity, lineText) {
  return (
    `**${severity.toUpperCase()} ${normalizedKind} contributor**\n` +
    `Code span: \`${item.start_line}:${item.start_col}-${item.end_line}:${item.end_col}\`\n` +
    `Why: ${contributorReason(normalizedKind)}\n` +
    `Code: \`${lineText}\``
  );
}

function baseFunctionName(functionName) {
  const methodSep = functionName.lastIndexOf(").");
  if (methodSep >= 0) {
    return functionName.slice(methodSep + 2);
  }
  return functionName;
}

function buildEditorFunctionLinks(monaco, inspectData) {
  return (inspectData.source_links || [])
    .map((link) => {
      const lineNumber = link.line - inspectData.start_line + 1;
      if (lineNumber < 1) {
        return null;
      }
      const startColumn = Math.max(1, link.range_start_col || link.column || 1);
      const endColumn = Math.max(startColumn + 1, link.range_end_col || startColumn + 1);
      return {
        targetID: link.target_id,
        sourceCallerID: inspectData.id,
        sourceLine: link.line,
        sourceColumn: link.column,
        requiresModifier: !!link.requires_modifier,
        range: new monaco.Range(lineNumber, startColumn, lineNumber, endColumn),
      };
    })
    .filter(Boolean);
}

function linkAtPosition(position) {
  if (!position) {
    return null;
  }
  for (const link of editorFunctionLinks) {
    if (position.lineNumber !== link.range.startLineNumber) {
      continue;
    }
    if (position.column >= link.range.startColumn && position.column <= link.range.endColumn) {
      return link;
    }
  }
  return null;
}

function isDefinitionModifierPressed(mouseEvent) {
  if (!mouseEvent) {
    return false;
  }
  const isMac = /\bMac\b/i.test(navigator.platform || "");
  return isMac ? !!mouseEvent.metaKey : !!mouseEvent.ctrlKey;
}

function isDefinitionModifierKey(event) {
  const isMac = /\bMac\b/i.test(navigator.platform || "");
  return isMac ? event.key === "Meta" : event.key === "Control";
}

function setModifierNavigationStyleEnabled(enabled) {
  if (!inspectEditorEl) {
    return;
  }
  inspectEditorEl.classList.toggle("modifier-nav-enabled", enabled);
}

function glyphMarginOption(position) {
  if (!position) {
    return undefined;
  }
  return { position };
}

function buildGlyphMarginDecorations(monaco, inspectData) {
  const byLine = buildContributorsByLine(inspectData);
  const sourceLines = inspectData.source.split("\n");
  const laneEnum = monaco.editor.GlyphMarginLane || {};
  const lanes = [
    laneEnum.Left,
    laneEnum.Center,
    laneEnum.Right,
  ];
  const decorations = [];
  for (const [line, items] of byLine.entries()) {
    const normalizedItems = items.map((item) => {
      const kind = normalizeContributorKind(item.kind);
      const severity = contributorSeverity(kind);
      return { item, kind, severity };
    });
    normalizedItems.sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 };
      return rank[a.severity] - rank[b.severity];
    });

    const lineText = (sourceLines[line - 1] || "").trim().slice(0, 120);
    const hasOverflow = normalizedItems.length > lanes.length;
    const displayCount = hasOverflow ? lanes.length - 1 : lanes.length;
    const displayItems = normalizedItems.slice(0, displayCount);
    for (let i = 0; i < displayItems.length; i += 1) {
      const entry = displayItems[i];
      decorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          glyphMargin: glyphMarginOption(lanes[i]),
          glyphMarginClassName: `complexity-glyph ${contributorEmojiClass(entry.kind, entry.severity)}`,
          glyphMarginHoverMessage: {
            value: contributorHoverMessage(entry.item, entry.kind, entry.severity, lineText),
          },
        },
      });
    }

    if (hasOverflow) {
      const remaining = normalizedItems.slice(displayCount).map((entry) => entry.item.kind).join(", ");
      decorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          glyphMargin: glyphMarginOption(lanes[lanes.length - 1]),
          glyphMarginClassName: "complexity-glyph complexity-glyph-overflow",
          glyphMarginHoverMessage: {
            value: `Additional contributors on this line: ${remaining}`,
          },
        },
      });
    }
  }
  return decorations;
}

function ensureMonaco() {
  if (window.monaco?.editor) {
    return Promise.resolve(window.monaco);
  }
  if (monacoReadyPromise) {
    return monacoReadyPromise;
  }
  monacoReadyPromise = new Promise((resolve, reject) => {
    if (typeof window.require !== "function") {
      reject(new Error("monaco loader not available"));
      return;
    }
    window.require.config({
      paths: {
        vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs",
      },
    });
    window.require(["vs/editor/editor.main"], () => {
      resolve(window.monaco);
    }, reject);
  });
  return monacoReadyPromise;
}

async function renderInspectorSource(inspectData) {
  const monaco = await ensureMonaco();
  if (!monacoEditor) {
    monacoEditor = monaco.editor.create(inspectEditorEl, {
      language: "go",
      readOnly: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      glyphMargin: true,
      hover: { enabled: true },
      theme: "vs-dark",
    });
    monacoEditor.onMouseDown((event) => {
      if (!event.target?.position) {
        return;
      }
      const link = linkAtPosition(event.target.position);
      if (!link) {
        return;
      }
      if (link.requiresModifier && !isDefinitionModifierPressed(event.event)) {
        return;
      }
      event.event.preventDefault();
      event.event.stopPropagation();
      void openInspector(link.targetID, {
        pushHistory: true,
        from: {
          callerID: link.sourceCallerID,
          line: link.sourceLine,
          column: link.sourceColumn,
        },
      });
    });
    monacoEditor.onMouseMove((event) => {
      const domNode = monacoEditor.getDomNode();
      if (!domNode) {
        return;
      }
      if (event.target?.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        domNode.style.cursor = "default";
        return;
      }
      const link = linkAtPosition(event.target?.position);
      domNode.style.cursor = link && (!link.requiresModifier || isDefinitionModifierPressed(event.event))
        ? "pointer"
        : "text";
    });
    monacoEditor.onMouseLeave(() => {
      const domNode = monacoEditor.getDomNode();
      if (!domNode) {
        return;
      }
      domNode.style.cursor = "text";
    });
    monacoEditor.onDidScrollChange(() => {
      saveInspectorScrollState();
    });
  }

  if (monacoModel) {
    monacoModel.dispose();
    monacoModel = null;
  }

  const uri = monaco.Uri.parse(`inmemory://inspect/${encodeURIComponent(inspectData.id)}.go`);
  monacoModel = monaco.editor.createModel(inspectData.source, "go", uri);
  monacoEditor.setModel(monacoModel);
  monacoEditor.updateOptions({
    lineNumbers(lineNumber) {
      return String(inspectData.start_line + lineNumber - 1);
    },
  });
  monacoEditor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });

  const contributors = [
    ...(inspectData.contributors || []),
    ...buildRecursionContributors(inspectData),
  ];

  disposeMonacoProviders();
  hoverProviderDisposable = monaco.languages.registerHoverProvider("go", {
    provideHover(model, position) {
      if (model.uri.toString() !== monacoModel.uri.toString()) {
        return null;
      }
      const matches = contributors.filter((item) =>
        isPositionWithinContributor(position, {
          start_line: item.start_line - inspectData.start_line + 1,
          start_col: item.start_col,
          end_line: item.end_line - inspectData.start_line + 1,
          end_col: item.end_col,
        }),
      );
      if (matches.length === 0) {
        return null;
      }
      const text = matches
        .map((item) => `- \`${item.kind}\` at ${item.start_line}:${item.start_col}-${item.end_line}:${item.end_col}`)
        .join("\n");
      return {
        contents: [{ value: `**Complexity contributors**\n${text}` }],
      };
    },
  });
  editorFunctionLinks = buildEditorFunctionLinks(monaco, inspectData);

  const linkDecorations = editorFunctionLinks.map((link) => ({
    range: link.range,
    options: {
      inlineClassName: link.requiresModifier
        ? "inspect-function-link-modifier"
        : "inspect-function-link",
      hoverMessage: {
        value: link.requiresModifier
          ? "Go to function (Cmd+Click on macOS / Ctrl+Click on Windows/Linux)"
          : "Go to function",
      },
    },
  }));

  const decorations = [
    ...buildGlyphMarginDecorations(monaco, inspectData),
    ...linkDecorations,
  ];
  editorDecorations = monacoEditor.deltaDecorations(editorDecorations, decorations);
}

async function openInspector(functionID, options = {}) {
  const inspectData = sourceData?.inspect_index?.[functionID];
  if (!inspectData) {
    return;
  }
  saveInspectorScrollState(currentInspectStateKey);
  const pushHistory = options.pushHistory !== false;
  const from = options.from || null;
  const nextStateKey = buildInspectHashKey(functionID, from);

  selectedFunctionID = functionID;
  inspectBackdropEl.classList.remove("hidden");
  if (pushHistory) {
    pushInspectHash(functionID, from);
  }
  currentInspectStateKey = nextStateKey;

  inspectTitleEl.textContent = inspectData.function;
  inspectMetaEl.textContent = `${inspectData.package} | ${inspectData.file} | lines ${inspectData.start_line}-${inspectData.end_line}`;
  const hasNoInboundCallsites = (inspectData.backlinks || []).length === 0;
  const hasFunctionValueReference = (inspectData.reference_backlinks || []).length > 0;
  const isExternalCallbackCandidate =
    hasNoInboundCallsites &&
    (hasFunctionValueReference || looksLikeExternalLibraryCallback(inspectData.function));
  if (hasNoInboundCallsites && !isMainEntrypoint(inspectData.package, inspectData.function)) {
    inspectWarningEl.textContent = isExternalCallbackCandidate
      ? "Note: No inbound callsites were found in analyzed code. This function appears to be passed by reference and may be invoked by dependency code (library callback/hook style)."
      : "Warning: No inbound callsites were found for this function in analyzed code.";
    inspectWarningEl.classList.remove("hidden");
  } else {
    inspectWarningEl.textContent = "";
    inspectWarningEl.classList.add("hidden");
  }
  renderInspectorScores(functionID);

  inspectReferenceFromEl.innerHTML = "";
  inspectReferenceFromSectionEl.hidden = false;
  const referencesByCaller = new Map();
  for (const link of inspectData.reference_backlinks || []) {
    const key = link.caller_id;
    if (!referencesByCaller.has(key)) {
      referencesByCaller.set(key, {
        caller_id: link.caller_id,
        caller_function: link.caller_function,
        caller_file: link.caller_file,
        line: link.line,
        column: link.column,
        count: 0,
        refs: [],
      });
    }
    const entry = referencesByCaller.get(key);
    entry.count += 1;
    entry.refs.push({ line: link.line, column: link.column });
    if (link.line < entry.line || (link.line === entry.line && link.column < entry.column)) {
      entry.line = link.line;
      entry.column = link.column;
    }
  }
  const referenceRows = [...referencesByCaller.values()].sort((a, b) => {
    if (a.caller_file !== b.caller_file) {
      return a.caller_file.localeCompare(b.caller_file);
    }
    if (a.caller_function !== b.caller_function) {
      return a.caller_function.localeCompare(b.caller_function);
    }
    return a.line - b.line;
  });
  if (referenceRows.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No inbound non-call function references found in analyzed code.";
    inspectReferenceFromEl.appendChild(li);
  } else {
    for (const ref of referenceRows) {
      const li = document.createElement("li");
      const isFromCaller = from?.callerID && from.callerID === ref.caller_id;
      const hasExactRef =
        isFromCaller &&
        from?.line &&
        from?.column &&
        ref.refs.some((site) => site.line === from.line && site.column === from.column);
      if (isFromCaller) {
        li.classList.add("inspect-list-active");
      }
      const button = document.createElement("button");
      button.className = "inspect-link";
      const refCountSuffix = ref.count > 1 ? ` x${ref.count}` : "";
      const fromSuffix = hasExactRef
        ? ` ← from ${from.line}:${from.column}`
        : isFromCaller
          ? " ← from previous"
          : "";
      button.textContent =
        `${ref.caller_function}${refCountSuffix} ` +
        `(${ref.caller_file}:${ref.line}:${ref.column})` +
        fromSuffix;
      button.addEventListener("click", () => {
        if (isFromCaller && window.history.length > 1) {
          window.history.back();
          return;
        }
        void openInspector(ref.caller_id, {
          pushHistory: true,
          from: {
            callerID: inspectData.id,
            line: ref.line,
            column: ref.column,
          },
        });
      });
      li.appendChild(button);
      inspectReferenceFromEl.appendChild(li);
    }
  }

  inspectBacklinksEl.innerHTML = "";
  const backlinksByCaller = new Map();
  for (const link of inspectData.backlinks || []) {
    const key = link.caller_id;
    if (!backlinksByCaller.has(key)) {
      backlinksByCaller.set(key, {
        caller_id: link.caller_id,
        caller_function: link.caller_function,
        caller_file: link.caller_file,
        line: link.line,
        column: link.column,
        count: 0,
        callsites: [],
      });
    }
    const entry = backlinksByCaller.get(key);
    entry.count += 1;
    entry.callsites.push({ line: link.line, column: link.column });
    if (link.line < entry.line || (link.line === entry.line && link.column < entry.column)) {
      entry.line = link.line;
      entry.column = link.column;
    }
  }

  const backlinks = [...backlinksByCaller.values()].sort((a, b) => {
    const aFromCaller = from?.callerID && from.callerID === a.caller_id;
    const bFromCaller = from?.callerID && from.callerID === b.caller_id;
    if (aFromCaller !== bFromCaller) {
      return aFromCaller ? -1 : 1;
    }
    if (a.caller_file !== b.caller_file) {
      return a.caller_file.localeCompare(b.caller_file);
    }
    if (a.caller_function !== b.caller_function) {
      return a.caller_function.localeCompare(b.caller_function);
    }
    return a.line - b.line;
  });

  if (backlinks.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No inbound callsites found in analyzed code.";
    inspectBacklinksEl.appendChild(li);
  } else {
    for (const link of backlinks) {
      const li = document.createElement("li");
      const isFromCaller = from?.callerID && from.callerID === link.caller_id;
      const hasExactCallsite =
        isFromCaller &&
        from?.line &&
        from?.column &&
        link.callsites.some((site) => site.line === from.line && site.column === from.column);
      if (isFromCaller) {
        li.classList.add("inspect-list-active");
      }
      const button = document.createElement("button");
      button.className = "inspect-link";
      const callCountSuffix = link.count > 1 ? ` x${link.count}` : "";
      const fromSuffix = hasExactCallsite
        ? ` ← from ${from.line}:${from.column}`
        : isFromCaller
          ? " ← from previous"
          : "";
      button.textContent =
        `${link.caller_function}${callCountSuffix} ` +
        `(${link.caller_file}:${link.line}:${link.column})` +
        fromSuffix;
      button.addEventListener("click", () => {
        if (isFromCaller) {
          if (window.history.length > 1) {
            window.history.back();
            return;
          }
          void openInspector(link.caller_id, {
            pushHistory: true,
            from: {
              callerID: inspectData.id,
              line: link.line,
              column: link.column,
            },
          });
          return;
        }
        void openInspector(link.caller_id, {
          pushHistory: true,
          from: {
            callerID: inspectData.id,
            line: link.line,
            column: link.column,
          },
        });
      });
      li.appendChild(button);
      inspectBacklinksEl.appendChild(li);
    }
  }

  await renderInspectorSource(inspectData);
  restoreInspectorScrollState(currentInspectStateKey);
}

function closeInspector(options = {}) {
  const pushHistory = options.pushHistory !== false;
  saveInspectorScrollState(currentInspectStateKey);
  selectedFunctionID = null;
  currentInspectStateKey = "";
  inspectBackdropEl.classList.add("hidden");
  if (pushHistory) {
    clearInspectHash();
  }
}

function syncInspectorFromHash() {
  const state = parseInspectStateFromHash();
  if (!state?.inspectID) {
    closeInspector({ pushHistory: false });
    return;
  }
  if (!sourceData?.inspect_index?.[state.inspectID]) {
    closeInspector({ pushHistory: false });
    return;
  }
  void openInspector(state.inspectID, { pushHistory: false, from: state.from });
}

function render() {
  if (!sourceData) {
    return;
  }

  const model = modelSelect.value;
  const weights = {
    cyclomatic: Number(cycloWeightInput.value) || 0,
    cognitive: Number(cognWeightInput.value) || 0,
  };
  const threshold = thresholdForModel(model, weights);
  const allPackages = sortedPackageNames(sourceData.functions);
  if (selectedPackages.size === 0 && allPackages.length > 0) {
    selectedPackages = new Set(allPackages);
    updatePackageFilterSummary();
  }
  const visibleFunctions = sourceData.functions.filter((fn) =>
    selectedPackages.has(packagePathFromFile(fn.file, fn.package)),
  );
  const hierarchyData = buildHierarchy(visibleFunctions, model, weights);

  const width = chartEl.clientWidth;
  const height = chartEl.clientHeight;

  chartEl.innerHTML = "";

  const root = d3
    .hierarchy(hierarchyData)
    .sum((d) => d.value || 0)
    .sort((a, b) => b.value - a.value);

  d3.treemap().size([width, height]).paddingInner(1).paddingOuter(2)(root);

  const svg = d3
    .select(chartEl)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("width", width)
    .attr("height", height);

  const leaves = svg
    .selectAll("g.leaf")
    .data(root.leaves())
    .enter()
    .append("g")
    .attr("class", "leaf")
    .attr("transform", (d) => `translate(${d.x0},${d.y0})`);

  const leafRects = leaves
    .append("rect")
    .attr("class", "node")
    .attr("width", (d) => Math.max(d.x1 - d.x0, 0))
    .attr("height", (d) => Math.max(d.y1 - d.y0, 0))
    .attr("fill", (d) => severityColor(d.data.score, threshold))
    .on("click", (_, d) => {
      if (d.data.id) {
        void openInspector(d.data.id, { pushHistory: true });
      }
    })
    .on("mousemove", (event, d) => {
      tooltipEl.style.display = "block";
      tooltipEl.style.left = `${event.clientX + 14}px`;
      tooltipEl.style.top = `${event.clientY + 14}px`;
      const warningLine =
        d.data.markerType === "unused"
          ? "\nwarning: triangle marker indicates no callsites found for this function"
          : d.data.markerType === "external-callback"
            ? "\nnote: hook marker indicates possible library-driven callback entrypoint"
            : "";
      tooltipEl.textContent =
        `package: ${d.data.package}\n` +
        `file: ${d.data.file}\n` +
        `function: ${d.data.name}\n` +
        `cyclomatic: ${d.data.cyclomatic}\n` +
        `cognitive: ${d.data.cognitive}\n` +
        `selected score: ${formatScore(d.data.score)}` +
        warningLine;
    })
    .on("mouseleave", () => {
      tooltipEl.style.display = "none";
    });
  leafRects.attr("pointer-events", "all");

  const labels = leaves
    .append("foreignObject")
    .attr("class", "node-label-box")
    .attr("x", 4)
    .attr("y", 4)
    .attr("width", (d) => {
      const w = d.x1 - d.x0 - 8;
      return w > 0 ? w : 0;
    })
    .attr("height", (d) => {
      const h = d.y1 - d.y0 - 8;
      return h > 0 ? h : 0;
    });

  labels
    .append("xhtml:div")
    .attr("class", "node-label")
    .text((d) => {
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      if (w < 70 || h < 26) {
        return "";
      }
      return d.data.name;
    });

  const unusedMarkers = leaves
    .filter((d) => d.data.markerType)
    .append("g")
    .attr("class", "treemap-marker")
    .attr("transform", (d) => {
      const w = Math.max(d.x1 - d.x0, 0);
      const x = Math.max(w - 16, 2);
      return `translate(${x},2)`;
    });

  unusedMarkers
    .append("path")
    .attr("d", "M0,12 L6,0 L12,12 Z")
    .attr("class", (d) => (d.data.markerType === "unused" ? "unused-marker-triangle" : "marker-hidden"));

  unusedMarkers
    .append("text")
    .attr("x", 6)
    .attr("y", 10)
    .attr("text-anchor", "middle")
    .attr("class", (d) =>
      d.data.markerType === "unused" ? "unused-marker-text" : "external-callback-marker-text",
    )
    .text((d) => (d.data.markerType === "unused" ? "!" : "\uf0c1"));

  statusEl.textContent =
    `Mode: ${model}. Packages: ${selectedPackages.size}/${allPackages.length}. ` +
    `Functions shown: ${visibleFunctions.length}/${sourceData.functions.length}. ` +
    `Warn >= ${formatScore(threshold.warn)}, high >= ${formatScore(threshold.red)}.`;

  for (const item of weightControls) {
    item.classList.toggle("disabled", model !== "weighted");
  }
}

async function init() {
  try {
    const response = await fetch(DATA_PATH);
    if (!response.ok) {
      throw new Error(`failed to load ${DATA_PATH}: ${response.status}`);
    }
    sourceData = await response.json();
    packageFunctionCount = new Map();
    functionPackagePathByID = new Map();
    for (const fn of sourceData.functions || []) {
      const packagePath = packagePathFromFile(fn.file, fn.package);
      functionPackagePathByID.set(fn.id, packagePath);
      packageFunctionCount.set(packagePath, (packageFunctionCount.get(packagePath) || 0) + 1);
    }
    selectedPackages = new Set(sortedPackageNames(sourceData.functions || []));
    buildPackageRelationships();
    updatePackageFilterSummary();
    functionMetricsByID = new Map(
      (sourceData.functions || []).map((fn) => [
        fn.id,
        {
          cyclomatic: Number(fn.cyclomatic) || 0,
          cognitive: Number(fn.cognitive) || 0,
        },
      ]),
    );
    callGraphByCaller = new Map();
    callsitesByCaller = new Map();
    for (const callee of Object.values(sourceData.inspect_index || {})) {
      for (const backlink of callee.backlinks || []) {
        if (!callGraphByCaller.has(backlink.caller_id)) {
          callGraphByCaller.set(backlink.caller_id, new Set());
        }
        callGraphByCaller.get(backlink.caller_id).add(callee.id);
        if (!callsitesByCaller.has(backlink.caller_id)) {
          callsitesByCaller.set(backlink.caller_id, []);
        }
        callsitesByCaller.get(backlink.caller_id).push({
          calleeID: callee.id,
          line: backlink.line,
          column: backlink.column,
        });
      }
    }
    render();
    syncInspectorFromHash();
  } catch (err) {
    statusEl.textContent = `Unable to load data: ${String(err)}`;
  }
}

modelSelect.addEventListener("change", render);
packageFilterOpenEl.addEventListener("click", openPackageFilterModal);
packageFilterCloseEl.addEventListener("click", closePackageFilterModal);
packageFilterCancelEl.addEventListener("click", closePackageFilterModal);
packageFilterApplyEl.addEventListener("click", applyPackageFilterSelection);
packageFilterSelectAllEl.addEventListener("click", () => {
  draftSelectedPackages = new Set(sortedPackageNames(sourceData?.functions || []));
  renderPackageFilterModal();
});
packageFilterSelectNoneEl.addEventListener("click", () => {
  draftSelectedPackages = new Set();
  renderPackageFilterModal();
});
cycloWeightInput.addEventListener("input", render);
cognWeightInput.addEventListener("input", render);
window.addEventListener("resize", render);
window.addEventListener("hashchange", syncInspectorFromHash);
window.addEventListener("popstate", syncInspectorFromHash);
window.addEventListener("keydown", (event) => {
  if (isDefinitionModifierKey(event)) {
    setModifierNavigationStyleEnabled(true);
  }
});
window.addEventListener("keyup", (event) => {
  if (isDefinitionModifierKey(event)) {
    setModifierNavigationStyleEnabled(false);
  }
});
window.addEventListener("blur", () => {
  setModifierNavigationStyleEnabled(false);
  hideInfoTooltip();
});
window.addEventListener("pageshow", () => {
  if (!sourceData) {
    void init();
    return;
  }
  syncInspectorFromHash();
});
inspectCloseEl.addEventListener("click", () => closeInspector({ pushHistory: true }));
inspectModalEl.addEventListener("scroll", () => {
  saveInspectorScrollState(currentInspectStateKey);
});
inspectBackdropEl.addEventListener("click", (event) => {
  if (event.target === inspectBackdropEl) {
    closeInspector({ pushHistory: true });
  }
});
packageFilterBackdropEl.addEventListener("click", (event) => {
  if (event.target === packageFilterBackdropEl) {
    closePackageFilterModal();
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !packageFilterBackdropEl.classList.contains("hidden")) {
    closePackageFilterModal();
  }
});

setupInfoTooltips();
init();
