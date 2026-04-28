// Package ui exposes the static frontend assets bundled into the binary.
//
// The actual files live in the sibling `assets/` directory (a non-Go folder
// so it stays pure static content) and are embedded at build time via
// "go:embed" directive. Files() returns a filesystem rooted at the assets directory so
// callers see paths like "index.html" rather than "assets/index.html".
package ui

import (
	"embed"
	"io/fs"
)

//go:embed all:assets
var assetsFS embed.FS

// Files returns the embedded UI filesystem rooted so that index.html lives
// at the root.
func Files() fs.FS {
	sub, err := fs.Sub(assetsFS, "assets")
	if err != nil {
		// fs.Sub only fails on an invalid prefix; "assets" is a literal
		// directory we just embedded, so this is unreachable in practice.
		panic("ui: embed prefix invalid: " + err.Error())
	}
	return sub
}
