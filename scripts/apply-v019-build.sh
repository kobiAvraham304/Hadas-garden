#!/usr/bin/env bash
set -euo pipefail

if grep -q '"version": "0.19.0"' package.json 2>/dev/null; then
  echo "v0.19.0 already applied"
  exit 0
fi

cat .deploy/v019.b64.part* > /tmp/v019.b64
base64 --decode /tmp/v019.b64 > /tmp/v019.patch.xz
xz --decompress --stdout /tmp/v019.patch.xz > /tmp/v019.patch
git apply --check --binary /tmp/v019.patch
git apply --binary --whitespace=nowarn /tmp/v019.patch

echo "v0.19.0 production patch applied"
node --check app.js
node --check api/index.js
