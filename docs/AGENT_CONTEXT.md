# Agent context: go-complexity-explorer

This document captures the architecture and code-organization conventions for this repository.

## Coding standards

Follow idiomatic Go and explicit error handling. Prefer clear and direct code.

- [Go Proverbs](https://go-proverbs.github.io/)
- [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md)

## High-level architecture

The runtime path is:

1. `cmd/complexity-explorer/main.go` (process entry)
2. `internal/app` (composition root / use-case execution)
3. `internal/complexity` (domain models + per-provider analysis packages)
4. `internal/transport/httpserver` (HTTP/UI serving)
5. `internal/ui` (embedded static frontend, exposed as an `fs.FS`)

The UI is shipped inside the binary via `go:embed` in `internal/ui`. The
static files themselves live in `internal/ui/assets/` and contain no Go
code.

## Directory roles

| Path | Role |
| --- | --- |
| `cmd/complexity-explorer` | CLI integration (subcommands, flags, usage, version printing) |
| `internal/app` | Bootstrap/composition root and use-case functions invoked by CLI |
| `internal/complexity` | Dataset shape and `Analyze` orchestration over the providers |
| `internal/complexity/codeindex` | Parser-driven indexer; owns the inspector data shape (`InspectData`, `Contributor`, `Backlink`, `SourceLink`) and the canonical `FuncID` |
| `internal/complexity/gocyclo` | Cyclomatic complexity provider (`fzipp/gocyclo`) |
| `internal/complexity/gocognit` | Cognitive complexity provider (`uudashr/gocognit`) |
| `internal/transport/httpserver` | HTTP server and API route handling; takes an `fs.FS` for the UI |
| `internal/ui` | Embeds the static UI assets via `go:embed` and exposes them as an `fs.FS` |
| `internal/ui/assets` | The static UI files (HTML/CSS/JS/icons); pure static content, no Go |

## Dependency direction (must keep)

- `cmd` can import `internal/app`.
- `internal/app` can import `internal/complexity` and `internal/transport/*`.
- `internal/complexity` can import its own subpackages (`codeindex`, `gocyclo`, `gocognit`).
- `internal/complexity/gocyclo` and `internal/complexity/gocognit` can import `internal/complexity/codeindex` (for `FuncID` only).
- `internal/complexity/codeindex` is a leaf; it must not import the parent `complexity` package or any sibling provider.
- `internal/transport/*` must not import `cmd`, `internal/app`, or any internal provider package.

In short: **outer layers depend on inner layers, never the reverse**.

## Operational commands

- `go test ./...`
- `go vet ./...`

Run both before considering a refactor complete.
