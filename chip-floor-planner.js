/* =============================================================================
 * Chip Floor Planner  —  晶片堆疊樓層擺盤工具 (2D ⇄ 3D)
 *
 * Copyright © 2026 Curtis (control168 · control.tw@gmail.com). All Rights Reserved.
 * 專有授權（非開源）：須經作者書面授權方得使用，且授權得由作者隨時撤銷。
 * Proprietary — use only under the Author's written authorization, revocable at any
 * time. 詳見 / See LICENSE.md or license.html. 授權洽詢：control.tw@gmail.com
 * -----------------------------------------------------------------------------
 * 可外掛的 Web Component。用法：
 *   <script src="vendor/three@0.128.0/three.min.js"></script>
 *   <script src="vendor/three@0.128.0/OrbitControls.js"></script>
 *   <script src="chip-floor-planner.js"></script>
 *   <chip-floor-planner></chip-floor-planner>
 *
 * 渲染：Three.js + WebGL（最快 GPU 路徑）。樣式以 Shadow DOM 隔離，不污染宿主頁面。
 * 元件庫依 TSMC 3DFabric 之 CoWoS / InFO / SoIC 封裝結構建立。
 * ===========================================================================*/
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // 1. 元件目錄（依 TSMC 3DFabric 封裝技術）
  //    尺寸單位為「格」(arbitrary unit ≈ mm)，h = 厚度。
  // ---------------------------------------------------------------------------
  const CATALOG = {
    CoWoS: {
      color: '#3b82f6',
      desc: 'Chip-on-Wafer-on-Substrate：矽中介層整合 Logic + HBM',
      parts: [
        { type: 'substrate',  name: 'Package Substrate', w: 70, d: 70, h: 5,  color: '#1e3a5f' },
        { type: 'c4bump',     name: 'C4 Bump Array',     w: 58, d: 58, h: 1,  color: '#6b7280' },
        { type: 'interposer', name: 'Silicon Interposer',w: 58, d: 58, h: 3,  color: '#2563eb' },
        { type: 'logic',      name: 'Logic Die (SoC)',   w: 20, d: 20, h: 4,  color: '#60a5fa' },
        { type: 'hbm',        name: 'HBM Stack',         w: 11, d: 13, h: 8,  color: '#93c5fd' },
      ],
    },
    InFO: {
      color: '#10b981',
      desc: 'Integrated Fan-Out：無基板，扇出型 RDL 走線',
      parts: [
        { type: 'rdl',     name: 'RDL Layer',        w: 50, d: 50, h: 1.5, color: '#065f46' },
        { type: 'logic',   name: 'Logic Die',        w: 18, d: 18, h: 4,   color: '#34d399' },
        { type: 'lsi',     name: 'LSI Bridge',       w: 10, d: 22, h: 1.5, color: '#a7f3d0' },
        { type: 'mold',    name: 'Molding Compound', w: 52, d: 52, h: 6,   color: '#047857' },
        { type: 'solder',  name: 'Solder Ball Array',w: 50, d: 50, h: 2,   color: '#6b7280' },
      ],
    },
    SoIC: {
      color: '#f59e0b',
      desc: 'System-on-Integrated-Chip：無凸塊 3D 混合鍵合堆疊',
      parts: [
        { type: 'basedie', name: 'Base Die / Wafer', w: 34, d: 34, h: 5,   color: '#92400e' },
        { type: 'bond',    name: 'Hybrid Bond',      w: 26, d: 26, h: 0.6, color: '#fcd34d' },
        { type: 'topdie',  name: 'Top Die',          w: 26, d: 26, h: 4,   color: '#fbbf24' },
        { type: 'tsv',     name: 'TSV Array',        w: 26, d: 26, h: 4,   color: '#f59e0b' },
      ],
    },
  };

  let _uid = 1;
  const uid = () => 'c' + (_uid++);
  const bumpUid = (n) => { if (isFinite(n) && n + 1 > _uid) _uid = n + 1; };  // 避免還原後 id 撞號

  // localStorage 鍵（進度儲存）
  const LS_AUTO = 'chip-floorplanner:autosave';
  const LS_SAVES = 'chip-floorplanner:saves';

  // ---------------------------------------------------------------------------
  // 1b. CSV 解析（支援雙引號內含逗號/換行）
  // ---------------------------------------------------------------------------
  function parseCSV(text) {
    const rows = []; let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch !== '\r') field += ch;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // 內建標準範例規格表（TSMC CoWoS HBM 封裝堆疊，尺寸為示意 mm）
  // 座標 x/y 以「左下角原點」為基準（與工具預設一致）；grid=格距(µm)
  const EXAMPLE_SPEC =
