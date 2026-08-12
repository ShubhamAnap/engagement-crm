#!/usr/bin/env bash
# Render Linux build (Vite 7 + Nitro). Keep peak memory low — avoid rm -rf node_modules each deploy.
set -euo pipefail

echo "==> Install dependencies"
if [ -f package-lock.json ]; then
  npm ci --include=dev --no-audit --no-fund
else
  npm install --include=dev --no-audit --no-fund
fi

echo "==> Linux Lightningcss native (Tailwind)"
npm install --force lightningcss-linux-x64-gnu@1.33.0 --no-audit --no-fund || true

echo "==> vite build"
npm run build

echo "==> Verifying Nitro output"
test -f .output/server/index.mjs
echo "==> Build OK"
