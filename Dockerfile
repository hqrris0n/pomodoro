# Builds the web app and the server, and ships both in an empty image:
# one static binary plus the built site.

# The build stages run on the build machine's own architecture; only the
# final binary is cross-compiled for the target (the NAS is linux/amd64).
FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts
COPY web/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS server
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY server/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-s -w" -o /cafe .
# An empty data directory to copy into the scratch image (it has no mkdir).
RUN mkdir -p /out/data

FROM scratch
COPY --from=server /cafe /cafe
COPY --from=web /web/dist /public
# Profiles live in /data. Owned by the runtime user so a fresh named volume,
# which copies this ownership, is writable.
COPY --from=server --chown=65534:65534 /out/data /data
ENV PORT=8080 STATIC_DIR=/public DATA_DIR=/data
# Keep the Go runtime's heap small; the server holds a few kilobytes of state.
ENV GOMEMLIMIT=24MiB
USER 65534:65534
EXPOSE 8080
ENTRYPOINT ["/cafe"]
