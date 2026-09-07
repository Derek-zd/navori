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
# Self-contained builder: podman builds/pushes business images inside the pod.
# podman is symlinked to docker so the engine's `docker` shell-outs work.
#
# This image runs podman ROOTFUL (container starts as root, no su-exec drop),
# matching aiops' proven deployment: the pod must run privileged so podman can
# mount the overlay storage driver. See examples/k8s/navori.yaml.
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
    && apk add --no-cache git kubectl podman fuse-overlayfs shadow ca-certificates tzdata \
    && ln -s /usr/bin/podman /usr/local/bin/docker \
    && mkdir -p /etc/containers \
    && printf '[storage]\ndriver = "overlay"\ngraphRoot = "/var/lib/containers/storage"\nrunRoot = "/run/containers/storage"\n' > /etc/containers/storage.conf
COPY --from=build /navori /usr/local/bin/navori
# Only runtime-mechanism env vars are baked in here. Business config
# (PORT/DB_*/MASTER_KEY/...) must come from config file or real env,
# NOT from image ENV — otherwise the image defaults would always override
# user config (env > config file by design). navori's code defaults apply when
# neither is set. DATA_DIR=/data only affects the container image (the bare
# binary inherits nothing here); user-set DATA_DIR still wins.
ENV DATA_DIR=/data \
    BUILDAH_FORMAT=docker \
    PODMAN_IGNORE_CGROUPSV1_WARNING=1
EXPOSE 3000
VOLUME ["/data"]
WORKDIR /data
ENTRYPOINT ["navori"]
