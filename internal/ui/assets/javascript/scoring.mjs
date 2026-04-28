// Scoring model evaluation, threshold reading, severity classification, and
// the score-bar / number formatting helpers shared between the treemap and
// the inspector modal. All functions here are pure with respect to module
// state; they only read DOM input values.

import { warnThresholdInput, highThresholdInput, DEFAULT_THRESHOLD } from "./globals.mjs";

export function scoreFunction(fn, model, weights) {
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

export function readThresholdInput(inputEl, fallback) {
  const value = Number.parseFloat(inputEl.value);
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return value;
}

export function currentThreshold() {
  return {
    warn: readThresholdInput(warnThresholdInput, DEFAULT_THRESHOLD.warn),
    red: readThresholdInput(highThresholdInput, DEFAULT_THRESHOLD.red),
  };
}

export function severityColor(score, threshold) {
  if (score >= threshold.red) {
    return "#dc2626";
  }
  if (score >= threshold.warn) {
    return "#eab308";
  }
  return "#16a34a";
}

export function severityClass(score, threshold) {
  if (score >= threshold.red) {
    return "high";
  }
  if (score >= threshold.warn) {
    return "medium";
  }
  return "low";
}

export function setScoreBar(barEl, valueEl, score, threshold) {
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

export function formatScore(score) {
  if (Number.isInteger(score)) {
    return String(score);
  }
  return score.toFixed(2);
}
