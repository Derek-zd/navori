#!/bin/sh
set -e

# Ensure the data directory (usually a mounted PVC) is owned by the runtime
# user so podman rootless + navori can write master.key / repos / logs / etc.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${DATA_DIR:-/data}"
  chown -R navori:navori "${DATA_DIR:-/data}"
  exec su-exec navori:navori navori "$@"
fi

exec navori "$@"
