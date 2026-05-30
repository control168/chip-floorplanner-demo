/* =============================================================================
 * Chip Floor Planner  —  晶片堆疊樓層擺盤工具 (2D ⇄ 3D)
 * -----------------------------------------------------------------------------
 * 可外掛的 Web Component。用法：
 *   <script src="https://unpkg.com/three@0.128.0/build/three.min.js"></script>
 *   <script src="https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
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
  const EXAMPLE_SPEC =
`floor,floor_w,floor_d,floor_h,category,component,width,depth,height,x,y,z,rotation,gap_note
Substrate Level,55,55,3,CoWoS,Package Substrate,55,55,3,0,0,0,0,Organic build-up substrate (BGA)
Interposer Level,55,55,2.5,CoWoS,C4 Bump Array,50,50,0.5,0,0,0,0,Substrate-to-interposer C4 bumps
Interposer Level,,,,CoWoS,Silicon Interposer,50,50,1.5,0,0,0.5,0,TSV silicon interposer (>1.2x reticle)
Die/HBM Level,55,55,9,CoWoS,Logic Die (SoC/GPU),24,24,4,0,0,0,0,Main compute die (chiplet)
Die/HBM Level,,,,CoWoS,HBM Stack 1,11,11,8,20,8,0,0,12-Hi DRAM cube; ~0.4mm to logic
Die/HBM Level,,,,CoWoS,HBM Stack 2,11,11,8,20,-8,0,0,12-Hi DRAM cube
Die/HBM Level,,,,CoWoS,HBM Stack 3,11,11,8,-20,8,0,0,12-Hi DRAM cube
Die/HBM Level,,,,CoWoS,HBM Stack 4,11,11,8,-20,-8,0,0,12-Hi DRAM cube
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
  .hint { position: absolute; left: 12px; bottom: 10px; font-size: 11px; color: #64748b;
          background: rgba(15,23,42,.7); padding: 5px 9px; border-radius: 6px; pointer-events: none; }
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
        measure: false,
        schemes: [],
        activeScheme: 0,
      };
      this._addFloor('Substrate Level', 120, 120, 10);
      this._addFloor('Interposer Level', 120, 120, 6);
      this._addFloor('Die / HBM Level', 120, 120, 14);
      this.state.activeFloor = 0;
      this.state.schemes = [{ name: '方案 1', floors: this.state.floors }];
      this._hist = { undo: [], redo: [] };
      this._buildDOM();
      this._waitThree();
    }

    // ---- 樓層資料 ----
    _addFloor(name, w, d, h) {
      this.state.floors.push({ id: uid(), name, w, d, h, comps: [] });
    }
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
            <div class="field">樓層 W<input data-fld="fw" type="number" min="10"></div>
            <div class="field">D<input data-fld="fd" type="number" min="10"></div>
            <div class="field">高<input data-fld="fh" type="number" min="1"></div>
            <div class="sep"></div>
            <button class="btn" data-act="addfloor">+ 新增樓層</button>
            <button class="btn on" data-act="snap">⌁ 吸附對齊</button>
            <button class="btn" data-act="labels">🏷 間隔標註</button>
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
          </div>
          <div class="tabs"></div>
          <div class="stage">
            <div class="drop-hl"></div>
            <div class="badge"></div>
            <div class="hint">拖曳元件到此 · 左鍵選取/拖移(自動吸附) · R 旋轉(Shift+R 反向) · Del 刪除 · 右鍵編輯屬性 · 滾輪縮放</div>
            <div class="menu"></div>
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
      };
      app.querySelector('.panel .close').onclick = () => this._toggleAnalysis(false);

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
          if (inp.dataset.fld === 'scheme') this._applyScheme(parseInt(inp.value, 10));
          else this._editFloorField(inp.dataset.fld, parseFloat(inp.value));
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
      set('fw', f.w); set('fd', f.d); set('fh', f.h);
    }

    // ---- toolbar 動作 ----
    _toolbar(act) {
      if (act === 'view3d') this._setView('3D');
      else if (act === 'view2d') this._setView('2D');
      else if (act === 'undo') this._undo();
      else if (act === 'redo') this._redo();
      else if (act === 'addfloor') {
        this._pushHistory();
        this._addFloor('Layer ' + (this.state.floors.length + 1), this.floor.w, this.floor.d, 8);
        this.state.activeFloor = this.state.floors.length - 1;
        this._renderTabs(); this._syncFloorFields(); this._rebuildScene();
      } else if (act === 'snap') {
        this.state.snap = !this.state.snap;
        this.root.querySelector('[data-act="snap"]').classList.toggle('on', this.state.snap);
      } else if (act === 'labels') {
        this.state.labels = !this.state.labels;
        this.root.querySelector('[data-act="labels"]').classList.toggle('on', this.state.labels);
        this._rebuildScene();
      } else if (act === 'spec') this._pickSpec();
      else if (act === 'example') this._download('spec-example.csv', EXAMPLE_SPEC);
      else if (act === 'examplexlsx') this._downloadExampleXLSX();
      else if (act === 'analysis') this._toggleAnalysis();
      else if (act === 'bom') this._download('chip-bom.csv', this.exportBOM());
      else if (act === 'measure') this._toggleMeasure();
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
      if (k === 'fw') f.w = v; else if (k === 'fd') f.d = v; else if (k === 'fh') f.h = v;
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
      scene.add(this.floorGroup, this.compGroup, this.labelGroup, this.measureGroup);

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
      };
      loop();
    }

    _resize() {
      if (!this.renderer) return;
      const w = this.el.stage.clientWidth, h = this.el.stage.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.cam.aspect = w / h;
      this.cam.updateProjectionMatrix();
    }

    // 重建整個場景（樓層 + 元件）
    _rebuildScene() {
      if (!this.scene) return;
      this._disposeGroup(this.floorGroup);
      this._disposeGroup(this.compGroup);
      this._disposeGroup(this.labelGroup);
      this.meshById = {};
      this._labelN = 0;

      this.state.floors.forEach((f, idx) => {
        const baseY = this._floorBaseY(idx);
        const active = idx === this.state.activeFloor;
        // 底板
        const g = new THREE.BoxGeometry(f.w, 0.4, f.d);
        const m = new THREE.MeshStandardMaterial({
          color: active ? '#1e293b' : '#172033',
          transparent: true, opacity: active ? 1 : 0.45,
        });
        const slab = new THREE.Mesh(g, m);
        slab.position.set(0, baseY + 0.2, 0);
        slab.receiveShadow = true;
        this.floorGroup.add(slab);
        // 網格線（僅作用層）
        if (active) {
          const grid = new THREE.GridHelper(Math.max(f.w, f.d), Math.max(f.w, f.d) / 10, '#334155', '#243044');
          grid.position.set(0, baseY + 0.42, 0);
          this.floorGroup.add(grid);
        }
        // 元件
        f.comps.forEach(c => {
          const mesh = this._makeMesh(c, baseY, active);
          this.compGroup.add(mesh);
          this.meshById[c.id] = mesh;
          if (this.state.labels && c.gap) this._addLabel(c, baseY);
        });
      });
      this._checkCollisions();
      if (this.el.panel && this.el.panel.classList.contains('on')) this._renderAnalysis();
    }

    // 間隔標註：在元件上方以引線 + 文字標籤顯示 gap_note
    _addLabel(c, baseY) {
      const topY = baseY + 0.4 + (c.z || 0) + c.h;
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
    _makeLabel(text, pos) {
      const fs = 30, pad = 10, dpr = 2;
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
      const k = 0.085;                                  // 像素 → 世界單位
      sp.scale.set(w * k, h * k, 1);
      sp.position.copy(pos); sp.position.y += h * k / 2 + 1;
      sp.renderOrder = 999;
      return sp;
    }

    _makeMesh(c, baseY, active) {
      const geo = new THREE.BoxGeometry(c.w, c.h, c.d);
      const mat = new THREE.MeshStandardMaterial({
        color: c.color, metalness: 0.25, roughness: 0.55,
        transparent: !active, opacity: active ? 1 : 0.5,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.position.set(c.x, baseY + 0.4 + (c.z || 0) + c.h / 2, c.y);
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
    // 5. 碰撞偵測（3D AABB，跨樓層）— 碰撞顯示亮紅色
    // ===========================================================================
    // 定向包圍盒（OBB）：僅繞 Y 軸旋轉，故 Y 區間不受旋轉影響、XZ 平面為旋轉矩形。
    _obb(c, idx) {
      const baseY = this._floorBaseY(idx);
      const cy = baseY + 0.4 + (c.z || 0) + c.h / 2;
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
    _checkCollisions() {
      const all = [];
      this.state.floors.forEach((f, idx) =>
        f.comps.forEach(c => all.push({ c, box: this._obb(c, idx) })));
      const hit = new Set();
      for (let i = 0; i < all.length; i++)
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i].box, b = all[j].box;
          const overlap = a.miny < b.maxy && a.maxy > b.miny && // Y 區間重疊
                          this._overlapXZ(a, b);                 // XZ 旋轉矩形重疊
          if (overlap) { hit.add(all[i].c.id); hit.add(all[j].c.id); }
        }
      // 上色
      let n = 0;
      all.forEach(({ c }) => {
        const mesh = this.meshById[c.id];
        if (!mesh) return;
        const m = mesh.material;
        if (hit.has(c.id)) {
          m.color.set('#ff1133');                 // 亮紅
          m.emissive.set('#ff1133');
          m.emissiveIntensity = 0.85;
          n++;
        } else {
          m.color.set(mesh.userData.baseColor);
          if (this.state.selected === c.id) { m.emissive.set('#1d4ed8'); m.emissiveIntensity = 0.4; }
          else { m.emissive.set('#000000'); m.emissiveIntensity = 0; }
        }
      });
      const bad = n > 0;
      this.el.badge.classList.toggle('bad', bad);
      this.el.badge.textContent = bad ? `⚠ ${n} 個元件碰撞` : '✓ 無碰撞';
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
      const baseY = this._floorBaseY(this.state.activeFloor) + 0.4;
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

    _onDown(e) {
      if (e.button !== 0) return;
      if (this.state.measure) { this._measurePick(this._pickComp(e, true)); return; }
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
      if (!this.drag) return;
      this._ndcFrom(e);
      const hit = this._planeHit();
      if (!hit) return;
      const c = this.floor.comps.find(x => x.id === this.drag.id);
      if (!c) return;
      if (!this.drag.moved) this._pushHistory();           // 拖移開始前存檔一次
      c.x = Math.round(hit.x); c.y = Math.round(hit.y);
      if (this.state.snap) this._applySnap(c);
      this.drag.moved = true;
      const mesh = this.meshById[c.id];
      if (mesh) { mesh.position.x = c.x; mesh.position.z = c.y; }
      this._checkCollisions();
    }
    _onUp() {
      if (this.drag) { this.drag = null; this.controls.enabled = true; }
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
      const c = {
        id: uid(), cat: data.cat, type: part.type,
        name: part.name, color: part.color,
        w: part.w, d: part.d, h: part.h,
        x: Math.round(hit.x), y: Math.round(hit.y), z: 0,
        rot: 0, gap: '',
      };
      this.floor.comps.push(c);
      this.state.selected = c.id;
      this._rebuildScene();
    }

    // ---- 右鍵屬性編輯選單 ----
    _onContext(e) {
      e.preventDefault();
      const id = this._pickComp(e);
      if (!id) { this._hideMenu(); return; }
      this.state.selected = id;
      this._rebuildScene();
      const c = this.floor.comps.find(x => x.id === id);
      this._showMenu(c, e);
    }
    _showMenu(c, e) {
      const m = this.el.menu;
      m.innerHTML = `
        <h3>編輯元件 · ${c.cat}</h3>
        <div class="row"><label>名稱</label><input data-k="name" value="${this._esc(c.name)}"></div>
        <div class="row"><label>尺寸 W/D/H</label>
          <div class="grid3">
            <input data-k="w" type="number" value="${c.w}">
            <input data-k="d" type="number" value="${c.d}">
            <input data-k="h" type="number" value="${c.h}">
          </div></div>
        <div class="row"><label>座標 X/Y/Z</label>
          <div class="grid3">
            <input data-k="x" type="number" value="${c.x}">
            <input data-k="y" type="number" value="${c.y}">
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
          if (['w', 'd', 'h', 'x', 'y', 'z', 'rot'].includes(k)) {
            const v = parseFloat(inp.value);
            if (isFinite(v)) c[k] = v;
          } else c[k] = inp.value;
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
      if (this.state.view === '2D') {
        this.cam.position.set(0, r * 1.8 + top, 0.01);
        this.controls.enableRotate = false;
      } else {
        this.cam.position.set(r * 0.95, r * 0.95 + top, r * 1.15);
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
      const lines = ['Floor,Cumulative Top,Floor WxD,Category,Component,W,D,H,X,Y,Z,Rotation,Footprint Area,Gap Note'];
      let cum = 0;
      this.state.floors.forEach(f => {
        cum += f.h;
        if (!f.comps.length) { lines.push([f.name, cum.toFixed(2), `${f.w}x${f.d}`, '', '(empty)', '', '', '', '', '', '', '', '', ''].map(esc).join(',')); return; }
        f.comps.forEach((c, i) => lines.push([
          i === 0 ? f.name : '', i === 0 ? cum.toFixed(2) : '', i === 0 ? `${f.w}x${f.d}` : '',
          c.cat, c.name, c.w, c.d, c.h, c.x, c.y, c.z || 0, c.rot || 0, (c.w * c.d).toFixed(1), c.gap || '',
        ].map(esc).join(',')));
      });
      const totalH = this.state.floors.reduce((s, f) => s + f.h, 0);
      lines.push('', '# Summary', `Total stack height,${totalH.toFixed(2)}`, `Floor count,${this.state.floors.length}`);
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
          map.set(fname, { id: uid(), name: fname, w: num(r, ci.fw, 120), d: num(r, ci.fd, 120), h: num(r, ci.fh, 12), comps: [] });
          order.push(fname);
        }
        const f = map.get(fname);
        const name = str(r, ci.name, ''); if (!name) return; // 純樓層定義列
        const cat = str(r, ci.cat, 'Custom');
        const color = palette[cat.toLowerCase().replace(/[^a-z]/g, '')] || '#64748b';
        f.comps.push({
          id: uid(), cat, type: 'custom', name, color,
          w: num(r, ci.w, 10), d: num(r, ci.d, 10), h: num(r, ci.h, 2),
          x: num(r, ci.x, 0), y: num(r, ci.y, 0), z: num(r, ci.z, 0),
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
      const head = 'floor,floor_w,floor_d,floor_h,category,component,width,depth,height,x,y,z,rotation,gap_note';
      const esc = v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const lines = [head];
      this.state.floors.forEach(f => {
        if (!f.comps.length) { lines.push([f.name, f.w, f.d, f.h, '', '', '', '', '', '', '', '', '', ''].map(esc).join(',')); return; }
        f.comps.forEach((c, i) => lines.push([
          i === 0 ? f.name : '', i === 0 ? f.w : '', i === 0 ? f.d : '', i === 0 ? f.h : '',
          c.cat, c.name, c.w, c.d, c.h, c.x, c.y, c.z, c.rot || 0, c.gap || '',
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
  }

  if (!customElements.get('chip-floor-planner'))
    customElements.define('chip-floor-planner', ChipFloorPlanner);
})();
