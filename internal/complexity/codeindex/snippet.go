package codeindex

import "go/token"

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
