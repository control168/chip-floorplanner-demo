# 下載第三方函式庫到 vendor/（self-host 打包用）。LICENSE / NOTICE 已預先備妥，請勿刪除。
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "↓ three.js 0.128.0"
Invoke-WebRequest "https://unpkg.com/three@0.128.0/build/three.min.js" -OutFile "three@0.128.0/three.min.js"
Invoke-WebRequest "https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js" -OutFile "three@0.128.0/OrbitControls.js"

Write-Host "↓ SheetJS xlsx 0.18.5"
Invoke-WebRequest "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" -OutFile "xlsx@0.18.5/xlsx.full.min.js"

Write-Host "✓ 完成。請將 index.html 的 CDN <script> 改為 vendor/ 本機路徑（見 vendor/README.md）。"
