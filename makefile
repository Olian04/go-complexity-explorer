.PHONY: help lint format test

help: ## Show available make targets
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_.-]+:.*##/ {printf "%-24s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

lint: ## Run go vet, module verify, govulncheck, gosec, golangci-lint
	go vet ./...
	go mod verify
	go tool govulncheck ./cmd/... ./internal/...
	go tool gosec -fmt text -stdout -quiet ./cmd/... ./internal/...
	golangci-lint run ./...

format: ## Run go fmt and gofmt
	go fmt ./...
	gofmt -w .

test: ## Run tests
	go test ./...

run: ## Run the application
	go run ./cmd/complexity-explorer