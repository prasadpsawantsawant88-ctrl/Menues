#!/usr/bin/env bash
# Starts DineFlow and prints the addresses.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. DineFlow needs Node.js 20 or newer: https://nodejs.org/en/download"
  exit 1
fi
node scripts/launch.mjs
