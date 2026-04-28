// Package-level helpers and the package filter modal: classification of
// main / external-callback functions, package path derivation, package
// relationship graph, and the modal that lets the user pick which packages
// the treemap shows.
//
// Imports `render` from treemap.mjs so the "Apply" button can refresh the
// view; that creates a packages.mjs <-> treemap.mjs cycle. The cycle is
// safe because `render` is only invoked inside an event listener that runs
// after both modules have finished evaluating.

import {
  packageFilterLabelEl,
  packageFilterTableEl,
  packageFilterBackdropEl,
  state,
} from "./globals.mjs";
import { baseFunctionName } from "./contributors.mjs";
import { render } from "./treemap.mjs";

export function isMainEntrypoint(packageName, functionName) {
  return packageName === "main" && baseFunctionName(functionName) === "main";
}

export function looksLikeExternalLibraryCallback(functionName) {
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

export function packagePathFromFile(filePath, fallbackPackage) {
  if (typeof filePath === "string" && filePath && filePath !== "(unknown)") {
    const normalized = filePath.replaceAll("\\", "/");
    const idx = normalized.lastIndexOf("/");
    if (idx > 0) {
      return normalized.slice(0, idx);
    }
  }
  return fallbackPackage || "(unknown)";
}

export function sortedPackageNames(functions) {
  if (state.packageFunctionCount.size > 0) {
    return [...state.packageFunctionCount.keys()].sort((a, b) => a.localeCompare(b));
  }
  return [...new Set((functions || []).map((fn) => packagePathFromFile(fn.file, fn.package)))].sort(
    (a, b) => a.localeCompare(b),
  );
}

export function buildPackageRelationships() {
  const packageNames = sortedPackageNames(state.sourceData?.functions || []);
  state.packageRelationships = new Map(packageNames.map((pkg) => [pkg, new Map()]));
  for (const callee of Object.values(state.sourceData?.inspect_index || {})) {
    const calleePkg =
      state.functionPackagePathByID.get(callee.id) || packagePathFromFile(callee.file, callee.package);
    for (const backlink of callee.backlinks || []) {
      const callerPkg =
        state.functionPackagePathByID.get(backlink.caller_id) ||
        packagePathFromFile(backlink.caller_file, backlink.caller_package);
      if (!state.packageRelationships.has(callerPkg)) {
        state.packageRelationships.set(callerPkg, new Map());
      }
      if (!state.packageRelationships.has(calleePkg)) {
        state.packageRelationships.set(calleePkg, new Map());
      }
      if (callerPkg === calleePkg) {
        continue;
      }
      const callerEdges = state.packageRelationships.get(callerPkg);
      callerEdges.set(calleePkg, (callerEdges.get(calleePkg) || 0) + 1);
      const calleeEdges = state.packageRelationships.get(calleePkg);
      calleeEdges.set(callerPkg, (calleeEdges.get(callerPkg) || 0) + 1);
    }
  }
}

export function packageRelationshipGroups() {
  const visited = new Set();
  const all = [...state.packageRelationships.keys()].sort((a, b) => a.localeCompare(b));
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
      for (const neighbor of state.packageRelationships.get(current)?.keys() || []) {
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

export function updatePackageFilterSummary() {
  if (!packageFilterLabelEl) {
    return;
  }
  const total = sortedPackageNames(state.sourceData?.functions || []).length;
  packageFilterLabelEl.textContent = `Showing ${state.selectedPackages.size} of ${total} packages`;
}

export function packageGroupOrderMap() {
  const groups = packageRelationshipGroups();
  const order = new Map();
  groups.forEach((pkgs, groupIdx) => {
    pkgs.forEach((pkg) => {
      order.set(pkg, groupIdx);
    });
  });
  return order;
}

export function renderPackageFilterModal() {
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
  const packages = sortedPackageNames(state.sourceData?.functions || []).sort((a, b) => {
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
    checkbox.checked = state.draftSelectedPackages.has(pkg);
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.draftSelectedPackages.add(pkg);
      } else {
        state.draftSelectedPackages.delete(pkg);
      }
    });
    selectCell.appendChild(checkbox);
    const pathCell = document.createElement("td");
    pathCell.textContent = pkg;
    const countCell = document.createElement("td");
    countCell.className = "package-filter-count";
    countCell.textContent = String(state.packageFunctionCount.get(pkg) || 0);
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

export function openPackageFilterModal() {
  if (!packageFilterBackdropEl) {
    return;
  }
  const allPackages = sortedPackageNames(state.sourceData?.functions || []);
  state.draftSelectedPackages = new Set(
    state.selectedPackages.size > 0 ? state.selectedPackages : allPackages,
  );
  renderPackageFilterModal();
  packageFilterBackdropEl.classList.remove("hidden");
}

export function closePackageFilterModal() {
  if (!packageFilterBackdropEl) {
    return;
  }
  packageFilterBackdropEl.classList.add("hidden");
}

export function applyPackageFilterSelection() {
  state.selectedPackages = new Set(state.draftSelectedPackages);
  updatePackageFilterSummary();
  closePackageFilterModal();
  render();
}
