package complexity

import (
	"fmt"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/Olian04/go-complexity-explorer/internal/complexity/codeindex"
	"github.com/Olian04/go-complexity-explorer/internal/complexity/gocognit"
	"github.com/Olian04/go-complexity-explorer/internal/complexity/gocyclo"
)

// Options configures an analysis run.
type Options struct {
	// Root is the repository root to analyze (relative or absolute).
	Root string
	// Include is a comma-separated list of directories under Root to scan.
	// Empty entries are ignored; an empty Include defaults to ".".
	Include string
}

// Analyze parses the source tree under opts.Root, computes cyclomatic and
// cognitive complexity for each function, and assembles the dataset consumed
// by both the JSON output and the HTTP transport.
func Analyze(opts Options) (Dataset, error) {
	absRoot, err := filepath.Abs(opts.Root)
	if err != nil {
		return Dataset{}, fmt.Errorf("resolve root %q: %w", opts.Root, err)
	}

	paths := existingIncludePaths(absRoot, parseIncludeDirs(opts.Include))
	if len(paths) == 0 {
		return Dataset{}, fmt.Errorf("no include directories found under root %q", absRoot)
	}

	fset := token.NewFileSet()
	files, functions, err := codeindex.Collect(absRoot, paths, fset)
	if err != nil {
		return Dataset{}, err
	}

	cyclo := gocyclo.Collect(absRoot, paths)
	cogn := gocognit.Collect(absRoot, fset, files)

	rows := make([]FunctionRow, 0, len(functions))
	inspectIndex := make(map[string]codeindex.InspectData, len(functions))
	for _, fn := range functions {
		rows = append(rows, FunctionRow{
			ID:         fn.ID,
			Package:    fn.Package,
			File:       fn.File,
			Function:   fn.Function,
			Cyclomatic: lookupMetric(cyclo, fn.Package, fn.File, fn.Function, fn.NameVariants),
			Cognitive:  lookupMetric(cogn, fn.Package, fn.File, fn.Function, fn.NameVariants),
			Inspect:    fn.Inspect,
		})
		inspectIndex[fn.ID] = fn.Inspect
	}

	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Package != rows[j].Package {
			return rows[i].Package < rows[j].Package
		}
		if rows[i].File != rows[j].File {
			return rows[i].File < rows[j].File
		}
		return rows[i].Function < rows[j].Function
	})

	return Dataset{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Functions:   rows,
		Inspect:     inspectIndex,
	}, nil
}

func parseIncludeDirs(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, item := range parts {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		out = append(out, filepath.Clean(trimmed))
	}
	if len(out) == 0 {
		return []string{"."}
	}
	return out
}

func existingIncludePaths(root string, includeDirs []string) []string {
	paths := make([]string, 0, len(includeDirs))
	for _, rel := range includeDirs {
		abs := filepath.Join(root, rel)
		info, err := os.Stat(abs)
		if err != nil || !info.IsDir() {
			continue
		}
		paths = append(paths, abs)
	}
	return paths
}

// lookupMetric resolves a metric value by trying the function's primary name
// and then any name variants (method receiver pointer/value permutations)
// until one matches a key produced by the providers.
func lookupMetric(metric map[string]int, pkg, file, name string, variants []string) int {
	if value, ok := metric[codeindex.FuncID(pkg, file, name)]; ok {
		return value
	}
	for _, variant := range variants {
		if value, ok := metric[codeindex.FuncID(pkg, file, variant)]; ok {
			return value
		}
	}
	return 0
}
