package main

import (
	"encoding/json"
	"go/token"
	"os"
	"path/filepath"
)

func snippet(src []byte, tokenFile *token.File, start, end token.Pos) string {
	if tokenFile == nil {
		return ""
	}
	startOff := tokenFile.Offset(start)
	endOff := tokenFile.Offset(end)
	if startOff < 0 || endOff < 0 || startOff >= len(src) || endOff > len(src) || startOff >= endOff {
		return ""
	}
	return string(src[startOff:endOff])
}

func writeJSONFile(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}
