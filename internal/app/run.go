package app

import (
	"io"

	complexitytreemap "github.com/Olian04/go-complexity-explorer"
)

func Run(args []string, stdout, stderr io.Writer) int {
	return complexitytreemap.Execute(args, stdout, stderr)
}
