#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/data}"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"

if [ "$(id -u)" = "0" ]; then
  # Started as root (plain docker run / K8s without runAsNonRoot):
  # fix ownership of the data dir (covers root-owned PVC mounts) and the
  # podman rootless runtime dir, then drop to the navori user.
  mkdir -p "${DATA_DIR}" "${RUNTIME_DIR}"
  chown -R navori:navori "${DATA_DIR}"
  chown navori:navori "${RUNTIME_DIR}"
  chmod 0700 "${RUNTIME_DIR}"
  exec su-exec navori:navori navori "$@"
fi

# Started as the navori user directly (K8s runAsNonRoot: 1000).
# The data dir must already be writable by uid 1000 (fsGroup / initContainer).
if [ ! -d "${RUNTIME_DIR}" ]; then
  mkdir -p "${RUNTIME_DIR}" 2>/dev/null || true
fi
exec navori "$@"
