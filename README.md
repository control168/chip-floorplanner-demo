# Chip Floor Planner — Live Demo

瀏覽器版**晶片堆疊樓層擺盤工具**（2D ⇄ 3D），面向 3DFabric 之 CoWoS / InFO / SoIC 封裝疊構規劃。

> 此 repo 為**公開 demo 鏡像**（僅靜態檔），主開發倉庫為私有。

## 🔗 線上 Demo

- 完整工具：**https://control168.github.io/chip-floorplanner-demo/**
- 最小嵌入範例：**https://control168.github.io/chip-floorplanner-demo/embed-min.html**

## 嵌入到任何網站

函式庫**自我託管（self-host）於 `vendor/`**，與本工具放在同一 server 路徑，不依賴外部 CDN（離線可用、版本固定）。把 `vendor/` 與 `chip-floor-planner.js` 一起放到你的網站後：

```html
<script src="vendor/three@0.128.0/three.min.js"></script>
<script src="vendor/three@0.128.0/OrbitControls.js"></script>
<script src="vendor/xlsx@0.18.5/xlsx.full.min.js"></script>
<script src="chip-floor-planner.js"></script>

<chip-floor-planner style="display:block;width:100%;height:600px"></chip-floor-planner>
```

> `vendor/` 內含各函式庫的 `LICENSE`／`NOTICE`，散布時請整包保留。SheetJS（xlsx）為選用，未引入時仍可使用 CSV 規格表。

## 功能

元件庫拖放、分樓層設計、2D/3D 切換、元件旋轉、邊緣吸附、OBB 旋轉碰撞偵測、CSV/Excel 規格表匯入匯出、多設計方案、間隔標註、疊構剖面圖、面積利用率分析、BOM 匯出、量測工具、復原/重做。

技術：Three.js + WebGL · Web Component（Shadow DOM 隔離）· SheetJS（選用）。
