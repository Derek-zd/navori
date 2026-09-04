# ---- frontend build ----
# Override for slow networks, e.g.:
#   docker build --build-arg NPM_REGISTRY=https://registry.npmmirror.com .
FROM node:20-alpine AS fe
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /src
COPY web/package.json web/package-lock.json ./
RUN npm ci --registry=$NPM_REGISTRY --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- go build ----
# Override for slow networks, e.g.:
#   docker build --build-arg GOPROXY=https://goproxy.cn,direct .
FROM golang:1.24-alpine AS build
ARG GOPROXY=https://proxy.golang.org,direct
WORKDIR /src
ENV GOPROXY=$GOPROXY CGO_ENABLED=0
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=fe /src/dist ./web/dist
RUN go build -trimpath -o /navori ./cmd/server

# ---- runtime ----
# Self-contained builder: podman rootless builds/pushes business images inside
# the pod — no host docker socket, no privileged container (DESIGN §4.1).
# podman is symlinked to docker so the engine's `docker` shell-outs work.
#
# Storage driver: vfs. Rootless overlay/fuse-overlayfs needs unprivileged
# mounts which managed K8s nodes usually deny ("configure storage: mount ...
# permission denied"). vfs performs no mounts at all — slow but works on any
# cluster. graphRoot lives under /data (writable, PVC-able).
#
# ALPINE_MIRROR: only rewrite /etc/apk/repositories when explicitly set, e.g.
#   docker build --build-arg ALPINE_MIRROR=https://mirrors.aliyun.com/alpine .
# The official alpine image already ships main + community pointing at
# dl-cdn.alpinelinux.org, so the default needs no rewrite.
FROM alpine:3.20
ARG ALPINE_MIRROR=
RUN if [ -n "$ALPINE_MIRROR" ]; then \
      printf '%s/v3.20/main\n%s/v3.20/community\n' "$ALPINE_MIRROR" "$ALPINE_MIRROR" > /etc/apk/repositories; \
    fi \
    && apk add --no-cache git kubectl podman fuse-overlayfs shadow su-exec ca-certificates tzdata \
    && ln -s /usr/bin/podman /usr/local/bin/docker \
    && mkdir -p /etc/containers \
    && printf '[storage]\ndriver = "vfs"\ngraphRoot = "/data/containers/storage"\nrunRoot = "/run/user/1000/containers"\n' > /etc/containers/storage.conf
# Run as a non-root user so podman rootless works (needs subuid/subgid range).
RUN adduser -D -u 1000 navori && \
    echo "navori:100000:65536" >> /etc/subuid && \
    echo "navori:100000:65536" >> /etc/subgid
# Rootless podman reads the per-user storage.conf (overrides /etc); point it
# at the same vfs setup so both code paths agree.
RUN mkdir -p /home/navori/.config/containers \
    && printf '[storage]\ndriver = "vfs"\ngraphRoot = "/data/containers/storage"\nrunRoot = "/run/user/1000/containers"\n' > /home/navori/.config/containers/storage.conf \
    && chown -R navori:navori /home/navori/.config
# Pre-create writable dirs owned by navori as a fallback; entrypoint re-chowns
# DATA_DIR and XDG_RUNTIME_DIR at boot when started as root (mounts are root-owned).
RUN mkdir -p /data /run/user/1000 && chown -R navori:navori /data /run/user/1000
COPY --from=build /navori /usr/local/bin/navori
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENV PORT=3000 \
    DB_DRIVER=sqlite \
    DB_PATH=/data/navori.db \
    DATA_DIR=/data \
    XDG_RUNTIME_DIR=/run/user/1000 \
    _CONTAINERS_USERNS_CONFIGURED="" \
    BUILDAH_FORMAT=docker \
    # chroot isolation: builds RUN steps without mount namespaces, so image
    # builds work on managed K8s / unprivileged runtimes that deny
    # unprivileged proc/overlay mounts ("mount proc: Operation not permitted").
    BUILDAH_ISOLATION=chroot \
    PODMAN_IGNORE_CGROUPSV1_WARNING=1
EXPOSE 3000
# NOTE: no USER directive on purpose — entrypoint starts as root, chowns the
# data/runtime dirs (covers PVC mounts), then drops to navori via su-exec.
VOLUME ["/data"]
WORKDIR /data
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
