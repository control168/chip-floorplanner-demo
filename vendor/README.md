# vendor/ — 自我託管第三方函式庫

正式版**已自我託管（self-host）** Three.js / OrbitControls / SheetJS 於此資料夾，`index.html` / `embed-min.html` 皆由本機 `vendor/` 路徑載入，**不依賴外部 CDN**（離線可用、版本固定、無第三方追蹤）。
散布本專案時請**整包保留此資料夾與每個函式庫的 `LICENSE`／`NOTICE`**。如需重新下載或升級版本，執行下方一鍵下載腳本。

## 目錄結構

```
vendor/
├── three@0.128.0/
│   ├── three.min.js          ✅ 已自我託管（MIT）
│   ├── OrbitControls.js      ✅ 已自我託管（MIT）
│   └── LICENSE               ✅ 已備（MIT，three.js authors）
└── xlsx@0.18.5/
    ├── xlsx.full.min.js      ✅ 已自我託管（Apache-2.0）
    ├── LICENSE               ✅ 已備（Apache-2.0，SheetJS LLC）
    └── NOTICE                ✅ 已備（Apache-2.0 attribution）
```

> ⚖️ **授權合規重點**：函式庫檔案已隨專案一起散布（不再連 CDN），MIT/Apache-2.0 的「散布時須附授權」義務生效——**`LICENSE`／`NOTICE` 檔必須與函式庫一起保留**，請勿刪除。

## 一鍵（重新）下載函式庫

函式庫已備妥；僅在需要**重新下載或升級版本**時執行：

```bash
# bash
./vendor/fetch-vendor.sh
```
```powershell
# Windows PowerShell
./vendor/fetch-vendor.ps1
```

## 載入方式（已套用）

`index.html` / `embed-min.html` 已改為由本機 `vendor/` 路徑載入，與本工具同一 server 路徑：

```html
<script src="vendor/three@0.128.0/three.min.js"></script>
<script src="vendor/three@0.128.0/OrbitControls.js"></script>
<script src="vendor/xlsx@0.18.5/xlsx.full.min.js"></script>
```

## 授權檔對應總表

| 函式庫 | 版本 | 授權 | 授權檔 |
|--------|------|------|--------|
| three.js | 0.128.0 | MIT | `three@0.128.0/LICENSE` |
| three.js OrbitControls | 0.128.0 | MIT（同上） | `three@0.128.0/LICENSE` |
| SheetJS / xlsx | 0.18.5 | Apache-2.0 | `xlsx@0.18.5/LICENSE` + `NOTICE` |

彙整聲明見專案根目錄 [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md)；本專案原創部分之授權見 [`LICENSE.md`](../LICENSE.md)。
