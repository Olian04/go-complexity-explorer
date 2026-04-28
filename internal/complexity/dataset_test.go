package complexity

import (
	"os"
	"path/filepath"
	"reflect"
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

func TestReadDataset_RoundTrip(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	out := filepath.Join(dir, "snapshot.json")

	want := Dataset{
		GeneratedAt: "2026-04-28T12:00:00Z",
		Functions: []FunctionRow{{
			ID:         "pkg|file.go|Fn",
			Package:    "pkg",
			File:       "file.go",
			Function:   "Fn",
			Cyclomatic: 3,
			Cognitive:  5,
			Inspect: codeindex.InspectData{
				ID:                 "pkg|file.go|Fn",
				Package:            "pkg",
				File:               "file.go",
				Function:           "Fn",
				NameVariants:       []string{"Fn"},
				StartLine:          10,
				EndLine:            20,
				Source:             "func Fn() {}",
				Contributors:       []codeindex.Contributor{},
				Backlinks:          []codeindex.Backlink{},
				ReferenceBacklinks: []codeindex.Backlink{},
				SourceLinks:        []codeindex.SourceLink{},
			},
		}},
		Inspect: map[string]codeindex.InspectData{
			"pkg|file.go|Fn": {
				ID:                 "pkg|file.go|Fn",
				Package:            "pkg",
				File:               "file.go",
				Function:           "Fn",
				NameVariants:       []string{"Fn"},
				StartLine:          10,
				EndLine:            20,
				Source:             "func Fn() {}",
				Contributors:       []codeindex.Contributor{},
				Backlinks:          []codeindex.Backlink{},
				ReferenceBacklinks: []codeindex.Backlink{},
				SourceLinks:        []codeindex.SourceLink{},
			},
		},
	}

	if err := want.WriteJSON(out); err != nil {
		t.Fatalf("WriteJSON() error = %v", err)
	}

	got, err := ReadDataset(out)
	if err != nil {
		t.Fatalf("ReadDataset() error = %v", err)
	}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ReadDataset() round-trip mismatch:\n got = %#v\nwant = %#v", got, want)
	}
}

func TestReadDataset_MissingFile(t *testing.T) {
	t.Parallel()

	_, err := ReadDataset(filepath.Join(t.TempDir(), "does-not-exist.json"))
	if err == nil {
		t.Fatal("ReadDataset() error = nil, want non-nil for missing file")
	}
}
