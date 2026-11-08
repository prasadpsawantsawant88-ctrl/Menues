#!/usr/bin/env bash
# Installs packages, builds and starts DineFlow.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. DineFlow needs Node.js 20 or newer: https://nodejs.org/en/download"
  exit 1
fi
echo "Installing DineFlow (first run needs internet, 1-3 minutes)..."
npm install --no-audit --no-fund && npm run build && node scripts/launch.mjs
