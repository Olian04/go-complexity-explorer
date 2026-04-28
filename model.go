package complexitytreemap

import "go/ast"

type contributor struct {
	Kind      string `json:"kind"`
	StartLine int    `json:"start_line"`
	StartCol  int    `json:"start_col"`
	EndLine   int    `json:"end_line"`
	EndCol    int    `json:"end_col"`
}

type backlink struct {
	CallerID       string `json:"caller_id"`
	CallerPackage  string `json:"caller_package"`
	CallerFile     string `json:"caller_file"`
	CallerFunction string `json:"caller_function"`
	Line           int    `json:"line"`
	Column         int    `json:"column"`
}

type sourceLink struct {
	TargetID         string `json:"target_id"`
	Line             int    `json:"line"`
	Column           int    `json:"column"`
	RangeStartColumn int    `json:"range_start_col"`
	RangeEndColumn   int    `json:"range_end_col"`
	RequiresModifier bool   `json:"requires_modifier"`
}

type inspectData struct {
	ID                 string        `json:"id"`
	Package            string        `json:"package"`
	File               string        `json:"file"`
	Function           string        `json:"function"`
	NameVariants       []string      `json:"name_variants"`
	StartLine          int           `json:"start_line"`
	EndLine            int           `json:"end_line"`
	Source             string        `json:"source"`
	Contributors       []contributor `json:"contributors"`
	Backlinks          []backlink    `json:"backlinks"`
	ReferenceBacklinks []backlink    `json:"reference_backlinks"`
	SourceLinks        []sourceLink  `json:"source_links"`
}

type functionRow struct {
	ID         string      `json:"id"`
	Package    string      `json:"package"`
	File       string      `json:"file"`
	Function   string      `json:"function"`
	Cyclomatic int         `json:"cyclomatic"`
	Cognitive  int         `json:"cognitive"`
	Inspect    inspectData `json:"inspect"`
}

type dataset struct {
	GeneratedAt string                 `json:"generated_at"`
	Functions   []functionRow          `json:"functions"`
	Inspect     map[string]inspectData `json:"inspect_index"`
}

type functionKey struct {
	pkg  string
	file string
	name string
}

type parsedFunction struct {
	key          functionKey
	nameVariants []string
	id           string
	inspect      inspectData
	aliases      map[string]string
	decl         *ast.FuncDecl
}
