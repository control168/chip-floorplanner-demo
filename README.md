# Chip Floor Planner — Live Demo

瀏覽器版**晶片堆疊樓層擺盤工具**（2D ⇄ 3D），面向 3DFabric 之 CoWoS / InFO / SoIC 封裝疊構規劃。

> 此 repo 為**公開 demo 鏡像**（僅靜態檔），主開發倉庫為私有。

## 🔗 線上 Demo

- 完整工具：**https://control168.github.io/chip-floorplanner-demo/**
- 最小嵌入範例：**https://control168.github.io/chip-floorplanner-demo/embed-min.html**

## 嵌入到任何網站

```html
<script src="https://unpkg.com/three@0.128.0/build/three.min.js"></script>
<script src="https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
<script src="chip-floor-planner.js"></script>

<chip-floor-planner style="display:block;width:100%;height:600px"></chip-floor-planner>
```

## 功能

元件庫拖放、分樓層設計、2D/3D 切換、元件旋轉、邊緣吸附、OBB 旋轉碰撞偵測、CSV/Excel 規格表匯入匯出、多設計方案、間隔標註、疊構剖面圖、面積利用率分析、BOM 匯出、量測工具、復原/重做。

技術：Three.js + WebGL · Web Component（Shadow DOM 隔離）· SheetJS（選用）。
