# ---- frontend build ----
FROM node:20-alpine AS fe
WORKDIR /src
COPY web/package.json web/package-lock.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# ---- go build ----
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=fe /src/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -o /navori ./cmd/server

# ---- runtime ----
FROM alpine:3.20
# Self-contained builder: podman rootless + fuse-overlayfs can build images
# fully in userspace — no host docker socket, no privileged container
# (DESIGN §4.1). podman is symlinked to docker so the engine's `docker`
# shell-outs just work. shadow provides useradd for the non-root runner user.
RUN apk add --no-cache git kubectl podman fuse-overlayfs shadow su-exec ca-certificates tzdata \
    && ln -s /usr/bin/podman /usr/local/bin/docker \
    && mkdir -p /etc/containers \
    && printf '[storage]\ndriver = "overlay"\ngraphRoot = "/var/lib/containers/storage"\nrunRoot = "/run/containers/storage"\n' > /etc/containers/storage.conf
# Run as a non-root user so podman rootless works (needs subuid/subgid range).
RUN adduser -D -u 1000 navori && \
    echo "navori:100000:65536" >> /etc/subuid && \
    echo "navori:100000:65536" >> /etc/subgid
COPY --from=build /navori /usr/local/bin/navori
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENV PORT=3000 \
    DB_DRIVER=sqlite \
    DB_PATH=/data/navori.db \
    DATA_DIR=/data \
    XDG_RUNTIME_DIR=/run/user/1000 \
    _CONTAINERS_USERNS_CONFIGURED="" \
    BUILDAH_FORMAT=docker
EXPOSE 3000
VOLUME ["/data"]
WORKDIR /data
USER navori
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
