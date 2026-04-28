package main

import (
	"os"

	"github.com/Olian04/go-complexity-explorer/internal/app"
)

func main() {
	os.Exit(app.Run(os.Args[1:], os.Stdout, os.Stderr))
}
