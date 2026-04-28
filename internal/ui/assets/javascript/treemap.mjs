// D3-driven treemap render: reads the current model / weights / thresholds /
// package selection, builds a hierarchy, and paints rectangles, labels and
// markers into `chartEl`. Also updates the bottom status bar and toggles
// the visibility of the weighted-sum weight inputs.
//
// D3 is loaded as a native ES module from a CDN.

import * as d3 from "https://esm.sh/d3@7";

import {
  modelSelect,
  cycloWeightInput,
  cognWeightInput,
  chartEl,
  tooltipEl,
  statusEl,
  weightControls,
  state,
} from "./globals.mjs";
import { currentThreshold, severityColor, formatScore } from "./scoring.mjs";
import {
  sortedPackageNames,
  packagePathFromFile,
  updatePackageFilterSummary,
} from "./packages.mjs";
import { buildHierarchy } from "./hierarchy.mjs";
import { openInspector } from "./inspector.mjs";

export function render() {
  if (!state.sourceData) {
    return;
  }

  const model = modelSelect.value;
  const weights = {
    cyclomatic: Number(cycloWeightInput.value) || 0,
    cognitive: Number(cognWeightInput.value) || 0,
  };
  const threshold = currentThreshold();
  const allPackages = sortedPackageNames(state.sourceData.functions);
  if (state.selectedPackages.size === 0 && allPackages.length > 0) {
    state.selectedPackages = new Set(allPackages);
    updatePackageFilterSummary();
  }
  const visibleFunctions = state.sourceData.functions.filter((fn) =>
    state.selectedPackages.has(packagePathFromFile(fn.file, fn.package)),
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
    `Mode: ${model}. Packages: ${state.selectedPackages.size}/${allPackages.length}. ` +
    `Functions shown: ${visibleFunctions.length}/${state.sourceData.functions.length}. ` +
    `Warn >= ${formatScore(threshold.warn)}, high >= ${formatScore(threshold.red)}.`;

  for (const item of weightControls) {
    item.classList.toggle("hidden", model !== "weighted");
  }
}
