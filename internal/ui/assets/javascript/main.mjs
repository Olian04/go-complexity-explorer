// Application bootstrap: fetches the dataset, populates the various index
// maps stored on `state`, attaches every top-level event listener, and
// kicks off the first render.
//
// This file is the only entry point loaded from index.html as
// <script type="module" src="./javascript/main.mjs"></script>; every other
// module is pulled in transitively through these imports.

import {
  DATA_PATH,
  modelSelect,
  packageFilterOpenEl,
  packageFilterCloseEl,
  packageFilterCancelEl,
  packageFilterApplyEl,
  packageFilterSelectAllEl,
  packageFilterSelectNoneEl,
  packageFilterBackdropEl,
  cycloWeightInput,
  cognWeightInput,
  warnThresholdInput,
  highThresholdInput,
  statusEl,
  inspectCloseEl,
  inspectModalEl,
  inspectBackdropEl,
  state,
} from "./globals.mjs";
import { hideInfoTooltip, setupInfoTooltips } from "./info-tooltip.mjs";
import {
  packagePathFromFile,
  sortedPackageNames,
  buildPackageRelationships,
  updatePackageFilterSummary,
  openPackageFilterModal,
  closePackageFilterModal,
  applyPackageFilterSelection,
  renderPackageFilterModal,
} from "./packages.mjs";
import {
  renderInspectorScores,
  closeInspector,
  syncInspectorFromHash,
  saveInspectorScrollState,
} from "./inspector.mjs";
import {
  isDefinitionModifierKey,
  setModifierNavigationStyleEnabled,
} from "./editor.mjs";
import { render } from "./treemap.mjs";

async function init() {
  try {
    const response = await fetch(DATA_PATH);
    if (!response.ok) {
      throw new Error(`failed to load ${DATA_PATH}: ${response.status}`);
    }
    state.sourceData = await response.json();
    state.packageFunctionCount = new Map();
    state.functionPackagePathByID = new Map();
    for (const fn of state.sourceData.functions || []) {
      const packagePath = packagePathFromFile(fn.file, fn.package);
      state.functionPackagePathByID.set(fn.id, packagePath);
      state.packageFunctionCount.set(
        packagePath,
        (state.packageFunctionCount.get(packagePath) || 0) + 1,
      );
    }
    state.selectedPackages = new Set(sortedPackageNames(state.sourceData.functions || []));
    buildPackageRelationships();
    updatePackageFilterSummary();
    state.functionMetricsByID = new Map(
      (state.sourceData.functions || []).map((fn) => [
        fn.id,
        {
          cyclomatic: Number(fn.cyclomatic) || 0,
          cognitive: Number(fn.cognitive) || 0,
        },
      ]),
    );
    state.callGraphByCaller = new Map();
    state.callsitesByCaller = new Map();
    for (const callee of Object.values(state.sourceData.inspect_index || {})) {
      for (const backlink of callee.backlinks || []) {
        if (!state.callGraphByCaller.has(backlink.caller_id)) {
          state.callGraphByCaller.set(backlink.caller_id, new Set());
        }
        state.callGraphByCaller.get(backlink.caller_id).add(callee.id);
        if (!state.callsitesByCaller.has(backlink.caller_id)) {
          state.callsitesByCaller.set(backlink.caller_id, []);
        }
        state.callsitesByCaller.get(backlink.caller_id).push({
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

function onThresholdChange() {
  render();
  if (state.selectedFunctionID) {
    renderInspectorScores(state.selectedFunctionID);
  }
}

modelSelect.addEventListener("change", render);
packageFilterOpenEl.addEventListener("click", openPackageFilterModal);
packageFilterCloseEl.addEventListener("click", closePackageFilterModal);
packageFilterCancelEl.addEventListener("click", closePackageFilterModal);
packageFilterApplyEl.addEventListener("click", applyPackageFilterSelection);
packageFilterSelectAllEl.addEventListener("click", () => {
  state.draftSelectedPackages = new Set(sortedPackageNames(state.sourceData?.functions || []));
  renderPackageFilterModal();
});
packageFilterSelectNoneEl.addEventListener("click", () => {
  state.draftSelectedPackages = new Set();
  renderPackageFilterModal();
});
cycloWeightInput.addEventListener("input", render);
cognWeightInput.addEventListener("input", render);
warnThresholdInput.addEventListener("input", onThresholdChange);
highThresholdInput.addEventListener("input", onThresholdChange);

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
  if (!state.sourceData) {
    void init();
    return;
  }
  syncInspectorFromHash();
});
inspectCloseEl.addEventListener("click", () => closeInspector({ pushHistory: true }));
inspectModalEl.addEventListener("scroll", () => {
  saveInspectorScrollState(state.currentInspectStateKey);
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
  if (event.key !== "Escape") {
    return;
  }
  if (!packageFilterBackdropEl.classList.contains("hidden")) {
    closePackageFilterModal();
    return;
  }
  if (!inspectBackdropEl.classList.contains("hidden")) {
    closeInspector({ pushHistory: true });
  }
});

setupInfoTooltips();
init();
