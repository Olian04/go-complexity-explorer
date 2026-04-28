// The inspector modal: hash-based deeplinks (so navigation/back work),
// per-hash scroll position, the cyclomatic / cognitive score bars, and the
// open / close lifecycle of the modal itself.
//
// Forms a cycle with editor.mjs (we call renderInspectorSource, it calls
// openInspector and saveInspectorScrollState). The cycle is safe because
// every cross-module call happens inside an event-handler callback.

import {
  inspectBackdropEl,
  inspectModalEl,
  inspectTitleEl,
  inspectMetaEl,
  inspectWarningEl,
  inspectBacklinksEl,
  inspectReferenceFromSectionEl,
  inspectReferenceFromEl,
  inspectCyclomaticBarEl,
  inspectCyclomaticValueEl,
  inspectCognitiveBarEl,
  inspectCognitiveValueEl,
  state,
} from "./globals.mjs";
import { currentThreshold, setScoreBar } from "./scoring.mjs";
import { isMainEntrypoint, looksLikeExternalLibraryCallback } from "./packages.mjs";
import { renderInspectorSource } from "./editor.mjs";

export function renderInspectorScores(functionID) {
  const threshold = currentThreshold();
  const metrics = state.functionMetricsByID.get(functionID);
  if (!metrics) {
    setScoreBar(inspectCyclomaticBarEl, inspectCyclomaticValueEl, 0, threshold);
    setScoreBar(inspectCognitiveBarEl, inspectCognitiveValueEl, 0, threshold);
    return;
  }
  setScoreBar(inspectCyclomaticBarEl, inspectCyclomaticValueEl, metrics.cyclomatic, threshold);
  setScoreBar(inspectCognitiveBarEl, inspectCognitiveValueEl, metrics.cognitive, threshold);
}

export function parseInspectStateFromHash() {
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

export function buildInspectHashKey(functionID, from = null) {
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

export function pushInspectHash(functionID, from = null) {
  const nextHash = buildInspectHashKey(functionID, from);
  if (window.location.hash === nextHash) {
    return;
  }
  window.location.hash = nextHash;
}

export function clearInspectHash() {
  if (window.location.hash === "") {
    return;
  }
  window.location.hash = "";
}

export function inspectHashKey() {
  if (state.currentInspectStateKey) {
    return state.currentInspectStateKey;
  }
  const parsed = parseInspectStateFromHash();
  if (parsed?.inspectID) {
    return window.location.hash;
  }
  if (state.selectedFunctionID) {
    return `#inspect=${encodeURIComponent(state.selectedFunctionID)}`;
  }
  return "";
}

export function saveInspectorScrollState(key = inspectHashKey()) {
  if (!key) {
    return;
  }
  state.inspectorScrollByHash.set(key, {
    modalScrollTop: inspectModalEl.scrollTop,
    editorScrollTop: state.monacoEditor ? state.monacoEditor.getScrollTop() : 0,
  });
}

export function restoreInspectorScrollState(key = inspectHashKey()) {
  const saved = state.inspectorScrollByHash.get(key);
  if (!saved) {
    inspectModalEl.scrollTop = 0;
    if (state.monacoEditor) {
      state.monacoEditor.setScrollTop(0);
    }
    return;
  }
  inspectModalEl.scrollTop = saved.modalScrollTop || 0;
  if (state.monacoEditor) {
    state.monacoEditor.setScrollTop(saved.editorScrollTop || 0);
  }
}

export async function openInspector(functionID, options = {}) {
  const inspectData = state.sourceData?.inspect_index?.[functionID];
  if (!inspectData) {
    return;
  }
  saveInspectorScrollState(state.currentInspectStateKey);
  const pushHistory = options.pushHistory !== false;
  const from = options.from || null;
  const nextStateKey = buildInspectHashKey(functionID, from);

  state.selectedFunctionID = functionID;
  inspectBackdropEl.classList.remove("hidden");
  if (pushHistory) {
    pushInspectHash(functionID, from);
  }
  state.currentInspectStateKey = nextStateKey;

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
  restoreInspectorScrollState(state.currentInspectStateKey);
}

export function closeInspector(options = {}) {
  const pushHistory = options.pushHistory !== false;
  saveInspectorScrollState(state.currentInspectStateKey);
  state.selectedFunctionID = null;
  state.currentInspectStateKey = "";
  inspectBackdropEl.classList.add("hidden");
  if (pushHistory) {
    clearInspectHash();
  }
}

export function syncInspectorFromHash() {
  const parsed = parseInspectStateFromHash();
  if (!parsed?.inspectID) {
    closeInspector({ pushHistory: false });
    return;
  }
  if (!state.sourceData?.inspect_index?.[parsed.inspectID]) {
    closeInspector({ pushHistory: false });
    return;
  }
  void openInspector(parsed.inspectID, { pushHistory: false, from: parsed.from });
}
