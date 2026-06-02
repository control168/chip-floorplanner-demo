#!/usr/bin/env bash
# 下載第三方函式庫到 vendor/（self-host 打包用）。LICENSE / NOTICE 已預先備妥，請勿刪除。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "↓ three.js 0.128.0"
curl -fsSL "https://unpkg.com/three@0.128.0/build/three.min.js" -o "three@0.128.0/three.min.js"
curl -fsSL "https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js" -o "three@0.128.0/OrbitControls.js"

echo "↓ SheetJS xlsx 0.18.5"
curl -fsSL "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" -o "xlsx@0.18.5/xlsx.full.min.js"

echo "✓ 完成。請將 index.html 的 CDN <script> 改為 vendor/ 本機路徑（見 vendor/README.md）。"
