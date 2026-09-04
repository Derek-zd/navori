# ---- frontend build ----
# Override for slow networks, e.g.:
#   docker build --build-arg NPM_REGISTRY=https://registry.npmmirror.com .
ARG NPM_REGISTRY=https://registry.npmjs.org
FROM node:20-alpine AS fe
ARG NPM_REGISTRY
WORKDIR /src
COPY web/package.json web/package-lock.json ./
RUN npm ci --registry=$NPM_REGISTRY --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- go build ----
# Override for slow networks, e.g.:
#   docker build --build-arg GOPROXY=https://goproxy.cn,direct .
ARG GOPROXY=https://proxy.golang.org,direct
FROM golang:1.24-alpine AS build
ARG GOPROXY
WORKDIR /src
ENV GOPROXY=$GOPROXY CGO_ENABLED=0
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=fe /src/dist ./web/dist
RUN go build -trimpath -o /navori ./cmd/server

# ---- runtime ----
# Override apk mirror for slow networks, e.g.:
#   docker build --build-arg ALPINE_MIRROR=https://mirrors.aliyun.com/alpine .
ARG ALPINE_MIRROR=https://dl-cdn.alpinelinux.org/alpine
FROM alpine:3.20
ARG ALPINE_MIRROR
# Self-contained builder: podman rootless + fuse-overlayfs can build images
# fully in userspace — no host docker socket, no privileged container
# (DESIGN §4.1). podman is symlinked to docker so the engine's `docker`
# shell-outs just work. shadow provides useradd for the non-root runner user.
RUN printf '%s/v3.20/main\n%s/v3.20/community\n' "$ALPINE_MIRROR" "$ALPINE_MIRROR" > /etc/apk/repositories \
    && apk add --no-cache git kubectl podman fuse-overlayfs shadow su-exec ca-certificates tzdata \
    && ln -s /usr/bin/podman /usr/local/bin/docker \
    && mkdir -p /etc/containers \
    && printf '[storage]\ndriver = "overlay"\ngraphRoot = "/var/lib/containers/storage"\nrunRoot = "/run/containers/storage"\n' > /etc/containers/storage.conf
# Run as a non-root user so podman rootless works (needs subuid/subgid range).
RUN adduser -D -u 1000 navori && \
    echo "navori:100000:65536" >> /etc/subuid && \
    echo "navori:100000:65536" >> /etc/subgid
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
    BUILDAH_FORMAT=docker
EXPOSE 3000
# NOTE: no USER directive on purpose — entrypoint starts as root, chowns the
# data/runtime dirs (covers PVC mounts), then drops to navori via su-exec.
VOLUME ["/data"]
WORKDIR /data
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
