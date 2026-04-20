#!/usr/bin/env bash
# build.sh — assemble the deployment artefacts into dist/
# Only whitelisted files are copied; nothing else is ever published.
set -euo pipefail

DIST="dist"

# Clean previous build
rm -rf "$DIST"
mkdir -p "$DIST"

# Whitelist — add new front-end assets here explicitly
# Grouped by layer: Foundation → Core → Features → Bootstrap → Assets
WHITELIST=(
  index.html
  utils.js
  holidays.js
  entry-helpers.js
  firebase.js
  cache.js
  ui.js
  setup-auth.js
  app.js
  calendar.js
  booking.js
  availability.js
  admin.js
  settings.js
  offday-drive.js
  reports.js
  manager.js
  documents.js
  analytics.js
  events.js
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
