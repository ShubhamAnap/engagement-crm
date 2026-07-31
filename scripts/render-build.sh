#!/usr/bin/env bash
# Render Linux build — Windows package-lock omits Rolldown/Lightningcss natives.
set -euo pipefail

echo "==> Cleaning node_modules + package-lock (platform-native reinstall)"
rm -rf node_modules package-lock.json

echo "==> npm install (Linux optional natives included)"
npm install --include=dev

echo "==> Force Linux Rolldown + Lightningcss bindings"
npm install --force @rolldown/binding-linux-x64-gnu@1.2.1 lightningcss-linux-x64-gnu@1.33.0

# Vite may nest its own rolldown; copy binding next to it so require() resolves.
BINDING_SRC="node_modules/@rolldown/binding-linux-x64-gnu"
if [ -d "$BINDING_SRC" ]; then
  for dest in \
    "node_modules/@rolldown" \
    "node_modules/vite/node_modules/@rolldown" \
    "node_modules/rolldown/node_modules/@rolldown"
  do
    mkdir -p "$dest"
    rm -rf "$dest/binding-linux-x64-gnu"
    cp -R "$BINDING_SRC" "$dest/binding-linux-x64-gnu"
    echo "==> Placed binding at $dest/binding-linux-x64-gnu"
  done
fi

echo "==> vite build"
npm run build

echo "==> Verifying Nitro output"
test -f .output/server/index.mjs
echo "==> Build OK"
