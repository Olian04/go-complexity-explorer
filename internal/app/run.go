// Package app is the composition root invoked by cmd/. It wires the
// complexity domain to the configured transports and exposes one entrypoint
// per use case.
package app

import (
	"context"
	"log/slog"
	"time"

	"github.com/Olian04/go-complexity-explorer/internal/complexity"
	"github.com/Olian04/go-complexity-explorer/internal/transport/httpserver"
	"github.com/Olian04/go-complexity-explorer/internal/ui"
)

// AnalyzeOptions configures the "analyze and write JSON" use case.
type AnalyzeOptions struct {
	Root    string
	Include string
	Output  string
}

// AnalyzeAndWrite runs an analysis and writes the resulting dataset to disk.
func AnalyzeAndWrite(opts AnalyzeOptions) error {
	dataset, err := complexity.Analyze(complexity.Options{
		Root:    opts.Root,
		Include: opts.Include,
	})
	if err != nil {
		return err
	}
	return dataset.WriteJSON(opts.Output)
}

// ServeOptions configures the "analyze and serve over HTTP" use case.
type ServeOptions struct {
	Root    string
	Include string
	Addr    string
}

// Serve runs an analysis and serves the resulting dataset and the embedded
// UI over HTTP. It logs the analysis lifecycle and delegates per-request
// access logs and graceful shutdown to the httpserver package.
func Serve(ctx context.Context, opts ServeOptions, logger *slog.Logger) error {
	logger.Info("analysis started", "root", opts.Root, "include", opts.Include)
	start := time.Now()

	dataset, err := complexity.Analyze(complexity.Options{
		Root:    opts.Root,
		Include: opts.Include,
	})
	if err != nil {
		return err
	}

	logger.Info("analysis complete",
		"packages", countPackages(dataset),
		"functions", len(dataset.Functions),
		"duration", time.Since(start),
	)

	return httpserver.Serve(ctx, opts.Addr, dataset, ui.Files(), logger)
}

func countPackages(dataset complexity.Dataset) int {
	seen := make(map[string]struct{}, len(dataset.Functions))
	for _, fn := range dataset.Functions {
		seen[fn.Package] = struct{}{}
	}
	return len(seen)
}
