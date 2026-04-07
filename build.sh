#!/usr/bin/env bash
# build.sh — assemble the deployment artefacts into dist/
# Only whitelisted files are copied; nothing else is ever published.
set -euo pipefail

DIST="dist"

# Clean previous build
rm -rf "$DIST"
mkdir -p "$DIST"

# Whitelist — add new front-end assets here explicitly
WHITELIST=(
  index.html
  app.js
  style.css
  coradam-logo.png
  favicon-192.png
  favicon.ico
  CNAME
)

for FILE in "${WHITELIST[@]}"; do
  if [ -f "$FILE" ]; then
    cp "$FILE" "$DIST/$FILE"
    echo "✓ copied $FILE"
  else
    echo "WARNING: $FILE not found, skipping"
  fi
done

echo "Build complete → $DIST/"
