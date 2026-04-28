// Shared module-wide values: API path, DOM element handles, threshold
// defaults, and the mutable state caches that the rest of the modules read
// from and write to.
//
// ES module imports are read-only bindings on the importer's side, so any
// value that needs to be reassigned from another module is bundled into the
// `state` object below. Other modules can mutate `state.foo = ...` because
// the binding to `state` is read-only, but the OBJECT it points to is not.

export const DATA_PATH = "./api/complexity";

export const modelSelect = document.getElementById("model-select");
export const packageFilterOpenEl = document.getElementById("package-filter-open");
export const packageFilterLabelEl = document.getElementById("package-filter-label");
export const packageFilterBackdropEl = document.getElementById("package-filter-modal-backdrop");
export const packageFilterTableEl = document.getElementById("package-filter-table");
export const packageFilterCloseEl = document.getElementById("package-filter-close");
export const packageFilterSelectAllEl = document.getElementById("package-filter-select-all");
export const packageFilterSelectNoneEl = document.getElementById("package-filter-select-none");
export const packageFilterCancelEl = document.getElementById("package-filter-cancel");
export const packageFilterApplyEl = document.getElementById("package-filter-apply");
export const cycloWeightInput = document.getElementById("cyclo-weight");
export const cognWeightInput = document.getElementById("cogn-weight");
export const warnThresholdInput = document.getElementById("warn-threshold");
export const highThresholdInput = document.getElementById("high-threshold");
export const weightControls = document.querySelectorAll(".weight-control");
export const statusEl = document.getElementById("status");
export const chartEl = document.getElementById("chart");
export const tooltipEl = document.getElementById("tooltip");
export const infoTooltipEl = document.getElementById("info-tooltip");
export const inspectBackdropEl = document.getElementById("inspect-modal-backdrop");
export const inspectModalEl = document.getElementById("inspect-modal");
export const inspectCloseEl = document.getElementById("inspect-close");
export const inspectTitleEl = document.getElementById("inspect-title");
export const inspectMetaEl = document.getElementById("inspect-meta");
export const inspectWarningEl = document.getElementById("inspect-warning");
export const inspectBacklinksEl = document.getElementById("inspect-backlinks");
export const inspectReferenceFromSectionEl = document.getElementById("inspect-reference-from-section");
export const inspectReferenceFromEl = document.getElementById("inspect-reference-from");
export const inspectEditorEl = document.getElementById("inspect-editor");
export const inspectCyclomaticValueEl = document.getElementById("inspect-score-cyclomatic-value");
export const inspectCyclomaticBarEl = document.getElementById("inspect-score-cyclomatic-bar");
export const inspectCognitiveValueEl = document.getElementById("inspect-score-cognitive-value");
export const inspectCognitiveBarEl = document.getElementById("inspect-score-cognitive-bar");

export const DEFAULT_THRESHOLD = { warn: 10, red: 15 };

export const state = {
  sourceData: null,
  selectedFunctionID: null,
  monacoReadyPromise: null,
  monacoEditor: null,
  monacoModel: null,
  hoverProviderDisposable: null,
  editorDecorations: [],
  editorFunctionLinks: [],
  functionMetricsByID: new Map(),
  callGraphByCaller: new Map(),
  callsitesByCaller: new Map(),
  selectedPackages: new Set(),
  draftSelectedPackages: new Set(),
  packageRelationships: new Map(),
  packageFunctionCount: new Map(),
  functionPackagePathByID: new Map(),
  activeInfoIcon: null,
  inspectorScrollByHash: new Map(),
  currentInspectStateKey: "",
};
