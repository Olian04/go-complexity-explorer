package codeindex

import (
	"go/token"
	"testing"
)

func TestSnippet(t *testing.T) {
	t.Parallel()

	src := []byte("package test\n\nfunc hello() {}\n")
	fset := token.NewFileSet()
	tokenFile := fset.AddFile("sample.go", -1, len(src))
	tokenFile.SetLinesForContent(src)

	const start = 14
	const end = 29
	got := snippet(src, tokenFile, tokenFile.Pos(start), tokenFile.Pos(end))
	if got != "func hello() {}" {
		t.Fatalf("snippet() = %q, want %q", got, "func hello() {}")
	}
}

func TestSnippet_InvalidRange(t *testing.T) {
	t.Parallel()

	src := []byte("package test\n")
	fset := token.NewFileSet()
	tokenFile := fset.AddFile("sample.go", -1, len(src))
	tokenFile.SetLinesForContent(src)

	got := snippet(src, tokenFile, tokenFile.Pos(3), tokenFile.Pos(3))
	if got != "" {
		t.Fatalf("snippet() with invalid range = %q, want empty", got)
	}
}

func TestSnippet_NilTokenFile(t *testing.T) {
	t.Parallel()

	if got := snippet(nil, nil, 0, 0); got != "" {
		t.Fatalf("snippet() with nil tokenFile = %q, want empty", got)
	}
}
