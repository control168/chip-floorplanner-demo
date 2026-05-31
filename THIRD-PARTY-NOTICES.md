# Third-Party Notices / 第三方授權聲明

Chip Floor Planner 於執行時會載入下列第三方開源元件。這些元件**各自依其原開源授權條款**規範，**不在本專案專有授權（[LICENSE.md](LICENSE.md)）的範圍內**。本專案保留並尊重其著作權與授權聲明。

This product loads the following third-party open-source components. Each is governed by **its own open-source license** and is **not covered by this project's proprietary license** ([LICENSE.md](LICENSE.md)).

> 載入方式：以下元件目前皆由公開 CDN 於瀏覽器端載入，本專案未重新散布其檔案。
> Delivery: these components are loaded in the browser from public CDNs; this project does not redistribute their files.

---

## 1. three.js — MIT License

- 版本 / Version: 0.128.0
- 用途 / Use: WebGL 3D 渲染 / 3D rendering
- 來源 / Source: https://github.com/mrdoob/three.js — https://unpkg.com/three@0.128.0/
- Copyright © 2010–2024 three.js authors

```
The MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### 1b. three.js — OrbitControls（MIT，同上）

- 屬 three.js examples 一部分（`examples/js/controls/OrbitControls.js`），授權同 three.js（MIT）。
- Part of three.js examples; licensed under the same MIT License as three.js.

---

## 2. SheetJS Community Edition (xlsx) — Apache License 2.0

- 版本 / Version: 0.18.5
- 用途 / Use: Excel (.xlsx) 規格表匯入/匯出 / spreadsheet import-export（選用 optional）
- 來源 / Source: https://github.com/SheetJS/sheetjs — https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/
- Copyright © 2012–present SheetJS LLC
- License: Apache License, Version 2.0 — 全文 / full text: https://www.apache.org/licenses/LICENSE-2.0

> Apache-2.0 摘要：允許商業/專有使用；散布時須附上授權副本、保留著作權與授權聲明、標示重大修改，並保留 NOTICE 內容（若有）。本專案未修改 SheetJS，亦未重新散布其檔案。
> Apache-2.0 summary: permits commercial/proprietary use; on redistribution you must include a copy of the License, retain notices, state significant changes, and preserve any NOTICE. This project does not modify or redistribute SheetJS.

---

## 範圍說明 / Scope

- 本專案**原創部分**（`chip-floor-planner.js`、`index.html`、`embed-min.html`、`license.html`、文件、範例）採**專有授權**，見 [LICENSE.md](LICENSE.md)。
- 上述第三方元件**不受**該專有授權拘束，依其各自之 MIT / Apache-2.0 授權。
- The **original work** of this project is under a proprietary license ([LICENSE.md](LICENSE.md)); the third-party components above remain under their respective MIT / Apache-2.0 licenses.
