package codeindex

import (
	"fmt"
	"go/ast"
	"go/token"
	"sort"
	"strings"
)

// resolveBacklinks populates Inspect.Backlinks (call sites), Inspect.
// ReferenceBacklinks (function-value usages such as callbacks/hooks), and
// Inspect.SourceLinks (per-line links the inspector renders) for every
// parsed function by walking each function's AST and matching identifiers
// against the global package index.
func resolveBacklinks(fset *token.FileSet, functions []*parsedFunction, byPackage map[string][]*parsedFunction) {
	globalByPkgSimple := map[string]map[string][]*parsedFunction{}
	for _, fn := range functions {
		pkgMap, ok := globalByPkgSimple[fn.key.pkg]
		if !ok {
			pkgMap = map[string][]*parsedFunction{}
			globalByPkgSimple[fn.key.pkg] = pkgMap
		}
		for _, name := range fn.nameVariants {
			if strings.Contains(name, ").") {
				continue
			}
			pkgMap[name] = append(pkgMap[name], fn)
		}
	}

	resolveTargets := func(
		caller *parsedFunction,
		expr ast.Expr,
		bySimple map[string][]*parsedFunction,
		byMethod map[string][]*parsedFunction,
	) []*parsedFunction {
		switch fun := expr.(type) {
		case *ast.Ident:
			return bySimple[fun.Name]
		case *ast.SelectorExpr:
			if ident, ok := fun.X.(*ast.Ident); ok {
				if importedPkgName, imported := caller.aliases[ident.Name]; imported {
					if importedFns, ok := globalByPkgSimple[importedPkgName]; ok {
						return importedFns[fun.Sel.Name]
					}
					return nil
				}
			}
			return byMethod[fun.Sel.Name]
		default:
			return nil
		}
	}

	rangeColumns := func(call *ast.CallExpr) (int, int) {
		switch fnExpr := call.Fun.(type) {
		case *ast.Ident:
			p := fset.Position(fnExpr.Pos())
			return p.Column, p.Column + len(fnExpr.Name)
		case *ast.SelectorExpr:
			p := fset.Position(fnExpr.Sel.Pos())
			return p.Column, p.Column + len(fnExpr.Sel.Name)
		default:
			p := fset.Position(call.Pos())
			return p.Column, p.Column + 1
		}
	}

	for _, pkgFuncs := range byPackage {
		bySimple := map[string][]*parsedFunction{}
		byMethod := map[string][]*parsedFunction{}
		for _, fn := range pkgFuncs {
			for _, name := range fn.nameVariants {
				if strings.Contains(name, ").") {
					parts := strings.Split(name, ").")
					method := parts[len(parts)-1]
					byMethod[method] = append(byMethod[method], fn)
				} else {
					bySimple[name] = append(bySimple[name], fn)
				}
			}
		}

		for _, caller := range pkgFuncs {
			seenCalls := map[string]struct{}{}
			seenRefs := map[string]struct{}{}
			seenSourceLinks := map[string]struct{}{}
			stack := make([]ast.Node, 0, 16)
			ast.Inspect(caller.decl.Body, func(n ast.Node) bool {
				if n == nil {
					if len(stack) > 0 {
						stack = stack[:len(stack)-1]
					}
					return false
				}
				var parent ast.Node
				if len(stack) > 0 {
					parent = stack[len(stack)-1]
				}
				stack = append(stack, n)

				addCallBacklink := func(callee *parsedFunction, line, col, rangeStart, rangeEnd int) {
					key := fmt.Sprintf("%s:%d:%d", callee.id, line, col)
					if _, ok := seenCalls[key]; ok {
						return
					}
					seenCalls[key] = struct{}{}
					callee.inspect.Backlinks = append(callee.inspect.Backlinks, Backlink{
						CallerID:       caller.id,
						CallerPackage:  caller.key.pkg,
						CallerFile:     caller.key.file,
						CallerFunction: caller.key.name,
						Line:           line,
						Column:         col,
					})
					sourceKey := fmt.Sprintf("%s:%d:%d:%d:%t", callee.id, line, rangeStart, rangeEnd, false)
					if _, ok := seenSourceLinks[sourceKey]; ok {
						return
					}
					seenSourceLinks[sourceKey] = struct{}{}
					caller.inspect.SourceLinks = append(caller.inspect.SourceLinks, SourceLink{
						TargetID:         callee.id,
						Line:             line,
						Column:           col,
						RangeStartColumn: rangeStart,
						RangeEndColumn:   rangeEnd,
						RequiresModifier: false,
					})
				}

				addReferenceBacklink := func(callee *parsedFunction, line, col, rangeStart, rangeEnd int) {
					key := fmt.Sprintf("%s:%d:%d", callee.id, line, col)
					if _, ok := seenRefs[key]; ok {
						return
					}
					seenRefs[key] = struct{}{}
					callee.inspect.ReferenceBacklinks = append(callee.inspect.ReferenceBacklinks, Backlink{
						CallerID:       caller.id,
						CallerPackage:  caller.key.pkg,
						CallerFile:     caller.key.file,
						CallerFunction: caller.key.name,
						Line:           line,
						Column:         col,
					})
					sourceKey := fmt.Sprintf("%s:%d:%d:%d:%t", callee.id, line, rangeStart, rangeEnd, true)
					if _, ok := seenSourceLinks[sourceKey]; ok {
						return
					}
					seenSourceLinks[sourceKey] = struct{}{}
					caller.inspect.SourceLinks = append(caller.inspect.SourceLinks, SourceLink{
						TargetID:         callee.id,
						Line:             line,
						Column:           col,
						RangeStartColumn: rangeStart,
						RangeEndColumn:   rangeEnd,
						RequiresModifier: true,
					})
				}

				switch node := n.(type) {
				case *ast.CallExpr:
					targets := resolveTargets(caller, node.Fun, bySimple, byMethod)
					pos := node.Pos()
					if node.Lparen != token.NoPos {
						pos = node.Lparen
					}
					callPos := fset.Position(pos)
					rangeStart, rangeEnd := rangeColumns(node)
					for _, callee := range targets {
						addCallBacklink(callee, callPos.Line, callPos.Column, rangeStart, rangeEnd)
					}
				case *ast.Ident:
					if node.Name == "_" {
						return true
					}
					if sel, ok := parent.(*ast.SelectorExpr); ok {
						if sel.X == node || sel.Sel == node {
							return true
						}
					}
					if call, ok := parent.(*ast.CallExpr); ok && call.Fun == node {
						return true
					}
					pos := fset.Position(node.Pos())
					rangeStart := pos.Column
					rangeEnd := pos.Column + len(node.Name)
					for _, callee := range resolveTargets(caller, node, bySimple, byMethod) {
						addReferenceBacklink(callee, pos.Line, pos.Column, rangeStart, rangeEnd)
					}
				case *ast.SelectorExpr:
					if call, ok := parent.(*ast.CallExpr); ok && call.Fun == node {
						return true
					}
					pos := fset.Position(node.Sel.Pos())
					rangeStart := pos.Column
					rangeEnd := pos.Column + len(node.Sel.Name)
					for _, callee := range resolveTargets(caller, node, bySimple, byMethod) {
						addReferenceBacklink(callee, pos.Line, pos.Column, rangeStart, rangeEnd)
					}
				}
				return true
			})
		}
	}

	for _, fn := range functions {
		sortBacklinks(fn.inspect.Backlinks)
		sortBacklinks(fn.inspect.ReferenceBacklinks)
		sortSourceLinks(fn.inspect.SourceLinks)
	}
}

func sortBacklinks(links []Backlink) {
	sort.Slice(links, func(i, j int) bool {
		if links[i].CallerID != links[j].CallerID {
			return links[i].CallerID < links[j].CallerID
		}
		if links[i].Line != links[j].Line {
			return links[i].Line < links[j].Line
		}
		return links[i].Column < links[j].Column
	})
}

func sortSourceLinks(links []SourceLink) {
	sort.Slice(links, func(i, j int) bool {
		if links[i].Line != links[j].Line {
			return links[i].Line < links[j].Line
		}
		if links[i].RangeStartColumn != links[j].RangeStartColumn {
			return links[i].RangeStartColumn < links[j].RangeStartColumn
		}
		if links[i].RangeEndColumn != links[j].RangeEndColumn {
			return links[i].RangeEndColumn < links[j].RangeEndColumn
		}
		if links[i].RequiresModifier != links[j].RequiresModifier {
			return !links[i].RequiresModifier
		}
		return links[i].TargetID < links[j].TargetID
	})
}
