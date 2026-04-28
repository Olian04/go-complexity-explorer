// Package version exposes release and build metadata for CLI output. Values
// are populated either via -ldflags at build time or, as a fallback, from
// runtime/debug.ReadBuildInfo when the binary was built with module-aware
// VCS metadata.
package version

import "runtime/debug"

// Set via -ldflags "-X
// github.com/Olian04/go-complexity-explorer/cmd/complexity-explorer/version.<Var>=<value>".
var (
	Version   = "unknown"
	Revision  = "unknown"
	BuildTime = "unknown"
)

// Info is a snapshot of the binary's release and build metadata.
type Info struct {
	Version   string
	Revision  string
	BuildTime string
}

// Resolve returns the version metadata, preferring values set via ldflags
// and falling back to information embedded by the Go toolchain.
func Resolve() Info {
	return Info{
		Version:   resolveVersion(),
		Revision:  resolveRevision(),
		BuildTime: resolveBuildTime(),
	}
}

func resolveVersion() string {
	if Version != "unknown" {
		return Version
	}
	if bi, ok := debug.ReadBuildInfo(); ok {
		for _, s := range bi.Settings {
			if s.Key == "vcs.tag" && s.Value != "" {
				return s.Value
			}
		}
		if bi.Main.Version != "" {
			return bi.Main.Version
		}
		for _, dep := range bi.Deps {
			if dep.Path == "github.com/Olian04/go-complexity-explorer" && dep.Version != "" && dep.Version != "(devel)" {
				return dep.Version
			}
		}
	}
	return "unknown"
}

func resolveRevision() string {
	if Revision != "unknown" {
		return Revision
	}
	if bi, ok := debug.ReadBuildInfo(); ok {
		for _, s := range bi.Settings {
			if s.Key == "vcs.revision" && s.Value != "" {
				return s.Value
			}
		}
	}
	return "unknown"
}

func resolveBuildTime() string {
	if BuildTime != "unknown" {
		return BuildTime
	}
	if bi, ok := debug.ReadBuildInfo(); ok {
		for _, s := range bi.Settings {
			if s.Key == "vcs.time" && s.Value != "" {
				return s.Value
			}
		}
	}
	return "unknown"
}
