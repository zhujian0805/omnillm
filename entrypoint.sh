#!/bin/sh
if [ "$1" = "--auth" ]; then
  # Run auth command
  exec bun dist/main.js auth
else
  # Default command
  exec bun dist/main.js start -g "$GH_TOKEN" "$@"
fi

