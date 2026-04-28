// Package gocyclo wraps github.com/fzipp/gocyclo and returns cyclomatic
// complexity scores keyed by codeindex.FuncID for joining with the rest of
// the dataset.
package gocyclo

import (
	"path/filepath"
	"strings"

	extgocyclo "github.com/fzipp/gocyclo"

	"github.com/Olian04/go-complexity-explorer/internal/complexity/codeindex"
)

// Collect runs gocyclo over includePaths and returns a map from
// codeindex.FuncID(pkg, file, fn) to cyclomatic complexity. Test files are
// skipped. Files that cannot be made relative to root are skipped.
func Collect(root string, includePaths []string) map[string]int {
	stats := extgocyclo.Analyze(includePaths, nil)
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
