// Package complexity is the domain of the complexity-explorer tool: it owns
// the dataset shape consumed by both the JSON output and the HTTP transport,
// and orchestrates the per-provider analysis (codeindex, gocyclo, gocognit)
// that produces it.
package complexity

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/Olian04/go-complexity-explorer/internal/complexity/codeindex"
)

const (
	directoryPerm = 0o755
	filePerm      = 0o644
)

// Dataset is the analysis result emitted to disk and over HTTP.
type Dataset struct {
	GeneratedAt string                            `json:"generated_at"`
	Functions   []FunctionRow                     `json:"functions"`
	Inspect     map[string]codeindex.InspectData  `json:"inspect_index"`
}

// FunctionRow is one function in the dataset: its identity, complexity
// metrics, and the inspector payload supplied by the codeindex provider.
type FunctionRow struct {
	ID         string                 `json:"id"`
	Package    string                 `json:"package"`
	File       string                 `json:"file"`
	Function   string                 `json:"function"`
	Cyclomatic int                    `json:"cyclomatic"`
	Cognitive  int                    `json:"cognitive"`
	Inspect    codeindex.InspectData  `json:"inspect"`
}

// WriteJSON marshals the dataset and writes it to path, creating parent
// directories as needed. The file is terminated with a trailing newline.
func (d Dataset) WriteJSON(path string) error {
	data, err := json.MarshalIndent(d, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal dataset: %w", err)
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, directoryPerm); err != nil {
		return fmt.Errorf("create output directory %q: %w", dir, err)
	}
	if err := os.WriteFile(path, append(data, '\n'), filePerm); err != nil {
		return fmt.Errorf("write output file %q: %w", path, err)
	}
	return nil
}
