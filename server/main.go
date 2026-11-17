// Command cafe serves the built web app and the room API from memory.
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// newHandler combines the API and the static site on one mux.
func newHandler(h *hub, p *profileStore, staticDir string) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/api/", newAPI(h, p))
	mux.Handle("/", staticHandler(os.DirFS(staticDir)))
	return mux
}

func main() {
	port := flag.String("port", envOr("PORT", "8080"), "listen port (env PORT)")
	static := flag.String("static", envOr("STATIC_DIR", "./public"), "static files directory (env STATIC_DIR)")
	data := flag.String("data", envOr("DATA_DIR", "./data"), "data directory for profiles.json (env DATA_DIR)")
	flag.Parse()

	h := newHub(time.Now, log.Printf)
	profiles := openProfiles(*data, time.Now, log.Printf)
	stop := make(chan struct{})
	go h.runJanitor(5*time.Second, stop)

	// ReadHeaderTimeout guards against slow-header clients. There is no
	// WriteTimeout because it would cut off long-lived SSE streams.
	srv := &http.Server{
		Addr:              ":" + *port,
		Handler:           newHandler(h, profiles, *static),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	// Open streams would otherwise hold Shutdown until its deadline.
	srv.RegisterOnShutdown(h.CloseStreams)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer cancel()
	go func() {
		<-ctx.Done()
		sctx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = srv.Shutdown(sctx)
	}()

	log.Printf("listening on :%s, serving %s", *port, *static)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	close(stop)
}
