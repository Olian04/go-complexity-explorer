package complexitytreemap

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	gocyclo "github.com/fzipp/gocyclo"
	"github.com/uudashr/gocognit"
)

func Execute(args []string, stdout, stderr io.Writer) int {
	if len(args) < 1 {
		printUsage(stderr)
		return 2
	}

	switch args[0] {
	case "analyze":
		if err := runAnalyze(args[1:]); err != nil {
			fmt.Fprintf(stderr, "analyze: %v\n", err)
			return 1
		}
	case "serve":
		if err := runServe(args[1:], stdout); err != nil {
			fmt.Fprintf(stderr, "serve: %v\n", err)
			return 1
		}
	default:
		printUsage(stderr)
		return 2
	}
	return 0
}

func printUsage(w io.Writer) {
	fmt.Fprintln(w, `complexity-explorer

Subcommands:
  analyze  - compute complexity dataset and write JSON
  serve    - analyze and serve embedded web UI + /api/complexity

Examples:
  go run ./tools/complexity-treemap/cmd/complexity-explorer analyze --root . --include . --output ./complexity.json
  go run ./tools/complexity-treemap/cmd/complexity-explorer serve --root . --include . --addr :8787`)
}

func runAnalyze(args []string) error {
	fsFlags := flag.NewFlagSet("analyze", flag.ContinueOnError)
	root := fsFlags.String("root", ".", "repository root to analyze")
	include := fsFlags.String("include", ".", "comma-separated directories under root to include")
	output := fsFlags.String("output", "", "output JSON file path")
	if err := fsFlags.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*output) == "" {
		return errors.New("missing --output")
	}

	data, err := analyze(*root, parseIncludeDirs(*include))
	if err != nil {
		return err
	}
	return writeJSONFile(*output, data)
}

func runServe(args []string, stdout io.Writer) error {
	fsFlags := flag.NewFlagSet("serve", flag.ContinueOnError)
	root := fsFlags.String("root", ".", "repository root to analyze")
	include := fsFlags.String("include", ".", "comma-separated directories under root to include")
	addr := fsFlags.String("addr", ":8787", "HTTP listen address")
	if err := fsFlags.Parse(args); err != nil {
		return err
	}

	data, err := analyze(*root, parseIncludeDirs(*include))
	if err != nil {
		return err
	}
	payload, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal dataset: %w", err)
	}

	webRoot, err := fs.Sub(embeddedWeb, "web")
	if err != nil {
		return fmt.Errorf("embedded web fs: %w", err)
	}
	fileServer := http.FileServer(http.FS(webRoot))
	mux := http.NewServeMux()
	mux.HandleFunc("/api/complexity", func(w http.ResponseWriter, _ *http.Request) {
		setNoStoreHeaders(w)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write(payload)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		setNoStoreHeaders(w)
		fileServer.ServeHTTP(w, r)
	})

	fmt.Fprintf(stdout, "complexity-explorer listening on http://localhost%s\n", *addr)
	return http.ListenAndServe(*addr, mux)
}

func setNoStoreHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
}

func analyze(root string, includeDirs []string) (dataset, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return dataset{}, fmt.Errorf("resolve root: %w", err)
	}

	paths := existingIncludePaths(absRoot, includeDirs)
	if len(paths) == 0 {
		return dataset{}, fmt.Errorf("no include directories found under root %q", absRoot)
	}

	fset := token.NewFileSet()
	files, functions, byPackage, err := parseFilesAndFunctions(fset, absRoot, paths)
	if err != nil {
		return dataset{}, err
	}

	cycloMap := collectCyclomatic(absRoot, paths)
	cognMap := collectCognitive(absRoot, fset, files)
	resolveBacklinks(fset, functions, byPackage)

	rows := make([]functionRow, 0, len(functions))
	inspectIndex := make(map[string]inspectData, len(functions))
	for _, fn := range functions {
		cyclo := lookupMetric(cycloMap, fn)
		cogn := lookupMetric(cognMap, fn)
		row := functionRow{
			ID:         fn.id,
			Package:    fn.key.pkg,
			File:       fn.key.file,
			Function:   fn.key.name,
			Cyclomatic: cyclo,
			Cognitive:  cogn,
			Inspect:    fn.inspect,
		}
		rows = append(rows, row)
		inspectIndex[fn.id] = fn.inspect
	}

	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Package != rows[j].Package {
			return rows[i].Package < rows[j].Package
		}
		if rows[i].File != rows[j].File {
			return rows[i].File < rows[j].File
		}
		return rows[i].Function < rows[j].Function
	})

	return dataset{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Functions:   rows,
		Inspect:     inspectIndex,
	}, nil
}

func parseIncludeDirs(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, item := range parts {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		out = append(out, filepath.Clean(trimmed))
	}
	if len(out) == 0 {
		return []string{"."}
	}
	return out
}

