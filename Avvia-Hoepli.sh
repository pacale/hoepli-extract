#!/bin/sh
# Open the interactive menu on Linux and macOS.
cd "$(dirname "$0")" || exit 1
exec node "bin/hoepli.mjs" "$@"
