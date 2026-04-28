// Package codeindex parses a Go source tree and produces the per-function
// inspector payload (source snippet, AST contributors, callsite backlinks)
// that the complexity dataset surfaces alongside cyclomatic and cognitive
// metrics.
//
// All keys produced by this package use FuncID, which must match the key
// format used by the gocyclo and gocognit providers.
package codeindex

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
)

// FuncID is the canonical stable identifier for a function across packages
// and providers. Format: "pkg|file|name". The gocyclo and gocognit providers
// must produce keys with the same shape.
func FuncID(pkg, file, fn string) string {
	return pkg + "|" + file + "|" + fn
}

// Collect walks the given paths under root, parses every non-test .go file,
// and returns the parsed AST files plus a Function entry for every top-level
// FuncDecl with a body. fset accumulates all positions so callers can pass
// the same FileSet to other AST consumers (e.g. gocognit).
func Collect(
	root string,
	paths []string,
	fset *token.FileSet,
) ([]*ast.File, []Function, error) {
	files, parsedFunctions, byPackage, err := parseFunctions(fset, root, paths)
	if err != nil {
		return nil, nil, err
	}

	resolveBacklinks(fset, parsedFunctions, byPackage)

	functions := make([]Function, 0, len(parsedFunctions))
	for _, fn := range parsedFunctions {
		functions = append(functions, Function{
			ID:           fn.id,
			Package:      fn.key.pkg,
			File:         fn.key.file,
			Function:     fn.key.name,
			NameVariants: fn.nameVariants,
			Inspect:      fn.inspect,
		})
	}

	return files, functions, nil
}

func parseFunctions(
	fset *token.FileSet,
	root string,
	paths []string,
) ([]*ast.File, []*parsedFunction, map[string][]*parsedFunction, error) {
	var files []*ast.File
	var functions []*parsedFunction
	byPackage := map[string][]*parsedFunction{}

	for _, basePath := range paths {
		err := filepath.WalkDir(basePath, func(path string, d os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if d.IsDir() {
				name := d.Name()
				if name == "vendor" || name == "testdata" || strings.HasPrefix(name, ".") || strings.HasPrefix(name, "_") {
					return filepath.SkipDir
				}
				return nil
			}
			if !strings.HasSuffix(d.Name(), ".go") || strings.HasSuffix(d.Name(), "_test.go") {
				return nil
			}
			src, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			fileNode, err := parser.ParseFile(fset, path, src, parser.ParseComments)
			if err != nil {
				return err
			}
			files = append(files, fileNode)
			aliases := importAliases(fileNode)
			relPath, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			relPath = filepath.ToSlash(relPath)

			for _, decl := range fileNode.Decls {
				fnDecl, ok := decl.(*ast.FuncDecl)
				if !ok || fnDecl.Body == nil {
					continue
				}
				fnName := funcDisplayName(fnDecl)
				id := FuncID(fileNode.Name.Name, relPath, fnName)
				startPos := fset.Position(fnDecl.Pos())
				endPos := fset.Position(fnDecl.End())
				entry := &parsedFunction{
					key: functionKey{
						pkg:  fileNode.Name.Name,
						file: relPath,
						name: fnName,
					},
					nameVariants: buildNameVariants(fnDecl),
					id:           id,
					aliases:      aliases,
					decl:         fnDecl,
					inspect: InspectData{
						ID:                 id,
						Package:            fileNode.Name.Name,
						File:               relPath,
						Function:           fnName,
						NameVariants:       buildNameVariants(fnDecl),
						StartLine:          startPos.Line,
						EndLine:            endPos.Line,
						Source:             snippet(src, fset.File(fnDecl.Pos()), fnDecl.Pos(), fnDecl.End()),
						Contributors:       collectContributors(fset, fnDecl.Body),
						Backlinks:          nil,
						ReferenceBacklinks: nil,
						SourceLinks:        nil,
					},
				}
				functions = append(functions, entry)
				byPackage[entry.key.pkg] = append(byPackage[entry.key.pkg], entry)
			}
			return nil
		})
		if err != nil {
			return nil, nil, nil, fmt.Errorf("walk %s: %w", basePath, err)
		}
	}

	return files, functions, byPackage, nil
}