func existingIncludePaths(root string, includeDirs []string) []string {
	paths := make([]string, 0, len(includeDirs))
	for _, rel := range includeDirs {
		abs := filepath.Join(root, rel)
		info, err := os.Stat(abs)
		if err != nil || !info.IsDir() {
			continue
		}
		paths = append(paths, abs)
	}
	return paths
}

func parseFilesAndFunctions(
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
				id := makeID(fileNode.Name.Name, relPath, fnName)
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
					inspect: inspectData{
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

func collectCyclomatic(root string, includePaths []string) map[functionKey]int {
	stats := gocyclo.Analyze(includePaths, nil)
	out := map[functionKey]int{}
	for _, stat := range stats {
		if strings.HasSuffix(stat.Pos.Filename, "_test.go") {
			continue
		}
		relPath, err := filepath.Rel(root, stat.Pos.Filename)
		if err != nil {
			continue
		}
		key := functionKey{
			pkg:  stat.PkgName,
			file: filepath.ToSlash(relPath),
			name: stat.FuncName,
		}
		out[key] = stat.Complexity
	}
	return out
}

func collectCognitive(root string, fset *token.FileSet, files []*ast.File) map[functionKey]int {
	var stats []gocognit.Stat
	for _, fileNode := range files {
		stats = gocognit.ComplexityStats(fileNode, fset, stats)
	}
	out := map[functionKey]int{}
	for _, stat := range stats {
		if strings.HasSuffix(stat.Pos.Filename, "_test.go") {
			continue
		}
		relPath, err := filepath.Rel(root, stat.Pos.Filename)
		if err != nil {
			continue
		}
		key := functionKey{pkg: stat.PkgName, file: filepath.ToSlash(relPath), name: stat.FuncName}
		out[key] = stat.Complexity
	}
	return out
}

func lookupMetric(metric map[functionKey]int, fn *parsedFunction) int {
	if value, ok := metric[fn.key]; ok {
		return value
	}
	for _, variant := range fn.nameVariants {
		key := functionKey{pkg: fn.key.pkg, file: fn.key.file, name: variant}
		if value, ok := metric[key]; ok {
			return value
		}
	}
	return 0
}

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
					callee.inspect.Backlinks = append(callee.inspect.Backlinks, backlink{
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
					caller.inspect.SourceLinks = append(caller.inspect.SourceLinks, sourceLink{
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
					callee.inspect.ReferenceBacklinks = append(callee.inspect.ReferenceBacklinks, backlink{
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
					caller.inspect.SourceLinks = append(caller.inspect.SourceLinks, sourceLink{
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
		sort.Slice(fn.inspect.Backlinks, func(i, j int) bool {
			if fn.inspect.Backlinks[i].CallerID != fn.inspect.Backlinks[j].CallerID {
				return fn.inspect.Backlinks[i].CallerID < fn.inspect.Backlinks[j].CallerID
			}
			if fn.inspect.Backlinks[i].Line != fn.inspect.Backlinks[j].Line {
				return fn.inspect.Backlinks[i].Line < fn.inspect.Backlinks[j].Line
			}
			return fn.inspect.Backlinks[i].Column < fn.inspect.Backlinks[j].Column
		})
		sort.Slice(fn.inspect.ReferenceBacklinks, func(i, j int) bool {
			if fn.inspect.ReferenceBacklinks[i].CallerID != fn.inspect.ReferenceBacklinks[j].CallerID {
				return fn.inspect.ReferenceBacklinks[i].CallerID < fn.inspect.ReferenceBacklinks[j].CallerID
			}
			if fn.inspect.ReferenceBacklinks[i].Line != fn.inspect.ReferenceBacklinks[j].Line {
				return fn.inspect.ReferenceBacklinks[i].Line < fn.inspect.ReferenceBacklinks[j].Line
			}
			return fn.inspect.ReferenceBacklinks[i].Column < fn.inspect.ReferenceBacklinks[j].Column
		})
		sort.Slice(fn.inspect.SourceLinks, func(i, j int) bool {
			if fn.inspect.SourceLinks[i].Line != fn.inspect.SourceLinks[j].Line {
				return fn.inspect.SourceLinks[i].Line < fn.inspect.SourceLinks[j].Line
			}
			if fn.inspect.SourceLinks[i].RangeStartColumn != fn.inspect.SourceLinks[j].RangeStartColumn {
				return fn.inspect.SourceLinks[i].RangeStartColumn < fn.inspect.SourceLinks[j].RangeStartColumn
			}
			if fn.inspect.SourceLinks[i].RangeEndColumn != fn.inspect.SourceLinks[j].RangeEndColumn {
				return fn.inspect.SourceLinks[i].RangeEndColumn < fn.inspect.SourceLinks[j].RangeEndColumn
			}
			if fn.inspect.SourceLinks[i].RequiresModifier != fn.inspect.SourceLinks[j].RequiresModifier {
				return !fn.inspect.SourceLinks[i].RequiresModifier
			}
			return fn.inspect.SourceLinks[i].TargetID < fn.inspect.SourceLinks[j].TargetID
		})
	}
}
