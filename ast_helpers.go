package complexitytreemap

import (
	"fmt"
	"go/ast"
	"go/printer"
	"go/token"
	"sort"
	"strings"
)

func collectContributors(fset *token.FileSet, body *ast.BlockStmt) []contributor {
	var out []contributor
	ast.Inspect(body, func(n ast.Node) bool {
		if n == nil {
			return true
		}

		kind := ""
		switch node := n.(type) {
		case *ast.IfStmt:
			kind = "if"
		case *ast.ForStmt:
			kind = "for"
		case *ast.RangeStmt:
			kind = "range"
		case *ast.SwitchStmt:
			kind = "switch"
		case *ast.TypeSwitchStmt:
			kind = "type-switch"
		case *ast.SelectStmt:
			kind = "select"
		case *ast.CaseClause:
			kind = "case"
		case *ast.CommClause:
			kind = "comm"
		case *ast.BinaryExpr:
			if node.Op == token.LAND {
				kind = "&&"
			}
			if node.Op == token.LOR {
				kind = "||"
			}
		}
		if kind == "" {
			return true
		}

		start := fset.Position(n.Pos())
		end := fset.Position(n.End())
		out = append(out, contributor{
			Kind:      kind,
			StartLine: start.Line,
			StartCol:  start.Column,
			EndLine:   end.Line,
			EndCol:    end.Column,
		})
		return true
	})

	sort.Slice(out, func(i, j int) bool {
		if out[i].StartLine != out[j].StartLine {
			return out[i].StartLine < out[j].StartLine
		}
		if out[i].StartCol != out[j].StartCol {
			return out[i].StartCol < out[j].StartCol
		}
		if out[i].EndLine != out[j].EndLine {
			return out[i].EndLine < out[j].EndLine
		}
		return out[i].EndCol < out[j].EndCol
	})

	return out
}

func importAliases(fileNode *ast.File) map[string]string {
	out := map[string]string{}
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

func funcDisplayName(fnDecl *ast.FuncDecl) string {
	if fnDecl.Recv == nil || len(fnDecl.Recv.List) == 0 {
		return fnDecl.Name.Name
	}
	recvType := exprToString(fnDecl.Recv.List[0].Type)
	return fmt.Sprintf("(%s).%s", recvType, fnDecl.Name.Name)
}

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

func makeID(pkg, file, fn string) string {
	return pkg + "|" + file + "|" + fn
}

func uniqueStrings(in []string) []string {
	seen := map[string]struct{}{}
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
