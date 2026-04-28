// Monaco editor integration for the inspector source view: lazy load via
// the AMD loader, set up click/hover/scroll handlers, build glyph-margin
// decorations from contributors, and wire up the Cmd/Ctrl-click "go to
// definition" behaviour for source links.
//
// Forms a cycle with inspector.mjs (we call openInspector, it calls
// renderInspectorSource). The cycle is safe because every cross-module
// call happens inside an event-handler callback, by which time both
// modules have finished evaluating.

import { inspectEditorEl, state } from "./globals.mjs";
import {
  buildContributorsByLine,
  normalizeContributorKind,
  contributorSeverity,
  contributorEmojiClass,
  contributorHoverMessage,
  buildRecursionContributors,
  isPositionWithinContributor,
} from "./contributors.mjs";
import { openInspector, saveInspectorScrollState } from "./inspector.mjs";

export function disposeMonacoProviders() {
  if (state.hoverProviderDisposable) {
    state.hoverProviderDisposable.dispose();
    state.hoverProviderDisposable = null;
  }
}

export function buildEditorFunctionLinks(monaco, inspectData) {
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

export function linkAtPosition(position) {
  if (!position) {
    return null;
  }
  for (const link of state.editorFunctionLinks) {
    if (position.lineNumber !== link.range.startLineNumber) {
      continue;
    }
    if (position.column >= link.range.startColumn && position.column <= link.range.endColumn) {
      return link;
    }
  }
  return null;
}

export function isDefinitionModifierPressed(mouseEvent) {
  if (!mouseEvent) {
    return false;
  }
  const isMac = /\bMac\b/i.test(navigator.platform || "");
  return isMac ? !!mouseEvent.metaKey : !!mouseEvent.ctrlKey;
}

export function isDefinitionModifierKey(event) {
  const isMac = /\bMac\b/i.test(navigator.platform || "");
  return isMac ? event.key === "Meta" : event.key === "Control";
}

export function setModifierNavigationStyleEnabled(enabled) {
  if (!inspectEditorEl) {
    return;
  }
  inspectEditorEl.classList.toggle("modifier-nav-enabled", enabled);
}

export function glyphMarginOption(position) {
  if (!position) {
    return undefined;
  }
  return { position };
}

export function buildGlyphMarginDecorations(monaco, inspectData) {
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

export function ensureMonaco() {
  if (window.monaco?.editor) {
    return Promise.resolve(window.monaco);
  }
  if (state.monacoReadyPromise) {
    return state.monacoReadyPromise;
  }
  state.monacoReadyPromise = new Promise((resolve, reject) => {
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
  return state.monacoReadyPromise;
}

export async function renderInspectorSource(inspectData) {
  const monaco = await ensureMonaco();
  if (!state.monacoEditor) {
    state.monacoEditor = monaco.editor.create(inspectEditorEl, {
      language: "go",
      readOnly: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      glyphMargin: true,
      hover: { enabled: true },
      theme: "vs-dark",
    });
    state.monacoEditor.onMouseDown((event) => {
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
    state.monacoEditor.onMouseMove((event) => {
      const domNode = state.monacoEditor.getDomNode();
      if (!domNode) {
        return;
      }
      if (event.target?.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        domNode.style.cursor = "default";
        return;
      }
      const link = linkAtPosition(event.target?.position);
      domNode.style.cursor =
        link && (!link.requiresModifier || isDefinitionModifierPressed(event.event))
          ? "pointer"
          : "text";
    });
    state.monacoEditor.onMouseLeave(() => {
      const domNode = state.monacoEditor.getDomNode();
      if (!domNode) {
        return;
      }
      domNode.style.cursor = "text";
    });
    state.monacoEditor.onDidScrollChange(() => {
      saveInspectorScrollState();
    });
  }

  if (state.monacoModel) {
    state.monacoModel.dispose();
    state.monacoModel = null;
  }

  const uri = monaco.Uri.parse(`inmemory://inspect/${encodeURIComponent(inspectData.id)}.go`);
  state.monacoModel = monaco.editor.createModel(inspectData.source, "go", uri);
  state.monacoEditor.setModel(state.monacoModel);
  state.monacoEditor.updateOptions({
    lineNumbers(lineNumber) {
      return String(inspectData.start_line + lineNumber - 1);
    },
  });
  state.monacoEditor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });

  const contributors = [
    ...(inspectData.contributors || []),
    ...buildRecursionContributors(inspectData),
  ];

  disposeMonacoProviders();
  state.hoverProviderDisposable = monaco.languages.registerHoverProvider("go", {
    provideHover(model, position) {
      if (model.uri.toString() !== state.monacoModel.uri.toString()) {
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
  state.editorFunctionLinks = buildEditorFunctionLinks(monaco, inspectData);

  const linkDecorations = state.editorFunctionLinks.map((link) => ({
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
  state.editorDecorations = state.monacoEditor.deltaDecorations(state.editorDecorations, decorations);
}
