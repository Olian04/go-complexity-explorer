package codeindex

import (
	"fmt"
	"go/ast"
	"go/printer"
	"go/token"
	"strings"
)

// funcDisplayName renders the canonical display name for a function
// declaration. Methods are formatted as "(Receiver).Method"; plain functions
// return their bare name.
func funcDisplayName(fnDecl *ast.FuncDecl) string {
	if fnDecl.Recv == nil || len(fnDecl.Recv.List) == 0 {
		return fnDecl.Name.Name
	}
	recvType := exprToString(fnDecl.Recv.List[0].Type)
	return fmt.Sprintf("(%s).%s", recvType, fnDecl.Name.Name)
}

// buildNameVariants returns every name a function may be referenced by in
// callsites, including pointer/value method receiver permutations. The base
// display name is always first.
func buildNameVariants(fnDecl *ast.FuncDecl) []string {
	base := funcDisplayName(fnDecl)
	out := []string{base}
	if fnDecl.Recv == nil || len(fnDecl.Recv.List) == 0 {
		return out
	}
	recvType := fnDecl.Recv.List[0].Type
	switch t := recvType.(type) {
	case *ast.StarExpr:
		plain := fmt.Sprintf("(%s).%s", exprToString(t.X), fnDecl.Name.Name)
		out = append(out, plain)
	default:
		star := fmt.Sprintf("(*%s).%s", exprToString(t), fnDecl.Name.Name)
		out = append(out, star)
	}
	return uniqueStrings(out)
}

func exprToString(expr ast.Expr) string {
	var b strings.Builder
	_ = printer.Fprint(&b, token.NewFileSet(), expr)
	return b.String()
}

func uniqueStrings(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, value := range in {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}
