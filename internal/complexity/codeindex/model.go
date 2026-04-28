package codeindex

import "go/ast"

// Contributor is an AST node that contributes to a function's
// cyclomatic/cognitive complexity (control flow, case clauses, short-circuit
// boolean operators).
type Contributor struct {
	Kind      string `json:"kind"`
	StartLine int    `json:"start_line"`
	StartCol  int    `json:"start_col"`
	EndLine   int    `json:"end_line"`
	EndCol    int    `json:"end_col"`
}

// Backlink is an inbound reference to a function from another function: the
// caller's identity plus the source position of the reference.
type Backlink struct {
	CallerID       string `json:"caller_id"`
	CallerPackage  string `json:"caller_package"`
	CallerFile     string `json:"caller_file"`
	CallerFunction string `json:"caller_function"`
	Line           int    `json:"line"`
	Column         int    `json:"column"`
}

// SourceLink describes a clickable region in a function's source view that
// links to another function.
type SourceLink struct {
	TargetID         string `json:"target_id"`
	Line             int    `json:"line"`
	Column           int    `json:"column"`
	RangeStartColumn int    `json:"range_start_col"`
	RangeEndColumn   int    `json:"range_end_col"`
	RequiresModifier bool   `json:"requires_modifier"`
}

// InspectData is the inspector payload for a single function: its identity,
// source slice, control-flow contributors, and backlinks.
type InspectData struct {
	ID                 string        `json:"id"`
	Package            string        `json:"package"`
	File               string        `json:"file"`
	Function           string        `json:"function"`
	NameVariants       []string      `json:"name_variants"`
	StartLine          int           `json:"start_line"`
	EndLine            int           `json:"end_line"`
	Source             string        `json:"source"`
	Contributors       []Contributor `json:"contributors"`
	Backlinks          []Backlink    `json:"backlinks"`
	ReferenceBacklinks []Backlink    `json:"reference_backlinks"`
	SourceLinks        []SourceLink  `json:"source_links"`
}

// Function is the codeindex view of a parsed Go function: identity, all the
// names it can be referenced by, and the inspector payload.
type Function struct {
	ID           string
	Package      string
	File         string
	Function     string
	NameVariants []string
	Inspect      InspectData
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
	inspect      InspectData
	aliases      map[string]string
	decl         *ast.FuncDecl
}
