package codeindex

import (
	"go/ast"
	"go/token"
	"sort"
)

// collectContributors returns every AST node inside body that contributes to
// cyclomatic/cognitive complexity (control flow, case clauses, short-circuit
// boolean operators), sorted by source position.
func collectContributors(fset *token.FileSet, body *ast.BlockStmt) []Contributor {
	var out []Contributor
	ast.Inspect(body, func(n ast.Node) bool {
		if n == nil {
			return true
		}

		kind := contributorKind(n)
		if kind == "" {
			return true
		}

		start := fset.Position(n.Pos())
		end := fset.Position(n.End())
		out = append(out, Contributor{
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

func contributorKind(n ast.Node) string {
	switch node := n.(type) {
	case *ast.IfStmt:
		return "if"
	case *ast.ForStmt:
		return "for"
	case *ast.RangeStmt:
		return "range"
	case *ast.SwitchStmt:
		return "switch"
	case *ast.TypeSwitchStmt:
		return "type-switch"
	case *ast.SelectStmt:
		return "select"
	case *ast.CaseClause:
		return "case"
	case *ast.CommClause:
		return "comm"
	case *ast.BinaryExpr:
		switch node.Op {
		case token.LAND:
			return "&&"
		case token.LOR:
			return "||"
		}
	}
	return ""
}
