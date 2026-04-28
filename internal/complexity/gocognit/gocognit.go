// Package gocognit wraps github.com/uudashr/gocognit and returns cognitive
// complexity scores keyed by codeindex.FuncID for joining with the rest of
// the dataset.
package gocognit

import (
	"go/ast"
	"go/token"
	"path/filepath"
	"strings"

	extgocognit "github.com/uudashr/gocognit"

	"github.com/Olian04/go-complexity-explorer/internal/complexity/codeindex"
)

// Collect runs gocognit over the parsed AST files (already loaded into fset)
// and returns a map from codeindex.FuncID(pkg, file, fn) to cognitive
// complexity. Test files are skipped. Files that cannot be made relative to
// root are skipped.
func Collect(root string, fset *token.FileSet, files []*ast.File) map[string]int {
	var stats []extgocognit.Stat
	for _, fileNode := range files {
		stats = extgocognit.ComplexityStats(fileNode, fset, stats)
	}
	out := make(map[string]int, len(stats))
	for _, stat := range stats {
		if strings.HasSuffix(stat.Pos.Filename, "_test.go") {
			continue
		}
		relPath, err := filepath.Rel(root, stat.Pos.Filename)
		if err != nil {
			continue
		}
		out[codeindex.FuncID(stat.PkgName, filepath.ToSlash(relPath), stat.FuncName)] = stat.Complexity
	}
	return out
}