`floor,floor_w,floor_d,floor_h,grid,thickness,category,component,width,depth,height,x,y,z,rotation,gap_note
Substrate Level,55,55,3,1,,CoWoS,Package Substrate,55,55,3,27.5,27.5,0,0,Organic build-up substrate (BGA)
Interposer Level,55,55,2.5,1,,CoWoS,C4 Bump Array,50,50,0.5,27.5,27.5,0,0,Substrate-to-interposer C4 bumps
Interposer Level,,,,,,CoWoS,Silicon Interposer,50,50,1.5,27.5,27.5,0.5,0,TSV silicon interposer (>1.2x reticle)
Die/HBM Level,55,55,9,1,,CoWoS,Logic Die (SoC/GPU),24,24,4,27.5,27.5,0,0,Main compute die (chiplet)
Die/HBM Level,,,,,,CoWoS,HBM Stack 1,11,11,8,47.5,19.5,0,0,12-Hi DRAM cube; ~0.4mm to logic
Die/HBM Level,,,,,,CoWoS,HBM Stack 2,11,11,8,47.5,35.5,0,0,12-Hi DRAM cube
Die/HBM Level,,,,,,CoWoS,HBM Stack 3,11,11,8,7.5,19.5,0,0,12-Hi DRAM cube
Die/HBM Level,,,,,,CoWoS,HBM Stack 4,11,11,8,7.5,35.5,0,0,12-Hi DRAM cube
`;

  // ---------------------------------------------------------------------------
  // 2. 樣式（注入 Shadow DOM）
  // ---------------------------------------------------------------------------
  const CSS = `
  :host { all: initial; display: block; width: 100%; height: 100%;
          font-family: -apple-system, "Segoe UI", "Microsoft JhengHei", sans-serif; }
  * { box-sizing: border-box; }
  .app { display: flex; width: 100%; height: 100%; min-height: 480px;
         background: #0f172a; color: #e2e8f0; position: relative; overflow: hidden; }

  /* 左側元件庫 */
  .sidebar { width: 230px; flex: none; background: #1e293b; border-right: 1px solid #334155;
             display: flex; flex-direction: column; }
  .sidebar h2 { margin: 0; padding: 12px 14px; font-size: 13px; letter-spacing: .5px;
                color: #94a3b8; border-bottom: 1px solid #334155; text-transform: uppercase; }
  .lib { overflow-y: auto; flex: 1; padding: 6px; }
  .cat { margin-bottom: 6px; }
  .cat-head { display: flex; align-items: center; gap: 6px; padding: 7px 8px; cursor: pointer;
              border-radius: 6px; font-weight: 600; font-size: 13px; }
  .cat-head:hover { background: #334155; }
  .cat-dot { width: 10px; height: 10px; border-radius: 3px; flex: none; }
  .cat-desc { font-size: 10px; color: #64748b; padding: 0 8px 4px 24px; line-height: 1.35; }
  .item { display: flex; align-items: center; gap: 9px; padding: 6px 8px; margin: 2px 0;
          border-radius: 6px; cursor: grab; background: #0f172a; border: 1px solid #334155; }
  .item:hover { border-color: #64748b; }
  .item:active { cursor: grabbing; }
  .thumb { width: 30px; height: 24px; flex: none; border-radius: 3px; position: relative;
           transform-style: preserve-3d; }
  .thumb::before { content:''; position:absolute; inset:0; border-radius:3px;
                   background: var(--c); transform: skewX(-18deg) scaleY(.8); filter: brightness(.75); }
  .thumb::after { content:''; position:absolute; left:4px; right:-4px; top:-5px; height:9px;
                  background: var(--c); border-radius:3px; transform: skewX(-18deg); filter: brightness(1.25); }
  .item-meta { min-width: 0; }
  .item-name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-size { font-size: 10px; color: #64748b; }

  /* 主區 */
  .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px;
             background: #1e293b; border-bottom: 1px solid #334155; flex-wrap: wrap; }
  .btn { background: #334155; color: #e2e8f0; border: 1px solid #475569; border-radius: 6px;
         padding: 6px 11px; font-size: 12px; cursor: pointer; }
  .btn:hover { background: #475569; }
  .btn.on { background: #3b82f6; border-color: #3b82f6; color: #fff; }
  .sep { width: 1px; height: 22px; background: #334155; }
  .sel { background: #0f172a; color: #e2e8f0; border: 1px solid #475569; border-radius: 6px;
         padding: 5px 8px; font-size: 12px; cursor: pointer; }
  .hinttxt { font-size: 11px; color: #64748b; }
  .toast { position: absolute; right: 12px; bottom: 42px; background: rgba(15,23,42,.92);
           color: #86efac; border: 1px solid #334155; padding: 6px 12px; border-radius: 8px;
           font-size: 12px; opacity: 0; transition: opacity .25s; pointer-events: none; z-index: 45; }
  .toast.on { opacity: 1; }
  .save-row { display: flex; align-items: center; gap: 6px; padding: 5px 4px; border-bottom: 1px solid #334155; }
  .sv-name { flex: 1; min-width: 0; font-size: 12px; line-height: 1.3; }
  .sv-name small { color: #64748b; font-size: 10px; }
  .field { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #94a3b8; }
  .field input { width: 56px; background: #0f172a; color: #e2e8f0; border: 1px solid #475569;
                 border-radius: 5px; padding: 4px 6px; font-size: 12px; }
  .tabs { display: flex; gap: 4px; padding: 6px 12px 0; background: #1e293b; }
  .tab { padding: 6px 12px; font-size: 12px; border-radius: 6px 6px 0 0; cursor: pointer;
         background: #0f172a; border: 1px solid #334155; border-bottom: none; color: #94a3b8; }
  .tab.on { background: #0f172a; color: #fff; border-color: #3b82f6; }
  .tab .x { margin-left: 6px; color: #64748b; }
  .tab .x:hover { color: #ef4444; }

  .stage { flex: 1; position: relative; background: #0f172a; }
  canvas { display: block; width: 100%; height: 100%; }
  /* CSS3D 圖層：覆蓋於 WebGL canvas 之上，但不攔截滑鼠（交給 OrbitControls） */
  .css3d { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  /* 貼附於元件頂面的名稱標籤（CSS 特效：小字 + 半透明膠囊 + 陰影/微光） */
  .cfp-name-label {
    font: 600 13px/1 -apple-system, "Segoe UI", "Microsoft JhengHei", sans-serif;
    color: #e2e8f0; white-space: nowrap; letter-spacing: .2px;
    padding: 3px 7px; border-radius: 5px;
    background: rgba(15,23,42,.72); border: 1px solid rgba(148,163,184,.55);
    box-shadow: 0 1px 6px rgba(0,0,0,.45), inset 0 0 8px rgba(56,189,248,.12);
    text-shadow: 0 1px 2px rgba(0,0,0,.6);
    -webkit-backdrop-filter: blur(1px); backdrop-filter: blur(1px);
    user-select: none; pointer-events: none; will-change: transform;
  }
  .hint { position: absolute; left: 12px; bottom: 10px; font-size: 11px; color: #64748b;
          background: rgba(15,23,42,.7); padding: 5px 9px; border-radius: 6px; pointer-events: none; }
  .licbadge { position: absolute; right: 12px; bottom: 10px; font-size: 10px; color: #64748b;
              background: rgba(15,23,42,.72); padding: 4px 9px; border-radius: 6px;
              text-decoration: none; z-index: 30; border: 1px solid #1e293b; }
  .licbadge:hover { color: #cbd5e1; border-color: #334155; }
  .licbadge b { color: #94a3b8; font-weight: 600; }
  .badge { position: absolute; right: 12px; top: 12px; font-size: 12px; padding: 5px 11px;
           border-radius: 20px; background: #065f46; color: #d1fae5; pointer-events: none; }
  .badge.bad { background: #7f1d1d; color: #fecaca; }
  .drop-hl { position:absolute; inset:0; border:2px dashed #3b82f6; pointer-events:none; opacity:0; }
  .drop-hl.on { opacity:1; }

  /* 疊構分析面板 */
  .panel { position: absolute; top: 0; right: 0; bottom: 0; width: 330px; background: #1e293b;
           border-left: 1px solid #334155; transform: translateX(100%); transition: transform .2s;
           overflow-y: auto; padding: 14px; z-index: 40; }
  .panel.on { transform: none; }
  .panel h3 { margin: 0 0 10px; font-size: 14px; color: #f1f5f9; }
  .panel h4 { margin: 16px 0 6px; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: .5px; }
  .panel .total { font-size: 12px; color: #e2e8f0; background: #0f172a; padding: 8px 10px; border-radius: 6px; }
  .panel .total b { color: #60a5fa; }
  .panel table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .panel th, .panel td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #334155; vertical-align: top; }
  .panel th { color: #64748b; font-weight: 600; }
  .panel .bar { height: 5px; background: #334155; border-radius: 3px; overflow: hidden; margin-top: 3px; }
  .panel .bar i { display: block; height: 100%; background: #3b82f6; }
  .panel .bar i.hi { background: #ef4444; }
  .panel svg { width: 100%; height: auto; background: #0f172a; border-radius: 6px; display: block; }
  .panel .close { position: absolute; top: 12px; right: 14px; cursor: pointer; color: #64748b; font-size: 15px; }
  .panel .close:hover { color: #e2e8f0; }

  /* 右鍵選單 */
  .menu { position: absolute; z-index: 50; width: 230px; background: #1e293b;
          border: 1px solid #475569; border-radius: 10px; padding: 10px; display: none;
          box-shadow: 0 12px 40px rgba(0,0,0,.5); }
  .menu.on { display: block; }
  .menu h3 { margin: 0 0 8px; font-size: 13px; color: #f1f5f9; }
  .row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .row label { width: 64px; font-size: 11px; color: #94a3b8; flex: none; }
  .row input { flex: 1; min-width: 0; background: #0f172a; color: #e2e8f0; border: 1px solid #475569;
               border-radius: 5px; padding: 5px 7px; font-size: 12px; }
  .grid3 { display: flex; gap: 6px; }
  .grid3 input { width: 100%; }
  .menu-actions { display: flex; gap: 6px; margin-top: 9px; }
  .menu-actions .btn { flex: 1; text-align: center; }
  .btn.danger { background: #7f1d1d; border-color: #991b1b; }
  .btn.danger:hover { background: #991b1b; }
  `;

  // ---------------------------------------------------------------------------
  // 3. Web Component
  // ---------------------------------------------------------------------------
  class ChipFloorPlanner extends HTMLElement {
    connectedCallback() {
      if (this._init) return;
      this._init = true;
      this.root = this.attachShadow({ mode: 'open' });
      this.state = {
        floors: [],
        activeFloor: 0,
        view: '3D',
        selected: null,
        snap: true,
        labels: false,
        names: true,
        measure: false,
        drc: { on: false, minSpacing: 0, edgeMargin: 0, minVGap: 0, boundary: true },
        coordBasis: 'LL',
        schemes: [],
        activeScheme: 0,
      };
      this._addFloor('Substrate Level', 120, 120, 10);
      this._addFloor('Interposer Level', 120, 120, 6);
      this._addFloor('Die / HBM Level', 120, 120, 14);
      this.state.activeFloor = 0;
      this.state.schemes = [{ name: '方案 1', floors: this.state.floors }];
      this._hist = { undo: [], redo: [] };
      this._tryRestoreAuto();         // 還原上次自動存檔（若有）
      this._buildDOM();
      this._syncToggles();            // 同步 DRC/標註/基準等 UI 狀態
      this._waitThree();
    }

    // ---- 樓層資料 ----
    _addFloor(name, w, d, h, grid, thickness) {
      this.state.floors.push({ id: uid(), name, w, d, h, grid: grid || 1, thickness: thickness != null ? thickness : 0.4, comps: [] });
    }
    _slabT(f) { return f.thickness != null ? f.thickness : 0.4; }   // 樓層板厚（預設薄，可由樓層選單調整）
    // 最底層（floor[0]）尺寸為上限：其他層 W/D 不得大於它
    _maxW() { return this.state.floors.length ? this.state.floors[0].w : Infinity; }
    _maxD() { return this.state.floors.length ? this.state.floors[0].d : Infinity; }
    // 座標基準：'LL' 左下角原點（預設，位於畫面左下前角，Y 軸向螢幕上方為正）/ 'center' 中心原點。
    _originX(f) { return this.state.coordBasis === 'center' ? 0 : -f.w / 2; }   // 原點的場景 x
    _originZ(f) { return this.state.coordBasis === 'center' ? 0 : f.d / 2; }    // 原點的場景 z（左下=前緣 +d/2）
    _yFlip() { return this.state.coordBasis === 'center' ? 1 : -1; }            // Y 正向（左下基準時往畫面上=場景 -z）
    _dispX(cx, f) { return cx - this._originX(f); }                  // 場景 → 顯示座標
    _dispY(cy, f) { return (cy - this._originZ(f)) * this._yFlip(); }
    _storeX(X, f) { return X + this._originX(f); }                   // 顯示座標 → 場景
    _storeY(Y, f) { return this._originZ(f) + Y * this._yFlip(); }
    _basisLabel() { return this.state.coordBasis === 'center' ? '中心' : '左下'; }
    // 吸附到格點（對齊座標原點，格距 = f.grid）
    _snapGrid(v, origin, g) { g = g || 1; return Math.round((v - origin) / g) * g + origin; }
    get floor() { return this.state.floors[this.state.activeFloor]; }
    _floorBaseY(idx) {
      let y = 0;
      for (let i = 0; i < idx; i++) y += this.state.floors[i].h;
      return y;
    }

    // ---- DOM ----
    _buildDOM() {
      const style = document.createElement('style');
      style.textContent = CSS;
      this.root.appendChild(style);

      const app = document.createElement('div');
      app.className = 'app';
      app.innerHTML = `
        <div class="sidebar">
          <h2>元件庫 · Component Library</h2>
          <div class="lib"></div>
        </div>
        <div class="main">
          <div class="toolbar">
            <button class="btn" data-act="view3d">3D 視圖</button>
            <button class="btn" data-act="view2d">2D 平面</button>
            <div class="sep"></div>
            <button class="btn" data-act="undo" title="復原 (Ctrl+Z)">↶</button>
            <button class="btn" data-act="redo" title="重做 (Ctrl+Y)">↷</button>
            <div class="sep"></div>
            <button class="btn" data-act="save" title="儲存進度到瀏覽器">💾 儲存</button>
            <button class="btn" data-act="load" title="載入已儲存的進度">📂 載入</button>
            <div class="sep"></div>
            <div class="field">樓層 W<input data-fld="fw" type="number" min="10"></div>
            <div class="field">D<input data-fld="fd" type="number" min="10"></div>
            <div class="field">高<input data-fld="fh" type="number" min="1"></div>
            <select class="sel" data-fld="coordbasis" title="座標基準">
              <option value="LL">座標基準：左下原點</option>
              <option value="center">座標基準：中心原點</option>
            </select>
            <div class="sep"></div>
            <button class="btn" data-act="addfloor">+ 新增樓層</button>
            <button class="btn on" data-act="snap">⌁ 吸附對齊</button>
            <button class="btn" data-act="labels">🏷 間隔標註</button>
            <button class="btn" data-act="names">🔖 元件名稱</button>
            <select class="sel" data-fld="scheme" title="設計方案" style="display:none"></select>
            <button class="btn" data-act="fit">⊹ 置中</button>
            <button class="btn danger" data-act="clear">清空本層</button>
            <div class="sep"></div>
            <button class="btn" data-act="spec">📋 匯入規格表 (CSV/Excel)</button>
            <button class="btn" data-act="example">⬇ CSV 範例</button>
            <button class="btn" data-act="examplexlsx">⬇ Excel 範例</button>
            <div class="sep"></div>
            <button class="btn" data-act="analysis">📐 疊構分析</button>
            <button class="btn" data-act="bom">📄 BOM</button>
            <button class="btn" data-act="measure">📏 量測</button>
            <div class="sep"></div>
            <button class="btn" data-act="drc">🛡 DRC</button>
            <button class="btn" data-act="addko" title="新增禁置區 keep-out">＋禁置區</button>
            <span class="hinttxt">右鍵點樓層可設定格距/間距/板厚</span>
          </div>
          <div class="tabs"></div>
          <div class="stage">
            <div class="drop-hl"></div>
            <div class="badge"></div>
            <div class="hint">拖曳元件到此 · 左鍵選取/拖移(自動吸附) · R 旋轉(Shift+R 反向) · Del 刪除 · 右鍵編輯屬性 · 滾輪縮放</div>
            <div class="menu"></div>
            <div class="toast"></div>
            <a class="licbadge" target="_blank" rel="noopener"
               title="專有授權 — 須經作者授權方得使用，作者得隨時撤銷">© 2026 Curtis · <b>授權 License</b></a>
            <div class="panel"><span class="close" title="關閉">✕</span><div class="panel-body"></div></div>
          </div>
        </div>`;
      this.root.appendChild(app);

      this.el = {
        lib: app.querySelector('.lib'),
        tabs: app.querySelector('.tabs'),
        stage: app.querySelector('.stage'),
        badge: app.querySelector('.badge'),
        menu: app.querySelector('.menu'),
        drop: app.querySelector('.drop-hl'),
        panel: app.querySelector('.panel'),
        panelBody: app.querySelector('.panel-body'),
        toast: app.querySelector('.toast'),
      };
      app.querySelector('.panel .close').onclick = () => this._toggleAnalysis(false);
      // 授權標記連結（可用 license-href 屬性覆寫，預設指向線上授權頁）
      app.querySelector('.licbadge').href =
        this.getAttribute('license-href') || 'https://control168.github.io/chip-floorplanner-demo/license.html';

      this._renderLibrary();
      this._renderTabs();
      this._renderSchemeSel();
      this._syncFloorFields();

      // toolbar
      app.querySelectorAll('[data-act]').forEach(b => {
        b.onclick = () => this._toolbar(b.dataset.act);
      });
      app.querySelectorAll('[data-fld]').forEach(inp => {
        inp.onchange = () => {
          const fld = inp.dataset.fld;
          if (fld === 'scheme') this._applyScheme(parseInt(inp.value, 10));
          else if (fld === 'minspacing') { this.state.drc.minSpacing = Math.max(0, parseFloat(inp.value) || 0); this._rebuildScene(); }
          else if (fld === 'edgemargin') { this.state.drc.edgeMargin = Math.max(0, parseFloat(inp.value) || 0); this._rebuildScene(); }
          else if (fld === 'coordbasis') { this.state.coordBasis = inp.value; this._hideMenu(); this._rebuildScene(); }
          else this._editFloorField(fld, parseFloat(inp.value));
        };
      });

      // drag-drop onto stage
      this.el.stage.addEventListener('dragover', e => {
        e.preventDefault(); this.el.drop.classList.add('on');
      });
      this.el.stage.addEventListener('dragleave', () => this.el.drop.classList.remove('on'));
      this.el.stage.addEventListener('drop', e => this._onDrop(e));
    }

    _renderLibrary() {
      this.el.lib.innerHTML = '';
      Object.entries(CATALOG).forEach(([cat, data]) => {
        const box = document.createElement('div');
        box.className = 'cat';
        const head = document.createElement('div');
        head.className = 'cat-head';
        head.innerHTML = `<span class="cat-dot" style="background:${data.color}"></span>${cat}`;
        box.appendChild(head);
        const desc = document.createElement('div');
        desc.className = 'cat-desc';
        desc.textContent = data.desc;
        box.appendChild(desc);
        data.parts.forEach((p, i) => {
          const it = document.createElement('div');
          it.className = 'item';
          it.draggable = true;
          it.innerHTML = `
            <span class="thumb" style="--c:${p.color}"></span>
            <span class="item-meta">
              <div class="item-name">${p.name}</div>
              <div class="item-size">${p.w}×${p.d}×${p.h}</div>
            </span>`;
          it.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ cat, i }));
          });
          box.appendChild(it);
        });
        this.el.lib.appendChild(box);
      });
    }

    _renderTabs() {
      this.el.tabs.innerHTML = '';
      this.state.floors.forEach((f, idx) => {
        const t = document.createElement('div');
        t.className = 'tab' + (idx === this.state.activeFloor ? ' on' : '');
        t.innerHTML = `${f.name}<span class="x" title="刪除樓層">✕</span>`;
        t.onclick = e => {
          if (e.target.classList.contains('x')) { this._delFloor(idx); return; }
          this.state.activeFloor = idx;
          this._hideMenu(); this.state.selected = null;
          this._renderTabs(); this._syncFloorFields(); this._rebuildScene();
        };
        this.el.tabs.appendChild(t);
      });
    }

    _syncFloorFields() {
      const f = this.floor;
      const set = (k, v) => { const i = this.root.querySelector(`[data-fld="${k}"]`); if (i) i.value = v; };
      set('fw', f.w); set('fd', f.d); set('fh', f.h); set('grid', f.grid || 1);
    }

    // ---- toolbar 動作 ----
    _toolbar(act) {
      if (act === 'view3d') this._setView('3D');
      else if (act === 'view2d') this._setView('2D');
      else if (act === 'undo') this._undo();
      else if (act === 'redo') this._redo();
      else if (act === 'save') this._saveNamed();
      else if (act === 'load') this._showLoadMenu();
      else if (act === 'addfloor') {
        this._pushHistory();
        const w = Math.min(this.floor.w, this._maxW()), d = Math.min(this.floor.d, this._maxD());
        this._addFloor('Layer ' + (this.state.floors.length + 1), w, d, 8, this.floor.grid, this._slabT(this.floor));
        this.state.activeFloor = this.state.floors.length - 1;
        this._renderTabs(); this._syncFloorFields(); this._rebuildScene();
      } else if (act === 'snap') {
        this.state.snap = !this.state.snap;
        this.root.querySelector('[data-act="snap"]').classList.toggle('on', this.state.snap);
      } else if (act === 'labels') {
        this.state.labels = !this.state.labels;
        this.root.querySelector('[data-act="labels"]').classList.toggle('on', this.state.labels);
        this._rebuildScene();
      } else if (act === 'names') {
        this.state.names = !this.state.names;
        this.root.querySelector('[data-act="names"]').classList.toggle('on', this.state.names);
        this._rebuildScene();
      } else if (act === 'spec') this._pickSpec();
      else if (act === 'example') this._download('spec-example.csv', EXAMPLE_SPEC);
      else if (act === 'examplexlsx') this._downloadExampleXLSX();
      else if (act === 'analysis') this._toggleAnalysis();
      else if (act === 'bom') this._download('chip-bom.csv', this.exportBOM());
      else if (act === 'measure') this._toggleMeasure();
      else if (act === 'drc') {
        this.state.drc.on = !this.state.drc.on;
        this.root.querySelector('[data-act="drc"]').classList.toggle('on', this.state.drc.on);
        if (this.state.drc.on) this._toggleAnalysis(true);   // 開 DRC 同時開面板看違規
        else this._rebuildScene();
      }
      else if (act === 'addko') {
        this._pushHistory();
        const f = this.floor;
        if (!f.keepouts) f.keepouts = [];
        f.keepouts.push({ id: uid(), x: 0, y: 0, w: 30, d: 30 });
        this._rebuildScene();
      }
      else if (act === 'fit') this._fitCamera();
      else if (act === 'clear') {
        this._pushHistory();
        this.floor.comps = []; this.state.selected = null; this._hideMenu(); this._rebuildScene();
      }
    }
    _delFloor(idx) {
      if (this.state.floors.length <= 1) return;
      this._pushHistory();
      this.state.floors.splice(idx, 1);
      this.state.activeFloor = Math.min(this.state.activeFloor, this.state.floors.length - 1);
      this._renderTabs(); this._syncFloorFields(); this._rebuildScene();
    }
    _editFloorField(k, v) {
      if (!isFinite(v) || v <= 0) { this._syncFloorFields(); return; }
      this._pushHistory();
      const f = this.floor;
      const isBottom = this.state.activeFloor === 0;
      if (k === 'fw') f.w = isBottom ? v : Math.min(v, this._maxW());        // 非底層 W 不得 > 最底層
      else if (k === 'fd') f.d = isBottom ? v : Math.min(v, this._maxD());   // 非底層 D 不得 > 最底層
      else if (k === 'fh') f.h = v;
      else if (k === 'thick') f.thickness = Math.min(v, f.h);               // 板厚 ≤ 層高
      else if (k === 'grid') f.grid = v;
      // 編輯最底層尺寸後，把其他層裁切到不大於它
      if (isBottom && (k === 'fw' || k === 'fd')) {
        this.state.floors.forEach((fl, i) => { if (i > 0) { fl.w = Math.min(fl.w, f.w); fl.d = Math.min(fl.d, f.d); } });
      }
      this._syncFloorFields();
      this._rebuildScene();
    }

    // ===========================================================================
    // 4. Three.js 場景
    // ===========================================================================
    _waitThree() {
      if (window.THREE && THREE.OrbitControls) this._initThree();
      else if (this._tries === undefined ? (this._tries = 0) : this._tries++ < 100)
        setTimeout(() => this._waitThree(), 50);
      else this.el.stage.insertAdjacentHTML('beforeend',
        '<div class="hint" style="color:#f87171">⚠ 未載入 Three.js / OrbitControls，請引入 CDN 腳本。</div>');
    }

    _initThree() {
      const stage = this.el.stage;
      const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      stage.appendChild(renderer.domElement);
      this.renderer = renderer;

      // CSS3D 圖層（選用）：把元件名稱以真實 HTML/CSS 貼在元件頂面
      if (THREE.CSS3DRenderer) {
        const css = new THREE.CSS3DRenderer();
        css.domElement.className = 'css3d';
        stage.appendChild(css.domElement);
        this.cssRenderer = css;
        this.cssScene = new THREE.Scene();
        this.cssLabelGroup = new THREE.Group();
        this.cssScene.add(this.cssLabelGroup);
      }

      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#0f172a');
      this.scene = scene;

      const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
      this.cam = cam;

      const controls = new THREE.OrbitControls(cam, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      this.controls = controls;

      scene.add(new THREE.HemisphereLight('#cbd5e1', '#1e293b', 0.9));
      const dir = new THREE.DirectionalLight('#ffffff', 0.8);
      dir.position.set(120, 200, 90);
      dir.castShadow = true;
      dir.shadow.mapSize.set(1024, 1024);
      const s = 300;
      dir.shadow.camera.left = -s; dir.shadow.camera.right = s;
      dir.shadow.camera.top = s; dir.shadow.camera.bottom = -s;
      scene.add(dir);

      this.compGroup = new THREE.Group();    // 元件
      this.floorGroup = new THREE.Group();   // 樓層底板
      this.labelGroup = new THREE.Group();   // 間隔標註
      this.measureGroup = new THREE.Group(); // 量測線
      this.koGroup = new THREE.Group();      // 禁置區 keep-out
      scene.add(this.floorGroup, this.compGroup, this.labelGroup, this.measureGroup, this.koGroup);

      this.ray = new THREE.Raycaster();
      this.ndc = new THREE.Vector2();

      this._bindCanvas(renderer.domElement);
      this._rebuildScene();
      this._fitCamera();

      const ro = new ResizeObserver(() => this._resize());
      ro.observe(stage);
      this._resize();

      const loop = () => {
        this._raf = requestAnimationFrame(loop);
        controls.update();
        renderer.render(scene, cam);
        if (this.cssRenderer) this.cssRenderer.render(this.cssScene, cam);
      };
      loop();
    }

    _resize() {
      if (!this.renderer) return;
      const w = this.el.stage.clientWidth, h = this.el.stage.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      if (this.cssRenderer) this.cssRenderer.setSize(w, h);
      this.cam.aspect = w / h;
      this.cam.updateProjectionMatrix();
    }

    // 重建整個場景（樓層 + 元件）
    _rebuildScene() {
      if (!this.scene) return;
      this._disposeGroup(this.floorGroup);
      this._disposeGroup(this.compGroup);
      this._disposeGroup(this.labelGroup);
      this._disposeGroup(this.koGroup);
      this._clearCssLabels();
      this.meshById = {};
      this.nameLabelById = {};       // 元件 id → 名稱標籤物件（拖移時即時跟隨）
      this._labelN = 0;

      this.state.floors.forEach((f, idx) => {
        const baseY = this._floorBaseY(idx);
        const active = idx === this.state.activeFloor;
        const T = this._slabT(f);                          // 板厚
        // 底板（實際厚度 = T）
        const g = new THREE.BoxGeometry(f.w, T, f.d);
        const m = new THREE.MeshStandardMaterial({
          color: active ? '#1e293b' : '#172033',
          transparent: true, opacity: active ? 1 : 0.45,
        });
        const slab = new THREE.Mesh(g, m);
        slab.position.set(0, baseY + T / 2, 0);
        slab.receiveShadow = true;
        slab.userData = { kind: 'slab', floorIdx: idx };
        this.floorGroup.add(slab);
        // 網格線（僅作用層，格距對齊 f.grid，密度上限 200）
        if (active) {
          const size = Math.max(f.w, f.d);
          const div = Math.min(200, Math.max(1, Math.round(size / (f.grid || 1))));
          const grid = new THREE.GridHelper(size, div, '#334155', '#243044');
          grid.position.set(0, baseY + T + 0.02, 0);
          this.floorGroup.add(grid);
          this._addDatum(f, baseY);            // 座標原點定位標記
        }
        // 元件
        f.comps.forEach(c => {
          const mesh = this._makeMesh(c, baseY, active, T);
          this.compGroup.add(mesh);
          this.meshById[c.id] = mesh;
          if (this.state.labels && c.gap) this._addLabel(c, baseY, T);
          if (this.state.names) this._addNameLabel(c, baseY, T);
        });
        // 禁置區 keep-out
        (f.keepouts || []).forEach(k => this._makeKeepout(k, baseY, active, idx));
      });
      this._runDRC();
      if (this.el.panel && this.el.panel.classList.contains('on')) this._renderAnalysis();
      this._autoSave();
    }

    // 間隔標註：在元件上方以引線 + 文字標籤顯示 gap_note
    _addLabel(c, baseY, T) {
      const topY = baseY + (T != null ? T : 0.4) + (c.z || 0) + c.h;
      // 依索引交錯升高，降低標籤互相重疊
      const idx = this._labelN = (this._labelN || 0) + 1;
      const lift = Math.max(7, c.h * 1.2) + (idx % 3) * 5;
      const a = new THREE.Vector3(c.x, topY, c.y);
      const b = new THREE.Vector3(c.x, topY + lift, c.y);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({ color: '#94a3b8', depthTest: false, transparent: true })
      );
      line.renderOrder = 998;
      this.labelGroup.add(line);
      this.labelGroup.add(this._makeLabel(`${c.name}｜${c.gap}`, b));
    }
    // 元件名稱：以 CSS3D 把名稱「平躺貼附」在元件朝上的頂面、置中（小字）
    _addNameLabel(c, baseY, T) {
      const topY = baseY + (T != null ? T : 0.4) + (c.z || 0) + c.h;
      // 優先：CSS3D（真實 HTML/CSS，貼在頂面上）
      if (this.cssRenderer && THREE.CSS3DObject) {
        const el = document.createElement('div');
        el.className = 'cfp-name-label';
        el.textContent = c.name;
        const obj = new THREE.CSS3DObject(el);
        obj.position.set(c.x, topY + 0.06, c.y);   // 緊貼頂面上方
        obj.rotation.order = 'YXZ';
        obj.rotation.y = (c.rot || 0) * Math.PI / 180;  // 跟著元件繞垂直軸旋轉
        obj.rotation.x = -Math.PI / 2;                  // 平躺貼附於頂面
        const s = 0.08;                                  // DOM px → 世界單位（縮小字體）
        obj.scale.set(s, s, s);
        this.cssLabelGroup.add(obj);
        this.nameLabelById[c.id] = obj;                  // 供拖移時即時跟隨
        return;
      }
      // 退回：小尺寸 sprite（未載入 CSS3DRenderer 時，例如舊版嵌入）
      const pos = new THREE.Vector3(c.x, topY + 1.2, c.y);
      const sp = this._makeLabel(c.name, pos, { fs: 18, k: 0.05 });
      this.labelGroup.add(sp);
      this.nameLabelById[c.id] = sp;
    }
    _clearCssLabels() {
      if (!this.cssLabelGroup) return;
      for (let i = this.cssLabelGroup.children.length - 1; i >= 0; i--) {
        const o = this.cssLabelGroup.children[i];
        if (o.element && o.element.parentNode) o.element.parentNode.removeChild(o.element);
        this.cssLabelGroup.remove(o);
      }
    }
    _makeLabel(text, pos, opts) {
      const fs = (opts && opts.fs) || 30, pad = 10, dpr = 2;
      const cv = document.createElement('canvas');
      const ctx = cv.getContext('2d');
      ctx.font = `${fs}px -apple-system,"Segoe UI","Microsoft JhengHei",sans-serif`;
      const tw = Math.ceil(ctx.measureText(text).width);
      cv.width = (tw + pad * 2) * dpr; cv.height = (fs + pad * 2) * dpr;
      ctx.scale(dpr, dpr);
      ctx.font = `${fs}px -apple-system,"Segoe UI","Microsoft JhengHei",sans-serif`;
      ctx.fillStyle = 'rgba(15,23,42,0.9)';
      ctx.strokeStyle = '#475569'; ctx.lineWidth = 2;
      const w = tw + pad * 2, h = fs + pad * 2, r = 8;
      ctx.beginPath();
      ctx.moveTo(r, 0); ctx.arcTo(w, 0, w, h, r); ctx.arcTo(w, h, 0, h, r);
      ctx.arcTo(0, h, 0, 0, r); ctx.arcTo(0, 0, w, 0, r); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e2e8f0'; ctx.textBaseline = 'middle';
      ctx.fillText(text, pad, h / 2);
      const tex = new THREE.CanvasTexture(cv);
      tex.minFilter = THREE.LinearFilter;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      const k = (opts && opts.k) || 0.085;              // 像素 → 世界單位
      sp.scale.set(w * k, h * k, 1);
      sp.position.copy(pos); sp.position.y += h * k / 2 + 1;
      sp.renderOrder = 999;
      return sp;
    }

    _makeMesh(c, baseY, active, T) {
      const geo = new THREE.BoxGeometry(c.w, c.h, c.d);
      const mat = new THREE.MeshStandardMaterial({
        color: c.color, metalness: 0.25, roughness: 0.55,
        transparent: !active, opacity: active ? 1 : 0.5,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.position.set(c.x, baseY + (T != null ? T : 0.4) + (c.z || 0) + c.h / 2, c.y);
      mesh.rotation.y = (c.rot || 0) * Math.PI / 180;
      mesh.userData = { id: c.id, baseColor: c.color };
      // 外框
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: '#0f172a' })
      );
      mesh.add(edges);
      // 選取高亮
      if (this.state.selected === c.id) {
        mat.emissive = new THREE.Color('#1d4ed8');
        mat.emissiveIntensity = 0.4;
      }
      return mesh;
    }

    _makeKeepout(k, baseY, active, idx) {
      const h = Math.max(2, this.state.floors[idx].h * 0.6);
      const geo = new THREE.BoxGeometry(k.w, h, k.d);
      const mat = new THREE.MeshStandardMaterial({
        color: '#ef4444', transparent: true, opacity: active ? 0.22 : 0.1,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(k.x, baseY + this._slabT(this.state.floors[idx]) + h / 2, k.y);
      mesh.userData = { kind: 'keepout', id: k.id, floorIdx: idx };
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: '#ef4444' })));
      this.koGroup.add(mesh);
      return mesh;
    }

    // 樓層定位原點（座標 0,0，預設左下角）：X(紅)/Y(綠) 軸指示 + 標籤
    _addDatum(f, baseY) {
      const ox = this._originX(f), oz = this._originZ(f), y = baseY + this._slabT(f) + 0.1;
      const len = Math.max(6, Math.min(f.w, f.d) * 0.16);
      const fy = this._yFlip();                            // Y 正向（左下基準時 -z 為畫面上）
      const mk = (to, col) => this.floorGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ox, y, oz), to]),
        new THREE.LineBasicMaterial({ color: col })));
      mk(new THREE.Vector3(ox + len, y, oz), '#f87171');        // +X 寬度方向（紅）
      mk(new THREE.Vector3(ox, y, oz + len * fy), '#4ade80');   // +Y 深度方向（綠，往畫面上）
      const dot = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 10),
        new THREE.MeshBasicMaterial({ color: '#fbbf24' }));
      dot.position.set(ox, y, oz);
      this.floorGroup.add(dot);
      this.floorGroup.add(this._makeLabel('原點 0,0', new THREE.Vector3(ox, y, oz)));
    }

    _disposeGroup(g) {
      for (let i = g.children.length - 1; i >= 0; i--) {
        const o = g.children[i];
        o.traverse(n => {
          if (n.geometry) n.geometry.dispose();
          if (n.material) { if (n.material.map) n.material.map.dispose(); n.material.dispose(); }
        });
        g.remove(o);
      }
    }

    // ===========================================================================
    // 5. DRC 設計規則檢查（含碰撞、最小間距、邊界包覆、禁置區）
    //    碰撞=亮紅，其他 DRC 違規=琥珀色
    // ===========================================================================
    // 定向包圍盒（OBB）：僅繞 Y 軸旋轉，故 Y 區間不受旋轉影響、XZ 平面為旋轉矩形。
    _obb(c, idx) {
      const baseY = this._floorBaseY(idx);
      const cy = baseY + this._slabT(this.state.floors[idx]) + (c.z || 0) + c.h / 2;
      const a = (c.rot || 0) * Math.PI / 180;
      return {
        cx: c.x, cz: c.y, hw: c.w / 2, hd: c.d / 2,
        miny: cy - c.h / 2, maxy: cy + c.h / 2,
        cos: Math.cos(a), sin: Math.sin(a),
      };
    }
    // XZ 平面 OBB-OBB 重疊測試（SAT，4 條分離軸）
    _overlapXZ(A, B) {
      const axes = [
        { x: A.cos, z: A.sin }, { x: -A.sin, z: A.cos },
        { x: B.cos, z: B.sin }, { x: -B.sin, z: B.cos },
      ];
      const dx = B.cx - A.cx, dz = B.cz - A.cz;
      for (const L of axes) {
        const rA = A.hw * Math.abs(A.cos * L.x + A.sin * L.z) +
                   A.hd * Math.abs(-A.sin * L.x + A.cos * L.z);
        const rB = B.hw * Math.abs(B.cos * L.x + B.sin * L.z) +
                   B.hd * Math.abs(-B.sin * L.x + B.cos * L.z);
        if (Math.abs(dx * L.x + dz * L.z) > rA + rB) return false; // 找到分離軸
      }
      return true;
    }
    _inflate(box, d) { return { cx: box.cx, cz: box.cz, hw: box.hw + d, hd: box.hd + d, cos: box.cos, sin: box.sin }; }
    // 旋轉後四角是否都落在樓層邊界內縮 margin 的範圍
    _withinFloor(c, f, margin) {
      const a = (c.rot || 0) * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
      const hx = c.w / 2, hz = c.d / 2, limX = f.w / 2 - margin, limZ = f.d / 2 - margin;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const lx = sx * hx, lz = sz * hz;
        const wx = c.x + lx * co - lz * si, wz = c.y + lx * si + lz * co;
        if (Math.abs(wx) > limX + 1e-6 || Math.abs(wz) > limZ + 1e-6) return false;
      }
      return true;
    }
    // 主檢查：碰撞 + 間距 + 邊界 + 禁置區
    _runDRC() {
      const drc = this.state.drc;
      const minS = drc.on ? (drc.minSpacing || 0) : 0;
      const minVG = drc.on ? (drc.minVGap || 0) : 0;
      const items = [];
      this.state.floors.forEach((f, idx) => f.comps.forEach(c => items.push({ c, idx, box: this._obb(c, idx) })));
      const viol = [], red = new Set(), amber = new Set(), koHit = new Set();

      // 兩兩：碰撞（同一垂直層）/ 間距不足
      for (let i = 0; i < items.length; i++)
        for (let j = i + 1; j < items.length; j++) {
          const A = items[i], B = items[j], yOv = A.box.miny < B.box.maxy && A.box.maxy > B.box.miny;
          if (yOv) {
            if (this._overlapXZ(A.box, B.box)) {
              red.add(A.c.id); red.add(B.c.id);
              viol.push({ sev: 2, text: `碰撞重疊：${A.c.name} ✕ ${B.c.name}` });
            } else if (minS > 0 && this._overlapXZ(this._inflate(A.box, minS / 2), this._inflate(B.box, minS / 2))) {
              amber.add(A.c.id); amber.add(B.c.id);
              viol.push({ sev: 1, text: `間距 < ${minS}：${A.c.name} ↔ ${B.c.name}` });
            }
          } else if (minVG > 0 && this._overlapXZ(A.box, B.box)) {     // 上下層、footprint 重疊 → 垂直淨距
            const gap = Math.max(A.box.miny - B.box.maxy, B.box.miny - A.box.maxy);
            if (gap < minVG) {
              amber.add(A.c.id); amber.add(B.c.id);
              viol.push({ sev: 1, text: `層間淨距 < ${minVG}：${A.c.name} ↕ ${B.c.name}（${+gap.toFixed(2)}）` });
            }
          }
        }
      // 邊界包覆
      if (drc.on && drc.boundary) {
        items.forEach(({ c, idx }) => {
          const f = this.state.floors[idx];
          if (!this._withinFloor(c, f, drc.edgeMargin || 0)) {
            amber.add(c.id);
            viol.push({ sev: 1, text: `超出邊界${drc.edgeMargin ? `(邊距${drc.edgeMargin})` : ''}：${c.name}（${f.name}）` });
          }
        });
      }
      // 高度：元件占用高度（層內位移 z + 厚度 h）超出該層層高 → 會壓到上層
      if (drc.on) items.forEach(({ c, idx }) => {
        const f = this.state.floors[idx], occ = (c.z || 0) + c.h;
        if (occ > f.h + 1e-6) { amber.add(c.id); viol.push({ sev: 1, text: `高度超出層高：${c.name}（高 ${+occ.toFixed(2)} > 層高 ${f.h}）` }); }
      });
      // 禁置區（永遠檢查，不受 DRC 開關影響——放置禁置區即為明確約束）
      this.state.floors.forEach((f, idx) => (f.keepouts || []).forEach(k => {
        const kbox = { cx: k.x, cz: k.y, hw: k.w / 2, hd: k.d / 2, cos: 1, sin: 0 };
        f.comps.forEach(c => {
          if (this._overlapXZ(this._obb(c, idx), kbox)) {
            amber.add(c.id); koHit.add(k.id);
            viol.push({ sev: 1, text: `進入禁置區：${c.name}（${f.name}）` });
          }
        });
      }));
      // 違規禁置區高亮（加亮、加實心邊框）
      this.koGroup.children.forEach(mesh => {
        const hit = koHit.has(mesh.userData.id);
        mesh.material.opacity = hit ? 0.5 : (mesh.userData.floorIdx === this.state.activeFloor ? 0.22 : 0.1);
        mesh.material.color.set(hit ? '#ff1133' : '#ef4444');
      });

      // 上色
      items.forEach(({ c }) => {
        const mesh = this.meshById[c.id]; if (!mesh) return;
        const m = mesh.material;
        if (red.has(c.id)) { m.color.set('#ff1133'); m.emissive.set('#ff1133'); m.emissiveIntensity = 0.85; }
        else if (amber.has(c.id)) { m.color.set('#f59e0b'); m.emissive.set('#f59e0b'); m.emissiveIntensity = 0.55; }
        else {
          m.color.set(mesh.userData.baseColor);
          if (this.state.selected === c.id) { m.emissive.set('#1d4ed8'); m.emissiveIntensity = 0.4; }
          else { m.emissive.set('#000000'); m.emissiveIntensity = 0; }
        }
      });

      this._violations = viol;
      const badge = this.el.badge;
      if (drc.on) {
        badge.classList.toggle('bad', viol.length > 0);
        badge.textContent = viol.length ? `⚠ ${viol.length} 項 DRC 違規` : '✓ DRC 通過';
      } else {
        // DRC 關閉時仍計入碰撞與禁置區違規
        const n = viol.length;
        badge.classList.toggle('bad', n > 0);
        badge.textContent = n ? `⚠ ${n} 項違規（碰撞/禁置區）` : '✓ 無碰撞';
      }
    }

    // ===========================================================================
    // 6. 滑鼠互動：放置 / 選取 / 拖移 / 右鍵選單
    // ===========================================================================
    _bindCanvas(canvas) {
      canvas.addEventListener('pointerdown', e => this._onDown(e));
      canvas.addEventListener('pointermove', e => this._onMove(e));
      window.addEventListener('pointerup', () => this._onUp());
      canvas.addEventListener('contextmenu', e => this._onContext(e));
      canvas.addEventListener('pointerdown', () => this._hideMenu(), true);
      window.addEventListener('keydown', e => this._onKey(e));
    }

    // 鍵盤：R 旋轉選取元件（Shift+R 反向），Delete 刪除
    _onKey(e) {
      if (this.root.activeElement && this.root.activeElement.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      // 復原 / 重做（不需選取元件）
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { this._undo(); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { this._redo(); e.preventDefault(); return; }
      if (!this.state.selected) return;
      const c = this.floor.comps.find(x => x.id === this.state.selected);
      if (!c) return;
      if (k === 'r') {
        this._pushHistory();
        c.rot = (((c.rot || 0) + (e.shiftKey ? -15 : 15)) % 360 + 360) % 360;
        this._rebuildScene(); e.preventDefault();
      } else if (k === 'delete' || k === 'backspace') {
        this._pushHistory();
        this.floor.comps = this.floor.comps.filter(x => x.id !== c.id);
        this.state.selected = null; this._hideMenu(); this._rebuildScene(); e.preventDefault();
      }
    }

    // 元件繞 Y 旋轉後，在世界座標的 XZ 半寬/半深（用於邊緣吸附）
    _worldHalf(c) {
      const a = (c.rot || 0) * Math.PI / 180, co = Math.abs(Math.cos(a)), si = Math.abs(Math.sin(a));
      return { hx: (c.w / 2) * co + (c.d / 2) * si, hz: (c.w / 2) * si + (c.d / 2) * co };
    }
    // 邊緣吸附：將元件的 左/中/右(前/中/後) 邊對齊其他元件邊或樓層中線/邊界
    _applySnap(c) {
      const T = 2.5, f = this.floor, half = this._worldHalf(c);
      const others = f.comps.filter(o => o.id !== c.id);
      const tX = [-f.w / 2, 0, f.w / 2], tZ = [-f.d / 2, 0, f.d / 2];
      others.forEach(o => {
        const oh = this._worldHalf(o);
        tX.push(o.x - oh.hx, o.x, o.x + oh.hx);
        tZ.push(o.y - oh.hz, o.y, o.y + oh.hz);
      });
      const fit = (mine, targets) => {
        let best = null, bd = T;
        mine.forEach(mv => targets.forEach(tv => {
          const d = tv - mv; if (Math.abs(d) < bd) { bd = Math.abs(d); best = d; }
        }));
        return best;
      };
      const dX = fit([c.x - half.hx, c.x, c.x + half.hx], tX); if (dX !== null) c.x += dX;
      const dZ = fit([c.y - half.hz, c.y, c.y + half.hz], tZ); if (dZ !== null) c.y += dZ;
    }

    _ndcFrom(e) {
      const r = this.renderer.domElement.getBoundingClientRect();
      this.ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      this.ray.setFromCamera(this.ndc, this.cam);
    }
    // 與作用樓層水平面交點 → {x, y(=scene z)}
    _planeHit() {
      const baseY = this._floorBaseY(this.state.activeFloor) + this._slabT(this.floor);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -baseY);
      const p = new THREE.Vector3();
      return this.ray.ray.intersectPlane(plane, p) ? { x: p.x, y: p.z } : null;
    }
    _pickComp(e, anyFloor) {
      this._ndcFrom(e);
      const hits = this.ray.intersectObjects(this.compGroup.children, false);
      for (const h of hits) {
        const id = h.object.userData.id;
        if (anyFloor) return id;                              // 量測：任何樓層皆可選
        if (this.floor.comps.some(c => c.id === id)) return id; // 一般：僅作用樓層
      }
      return null;
    }
    // 取作用樓層的禁置區（回傳資料物件）
    _pickKeepout(e) {
      if (!this.koGroup) return null;
      this._ndcFrom(e);
      const hits = this.ray.intersectObjects(this.koGroup.children, false);
      for (const h of hits) {
        const ud = h.object.userData;
        if (ud.kind === 'keepout' && ud.floorIdx === this.state.activeFloor) {
          const k = (this.floor.keepouts || []).find(x => x.id === ud.id);
          if (k) return k;
        }
      }
      return null;
    }

    _onDown(e) {
      if (e.button !== 0) return;
      if (this.state.measure) { this._measurePick(this._pickComp(e, true)); return; }
      const ko = this._pickKeepout(e);                       // 禁置區優先
      if (ko) {
        this.state.selected = null;
        this.koDrag = { ko, moved: false };
        this.controls.enabled = false;
        return;
      }
      const id = this._pickComp(e);
      if (id) {
        this.state.selected = id;
        this.drag = { id, moved: false };
        this.controls.enabled = false;
        this._rebuildScene();
      } else {
        if (this.state.selected) { this.state.selected = null; this._rebuildScene(); }
      }
    }
    _onMove(e) {
      if (this.koDrag) {
        this._ndcFrom(e); const hit = this._planeHit(); if (!hit) return;
        if (!this.koDrag.moved) { this._pushHistory(); this.koDrag.moved = true; }
        const kf = this.floor;
        this.koDrag.ko.x = this._snapGrid(hit.x, this._originX(kf), kf.grid);
        this.koDrag.ko.y = this._snapGrid(hit.y, this._originZ(kf), kf.grid);
        this._rebuildScene();
        return;
      }
      if (!this.drag) return;
      this._ndcFrom(e);
      const hit = this._planeHit();
      if (!hit) return;
      const c = this.floor.comps.find(x => x.id === this.drag.id);
      if (!c) return;
      if (!this.drag.moved) this._pushHistory();           // 拖移開始前存檔一次
      const f = this.floor;
      c.x = this._snapGrid(hit.x, this._originX(f), f.grid);
      c.y = this._snapGrid(hit.y, this._originZ(f), f.grid);
      if (this.state.snap) this._applySnap(c);
      this.drag.moved = true;
      const mesh = this.meshById[c.id];
      if (mesh) { mesh.position.x = c.x; mesh.position.z = c.y; }
      const lbl = this.nameLabelById && this.nameLabelById[c.id];   // 名稱標籤即時跟隨
      if (lbl) { lbl.position.x = c.x; lbl.position.z = c.y; }
      this._runDRC();
    }
    _onUp() {
      if (this.drag) { this.drag = null; this.controls.enabled = true; }
      if (this.koDrag) { this.koDrag = null; this.controls.enabled = true; }
    }

    _onDrop(e) {
      e.preventDefault();
      this.el.drop.classList.remove('on');
      let data; try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      const part = CATALOG[data.cat] && CATALOG[data.cat].parts[data.i];
      if (!part || !this.renderer) return;
      this._pushHistory();
      this._ndcFrom(e);
      const hit = this._planeHit() || { x: 0, y: 0 };
      const f = this.floor;
      const c = {
        id: uid(), cat: data.cat, type: part.type,
        name: part.name, color: part.color,
        w: part.w, d: part.d, h: part.h,
        x: this._snapGrid(hit.x, this._originX(f), f.grid), y: this._snapGrid(hit.y, this._originZ(f), f.grid), z: 0,
        rot: 0, gap: '',
      };
      this.floor.comps.push(c);
      this.state.selected = c.id;
      this._rebuildScene();
    }

    // ---- 右鍵屬性編輯選單 ----
    _onContext(e) {
      e.preventDefault();
      const ko = this._pickKeepout(e);                       // 禁置區：右鍵編輯/刪除
      if (ko) { this._showKeepoutMenu(ko, e); return; }
      const id = this._pickComp(e);
      if (id) {
        this.state.selected = id;
        this._rebuildScene();
        this._showMenu(this.floor.comps.find(x => x.id === id), e);
        return;
      }
      // 右鍵指向樓層 → 樓層設定選單（座標格距 / 間距 / 板厚…）
      const fi = this._pickFloor(e);
      if (fi == null) { this._hideMenu(); return; }          // 不在樓層上：不顯示選單
      if (fi !== this.state.activeFloor) {
        this.state.activeFloor = fi; this.state.selected = null;
        this._renderTabs(); this._syncFloorFields(); this._rebuildScene();
      }
      this._showFloorMenu(e);
    }
    _pickFloor(e) {
      this._ndcFrom(e);
      const hits = this.ray.intersectObjects(this.floorGroup.children, false);
      for (const h of hits) if (h.object.userData && h.object.userData.kind === 'slab') return h.object.userData.floorIdx;
      return null;
    }
    _showFloorMenu(e) {
      const f = this.floor, m = this.el.menu;
      const isBottom = this.state.activeFloor === 0;
      m.innerHTML = `
        <h3>樓層設定 · ${this._esc(f.name)}${isBottom ? '（最底層）' : ''}</h3>
        <div class="row"><label>名稱</label><input data-fk="name" value="${this._esc(f.name)}"></div>
        <div class="row"><label>尺寸 W/D</label><div class="grid3">
          <input data-fk="w" type="number" value="${f.w}">
          <input data-fk="d" type="number" value="${f.d}"></div></div>
        <div class="row"><label>層高/板厚</label><div class="grid3">
          <input data-fk="h" type="number" value="${f.h}">
          <input data-fk="thickness" type="number" value="${this._slabT(f)}"></div></div>
        <div class="row"><label>格距µm</label><input data-fk="grid" type="number" step="0.1" value="${f.grid || 1}"></div>
        <div class="row"><label>間距/邊距(DRC)</label><div class="grid3">
          <input data-fk="minSpacing" type="number" step="0.5" value="${this.state.drc.minSpacing}">
          <input data-fk="edgeMargin" type="number" step="0.5" value="${this.state.drc.edgeMargin}"></div></div>
        <div class="row"><label>垂直淨距(DRC)</label><input data-fk="minVGap" type="number" step="0.5" value="${this.state.drc.minVGap || 0}"></div>
        ${isBottom ? '' : `<div class="cat-desc" style="padding:2px 0 0">W/D 上限＝最底層 ${this._maxW()}×${this._maxD()}</div>`}
        <div class="menu-actions"><button class="btn on" data-fkact="close">完成</button></div>`;
      const r = this.el.stage.getBoundingClientRect();
      m.style.left = Math.min(e.clientX - r.left + 6, r.width - 244) + 'px';
      m.style.top = Math.min(e.clientY - r.top + 6, r.height - 300) + 'px';
      m.classList.add('on');
      let dirty = false;
      const apply = () => {
        if (!dirty) { this._pushHistory(); dirty = true; }
        m.querySelectorAll('[data-fk]').forEach(inp => {
          const k = inp.dataset.fk, raw = inp.value, n = parseFloat(raw);
          if (k === 'name') { f.name = raw; return; }
          if (!isFinite(n) || n <= 0) return;
          if (k === 'w') f.w = isBottom ? n : Math.min(n, this._maxW());
          else if (k === 'd') f.d = isBottom ? n : Math.min(n, this._maxD());
          else if (k === 'h') f.h = n;
          else if (k === 'thickness') f.thickness = n;
          else if (k === 'grid') f.grid = n;
          else if (k === 'minSpacing') this.state.drc.minSpacing = n;
          else if (k === 'edgeMargin') this.state.drc.edgeMargin = n;
          else if (k === 'minVGap') this.state.drc.minVGap = n;
        });
        if (f.thickness > f.h) f.thickness = f.h;                       // 板厚 ≤ 層高
        if (isBottom) this.state.floors.forEach((fl, i) => { if (i > 0) { fl.w = Math.min(fl.w, f.w); fl.d = Math.min(fl.d, f.d); } });
        this._renderTabs(); this._syncFloorFields(); this._rebuildScene();
      };
      m.querySelectorAll('[data-fk]').forEach(inp => inp.oninput = apply);
      m.querySelector('[data-fkact="close"]').onclick = () => this._hideMenu();
    }
    _showKeepoutMenu(k, e) {
      const m = this.el.menu;
      m.innerHTML = `
        <h3>禁置區 · Keep-out</h3>
        <div class="row"><label>尺寸 W/D</label>
          <div class="grid3">
            <input data-kk="w" type="number" value="${k.w}">
            <input data-kk="d" type="number" value="${k.d}">
          </div></div>
        <div class="row"><label>座標 X/Y</label>
          <div class="grid3">
            <input data-kk="x" type="number" value="${k.x}">
            <input data-kk="y" type="number" value="${k.y}">
          </div></div>
        <div class="menu-actions">
          <button class="btn danger" data-kact="del">刪除禁置區</button>
        </div>`;
      const r = this.el.stage.getBoundingClientRect();
      m.style.left = Math.min(e.clientX - r.left + 6, r.width - 244) + 'px';
      m.style.top = Math.min(e.clientY - r.top + 6, r.height - 200) + 'px';
      m.classList.add('on');
      let dirty = false;
      m.querySelectorAll('[data-kk]').forEach(inp => inp.oninput = () => {
        if (!dirty) { this._pushHistory(); dirty = true; }
        const v = parseFloat(inp.value); if (isFinite(v)) k[inp.dataset.kk] = v;
        this._rebuildScene();
      });
      m.querySelector('[data-kact="del"]').onclick = () => {
        this._pushHistory();
        this.floor.keepouts = (this.floor.keepouts || []).filter(x => x.id !== k.id);
        this._hideMenu(); this._rebuildScene();
      };
    }
    _showMenu(c, e) {
      const m = this.el.menu;
      const f = this.floor;
      const round3 = v => +v.toFixed(3);
      m.innerHTML = `
        <h3>編輯元件 · ${c.cat}</h3>
        <div class="row"><label>名稱</label><input data-k="name" value="${this._esc(c.name)}"></div>
        <div class="row"><label>尺寸 W/D/H</label>
          <div class="grid3">
            <input data-k="w" type="number" value="${c.w}">
            <input data-k="d" type="number" value="${c.d}">
            <input data-k="h" type="number" value="${c.h}">
          </div></div>
        <div class="row"><label>座標 X/Y/Z（${this._basisLabel()}原點）</label>
          <div class="grid3">
            <input data-k="x" type="number" step="${f.grid || 1}" value="${round3(this._dispX(c.x, f))}">
            <input data-k="y" type="number" step="${f.grid || 1}" value="${round3(this._dispY(c.y, f))}">
            <input data-k="z" type="number" value="${c.z}">
          </div></div>
        <div class="row"><label>旋轉 °（繞 Y）</label><input data-k="rot" type="number" step="15" value="${c.rot || 0}"></div>
        <div class="row"><label>間隔備註</label><input data-k="gap" value="${this._esc(c.gap)}" placeholder="如：與前一元件 0.5mm bond gap"></div>
        <div class="menu-actions">
          <button class="btn on" data-mact="apply">套用</button>
          <button class="btn danger" data-mact="del">刪除</button>
        </div>`;
      // 定位
      const r = this.el.stage.getBoundingClientRect();
      let x = e.clientX - r.left + 6, y = e.clientY - r.top + 6;
      x = Math.min(x, r.width - 244); y = Math.min(y, r.height - 250);
      m.style.left = x + 'px'; m.style.top = y + 'px';
      m.classList.add('on');

      const apply = () => {
        m.querySelectorAll('[data-k]').forEach(inp => {
          const k = inp.dataset.k;
          const v = parseFloat(inp.value);
          if (k === 'x') { if (isFinite(v)) c.x = this._storeX(v, f); }            // 顯示座標 → 場景
          else if (k === 'y') { if (isFinite(v)) c.y = this._storeY(v, f); }
          else if (['w', 'd', 'h', 'z', 'rot'].includes(k)) { if (isFinite(v)) c[k] = v; }
          else c[k] = inp.value;
        });
        this._rebuildScene();
      };
      m.querySelector('[data-mact="apply"]').onclick = () => { apply(); this._hideMenu(); };
      m.querySelector('[data-mact="del"]').onclick = () => {
        this._pushHistory();
        this.floor.comps = this.floor.comps.filter(x => x.id !== c.id);
        this.state.selected = null; this._hideMenu(); this._rebuildScene();
      };
      // 即時預覽（輸入時更新）；首次編輯前存檔一次以供復原
      let dirty = false;
      m.querySelectorAll('[data-k]').forEach(inp => inp.oninput = () => {
        if (!dirty) { this._pushHistory(); dirty = true; }
        apply();
      });
    }
    _hideMenu() { if (this.el && this.el.menu) this.el.menu.classList.remove('on'); }
    _esc(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

    // ===========================================================================
    // 6b. 復原 / 重做（Ctrl+Z / Ctrl+Y）
    // ===========================================================================
    _snapshot() {
      return JSON.stringify({
        schemes: this.state.schemes,
        activeScheme: this.state.activeScheme,
        activeFloor: this.state.activeFloor,
      });
    }
    _pushHistory() {
      if (!this._hist) return;
      this._hist.undo.push(this._snapshot());
      if (this._hist.undo.length > 60) this._hist.undo.shift();
      this._hist.redo = [];
    }
    _restore(json) {
      const o = JSON.parse(json);
      this.state.schemes = o.schemes;
      this.state.activeScheme = o.activeScheme;
      this.state.floors = this.state.schemes[o.activeScheme].floors;
      this.state.activeFloor = Math.min(o.activeFloor, this.state.floors.length - 1);
      this.state.selected = null; this._hideMenu();
      this._renderTabs(); this._renderSchemeSel(); this._syncFloorFields(); this._rebuildScene();
    }
    _undo() {
      if (!this._hist || !this._hist.undo.length) return;
      this._hist.redo.push(this._snapshot());
      this._restore(this._hist.undo.pop());
    }
    _redo() {
      if (!this._hist || !this._hist.redo.length) return;
      this._hist.undo.push(this._snapshot());
      this._restore(this._hist.redo.pop());
    }

    // ===========================================================================
    // 7. 相機 / 視圖
    // ===========================================================================
    _sceneSize() {
      let w = 0, d = 0, top = 0;
      this.state.floors.forEach((f, i) => {
        w = Math.max(w, f.w); d = Math.max(d, f.d); top = this._floorBaseY(i) + f.h;
      });
      return { w, d, top };
    }
    _setView(v) {
      this.state.view = v;
      this.root.querySelector('[data-act="view3d"]').classList.toggle('on', v === '3D');
      this.root.querySelector('[data-act="view2d"]').classList.toggle('on', v === '2D');
      this._fitCamera();
    }
    _fitCamera() {
      if (!this.cam) return;
      const { w, d, top } = this._sceneSize();
      const r = Math.max(w, d, 40);
      const cy = top / 2;
      this.controls.target.set(0, cy, 0);
      const upZ = this.state.coordBasis === 'center' ? 1 : -1;  // 左下基準：-Z 朝畫面上，+X 右
      if (this.state.view === '2D') {
        this.cam.up.set(0, 0, upZ);
        this.cam.position.set(0, r * 1.8 + top, 0);
        this.controls.enableRotate = false;
      } else {
        this.cam.up.set(0, 1, 0);
        this.cam.position.set(-r * 0.95, r * 0.95 + top, r * 1.15);
        this.controls.enableRotate = true;
      }
      this.controls.update();
    }

    // ===========================================================================
    // 7b. 疊構分析：剖面圖 + 面積利用率
    // ===========================================================================
    _toggleAnalysis(force) {
      const on = force === undefined ? !this.el.panel.classList.contains('on') : force;
      this.el.panel.classList.toggle('on', on);
      this.root.querySelector('[data-act="analysis"]').classList.toggle('on', on);
      if (on) this._renderAnalysis();
    }
    // 單層面積利用率：以格點取樣計算元件足跡（含旋轉）聯集佔比
    _floorUtil(f) {
      const area = f.w * f.d;
      if (!f.comps.length) return { area, used: 0, util: 0 };
      const step = Math.max(0.5, Math.min(f.w, f.d) / 80);
      let cov = 0, tot = 0;
      for (let px = -f.w / 2; px <= f.w / 2; px += step)
        for (let pz = -f.d / 2; pz <= f.d / 2; pz += step) {
          tot++;
          for (const c of f.comps) {
            const a = (c.rot || 0) * Math.PI / 180, dx = px - c.x, dz = pz - c.y;
            const lx = dx * Math.cos(a) + dz * Math.sin(a), lz = -dx * Math.sin(a) + dz * Math.cos(a);
            if (Math.abs(lx) <= c.w / 2 && Math.abs(lz) <= c.d / 2) { cov++; break; }
          }
        }
      const util = tot ? cov / tot : 0;
      return { area, used: util * area, util };
    }
    // 側視剖面 SVG（X 為寬度方向、Y 為堆疊高度，由下往上）
    _crossSectionSVG() {
      const floors = this.state.floors;
      const maxW = Math.max(10, ...floors.map(f => f.w));
      const totalH = floors.reduce((s, f) => s + f.h, 0) || 1;
      const W = 300, padX = 36, padTop = 12, padBot = 18;
      const plotH = Math.min(300, Math.max(110, totalH * 7));
      const H = plotH + padTop + padBot;
      const x0 = W / 2, xs = (W - 2 * padX) / maxW, ys = plotH / totalH;
      const mx = x => (x0 + x * xs).toFixed(1);
      const my = h => (padTop + (totalH - h) * ys).toFixed(1);
      let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
      let cum = 0;
      floors.forEach(f => {
        const base = cum, top = cum + f.h;
        svg += `<rect x="${mx(-f.w / 2)}" y="${my(top)}" width="${(f.w * xs).toFixed(1)}" height="${(f.h * ys).toFixed(1)}" fill="#172033" stroke="#334155"/>`;
        f.comps.forEach(c => {
          const ct = base + (c.z || 0) + c.h;
          svg += `<rect x="${mx(c.x - c.w / 2)}" y="${my(ct)}" width="${(c.w * xs).toFixed(1)}" height="${(c.h * ys).toFixed(1)}" fill="${c.color}" fill-opacity="0.85" stroke="#0f172a" stroke-width="0.5"/>`;
        });
        svg += `<text x="4" y="${my((base + top) / 2)}" dy="3" fill="#94a3b8" font-size="9">${this._esc(f.name)}</text>`;
        svg += `<text x="${W - 3}" y="${my(top)}" dy="3" fill="#64748b" font-size="9" text-anchor="end">${top.toFixed(1)}</text>`;
        cum = top;
      });
      svg += `<line x1="${padX}" y1="${my(0)}" x2="${W - padX}" y2="${my(0)}" stroke="#475569"/>`;
      svg += `<text x="${W - 3}" y="${my(0)}" dy="3" fill="#64748b" font-size="9" text-anchor="end">0</text></svg>`;
      return svg;
    }
    _renderAnalysis() {
      const floors = this.state.floors;
      const totalH = floors.reduce((s, f) => s + f.h, 0);
      const nComp = floors.reduce((s, f) => s + f.comps.length, 0);
      let html = `<h3>疊構分析 · Stack Analysis</h3>`;
      html += `<div class="total">總高度 <b>${totalH.toFixed(1)}</b>　樓層 <b>${floors.length}</b>　元件 <b>${nComp}</b></div>`;
      if (this.state.drc.on) {
        const v = this._violations || [];
        html += `<h4>DRC 違規（${v.length}）</h4>`;
        if (!v.length) html += `<div class="total" style="color:#86efac">✓ 全部通過（間距≥${this.state.drc.minSpacing}、邊距${this.state.drc.edgeMargin}）</div>`;
        else html += '<table>' + v.map(x => `<tr><td>${x.sev >= 2 ? '🔴' : '🟠'}</td><td>${this._esc(x.text)}</td></tr>`).join('') + '</table>';
      }
      html += `<h4>側視剖面 Cross-section</h4>` + this._crossSectionSVG();
      html += `<h4>面積利用率 Utilization</h4><table><tr><th>樓層</th><th>面積</th><th>利用率</th></tr>`;
      floors.forEach(f => {
        const u = this._floorUtil(f), pct = u.util * 100;
        html += `<tr><td>${this._esc(f.name)}</td><td>${(f.w * f.d).toFixed(0)}</td>` +
          `<td>${pct.toFixed(0)}%<div class="bar"><i class="${pct > 85 ? 'hi' : ''}" style="width:${Math.min(100, pct)}%"></i></div></td></tr>`;
      });
      html += `</table>`;
      this.el.panelBody.innerHTML = html;
    }

    // ===========================================================================
    // 7c. BOM / 疊構表匯出（CSV）
    // ===========================================================================
    exportBOM() {
      const esc = v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      // X/Y 以目前座標基準（左下/中心）輸出，與編輯器一致
      const lines = ['Floor,Cumulative Top,Floor WxD,Grid,Category,Component,W,D,H,X,Y,Z,Rotation,Footprint Area,Gap Note'];
      let cum = 0;
      this.state.floors.forEach(f => {
        cum += f.h;
        if (!f.comps.length) { lines.push([f.name, cum.toFixed(2), `${f.w}x${f.d}`, f.grid || 1, '', '(empty)', '', '', '', '', '', '', '', '', ''].map(esc).join(',')); return; }
        f.comps.forEach((c, i) => lines.push([
          i === 0 ? f.name : '', i === 0 ? cum.toFixed(2) : '', i === 0 ? `${f.w}x${f.d}` : '', i === 0 ? (f.grid || 1) : '',
          c.cat, c.name, c.w, c.d, c.h,
          (+this._dispX(c.x, f).toFixed(3)), (+this._dispY(c.y, f).toFixed(3)), c.z || 0, c.rot || 0,
          (c.w * c.d).toFixed(1), c.gap || '',
        ].map(esc).join(',')));
      });
      const totalH = this.state.floors.reduce((s, f) => s + f.h, 0);
      lines.push('', '# Summary', `Coordinate basis,${this.state.coordBasis === 'center' ? 'Center origin' : 'Lower-left origin'}`,
        `Total stack height,${totalH.toFixed(2)}`, `Floor count,${this.state.floors.length}`);
      this.state.floors.forEach(f => lines.push(`Utilization ${esc(f.name)},${(this._floorUtil(f).util * 100).toFixed(1)}%`));
      return lines.join('\n');
    }

    // ===========================================================================
    // 7d. 量測工具：點兩元件量測中心距，可回填 gap_note
    // ===========================================================================
    _toggleMeasure() {
      this.state.measure = !this.state.measure;
      this.root.querySelector('[data-act="measure"]').classList.toggle('on', this.state.measure);
      this.el.stage.style.cursor = this.state.measure ? 'crosshair' : '';
      if (this.controls) this.controls.enableRotate = this.state.measure ? false : (this.state.view === '3D');
      if (!this.state.measure) { this.measure = null; this._clearMeasure(); }
      else { this.measure = { a: null }; }
    }
    _findComp(id) {
      for (let idx = 0; idx < this.state.floors.length; idx++) {
        const c = this.state.floors[idx].comps.find(x => x.id === id);
        if (c) return { c, idx };
      }
      return null;
    }
    _compName(id) { const r = this._findComp(id); return r ? r.c.name : ''; }
    _measurePick(id) {
      if (!id) return;
      if (!this.measure) this.measure = { a: null };
      if (!this.measure.a) { this.measure.a = id; this.state.selected = id; this._rebuildScene(); return; }
      if (this.measure.a === id) return;
      const pa = this.meshById[this.measure.a].position.clone();
      const pb = this.meshById[id].position.clone();
      const dxz = Math.hypot(pa.x - pb.x, pa.z - pb.z);
      const d3 = pa.distanceTo(pb);
      this._drawMeasure(pa, pb, dxz);
      const aName = this._compName(this.measure.a);
      const write = confirm(`平面中心距 ${dxz.toFixed(2)}，3D 距離 ${d3.toFixed(2)}。\n按「確定」將此距離寫入該元件的間隔備註。`);
      if (write) { this._pushHistory(); const r = this._findComp(id); if (r) r.c.gap = `${dxz.toFixed(2)} to ${aName}`; }
      this.measure.a = null; this.state.selected = null;
      this._rebuildScene();
    }
    _drawMeasure(pa, pb, dist) {
      this._clearMeasure();
      const mat = new THREE.LineBasicMaterial({ color: '#fbbf24', depthTest: false, transparent: true });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pa, pb]), mat);
      line.renderOrder = 1000; this.measureGroup.add(line);
      [pa, pb].forEach(p => {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(1.3, 10, 10),
          new THREE.MeshBasicMaterial({ color: '#fbbf24', depthTest: false }));
        dot.position.copy(p); dot.renderOrder = 1000; this.measureGroup.add(dot);
      });
      const mid = pa.clone().add(pb).multiplyScalar(0.5);
      this.measureGroup.add(this._makeLabel(`Δ ${dist.toFixed(2)}`, mid));
    }
    _clearMeasure() { if (this.measureGroup) this._disposeGroup(this.measureGroup); }

    // ===========================================================================
    // 8. 規格表（CSV）匯入 / 匯出
    // ===========================================================================
    _pickSpec() {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.csv,.xlsx,.xls,text/csv';
      inp.onchange = () => {
        const f = inp.files[0]; if (!f) return;
        const isXlsx = /\.xls[xmb]?$/i.test(f.name);
        const r = new FileReader();
        r.onload = () => {
          try { isXlsx ? this.importSpecXLSX(r.result) : this.importSpecCSV(r.result); }
          catch (err) { alert('規格表解析失敗：' + err.message); }
        };
        isXlsx ? r.readAsArrayBuffer(f) : r.readAsText(f);
      };
      inp.click();
    }
    // 產生並下載 Excel 範例（需引入 SheetJS）
    _downloadExampleXLSX() {
      if (!window.XLSX) { alert('未載入 SheetJS (xlsx) 函式庫，無法產生 Excel'); return; }
      const rows = parseCSV(EXAMPLE_SPEC).filter(r => r.some(c => c.trim() !== ''));
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Spec');
      XLSX.writeFile(wb, 'spec-example.xlsx');
    }
    _download(name, content) {
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    // 由 CSV 文字建立整個設計（樓層 + 元件）
    importSpecCSV(text) {
      const rows = parseCSV(text).filter(r => r.some(c => c.trim() !== ''));
      return this._importSpecRows(rows);
    }
    // 由 Excel (.xlsx/.xls) ArrayBuffer 建立設計（需引入 SheetJS）
    // 每個工作表 = 一個獨立設計方案，可在工具列切換。
    importSpecXLSX(buffer) {
      if (!window.XLSX) throw new Error('未載入 SheetJS (xlsx) 函式庫');
      const wb = XLSX.read(buffer, { type: 'array' });
      const schemes = [];
      wb.SheetNames.forEach(name => {
        const ws = wb.Sheets[name];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
          .map(r => r.map(c => String(c == null ? '' : c)))
          .filter(r => r.some(c => c.trim() !== ''));
        if (rows.length < 2) return;                       // 跳過空白工作表
        try { schemes.push({ name, floors: this._buildFloorsFromRows(rows) }); }
        catch (e) { /* 跳過無效工作表 */ }
      });
      if (!schemes.length) throw new Error('Excel 中沒有有效的規格表工作表');
      this._loadSchemes(schemes);
    }
    // 單一規格表（CSV）→ 單一方案
    _importSpecRows(rows) {
      this._loadSchemes([{ name: '方案 1', floors: this._buildFloorsFromRows(rows) }]);
    }
    // 由二維陣列（首列為表頭）建立樓層與元件，回傳 floors（純函式）
    _buildFloorsFromRows(rows) {
      if (rows.length < 2) throw new Error('規格表沒有資料列');
      const head = rows[0].map(h => h.trim().toLowerCase());
      const col = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
      const ci = {
        floor: col('floor', '樓層', 'layer'),
        fw: col('floor_w', 'floor_width'), fd: col('floor_d', 'floor_depth'), fh: col('floor_h', 'floor_height'),
        grid: col('grid', 'floor_grid', '格距'),
        thick: col('thickness', '板厚'),
        cat: col('category', '類別', 'cat'),
        name: col('component', 'name', '元件', '元件名稱'),
        w: col('width', 'w', '寬'), d: col('depth', 'd', '深'), h: col('height', 'h', '高', '厚'),
        x: col('x'), y: col('y'), z: col('z'),
        rot: col('rotation', 'rot', '旋轉', '角度'),
        gap: col('gap_note', 'gap', '間隔', '間隔備註', 'note'),
      };
      if (ci.name < 0) throw new Error('缺少 component 欄位');
      const num = (r, i, def = 0) => { if (i < 0) return def; const v = parseFloat(r[i]); return isFinite(v) ? v : def; };
      const str = (r, i, def = '') => { if (i < 0) return def; return (r[i] || '').trim() || def; };
      const palette = { cowos: '#3b82f6', info: '#10b981', soic: '#f59e0b' };

      const map = new Map(); const order = []; let lastFloor = 'Layer 1';
      rows.slice(1).forEach(r => {
        let fname = str(r, ci.floor, ''); if (!fname) fname = lastFloor; else lastFloor = fname;
        if (!map.has(fname)) {
          map.set(fname, { id: uid(), name: fname, w: num(r, ci.fw, 120), d: num(r, ci.fd, 120), h: num(r, ci.fh, 12), grid: num(r, ci.grid, 1), thickness: num(r, ci.thick, 0.4), comps: [] });
          order.push(fname);
        }
        const f = map.get(fname);
        const name = str(r, ci.name, ''); if (!name) return; // 純樓層定義列
        const cat = str(r, ci.cat, 'Custom');
        const color = palette[cat.toLowerCase().replace(/[^a-z]/g, '')] || '#64748b';
        f.comps.push({
          id: uid(), cat, type: 'custom', name, color,
          w: num(r, ci.w, 10), d: num(r, ci.d, 10), h: num(r, ci.h, 2),
          x: this._storeX(num(r, ci.x, 0), f), y: this._storeY(num(r, ci.y, 0), f), z: num(r, ci.z, 0),
          rot: num(r, ci.rot, 0), gap: str(r, ci.gap, ''),
        });
      });
      const floors = order.map(n => map.get(n));
      if (!floors.length) throw new Error('未解析到任何樓層');
      return floors;
    }

    // ---- 設計方案（多工作表）----
    _loadSchemes(schemes) {
      this._pushHistory();
      this.state.schemes = schemes;
      this._reindexUid();
      this._applyScheme(0);
      this._renderSchemeSel();
    }
    _applyScheme(i) {
      const s = this.state.schemes[i]; if (!s) return;
      this.state.activeScheme = i;
      this.state.floors = s.floors;          // 直接引用，編輯即時保存於該方案
      this.state.activeFloor = 0;
      this.state.selected = null;
      this._hideMenu();
      this._renderTabs(); this._syncFloorFields(); this._rebuildScene(); this._fitCamera();
    }
    _renderSchemeSel() {
      const sel = this.root.querySelector('[data-fld="scheme"]');
      if (!sel) return;
      const schemes = this.state.schemes || [];
      sel.innerHTML = schemes.map((s, i) => `<option value="${i}">方案：${this._esc(s.name)}</option>`).join('');
      sel.value = String(this.state.activeScheme || 0);
      sel.style.display = schemes.length > 1 ? '' : 'none';
    }

    // 將目前設計匯出為 CSV 規格表（與匯入格式相容，可往返）
    exportSpecCSV() {
      const head = 'floor,floor_w,floor_d,floor_h,grid,thickness,category,component,width,depth,height,x,y,z,rotation,gap_note';
      const esc = v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const lines = [head];
      this.state.floors.forEach(f => {
        if (!f.comps.length) { lines.push([f.name, f.w, f.d, f.h, f.grid || 1, this._slabT(f), '', '', '', '', '', '', '', '', '', ''].map(esc).join(',')); return; }
        f.comps.forEach((c, i) => lines.push([
          i === 0 ? f.name : '', i === 0 ? f.w : '', i === 0 ? f.d : '', i === 0 ? f.h : '', i === 0 ? (f.grid || 1) : '', i === 0 ? this._slabT(f) : '',
          c.cat, c.name, c.w, c.d, c.h,
          (+this._dispX(c.x, f).toFixed(3)), (+this._dispY(c.y, f).toFixed(3)), c.z, c.rot || 0, c.gap || '',
        ].map(esc).join(',')));
      });
      return lines.join('\n');
    }

    // ---- 公開 API（可程式化匯入/匯出設計）----
    exportJSON() { return JSON.stringify({ floors: this.state.floors }, null, 2); }
    importJSON(json) {
      const o = typeof json === 'string' ? JSON.parse(json) : json;
      if (o && o.floors) this._loadSchemes([{ name: o.name || '方案 1', floors: o.floors }]);
    }

    // ===========================================================================
    // 9. 進度儲存（localStorage：自動存檔 + 具名存檔）
    // ===========================================================================
    _lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
    _lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

    // 序列化完整工作狀態
    _serialize() {
      return {
        v: 1, savedAt: new Date().toISOString(),
        schemes: this.state.schemes, activeScheme: this.state.activeScheme, activeFloor: this.state.activeFloor,
        coordBasis: this.state.coordBasis, labels: this.state.labels, names: this.state.names,
        drc: { minSpacing: this.state.drc.minSpacing, edgeMargin: this.state.drc.edgeMargin, minVGap: this.state.drc.minVGap, on: this.state.drc.on, boundary: this.state.drc.boundary },
      };
    }
    // 套用快照到 state（不碰場景，供初始化還原用）
    _applySnapshot(s) {
      if (!s || !Array.isArray(s.schemes) || !s.schemes.length) return false;
      this.state.schemes = s.schemes;
      this.state.activeScheme = Math.min(s.activeScheme || 0, s.schemes.length - 1);
      this.state.floors = this.state.schemes[this.state.activeScheme].floors;
      this.state.activeFloor = Math.min(s.activeFloor || 0, this.state.floors.length - 1);
      this.state.coordBasis = s.coordBasis || 'LL';
      this.state.labels = !!s.labels;
      this.state.names = s.names === undefined ? true : !!s.names;   // 預設開啟；舊存檔無此欄位時亦視為開啟
      if (s.drc) Object.assign(this.state.drc, s.drc);
      this.state.selected = null;
      this._reindexUid();
      return true;
    }
    // 掃描所有 id，把 uid 計數器推到最大值之後，避免新元件撞號
    _reindexUid() {
      let mx = 0;
      (this.state.schemes || []).forEach(s => (s.floors || []).forEach(f => {
        [...(f.comps || []), ...(f.keepouts || [])].forEach(o => {
          const n = parseInt(String(o.id).replace(/\D/g, ''), 10); if (n > mx) mx = n;
        });
      }));
      bumpUid(mx);
    }
    // 載入快照並刷新 UI/場景
    _loadSnapshot(s) {
      if (!this._applySnapshot(s)) return false;
      this._syncToggles();
      this._renderTabs(); this._renderSchemeSel(); this._syncFloorFields();
      this._rebuildScene(); this._fitCamera();
      return true;
    }
    _syncToggles() {
      const set = (sel, on) => { const el = this.root.querySelector(sel); if (el) el.classList.toggle('on', on); };
      const cb = this.root.querySelector('[data-fld="coordbasis"]'); if (cb) cb.value = this.state.coordBasis;
      set('[data-act="drc"]', this.state.drc.on);
      set('[data-act="labels"]', this.state.labels);
      set('[data-act="names"]', this.state.names);
      set('[data-act="snap"]', this.state.snap);
    }
    _setStatus(msg) {
      const t = this.el.toast; if (!t) return;
      t.textContent = msg; t.classList.add('on');
      clearTimeout(this._toastT); this._toastT = setTimeout(() => t.classList.remove('on'), 2200);
    }
    // 自動存檔（防抖）
    _autoSave() {
      clearTimeout(this._autoT);
      this._autoT = setTimeout(() => {
        if (this._lsSet(LS_AUTO, this._serialize()))
          this._setStatus('✓ 已自動儲存 ' + new Date().toLocaleTimeString());
      }, 800);
    }
    // 初始化時還原自動存檔（在 _buildDOM 前呼叫，只動 state）
    _tryRestoreAuto() {
      const s = this._lsGet(LS_AUTO);
      if (s) this._applySnapshot(s);
    }
    // 具名存檔
    _saveNamed() {
      const def = '進度 ' + new Date().toLocaleString();
      const name = prompt('儲存進度名稱：', def);
      if (!name) return;
      const saves = this._lsGet(LS_SAVES) || {};
      saves[name] = this._serialize();
      if (this._lsSet(LS_SAVES, saves)) this._setStatus('✓ 已儲存「' + name + '」');
      else alert('儲存失敗：瀏覽器儲存空間不足或被停用。');
    }
    // 載入清單彈出選單
    _showLoadMenu() {
      const saves = this._lsGet(LS_SAVES) || {};
      const auto = this._lsGet(LS_AUTO);
      const m = this.el.menu;
      const fmt = t => (t || '').replace('T', ' ').slice(0, 19);
      const entries = Object.entries(saves).sort((a, b) => (b[1].savedAt || '').localeCompare(a[1].savedAt || ''));
      let html = `<h3>載入進度</h3>`;
      if (auto) html += `<div class="save-row"><span class="sv-name">⟲ 自動存檔<br><small>${fmt(auto.savedAt)}</small></span><button class="btn" data-load="__auto__">載入</button></div>`;
      if (!entries.length && !auto) html += `<div class="cat-desc" style="padding:6px 0">尚無已儲存的進度</div>`;
      entries.forEach(([name]) => {
        const sn = saves[name];
        html += `<div class="save-row"><span class="sv-name">${this._esc(name)}<br><small>${fmt(sn.savedAt)}</small></span>`
          + `<button class="btn" data-load="${this._esc(name)}">載入</button>`
          + `<button class="btn danger" data-del="${this._esc(name)}">✕</button></div>`;
      });
      m.innerHTML = html;
      const btn = this.root.querySelector('[data-act="load"]'), r = this.el.stage.getBoundingClientRect(), br = btn.getBoundingClientRect();
      m.style.left = Math.max(4, Math.min(br.left - r.left, r.width - 250)) + 'px';
      m.style.top = Math.max(4, br.bottom - r.top + 4) + 'px';
      m.classList.add('on');
      m.querySelectorAll('[data-load]').forEach(b => b.onclick = () => {
        const key = b.dataset.load, snap = key === '__auto__' ? auto : saves[key];
        this._pushHistory();
        if (this._loadSnapshot(snap)) this._setStatus('✓ 已載入');
        this._hideMenu();
      });
      m.querySelectorAll('[data-del]').forEach(b => b.onclick = (ev) => {
        ev.stopPropagation();
        delete saves[b.dataset.del]; this._lsSet(LS_SAVES, saves); this._showLoadMenu();
      });
    }
  }

  if (!customElements.get('chip-floor-planner'))
    customElements.define('chip-floor-planner', ChipFloorPlanner);
})();
