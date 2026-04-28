# Complexity Explorer

Pure-Go complexity explorer with an embedded web client.

Hierarchy in the treemap:

- package
- file
- function

Scoring models (switchable in UI):

- cyclomatic
- cognitive
- max(cyclomatic, cognitive)
- weighted sum (`cyclomatic_weight * cyclomatic + cognitive_weight * cognitive`)

Inspector features:

- Click a function tile to inspect it.
- Source code view with highlighted AST regions contributing to complexity (`if`, loops, `switch`, `case`, `&&`, `||`, etc.).
- Backlinks list showing inbound callsites (which functions call the selected function), derived via `go/parser` / `go/ast`.
- Reference From list showing inbound non-call function references (function-value usage such as callback wiring), derived via `go/parser` / `go/ast`.

## Inspector Nomenclature

### Gutter icon legend (Font Awesome)

- `fa-question` - `if` branch contributor (medium severity).
- `fa-repeat` - loop contributor (`for` / `range`, medium severity).
- `fa-code-branch` - `switch` / `type-switch` / `select` contributor (high severity).
- `fa-puzzle-piece` - `case` / `comm` arm contributor (medium severity).
- `fa-gear` - boolean logic contributor (`&&` / `||`, low severity).
- `fa-location-dot` - other control-flow contributor not covered by the categories above (low severity).
- `fa-rotate-left` - direct recursion contributor: the function calls itself at this callsite (medium severity).
- `fa-arrows-rotate` - cyclic/indirect recursion contributor: this call enters a deeper call chain that eventually returns to the same function (high severity).
- `fa-ellipsis` - overflow marker: additional contributors exist on the same line beyond visible glyph slots.

### Treemap marker legend

- `fa-triangle-exclamation` marker on a function tile - no inbound callsites were found for that function in analyzed code.
  - Exception: package `main` entrypoint function `main` does not show this warning marker.
- `fa-link` hook marker on a function tile - no inbound callsites were found in analyzed app code, but the function appears to be used as a callback/hook (for example exported `On*`/`Handle*` methods or function-value references passed into library-owned structs/options) and may be invoked by dependency code.

## Layout

Everything is isolated under this directory:

- `main.go` - CLI entrypoint (`analyze`, `serve`)
- `web/index.html` - UI entrypoint
- `web/styles.css` - styles
- `web/app.js` - treemap + inspector behavior

No Python or Bash scripts are required.

## Analyze to JSON

From repository root:

```bash
go run ./tools/complexity-treemap/cmd/complexity-explorer analyze \
  --root . \
  --include . \
  --output ./complexity.json
```

Flags:

- `--root` root directory to analyze
- `--include` comma-separated directories under root (portable; not repo-hardcoded)
- `--output` JSON output file path

## Run Embedded Web Server

From repository root:

```bash
go run ./tools/complexity-treemap/cmd/complexity-explorer serve \
  --root . \
  --include . \
  --addr :8787
```

Open:

- <http://localhost:8787/>

The Go binary embeds and serves `web/` assets and exposes runtime analysis data via:

- `/api/complexity`
