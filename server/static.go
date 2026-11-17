package main

import (
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// staticHandler serves a built single-page app from dir. Paths without a file
// extension that match no file get index.html so client-side routes work.
// Names go through path.Clean and fs.FS, which cannot leave dir.
func staticHandler(fsys fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		f, info, ok := openFile(fsys, name)
		if !ok && path.Ext(name) == "" {
			name = "index.html"
			f, info, ok = openFile(fsys, name)
		}
		if !ok {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		rs, canSeek := f.(io.ReadSeeker)
		if !canSeek {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if strings.HasPrefix(name, "assets/") {
			// Vite names these by content hash, so they never change.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		http.ServeContent(w, r, name, info.ModTime(), rs)
	})
}

// openFile opens a regular file; directories (no listings) count as missing.
func openFile(fsys fs.FS, name string) (fs.File, fs.FileInfo, bool) {
	if name == "" {
		name = "index.html"
	}
	f, err := fsys.Open(name)
	if err != nil {
		return nil, nil, false
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		f.Close()
		return nil, nil, false
	}
	return f, info, true
}
