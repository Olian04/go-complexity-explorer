package complexity

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Olian04/go-complexity-explorer/internal/complexity/codeindex"
)

func TestDataset_WriteJSON(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	out := filepath.Join(dir, "nested", "dataset.json")

	dataset := Dataset{
		GeneratedAt: "2026-04-28T12:00:00Z",
		Functions:   []FunctionRow{},
		Inspect:     map[string]codeindex.InspectData{},
	}
	if err := dataset.WriteJSON(out); err != nil {
		t.Fatalf("WriteJSON() error = %v", err)
	}

	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}

	got := string(data)
	if !strings.HasSuffix(got, "\n") {
		t.Fatalf("WriteJSON output missing trailing newline: %q", got)
	}
	if !strings.Contains(got, `"generated_at": "2026-04-28T12:00:00Z"`) {
		t.Fatalf("WriteJSON output missing generated_at field: %q", got)
	}
}
