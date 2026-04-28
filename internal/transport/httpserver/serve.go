// Package httpserver exposes the complexity dataset and a static UI
// filesystem over HTTP. It marshals the dataset once at startup and serves
// the same payload to every /api/complexity request. The server supports
// graceful shutdown via the caller's context and emits structured access
// logs for every request.
package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"time"
)

// shutdownTimeout bounds how long Shutdown waits for in-flight requests to
// drain after the caller's context is cancelled.
const shutdownTimeout = 10 * time.Second

// Serve marshals data, then listens on addr and serves /api/complexity
// alongside the contents of uiFiles. Every request is logged via logger.
// Serve blocks until ctx is cancelled (then it gracefully shuts down) or
// the underlying ListenAndServe returns an error.
func Serve(ctx context.Context, addr string, data any, uiFiles fs.FS, logger *slog.Logger) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal dataset: %w", err)
	}

	fileServer := http.FileServer(http.FS(uiFiles))
	mux := http.NewServeMux()
	mux.HandleFunc("/api/complexity", func(w http.ResponseWriter, _ *http.Request) {
		setNoStoreHeaders(w)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write(payload)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		setNoStoreHeaders(w)
		fileServer.ServeHTTP(w, r)
	})

	srv := &http.Server{
		Addr:              addr,
		Handler:           accessLog(logger, mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	listenErr := make(chan error, 1)
	go func() {
		err := srv.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			listenErr <- err
			return
		}
		listenErr <- nil
	}()

	logger.Info("server listening", "url", "http://localhost"+addr)

	select {
	case <-ctx.Done():
		logger.Info("graceful shutdown started", "timeout", shutdownTimeout)
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		shutdownErr := srv.Shutdown(shutdownCtx)
		<-listenErr
		if shutdownErr != nil {
			logger.Error("graceful shutdown failed", "err", shutdownErr)
			return shutdownErr
		}
		logger.Info("graceful shutdown complete")
		return nil
	case err := <-listenErr:
		return err
	}
}

// accessLog wraps h with a middleware that emits one structured log line
// per request after the handler returns, capturing the response status
// code via a ResponseWriter shim.
func accessLog(logger *slog.Logger, h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		h.ServeHTTP(rec, r)
		logger.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration", time.Since(start),
		)
	})
}

// statusRecorder captures the response status code so accessLog can record
// it. The default of 200 matches net/http's behavior when a handler writes
// the body without explicitly calling WriteHeader.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func setNoStoreHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
}
