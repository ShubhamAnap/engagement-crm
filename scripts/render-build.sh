#!/usr/bin/env bash
# Render Linux build (Vite 7 + Nitro).
set -euo pipefail

echo "==> Install dependencies"
# Prefer npm ci when lock is valid; fall back to install (Render cache can desync strict ci).
if [ -f package-lock.json ] && npm ci --include=dev --no-audit --no-fund; then
  echo "==> npm ci OK"
else
  echo "==> npm ci skipped or failed — running npm install"
  npm install --include=dev --no-audit --no-fund
fi

echo "==> Linux Lightningcss native (Tailwind)"
npm install --force lightningcss-linux-x64-gnu@1.33.0 --no-audit --no-fund || true

echo "==> vite build (Render — raised Node heap, reduced Rollup parallelism)"
# Default Node heap (~2GB) OOMs on Vite+Nitro "rendering chunks"; Render build VMs have more RAM.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
npm run build:render

echo "==> Verifying Nitro output"
test -f .output/server/index.mjs
echo "==> Build OK"
