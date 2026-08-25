#!/usr/bin/env bash
set -euo pipefail

mkdir -p "${DSH_HOME}"
# Run the compiled official CLI. The build stage has already generated and
# verified the Host, Typert Client, and Vite artifacts.
exec node --expose-internals /opt/dps/apps/cli/lib/bin.js "$@"
