package main

import (
	"net/http"
	"time"
)

const pingInterval = 25 * time.Second

// events serves the SSE stream. The hub pushes frames into the connection's
// buffered channel; this goroutine only copies them to the wire.
func (a *api) events(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if !validToken(token) {
		writeErr(w, badRequest("missing or malformed token"))
		return
	}
	name := ""
	if raw := r.URL.Query().Get("name"); raw != "" {
		var err error
		if name, err = validateName(raw); err != nil {
			writeErr(w, err)
			return
		}
	}
	rc := http.NewResponseController(w)
	cn, err := a.h.Connect(token, name)
	if err != nil {
		writeErr(w, err)
		return
	}
	defer a.h.Detach(cn)

	hd := w.Header()
	hd.Set("Content-Type", "text/event-stream")
	hd.Set("Cache-Control", "no-store")
	hd.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	if rc.Flush() != nil {
		return
	}

	ping := time.NewTicker(pingInterval)
	defer ping.Stop()
	for {
		var msg []byte
		select {
		case msg = <-cn.ch:
		case <-ping.C:
			msg = []byte(": ping\n\n")
		case <-cn.done:
			return
		case <-r.Context().Done():
			return
		}
		if _, err := w.Write(msg); err != nil || rc.Flush() != nil {
			return
		}
	}
}
