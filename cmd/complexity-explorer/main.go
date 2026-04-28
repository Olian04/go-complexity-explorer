package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/Olian04/go-complexity-explorer/cmd/complexity-explorer/version"
	"github.com/Olian04/go-complexity-explorer/internal/app"
	"github.com/urfave/cli/v3"
)

func main() {
	info := version.Resolve()
	cli.VersionPrinter = printVersion

	// The root command analyzes the target repo and serves the inspector
	// over HTTP. Running the binary with no subcommand performs this
	// default action. Two opt-in subcommands are available: `analyze`
	// writes a JSON snapshot to disk, and `view` serves the UI against a
	// previously-produced snapshot. Help is reachable via --help / -h (the
	// auto-generated `help` subcommand is hidden).
	root := &cli.Command{
		Name:            "complexity-explorer",
		Usage:           "Analyze a Go repo and serve the complexity explorer UI",
		Version:         info.Version,
		HideHelpCommand: true,
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:  "root",
				Usage: "repository root to analyze",
				Value: ".",
			},
			&cli.StringFlag{
				Name:  "include",
				Usage: "comma-separated directories under root to include",
				Value: ".",
			},
			&cli.StringFlag{
				Name:  "addr",
				Usage: "HTTP listen address",
				Value: ":8787",
			},
		},
		Action: runServe,
		Commands: []*cli.Command{
			analyzeCommand(),
			viewCommand(),
		},
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := root.Run(ctx, os.Args); err != nil {
		fmt.Fprintf(os.Stderr, "complexity-explorer: %v\n", err)
		os.Exit(1)
	}
}

func runServe(ctx context.Context, c *cli.Command) error {
	return app.Serve(ctx, app.ServeOptions{
		Root:    c.String("root"),
		Include: c.String("include"),
		Addr:    c.String("addr"),
	}, newLogger(c.Root().ErrWriter))
}

func newLogger(w io.Writer) *slog.Logger {
	if w == nil {
		w = os.Stderr
	}
	return slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{Level: slog.LevelInfo}))
}

func analyzeCommand() *cli.Command {
	return &cli.Command{
		Name:  "analyze",
		Usage: "Compute the complexity dataset and write it as JSON",
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:  "root",
				Usage: "repository root to analyze",
				Value: ".",
			},
			&cli.StringFlag{
				Name:  "include",
				Usage: "comma-separated directories under root to include",
				Value: ".",
			},
			&cli.StringFlag{
				Name:  "output",
				Usage: "output JSON file path",
			},
		},
		Action: runAnalyze,
	}
}

func runAnalyze(_ context.Context, c *cli.Command) error {
	output := strings.TrimSpace(c.String("output"))
	if output == "" {
		return errors.New("missing --output")
	}

	return app.AnalyzeAndWrite(app.AnalyzeOptions{
		Root:    c.String("root"),
		Include: c.String("include"),
		Output:  output,
	})
}

func viewCommand() *cli.Command {
	return &cli.Command{
		Name:  "view",
		Usage: "Serve the UI against a previously-produced JSON snapshot",
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:  "input",
				Usage: "JSON snapshot file produced by `analyze`",
			},
			&cli.StringFlag{
				Name:  "addr",
				Usage: "HTTP listen address",
				Value: ":8787",
			},
		},
		Action: runView,
	}
}

func runView(ctx context.Context, c *cli.Command) error {
	input := strings.TrimSpace(c.String("input"))
	if input == "" {
		return errors.New("missing --input")
	}

	return app.View(ctx, app.ViewOptions{
		Input: input,
		Addr:  c.String("addr"),
	}, newLogger(c.Root().ErrWriter))
}

func printVersion(cmd *cli.Command) {
	info := version.Resolve()
	_, err := fmt.Fprintf(cmd.Root().Writer, "%s version %s\nrevision %s\nbuild_time %s\n",
		cmd.Name, info.Version, info.Revision, info.BuildTime)
	if err != nil {
		_, _ = io.WriteString(os.Stderr, "write version failed\n")
	}
}
