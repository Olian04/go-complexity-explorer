package codeindex

import (
	"go/ast"
	"strings"
)

// importAliases returns a map from the local name a file uses for an import
// to the import's package name (its last path segment). Blank and dot
// imports are skipped because they cannot appear in qualified callsites.
func importAliases(fileNode *ast.File) map[string]string {
	out := make(map[string]string, len(fileNode.Imports))
	for _, imp := range fileNode.Imports {
		importPath := strings.Trim(imp.Path.Value, "\"")
		parts := strings.Split(importPath, "/")
		importPkgName := parts[len(parts)-1]

		if imp.Name != nil {
			if imp.Name.Name == "_" || imp.Name.Name == "." {
				continue
			}
			out[imp.Name.Name] = importPkgName
			continue
		}
		out[importPkgName] = importPkgName
	}
	return out
}
