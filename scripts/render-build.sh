#!/usr/bin/env bash
# Render Linux build (Vite 7 — no Rolldown native binding required).
set -euo pipefail

echo "==> Clean install"
rm -rf node_modules
npm install --include=dev

echo "==> Force Linux Lightningcss native (Tailwind)"
npm install --force lightningcss-linux-x64-gnu@1.33.0 || true

echo "==> vite build"
npm run build

echo "==> Verifying Nitro output"
test -f .output/server/index.mjs
echo "==> Build OK"
