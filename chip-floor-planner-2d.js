/* =============================================================================
 * Chip Floor Planner 2D — WebGL-Free（SVG）版，為 RBI（如 Menlo ACR）最佳化
 *
 * Copyright © 2026 Curtis (control168 · control.tw@gmail.com). All Rights Reserved.
 * 專有授權（非開源）：須經作者書面授權方得使用，且授權得由作者隨時撤銷。See LICENSE.md.
 * -----------------------------------------------------------------------------
 * 與 WebGL 版 <chip-floor-planner> 共用同一份資料模型與 CSV/規格表格式：
 *   - 純 SVG 俯視平面（DOM，Menlo 原生重建、快、低頻寬，不需 GPU）
 *   - 左鍵選取/拖移、右側「屬性面板」取代右鍵選單（RBI 下右鍵常被封鎖）
 *   - DRC（間距/邊界/禁置區）、座標基準（左下/中心）、格距、板厚、元件名稱
 *   - CSV/Excel 規格表匯入匯出、BOM、進度儲存(localStorage)、復原/重做
 * ===========================================================================*/
(function () {
  'use strict';

  const LS_AUTO = 'chip-floorplanner:autosave';   // 與 WebGL 版共用自動存檔
  const LS_SAVES = 'chip-floorplanner:saves';
  const LS_PREV = 'chip-floorplanner:previous';   // 新建/載入前的自動備份「上一份」
  const PAD = 10;                                   // SVG 圖面留白（model 單位）
  const ISO = { A: 0.92, B: 0.5, ZE: 1.0 };         // 等角投影係數（繪製與反投影共用）

  let _uid = 1;
  const uid = () => 'c' + (_uid++);
  const bumpUid = (n) => { if (isFinite(n) && n + 1 > _uid) _uid = n + 1; };

  const CATALOG = {
    CoWoS: { color: '#3b82f6', desc: 'Chip-on-Wafer-on-Substrate', parts: [
      { type: 'substrate', name: 'Package Substrate', w: 70, d: 70, h: 5, color: '#1e3a5f' },
      { type: 'c4bump', name: 'C4 Bump Array', w: 58, d: 58, h: 1, color: '#6b7280' },
      { type: 'interposer', name: 'Silicon Interposer', w: 58, d: 58, h: 3, color: '#2563eb' },
      { type: 'logic', name: 'Logic Die (SoC)', w: 20, d: 20, h: 4, color: '#60a5fa' },
      { type: 'hbm', name: 'HBM Stack', w: 11, d: 13, h: 8, color: '#93c5fd' },
    ] },
    InFO: { color: '#10b981', desc: 'Integrated Fan-Out（無基板）', parts: [
      { type: 'rdl', name: 'RDL Layer', w: 50, d: 50, h: 1.5, color: '#065f46' },
      { type: 'logic', name: 'Logic Die', w: 18, d: 18, h: 4, color: '#34d399' },
      { type: 'lsi', name: 'LSI Bridge', w: 10, d: 22, h: 1.5, color: '#a7f3d0' },
      { type: 'mold', name: 'Molding Compound', w: 52, d: 52, h: 6, color: '#047857' },
      { type: 'solder', name: 'Solder Ball Array', w: 50, d: 50, h: 2, color: '#6b7280' },
    ] },
    SoIC: { color: '#f59e0b', desc: 'System-on-Integrated-Chip（3D 鍵合）', parts: [
      { type: 'basedie', name: 'Base Die / Wafer', w: 34, d: 34, h: 5, color: '#92400e' },
      { type: 'bond', name: 'Hybrid Bond', w: 26, d: 26, h: 0.6, color: '#fcd34d' },
      { type: 'topdie', name: 'Top Die', w: 26, d: 26, h: 4, color: '#fbbf24' },
      { type: 'tsv', name: 'TSV Array', w: 26, d: 26, h: 4, color: '#f59e0b' },
    ] },
  };

  function parseCSV(text) {
    const rows = []; let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
      else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch !== '\r') field += ch;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const CSS = `
  :host { all: initial; display: block; width: 100%; height: 100%;
          font-family: -apple-system, "Segoe UI", "Microsoft JhengHei", sans-serif; }
  * { box-sizing: border-box; }
  .app { display: flex; width: 100%; height: 100%; min-height: 480px; background: #0f172a; color: #e2e8f0; }
  .sidebar { width: 210px; flex: none; background: #1e293b; border-right: 1px solid #334155; display: flex; flex-direction: column; }
  .sidebar h2 { margin: 0; padding: 10px 12px; font-size: 12px; color: #94a3b8; border-bottom: 1px solid #334155; text-transform: uppercase; }
  .lib { overflow-y: auto; flex: 1; padding: 6px; }
  .cat-head { display: flex; align-items: center; gap: 6px; padding: 6px 6px; font-weight: 600; font-size: 12px; }
  .cat-dot { width: 10px; height: 10px; border-radius: 3px; }
  .cat-desc { font-size: 10px; color: #64748b; padding: 0 6px 4px 22px; }
  .item { display: flex; align-items: center; gap: 8px; padding: 5px 7px; margin: 2px 0; border-radius: 6px;
          cursor: grab; background: #0f172a; border: 1px solid #334155; }
  .item:hover { border-color: #64748b; }
  .swatch { width: 22px; height: 16px; border-radius: 3px; flex: none; }
  .item-name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-size { font-size: 10px; color: #64748b; }

  .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .toolbar { display: flex; align-items: center; gap: 6px; padding: 7px 10px; background: #1e293b;
             border-bottom: 1px solid #334155; flex-wrap: wrap; }
  .btn { background: #334155; color: #e2e8f0; border: 1px solid #475569; border-radius: 6px;
         padding: 5px 10px; font-size: 12px; cursor: pointer; }
  .btn:hover { background: #475569; }
  .btn.on { background: #3b82f6; border-color: #3b82f6; color: #fff; }
  .btn.danger { background: #7f1d1d; border-color: #991b1b; }
  .sep { width: 1px; height: 20px; background: #334155; }
  .sel { background: #0f172a; color: #e2e8f0; border: 1px solid #475569; border-radius: 6px; padding: 4px 7px; font-size: 12px; }
  .hinttxt { font-size: 11px; color: #64748b; }
  .tabs { display: flex; gap: 4px; padding: 6px 10px 0; background: #1e293b; flex-wrap: wrap; }
  .tab { padding: 5px 11px; font-size: 12px; border-radius: 6px 6px 0 0; cursor: pointer;
         background: #0f172a; border: 1px solid #334155; border-bottom: none; color: #94a3b8; }
  .tab.on { color: #fff; border-color: #3b82f6; }
  .tab .x { margin-left: 6px; color: #64748b; }
  .tab .x:hover { color: #ef4444; }

  .stagewrap { flex: 1; display: flex; min-height: 0; }
  .stage { flex: 1; position: relative; background: #0f172a; overflow: hidden; }
  svg.canvas { width: 100%; height: 100%; display: block; touch-action: none; }
  .hint { position: absolute; left: 12px; bottom: 10px; font-size: 11px; color: #64748b;
          background: rgba(15,23,42,.7); padding: 5px 9px; border-radius: 6px; pointer-events: none; }
  .badge { position: absolute; right: 12px; top: 12px; font-size: 12px; padding: 5px 11px; border-radius: 20px;
           background: #065f46; color: #d1fae5; pointer-events: none; }
  .badge.bad { background: #7f1d1d; color: #fecaca; }
  .drop { position: absolute; inset: 0; border: 2px dashed #3b82f6; opacity: 0; pointer-events: none; }
  .drop.on { opacity: 1; }
  .licbadge { position: absolute; right: 12px; bottom: 10px; font-size: 10px; color: #64748b;
              background: rgba(15,23,42,.72); padding: 4px 9px; border-radius: 6px; text-decoration: none;
              border: 1px solid #1e293b; }
  .licbadge:hover { color: #cbd5e1; }
  .toast { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); background: rgba(15,23,42,.92);
           color: #86efac; border: 1px solid #334155; padding: 6px 12px; border-radius: 8px; font-size: 12px;
           opacity: 0; transition: opacity .25s; pointer-events: none; }
  .toast.on { opacity: 1; }

  /* 右側屬性面板（取代右鍵選單） */
  .props { width: 270px; flex: none; background: #1e293b; border-left: 1px solid #334155; overflow-y: auto; padding: 12px; }
  .props h3 { margin: 0 0 4px; font-size: 13px; color: #f1f5f9; }
  .props h4 { margin: 16px 0 6px; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: .5px; }
  .props .muted { font-size: 12px; color: #64748b; margin: 6px 0 12px; }
  .row { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
  .row label { width: 88px; font-size: 11px; color: #94a3b8; flex: none; }
  .row input { flex: 1; min-width: 0; background: #0f172a; color: #e2e8f0; border: 1px solid #475569; border-radius: 5px; padding: 5px 7px; font-size: 12px; }
  .grid2 { display: flex; gap: 6px; flex: 1; }
  .grid2 input { width: 100%; }
  .pill { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 12px; background: #334155; color: #cbd5e1; }
  .viol { font-size: 11px; line-height: 1.5; }
  .viol div { padding: 2px 0; border-bottom: 1px solid #243044; }
  .props .actions { display: flex; gap: 6px; margin-top: 10px; }
  .props .actions .btn { flex: 1; text-align: center; }
  .note { font-size: 10px; color: #475569; margin-top: 14px; border-top: 1px dashed #334155; padding-top: 10px; line-height: 1.5; }
  .modal { position: absolute; inset: 0; background: rgba(2,6,23,.6); display: none; align-items: center; justify-content: center; z-index: 60; }
  .modal.on { display: flex; }
  .modal .box { background: #1e293b; border: 1px solid #475569; border-radius: 12px; padding: 18px 20px; width: 330px; box-shadow: 0 16px 50px rgba(0,0,0,.5); }
  .modal h3 { margin: 0 0 6px; font-size: 15px; color: #f1f5f9; }
  .modal p { font-size: 12px; color: #94a3b8; margin: 0 0 14px; line-height: 1.5; }
  .modal .opt { display: block; width: 100%; text-align: left; padding: 10px 12px; border-radius: 8px; background: #0f172a; border: 1px solid #334155; cursor: pointer; color: #e2e8f0; margin-bottom: 8px; }
  .modal .opt:hover { border-color: #3b82f6; background: #16233b; }
  .modal .opt b { display: block; font-size: 13px; }
  .modal .opt small { color: #64748b; font-size: 11px; }
  .modal .cancel { margin-top: 6px; text-align: center; color: #94a3b8; cursor: pointer; font-size: 12px; padding: 6px; }
  .modal .cancel:hover { color: #e2e8f0; }
  `;

  class ChipFloorPlanner2D extends HTMLElement {
    connectedCallback() {
      if (this._init) return; this._init = true;
      this.root = this.attachShadow({ mode: 'open' });
      this.state = {
        floors: [], activeFloor: 0, selected: null, snap: true, names: true,
        drc: { on: false, minSpacing: 0, edgeMargin: 0, minVGap: 0, boundary: true },
        coordBasis: 'LL', schemes: [], activeScheme: 0,
        view: 'top', isoRot: 0,                 // top=俯視平面 / iso=等角 2.5D
      };
      this._addFloor('Substrate Level', 120, 120, 10);
      this._addFloor('Interposer Level', 120, 120, 6);
      this._addFloor('Die / HBM Level', 120, 120, 14);
      this.state.activeFloor = 0;
      this.state.schemes = [{ name: '方案 1', floors: this.state.floors }];
      this._hist = { undo: [], redo: [] };
      this._tryRestoreAuto();
      this._buildDOM();
      this._render();
    }

    // ---------- 資料模型 ----------
    _addFloor(name, w, d, h, grid, thickness) {
      this.state.floors.push({ id: uid(), name, w, d, h, grid: grid || 1, thickness: thickness != null ? thickness : 0.4, comps: [], keepouts: [] });
    }
    get floor() { return this.state.floors[this.state.activeFloor]; }
    _slabT(f) { return f.thickness != null ? f.thickness : 0.4; }
    _maxW() { return this.state.floors.length ? this.state.floors[0].w : Infinity; }
    _maxD() { return this.state.floors.length ? this.state.floors[0].d : Infinity; }
    _floorBaseY(idx) { let y = 0; for (let i = 0; i < idx; i++) y += this.state.floors[i].h; return y; }

    // ---------- 座標基準（與 WebGL 版一致，確保 CSV 相容）----------
    _originX(f) { return this.state.coordBasis === 'center' ? 0 : -f.w / 2; }
    _originZ(f) { return this.state.coordBasis === 'center' ? 0 : f.d / 2; }
    _yFlip() { return this.state.coordBasis === 'center' ? 1 : -1; }
    _dispX(cx, f) { return cx - this._originX(f); }
    _dispY(cy, f) { return (cy - this._originZ(f)) * this._yFlip(); }
    _storeX(X, f) { return X + this._originX(f); }
    _storeY(Y, f) { return this._originZ(f) + Y * this._yFlip(); }
    _basisLabel() { return this.state.coordBasis === 'center' ? '中心' : '左下'; }
    _snapGrid(v, origin, g) { g = g || 1; return Math.round((v - origin) / g) * g + origin; }

    // ---------- SVG 座標對應（model → svg；origin 落畫面左下、CSV 相容）----------
    // svgX = PAD + mx + W/2 ; svgY = PAD + my + D/2 ; 旋轉 rotate(rot) 與 model 一致
    _sx(mx, f) { return PAD + mx + f.w / 2; }
    _sy(my, f) { return PAD + my + f.d / 2; }
    _pointerModel(e) {
      const svg = this.el.svg, f = this.floor;
      const ctm = svg.getScreenCTM(); if (!ctm) return { x: 0, y: 0 };
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      return { x: p.x - PAD - f.w / 2, y: p.y - PAD - f.d / 2 };
    }
    // 等角反投影：螢幕點 + 指定高度 zRef → model 座標（在該 Z 平面上求解，再反轉視角）
    _isoToModel(e, zRef) {
      const ctm = this.el.svg.getScreenCTM(); if (!ctm) return { x: 0, y: 0 };
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      const u = p.x / ISO.A;                          // wx - wy
      const v = (p.y + zRef * ISO.ZE) / ISO.B;        // wx + wy
      const wx = (u + v) / 2, wy = (v - u) / 2;
      const vr = (this.state.isoRot || 0) * Math.PI / 180, cv = Math.cos(vr), sv = Math.sin(vr);
      return { x: wx * cv + wy * sv, y: -wx * sv + wy * cv };   // 反轉視角旋轉
    }
    _compZc(idx, c) { return this._floorBaseY(idx) + this._slabT(this.state.floors[idx]) + (c.z || 0) + c.h / 2; }

    // ===========================================================================
    // DRC（與 WebGL 版同演算法）
    // ===========================================================================
    _obb(c, idx) {
      const baseY = this._floorBaseY(idx), cy = baseY + this._slabT(this.state.floors[idx]) + (c.z || 0) + c.h / 2;
      const a = (c.rot || 0) * Math.PI / 180;
      return { cx: c.x, cz: c.y, hw: c.w / 2, hd: c.d / 2, miny: cy - c.h / 2, maxy: cy + c.h / 2, cos: Math.cos(a), sin: Math.sin(a) };
    }
    _overlapXZ(A, B) {
      const axes = [{ x: A.cos, z: A.sin }, { x: -A.sin, z: A.cos }, { x: B.cos, z: B.sin }, { x: -B.sin, z: B.cos }];
      const dx = B.cx - A.cx, dz = B.cz - A.cz;
      for (const L of axes) {
        const rA = A.hw * Math.abs(A.cos * L.x + A.sin * L.z) + A.hd * Math.abs(-A.sin * L.x + A.cos * L.z);
        const rB = B.hw * Math.abs(B.cos * L.x + B.sin * L.z) + B.hd * Math.abs(-B.sin * L.x + B.cos * L.z);
        if (Math.abs(dx * L.x + dz * L.z) > rA + rB) return false;
      }
      return true;
    }
    _inflate(b, d) { return { cx: b.cx, cz: b.cz, hw: b.hw + d, hd: b.hd + d, cos: b.cos, sin: b.sin }; }
    _withinFloor(c, f, margin) {
      const a = (c.rot || 0) * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
      const hx = c.w / 2, hz = c.d / 2, lx2 = f.w / 2 - margin, lz2 = f.d / 2 - margin;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const lx = sx * hx, lz = sz * hz, wx = c.x + lx * co - lz * si, wz = c.y + lx * si + lz * co;
        if (Math.abs(wx) > lx2 + 1e-6 || Math.abs(wz) > lz2 + 1e-6) return false;
      }
      return true;
    }
    _runDRC() {
      const drc = this.state.drc, minS = drc.on ? (drc.minSpacing || 0) : 0, minVG = drc.on ? (drc.minVGap || 0) : 0;
      const items = []; this.state.floors.forEach((f, idx) => f.comps.forEach(c => items.push({ c, idx, box: this._obb(c, idx) })));
      const viol = [], red = new Set(), amber = new Set(), koHit = new Set();
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const A = items[i], B = items[j], yOv = A.box.miny < B.box.maxy && A.box.maxy > B.box.miny;
        if (yOv) {
          if (this._overlapXZ(A.box, B.box)) { red.add(A.c.id); red.add(B.c.id); viol.push({ sev: 2, text: `碰撞重疊：${A.c.name} ✕ ${B.c.name}` }); }
          else if (minS > 0 && this._overlapXZ(this._inflate(A.box, minS / 2), this._inflate(B.box, minS / 2))) { amber.add(A.c.id); amber.add(B.c.id); viol.push({ sev: 1, text: `間距 < ${minS}：${A.c.name} ↔ ${B.c.name}` }); }
        } else if (minVG > 0 && this._overlapXZ(A.box, B.box)) {     // 上下層、footprint 重疊 → 檢查垂直淨距
          const gap = Math.max(A.box.miny - B.box.maxy, B.box.miny - A.box.maxy);
          if (gap < minVG) { amber.add(A.c.id); amber.add(B.c.id); viol.push({ sev: 1, text: `層間淨距 < ${minVG}：${A.c.name} ↕ ${B.c.name}（${+gap.toFixed(2)}）` }); }
        }
      }
      if (drc.on && drc.boundary) items.forEach(({ c, idx }) => {
        const f = this.state.floors[idx];
        if (!this._withinFloor(c, f, drc.edgeMargin || 0)) { amber.add(c.id); viol.push({ sev: 1, text: `超出邊界：${c.name}（${f.name}）` }); }
      });
      // 高度：元件占用高度（層內位移 z + 厚度 h）超出該層層高 → 會壓到上層
      if (drc.on) items.forEach(({ c, idx }) => {
        const f = this.state.floors[idx], occ = (c.z || 0) + c.h;
        if (occ > f.h + 1e-6) { amber.add(c.id); viol.push({ sev: 1, text: `高度超出層高：${c.name}（高 ${+occ.toFixed(2)} > 層高 ${f.h}）` }); }
      });
      this.state.floors.forEach((f, idx) => (f.keepouts || []).forEach(k => {
        const kb = { cx: k.x, cz: k.y, hw: k.w / 2, hd: k.d / 2, cos: 1, sin: 0 };
        f.comps.forEach(c => { if (this._overlapXZ(this._obb(c, idx), kb)) { amber.add(c.id); koHit.add(k.id); viol.push({ sev: 1, text: `進入禁置區：${c.name}（${f.name}）` }); } });
      }));
      this._drc = { red, amber, koHit, viol };
      return this._drc;
    }

    // ===========================================================================
    // DOM / 版面
    // ===========================================================================
    _buildDOM() {
      const style = document.createElement('style'); style.textContent = CSS; this.root.appendChild(style);
      const app = document.createElement('div'); app.className = 'app';
      app.innerHTML = `
        <div class="sidebar"><h2>元件庫</h2><div class="lib"></div></div>
        <div class="main">
          <div class="toolbar">
            <button class="btn" data-act="undo" title="復原 Ctrl+Z">↶</button>
            <button class="btn" data-act="redo" title="重做 Ctrl+Y">↷</button>
            <div class="sep"></div>
            <button class="btn" data-act="new" title="清空並開新擺盤">🆕 新建</button>
            <button class="btn" data-act="save">💾 儲存</button>
            <button class="btn" data-act="load">📂 載入</button>
            <div class="sep"></div>
            <button class="btn on" data-act="vtop">▦ 平面</button>
            <button class="btn" data-act="viso">◈ 等角</button>
            <button class="btn" data-act="isorot" style="display:none">↻ 視角</button>
            <div class="sep"></div>
            <button class="btn on" data-act="snap">⌁ 吸附</button>
            <button class="btn on" data-act="names">🔤 名稱</button>
            <button class="btn" data-act="drc">🛡 DRC</button>
            <button class="btn" data-act="addko">＋禁置區</button>
            <select class="sel" data-fld="coordbasis"><option value="LL">座標：左下原點</option><option value="center">座標：中心原點</option></select>
            <div class="sep"></div>
            <button class="btn" data-act="addfloor">＋樓層</button>
            <button class="btn" data-act="fit">⊹ 置中</button>
            <button class="btn" data-act="spec">📋 匯入規格表</button>
            <button class="btn" data-act="csvex">⬇ CSV</button>
            <button class="btn" data-act="bom">📄 BOM</button>
            <button class="btn" data-act="expjson">匯出</button>
            <button class="btn" data-act="impjson">匯入</button>
          </div>
          <div class="tabs"></div>
          <div class="stagewrap">
            <div class="stage">
              <svg class="canvas" xmlns="http://www.w3.org/2000/svg"></svg>
              <div class="drop"></div>
              <div class="badge"></div>
              <div class="hint">左鍵選取/拖移(吸附) · 拖元件庫到此新增 · 右側面板編輯 · Del 刪除（不需右鍵，RBI 友善）</div>
              <a class="licbadge" target="_blank" rel="noopener" title="專有授權 — 須經作者授權方得使用，作者得隨時撤銷">© 2026 Curtis · 授權</a>
              <div class="toast"></div>
              <div class="modal"><div class="box">
                <h3>開新擺盤</h3>
                <p>選擇範本。目前設計會自動備份到「上一份」，可於「📂 載入」輸入 <b>prev</b> 找回。</p>
                <button class="opt" data-tpl="blank"><b>空白</b><small>單一空樓層，從零開始</small></button>
                <button class="opt" data-tpl="default"><b>預設 3 層</b><small>Substrate / Interposer / Die（無元件）</small></button>
                <button class="opt" data-tpl="example"><b>CoWoS 範例</b><small>TSMC CoWoS HBM 疊構（含元件）</small></button>
                <div class="cancel">取消</div>
              </div></div>
            </div>
            <div class="props"></div>
          </div>
        </div>`;
      this.root.appendChild(app);
      this.el = {
        lib: app.querySelector('.lib'), tabs: app.querySelector('.tabs'), stage: app.querySelector('.stage'),
        svg: app.querySelector('svg.canvas'), badge: app.querySelector('.badge'), drop: app.querySelector('.drop'),
        props: app.querySelector('.props'), toast: app.querySelector('.toast'), menu: null, modal: app.querySelector('.modal'),
      };
      app.querySelector('.licbadge').href = this.getAttribute('license-href') || 'https://control168.github.io/chip-floorplanner-demo/license.html';
      app.querySelectorAll('.modal [data-tpl]').forEach(b => b.onclick = () => this._doNew(b.dataset.tpl));
      app.querySelector('.modal .cancel').onclick = () => this._hideModal();
      app.querySelector('.modal').onclick = e => { if (e.target.classList.contains('modal')) this._hideModal(); };
      this._renderLibrary();
      app.querySelectorAll('[data-act]').forEach(b => b.onclick = () => this._toolbar(b.dataset.act));
      const cb = app.querySelector('[data-fld="coordbasis"]'); cb.value = this.state.coordBasis;
      cb.onchange = () => { this.state.coordBasis = cb.value; this._render(); };
      this._syncToggles();
      // SVG 互動
      const svg = this.el.svg;
      svg.addEventListener('pointerdown', e => this._onDown(e));
      svg.addEventListener('pointermove', e => this._onMove(e));
      window.addEventListener('pointerup', () => this._onUp());
      window.addEventListener('keydown', e => this._onKey(e));
      this.el.stage.addEventListener('dragover', e => { e.preventDefault(); this.el.drop.classList.add('on'); });
      this.el.stage.addEventListener('dragleave', () => this.el.drop.classList.remove('on'));
      this.el.stage.addEventListener('drop', e => this._onDrop(e));
    }

    _renderLibrary() {
      this.el.lib.innerHTML = '';
      Object.entries(CATALOG).forEach(([cat, data]) => {
        const box = document.createElement('div');
        box.innerHTML = `<div class="cat-head"><span class="cat-dot" style="background:${data.color}"></span>${cat}</div><div class="cat-desc">${data.desc}</div>`;
        data.parts.forEach((p, i) => {
          const it = document.createElement('div'); it.className = 'item'; it.draggable = true;
          it.innerHTML = `<span class="swatch" style="background:${p.color}"></span><span style="min-width:0"><div class="item-name">${p.name}</div><div class="item-size">${p.w}×${p.d}×${p.h}</div></span>`;
          it.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', JSON.stringify({ cat, i })));
          it.addEventListener('click', () => this._addPart(cat, i, 0, 0));   // 點擊＝加到中心
          box.appendChild(it);
        });
        this.el.lib.appendChild(box);
      });
    }
    _renderTabs() {
      this.el.tabs.innerHTML = '';
      this.state.floors.forEach((f, idx) => {
        const t = document.createElement('div'); t.className = 'tab' + (idx === this.state.activeFloor ? ' on' : '');
        t.innerHTML = `${esc(f.name)}<span class="x" title="刪除樓層">✕</span>`;
        t.onclick = e => {
          if (e.target.classList.contains('x')) { this._delFloor(idx); return; }
          this.state.activeFloor = idx; this.state.selected = null; this._render();
        };
        this.el.tabs.appendChild(t);
      });
    }
    _syncToggles() {
      const set = (a, on) => { const el = this.root.querySelector(`[data-act="${a}"]`); if (el) el.classList.toggle('on', on); };
      set('snap', this.state.snap); set('names', this.state.names); set('drc', this.state.drc.on);
      const cb = this.root.querySelector('[data-fld="coordbasis"]'); if (cb) cb.value = this.state.coordBasis;
      this._updateViewBtns();
    }
    _updateViewBtns() {
      const vt = this.root.querySelector('[data-act="vtop"]'), vi = this.root.querySelector('[data-act="viso"]'), ir = this.root.querySelector('[data-act="isorot"]');
      const iso = this.state.view === 'iso';
      if (vt) vt.classList.toggle('on', !iso); if (vi) vi.classList.toggle('on', iso); if (ir) ir.style.display = iso ? '' : 'none';
    }

    // ===========================================================================
    // 渲染（SVG）
    // ===========================================================================
    _render() {
      this._renderTabs();
      this._drawSvg();
      this._renderProps();
      this._autoSave();
    }
    _drawSvg() {
      if (this.state.view === 'iso') { this._drawIso(); return; }
      const f = this.floor; if (!f) return;
      const W = f.w, D = f.d, VBW = W + 2 * PAD, VBH = D + 2 * PAD;
      this.el.svg.setAttribute('viewBox', `0 0 ${VBW} ${VBH}`);
      this.el.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      const drc = this._runDRC();
      let s = '';
      // 底板
      s += `<rect x="${PAD}" y="${PAD}" width="${W}" height="${D}" fill="#172033" stroke="#334155" stroke-width="0.5"/>`;
      // 格線
      const g = f.grid || 1, step = Math.max(g, Math.max(W, D) / 200);
      let lines = '';
      for (let gx = 0; gx <= W + 1e-6; gx += step) lines += `<line x1="${PAD + gx}" y1="${PAD}" x2="${PAD + gx}" y2="${PAD + D}" stroke="#243044" stroke-width="0.15"/>`;
      for (let gy = 0; gy <= D + 1e-6; gy += step) lines += `<line x1="${PAD}" y1="${PAD + gy}" x2="${PAD + W}" y2="${PAD + gy}" stroke="#243044" stroke-width="0.15"/>`;
      s += `<g>${lines}</g>`;
      // 禁置區
      (f.keepouts || []).forEach(k => {
        const x = this._sx(k.x - k.w / 2, f), y = this._sy(k.y - k.d / 2, f);
        const hit = drc.koHit.has(k.id);
        s += `<g class="ko" data-ko-id="${k.id}" style="cursor:move"><rect x="${x}" y="${y}" width="${k.w}" height="${k.d}" fill="${hit ? '#ff1133' : '#ef4444'}" fill-opacity="${hit ? 0.4 : 0.18}" stroke="#ef4444" stroke-width="0.4" stroke-dasharray="2 1.5"/></g>`;
      });
      // 元件
      f.comps.forEach(c => {
        const cx = this._sx(c.x, f), cy = this._sy(c.y, f);
        const x = cx - c.w / 2, y = cy - c.d / 2;
        let fill = c.color, stroke = '#0f172a', sw = 0.4;
        if (drc.red.has(c.id)) fill = '#ff1133';
        else if (drc.amber.has(c.id)) fill = '#f59e0b';
        if (this.state.selected === c.id) { stroke = '#fbbf24'; sw = 1; }
        const rot = `rotate(${c.rot || 0} ${cx} ${cy})`;
        let label = '';
        if (this.state.names) {
          const fs = Math.max(2.2, Math.min(c.w, c.d) * 0.16);
          const nm = c.name.length > 16 ? c.name.slice(0, 15) + '…' : c.name;
          label = `<text x="${cx}" y="${cy}" font-size="${fs}" fill="#0b1220" text-anchor="middle" dominant-baseline="central" style="pointer-events:none;font-weight:600">${esc(nm)}</text>`;
        }
        s += `<g class="comp" data-comp-id="${c.id}" transform="${rot}" style="cursor:move">`
          + `<rect x="${x}" y="${y}" width="${c.w}" height="${c.d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" rx="0.6"/>${label}</g>`;
      });
      // 原點標記（座標 0,0）
      const ox = this._sx(this._originX(f), f), oy = this._sy(this._originZ(f), f), L = Math.max(6, Math.min(W, D) * 0.14);
      s += `<g style="pointer-events:none">`
        + `<line x1="${ox}" y1="${oy}" x2="${ox + L}" y2="${oy}" stroke="#f87171" stroke-width="0.6"/>`
        + `<line x1="${ox}" y1="${oy}" x2="${ox}" y2="${oy - L * this._yFlip()}" stroke="#4ade80" stroke-width="0.6"/>`
        + `<circle cx="${ox}" cy="${oy}" r="1.3" fill="#fbbf24"/>`
        + `<text x="${ox + 2}" y="${oy + (this._yFlip() < 0 ? 4 : -2)}" font-size="3.4" fill="#94a3b8">原點 0,0</text></g>`;
      this.el.svg.innerHTML = s;
      // badge
      const bad = drc.viol.length > 0;
      this.el.badge.classList.toggle('bad', bad);
      this.el.badge.textContent = bad ? `⚠ ${drc.viol.length} 項${this.state.drc.on ? ' DRC' : ''}違規` : (this.state.drc.on ? '✓ DRC 通過' : '✓ 無碰撞');
    }

    _shade(hex, fac) {
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
      const n = parseInt(hex.slice(1), 16);
      const r = Math.min(255, Math.round(((n >> 16) & 255) * fac));
      const g = Math.min(255, Math.round(((n >> 8) & 255) * fac));
      const b = Math.min(255, Math.round((n & 255) * fac));
      return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }
    // 等角(2.5D)：3D→等角投影、每方塊 3 面著色、畫家演算法排序，純 SVG
    _drawIso() {
      const A = ISO.A, B = ISO.B, ZE = ISO.ZE;                 // 等角投影係數 / Z 放大
      const vr = (this.state.isoRot || 0) * Math.PI / 180, cv = Math.cos(vr), sv = Math.sin(vr);
      const iso = (X, Y, Z) => ({ x: (X - Y) * A, y: (X + Y) * B - Z * ZE });
      const drc = this._runDRC();
      const boxes = [];
      const add = (cx, cy, w, d, zb, zt, rotDeg, color, isComp, comp) => {
        const wx = cx * cv - cy * sv, wy = cx * sv + cy * cv;
        const ang = (rotDeg + (this.state.isoRot || 0)) * Math.PI / 180, ca = Math.cos(ang), sa = Math.sin(ang);
        const offs = [[w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2], [w / 2, -d / 2]];
        const base = offs.map(([ox, oy]) => ({ X: wx + ox * ca - oy * sa, Y: wy + ox * sa + oy * ca }));
        boxes.push({ base, top: base.map(p => iso(p.X, p.Y, zt)), bot: base.map(p => iso(p.X, p.Y, zb)), wx, wy, zt, depth: wx + wy + (zb + zt) / 2, color, isComp, comp });
      };
      this.state.floors.forEach((f, idx) => {
        const baseY = this._floorBaseY(idx), T = this._slabT(f);
        add(0, 0, f.w, f.d, baseY, baseY + T, 0, '#2b3a52', false, null);     // 樓層板
        f.comps.forEach(c => {
          const zb = baseY + T + (c.z || 0), zt = zb + c.h;
          let col = c.color; if (drc.red.has(c.id)) col = '#ff1133'; else if (drc.amber.has(c.id)) col = '#f59e0b';
          add(c.x, c.y, c.w, c.d, zb, zt, c.rot || 0, col, true, c);
        });
      });
      boxes.sort((a, b) => a.depth - b.depth);                  // 畫家演算法：由後往前
      let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
      boxes.forEach(bx => bx.top.concat(bx.bot).forEach(p => { if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y; }));
      const pad = 8;
      const fitVB = `${(minx - pad).toFixed(1)} ${(miny - pad).toFixed(1)} ${(maxx - minx + 2 * pad).toFixed(1)} ${(maxy - miny + 2 * pad).toFixed(1)}`;
      this.el.svg.setAttribute('viewBox', (this.isoDrag && this._isoVB) ? this._isoVB : fitVB);   // 拖移中鎖定視框
      if (!this.isoDrag) this._isoVB = fitVB;
      this.el.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      const poly = (pts, fill, stroke, sw) => `<polygon points="${pts.map(p => p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
      let s = '';
      boxes.forEach(bx => {
        const sel = bx.comp && this.state.selected === bx.comp.id;
        const edge = sel ? '#fbbf24' : '#0b1220', esw = sel ? 0.8 : 0.25;
        let faces = '';
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4;
          const ex = bx.base[j].X - bx.base[i].X, ey = bx.base[j].Y - bx.base[i].Y;
          let nx = ey, ny = -ex;
          const mx = (bx.base[i].X + bx.base[j].X) / 2 - bx.wx, my = (bx.base[i].Y + bx.base[j].Y) / 2 - bx.wy;
          if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
          if (nx + ny <= 1e-4) continue;                       // 非朝向鏡頭的側面不畫
          const fac = (Math.abs(nx) >= Math.abs(ny)) ? 0.82 : 0.6;
          faces += poly([bx.top[i], bx.top[j], bx.bot[j], bx.bot[i]], this._shade(bx.color, fac), edge, esw);
        }
        faces += poly(bx.top, this._shade(bx.color, bx.isComp ? 1.12 : 0.95), edge, esw);   // 頂面
        let label = '';
        if (bx.isComp && this.state.names) {
          const tx = (bx.top[0].x + bx.top[1].x + bx.top[2].x + bx.top[3].x) / 4;
          const ty = (bx.top[0].y + bx.top[1].y + bx.top[2].y + bx.top[3].y) / 4;
          const fs = Math.max(2, Math.min(bx.comp.w, bx.comp.d) * 0.13);
          const nm = bx.comp.name.length > 13 ? bx.comp.name.slice(0, 12) + '…' : bx.comp.name;
          label = `<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" font-size="${fs}" fill="#0b1220" text-anchor="middle" dominant-baseline="central" style="pointer-events:none;font-weight:600">${esc(nm)}</text>`;
        }
        s += `<g${bx.isComp ? ` data-comp-id="${bx.comp.id}" style="cursor:pointer"` : ''}>${faces}${label}</g>`;
      });
      this.el.svg.innerHTML = s;
      const bad = drc.viol.length > 0;
      this.el.badge.classList.toggle('bad', bad);
      this.el.badge.textContent = bad ? `⚠ ${drc.viol.length} 項${this.state.drc.on ? ' DRC' : ''}違規` : (this.state.drc.on ? '✓ DRC 通過' : '✓ 無碰撞');
    }

    // ===========================================================================
    // 屬性面板（取代右鍵選單）
    // ===========================================================================
    _renderProps() {
      const sel = this.state.selected ? this.floor.comps.find(c => c.id === this.state.selected) : null;
      const f = this.floor;
      let h = '';
      if (sel) {
        h += `<h3>元件屬性 <span class="pill">${esc(sel.cat || '')}</span></h3><div class="muted">編輯選取的元件（座標：${this._basisLabel()}原點）</div>`;
        h += this._field('名稱', `<input data-p="name" value="${esc(sel.name)}">`);
        h += this._field('尺寸 W/D', `<div class="grid2"><input data-p="w" type="number" value="${sel.w}"><input data-p="d" type="number" value="${sel.d}"></div>`);
        h += this._field('厚度 H', `<input data-p="h" type="number" value="${sel.h}">`);
        h += this._field('座標 X/Y', `<div class="grid2"><input data-p="x" type="number" step="${f.grid || 1}" value="${+this._dispX(sel.x, f).toFixed(3)}"><input data-p="y" type="number" step="${f.grid || 1}" value="${+this._dispY(sel.y, f).toFixed(3)}"></div>`);
        h += this._field('層內 Z', `<input data-p="z" type="number" value="${sel.z || 0}">`);
        h += this._field('旋轉 °', `<input data-p="rot" type="number" step="15" value="${sel.rot || 0}">`);
        h += this._field('間隔備註', `<input data-p="gap" value="${esc(sel.gap || '')}">`);
        h += `<div class="actions"><button class="btn" data-pact="rotate">⟳ 旋轉90°</button><button class="btn danger" data-pact="del">刪除</button></div>`;
      } else {
        h += `<h3>樓層設定</h3><div class="muted">點選元件以編輯其屬性；或在此設定本層。</div>`;
        const isB = this.state.activeFloor === 0;
        h += this._field('名稱', `<input data-f="name" value="${esc(f.name)}">`);
        h += this._field('尺寸 W/D', `<div class="grid2"><input data-f="w" type="number" value="${f.w}"><input data-f="d" type="number" value="${f.d}"></div>`);
        h += this._field('層高/板厚', `<div class="grid2"><input data-f="h" type="number" value="${f.h}"><input data-f="thickness" type="number" value="${this._slabT(f)}"></div>`);
        h += this._field('格距 µm', `<input data-f="grid" type="number" step="0.1" value="${f.grid || 1}">`);
        h += this._field('間距/邊距', `<div class="grid2"><input data-f="minSpacing" type="number" step="0.5" value="${this.state.drc.minSpacing}"><input data-f="edgeMargin" type="number" step="0.5" value="${this.state.drc.edgeMargin}"></div>`);
        h += this._field('垂直淨距', `<input data-f="minVGap" type="number" step="0.5" value="${this.state.drc.minVGap || 0}">`);
        if (!isB) h += `<div class="muted">W/D 上限＝最底層 ${this._maxW()}×${this._maxD()}</div>`;
      }
      // DRC 違規清單
      const v = (this._drc && this._drc.viol) || [];
      if (this.state.drc.on) {
        h += `<h4>DRC 違規（${v.length}）</h4>`;
        h += v.length ? `<div class="viol">${v.map(x => `<div>${x.sev >= 2 ? '🔴' : '🟠'} ${esc(x.text)}</div>`).join('')}</div>` : `<div class="muted" style="color:#86efac">✓ 全部通過</div>`;
      }
      h += `<div class="note">WebGL-Free（SVG）版，為 RBI／Menlo 最佳化：純 DOM、不需 GPU、不依賴右鍵。<br>© 2026 Curtis · 專有授權</div>`;
      this.el.props.innerHTML = h;
      // 綁定（即時編輯）
      this.el.props.querySelectorAll('[data-p]').forEach(inp => inp.oninput = () => this._applyCompEdit());
      this.el.props.querySelectorAll('[data-f]').forEach(inp => inp.oninput = () => this._applyFloorEdit());
      const del = this.el.props.querySelector('[data-pact="del"]');
      if (del) del.onclick = () => { this._pushHistory(); this.floor.comps = this.floor.comps.filter(c => c.id !== this.state.selected); this.state.selected = null; this._render(); };
      const rot = this.el.props.querySelector('[data-pact="rotate"]');
      if (rot) rot.onclick = () => { const c = this.floor.comps.find(x => x.id === this.state.selected); if (c) { this._pushHistory(); c.rot = ((c.rot || 0) + 90) % 360; this._render(); } };
    }
    _field(lbl, inner) { return `<div class="row"><label>${lbl}</label>${inner}</div>`; }
    _applyCompEdit() {
      const c = this.floor.comps.find(x => x.id === this.state.selected); if (!c) return;
      if (!this._editDirty) { this._pushHistory(); this._editDirty = true; }
      const f = this.floor, get = k => this.el.props.querySelector(`[data-p="${k}"]`);
      c.name = get('name').value;
      const num = (k, set) => { const v = parseFloat(get(k).value); if (isFinite(v)) set(v); };
      num('w', v => c.w = v); num('d', v => c.d = v); num('h', v => c.h = v);
      num('x', v => c.x = this._storeX(v, f)); num('y', v => c.y = this._storeY(v, f));
      num('z', v => c.z = v); num('rot', v => c.rot = v);
      c.gap = get('gap').value;
      this._drawSvg();
    }
    _applyFloorEdit() {
      const f = this.floor; if (!this._editDirty) { this._pushHistory(); this._editDirty = true; }
      const isB = this.state.activeFloor === 0, get = k => this.el.props.querySelector(`[data-f="${k}"]`);
      f.name = get('name').value;
      const num = (k, set) => { const v = parseFloat(get(k).value); if (isFinite(v) && v > 0) set(v); };
      num('w', v => f.w = isB ? v : Math.min(v, this._maxW()));
      num('d', v => f.d = isB ? v : Math.min(v, this._maxD()));
      num('h', v => f.h = v); num('thickness', v => f.thickness = v); num('grid', v => f.grid = v);
      num('minSpacing', v => this.state.drc.minSpacing = v); num('edgeMargin', v => this.state.drc.edgeMargin = v); num('minVGap', v => this.state.drc.minVGap = v);
      if (f.thickness > f.h) f.thickness = f.h;
      if (isB) this.state.floors.forEach((fl, i) => { if (i > 0) { fl.w = Math.min(fl.w, f.w); fl.d = Math.min(fl.d, f.d); } });
      this._drawSvg(); this._renderTabs();
    }

    // ===========================================================================
    // 互動：選取 / 拖移 / 放置 / 鍵盤
    // ===========================================================================
    _onDown(e) {
      if (e.button !== 0) return;
      const compEl = e.target.closest('[data-comp-id]'), koEl = e.target.closest('[data-ko-id]');
      if (this.state.view === 'iso') {                          // 等角：可選取 + 拖移（反投影到樓層平面）
        if (compEl) {
          const id = compEl.dataset.compId, fi = this.state.floors.findIndex(f => f.comps.some(c => c.id === id));
          if (fi >= 0) this.state.activeFloor = fi;
          this.state.selected = id;
          const c = this.floor.comps.find(x => x.id === id);
          if (c) {
            const zc = this._compZc(this.state.activeFloor, c), gm = this._isoToModel(e, zc);
            this.isoDrag = { id, zc, ox: c.x - gm.x, oy: c.y - gm.y, moved: false };
            try { this.el.svg.setPointerCapture(e.pointerId); } catch (err) {}
          }
        } else this.state.selected = null;
        this._render(); return;
      }
      if (compEl) {
        const id = compEl.dataset.compId; this.state.selected = id;
        this.drag = { id, moved: false }; this.el.svg.setPointerCapture(e.pointerId);
        this._render();
      } else if (koEl) {
        this.state.selected = null; this.koDrag = { id: koEl.dataset.koId, moved: false }; this.el.svg.setPointerCapture(e.pointerId); this._render();
      } else { if (this.state.selected) { this.state.selected = null; this._render(); } }
    }
    _onMove(e) {
      const f = this.floor;
      if (this.isoDrag) {
        const c = f.comps.find(x => x.id === this.isoDrag.id); if (!c) return;
        if (!this.isoDrag.moved) { this._pushHistory(); this.isoDrag.moved = true; }
        const gm = this._isoToModel(e, this.isoDrag.zc);
        c.x = this._snapGrid(gm.x + this.isoDrag.ox, this._originX(f), f.grid);
        c.y = this._snapGrid(gm.y + this.isoDrag.oy, this._originZ(f), f.grid);
        if (this.state.snap) this._applySnap(c);
        this._render(); return;
      }
      if (this.koDrag) {
        const m = this._pointerModel(e); if (!this.koDrag.moved) { this._pushHistory(); this.koDrag.moved = true; }
        const k = (f.keepouts || []).find(x => x.id === this.koDrag.id); if (!k) return;
        k.x = this._snapGrid(m.x, this._originX(f), f.grid); k.y = this._snapGrid(m.y, this._originZ(f), f.grid); this._render(); return;
      }
      if (!this.drag) return;
      const m = this._pointerModel(e), c = f.comps.find(x => x.id === this.drag.id); if (!c) return;
      if (!this.drag.moved) { this._pushHistory(); this.drag.moved = true; }
      c.x = this._snapGrid(m.x, this._originX(f), f.grid); c.y = this._snapGrid(m.y, this._originZ(f), f.grid);
      if (this.state.snap) this._applySnap(c);
      this._render();
    }
    _onUp() {
      this.drag = null; this.koDrag = null;
      if (this.isoDrag) { this.isoDrag = null; this._isoVB = null; this._render(); }   // 放開後重新置中
    }
    _applySnap(c) {
      const T = 2.5, f = this.floor, others = f.comps.filter(o => o.id !== c.id);
      const wh = o => { const a = (o.rot || 0) * Math.PI / 180, co = Math.abs(Math.cos(a)), si = Math.abs(Math.sin(a)); return { hx: o.w / 2 * co + o.d / 2 * si, hz: o.w / 2 * si + o.d / 2 * co }; };
      const h = wh(c), tX = [-f.w / 2, 0, f.w / 2], tZ = [-f.d / 2, 0, f.d / 2];
      others.forEach(o => { const oh = wh(o); tX.push(o.x - oh.hx, o.x, o.x + oh.hx); tZ.push(o.y - oh.hz, o.y, o.y + oh.hz); });
      const fit = (mine, t) => { let b = null, bd = T; mine.forEach(mv => t.forEach(tv => { const d = tv - mv; if (Math.abs(d) < bd) { bd = Math.abs(d); b = d; } })); return b; };
      const dX = fit([c.x - h.hx, c.x, c.x + h.hx], tX); if (dX !== null) c.x += dX;
      const dZ = fit([c.y - h.hz, c.y, c.y + h.hz], tZ); if (dZ !== null) c.y += dZ;
    }
    _onDrop(e) {
      e.preventDefault(); this.el.drop.classList.remove('on');
      let data; try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
      let m;
      if (this.state.view === 'iso') { const zr = this._floorBaseY(this.state.activeFloor) + this._slabT(this.floor); m = this._isoToModel(e, zr); }
      else m = this._pointerModel(e);
      this._addPart(data.cat, data.i, m.x, m.y);
    }
    _addPart(cat, i, mx, my) {
      const part = CATALOG[cat] && CATALOG[cat].parts[i]; if (!part) return;
      this._pushHistory();
      const f = this.floor;
      const c = { id: uid(), cat, type: part.type, name: part.name, color: part.color, w: part.w, d: part.d, h: part.h,
        x: this._snapGrid(mx, this._originX(f), f.grid), y: this._snapGrid(my, this._originZ(f), f.grid), z: 0, rot: 0, gap: '' };
      f.comps.push(c); this.state.selected = c.id; this._render();
    }
    _onKey(e) {
      if (this.root.activeElement && this.root.activeElement.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { this._undo(); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { this._redo(); e.preventDefault(); return; }
      if (!this.state.selected) return;
      const c = this.floor.comps.find(x => x.id === this.state.selected); if (!c) return;
      if (k === 'r') { this._pushHistory(); c.rot = (((c.rot || 0) + (e.shiftKey ? -15 : 15)) % 360 + 360) % 360; this._render(); e.preventDefault(); }
      else if (k === 'delete' || k === 'backspace') { this._pushHistory(); this.floor.comps = this.floor.comps.filter(x => x.id !== c.id); this.state.selected = null; this._render(); e.preventDefault(); }
    }

    // ===========================================================================
    // 工具列動作
    // ===========================================================================
    _toolbar(act) {
      const tog = (k, key) => { this.state[k] = !this.state[k]; this.root.querySelector(`[data-act="${key}"]`).classList.toggle('on', this.state[k]); this._render(); };
      if (act === 'undo') this._undo();
      else if (act === 'redo') this._redo();
      else if (act === 'vtop') { this.state.view = 'top'; this._updateViewBtns(); this._render(); }
      else if (act === 'viso') { this.state.view = 'iso'; this._updateViewBtns(); this._render(); }
      else if (act === 'isorot') { this.state.isoRot = ((this.state.isoRot || 0) + 90) % 360; this._render(); }
      else if (act === 'snap') tog('snap', 'snap');
      else if (act === 'names') tog('names', 'names');
      else if (act === 'drc') { this.state.drc.on = !this.state.drc.on; this.root.querySelector('[data-act="drc"]').classList.toggle('on', this.state.drc.on); this._render(); }
      else if (act === 'addko') { this._pushHistory(); if (!this.floor.keepouts) this.floor.keepouts = []; this.floor.keepouts.push({ id: uid(), x: 0, y: 0, w: 30, d: 30 }); this._render(); }
      else if (act === 'addfloor') { this._pushHistory(); const w = Math.min(this.floor.w, this._maxW()), d = Math.min(this.floor.d, this._maxD()); this._addFloor('Layer ' + (this.state.floors.length + 1), w, d, 8, this.floor.grid, this._slabT(this.floor)); this.state.activeFloor = this.state.floors.length - 1; this.state.selected = null; this._render(); }
      else if (act === 'fit') this._render();
      else if (act === 'spec') this._pickSpec();
      else if (act === 'csvex') this._download('spec-example.csv', this.exportSpecCSV());
      else if (act === 'bom') this._download('chip-bom.csv', this.exportBOM());
      else if (act === 'expjson') this._download('chip-floorplan.json', this.exportJSON());
      else if (act === 'impjson') this._pickJSON();
      else if (act === 'new') this._newPlan();
      else if (act === 'save') this._saveNamed();
      else if (act === 'load') this._showLoadMenu();
    }
    _newPlan() { this.el.modal.classList.add('on'); }
    _hideModal() { this.el.modal.classList.remove('on'); }
    _backupPrev() { try { localStorage.setItem(LS_PREV, JSON.stringify(this._serialize())); } catch (e) {} }
    _doNew(tpl) {
      this._hideModal();
      this._backupPrev();                                   // 先備份目前到「上一份」
      if (tpl === 'example') {
        fetch('spec-example.csv').then(r => r.text()).then(t => { this.importSpecCSV(t); this.state.view = 'top'; this._updateViewBtns(); this._render(); this._setStatus('✓ 已載入 CoWoS 範例'); })
          .catch(() => alert('找不到 spec-example.csv'));
        return;
      }
      this._pushHistory();
      this.state.floors = [];
      if (tpl === 'blank') this._addFloor('Layer 1', 120, 120, 10);
      else { this._addFloor('Substrate Level', 120, 120, 10); this._addFloor('Interposer Level', 120, 120, 6); this._addFloor('Die / HBM Level', 120, 120, 14); }
      this.state.activeFloor = 0; this.state.selected = null;
      this.state.schemes = [{ name: '方案 1', floors: this.state.floors }]; this.state.activeScheme = 0;
      this.state.view = 'top'; this._updateViewBtns();
      this._render(); this._setStatus(tpl === 'blank' ? '✓ 已開空白擺盤' : '✓ 已開預設擺盤');
    }
    _delFloor(idx) {
      if (this.state.floors.length <= 1) return;
      this._pushHistory(); this.state.floors.splice(idx, 1);
      this.state.activeFloor = Math.min(this.state.activeFloor, this.state.floors.length - 1); this.state.selected = null; this._render();
    }

    // ===========================================================================
    // 規格表 / BOM / JSON（與 WebGL 版相容）
    // ===========================================================================
    _pickSpec() {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,.xlsx,.xls,text/csv';
      inp.onchange = () => { const fl = inp.files[0]; if (!fl) return; const r = new FileReader(); const xl = /\.xls[xmb]?$/i.test(fl.name);
        r.onload = () => { try { xl ? this.importSpecXLSX(r.result) : this.importSpecCSV(r.result); } catch (err) { alert('解析失敗：' + err.message); } };
        xl ? r.readAsArrayBuffer(fl) : r.readAsText(fl); };
      inp.click();
    }
    _pickJSON() {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
      inp.onchange = () => { const fl = inp.files[0]; if (!fl) return; const r = new FileReader(); r.onload = () => { try { this.importJSON(r.result); } catch (e) { alert('JSON 解析失敗'); } }; r.readAsText(fl); };
      inp.click();
    }
    _download(name, content) { const b = new Blob([content], { type: 'text/plain;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }

    importSpecCSV(text) { this._loadSchemes([{ name: '方案 1', floors: this._buildFloors(parseCSV(text).filter(r => r.some(c => c.trim() !== ''))) }]); }
    importSpecXLSX(buffer) {
      if (!window.XLSX) throw new Error('未載入 SheetJS (xlsx)');
      const wb = XLSX.read(buffer, { type: 'array' }), schemes = [];
      wb.SheetNames.forEach(nm => { const ws = wb.Sheets[nm]; const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }).map(r => r.map(c => String(c == null ? '' : c))).filter(r => r.some(c => c.trim() !== '')); if (rows.length < 2) return; try { schemes.push({ name: nm, floors: this._buildFloors(rows) }); } catch (e) {} });
      if (!schemes.length) throw new Error('無有效工作表'); this._loadSchemes(schemes);
    }
    _buildFloors(rows) {
      if (rows.length < 2) throw new Error('沒有資料列');
      const head = rows[0].map(h => h.trim().toLowerCase());
      const col = (...n) => { for (const x of n) { const i = head.indexOf(x); if (i >= 0) return i; } return -1; };
      const ci = { floor: col('floor', '樓層', 'layer'), fw: col('floor_w', 'floor_width'), fd: col('floor_d', 'floor_depth'), fh: col('floor_h', 'floor_height'), grid: col('grid', '格距'), thick: col('thickness', '板厚'), cat: col('category', '類別'), name: col('component', 'name', '元件'), w: col('width', 'w'), d: col('depth', 'd'), h: col('height', 'h'), x: col('x'), y: col('y'), z: col('z'), rot: col('rotation', 'rot'), gap: col('gap_note', 'gap', 'note') };
      if (ci.name < 0) throw new Error('缺少 component 欄位');
      const num = (r, i, df = 0) => { if (i < 0) return df; const v = parseFloat(r[i]); return isFinite(v) ? v : df; };
      const str = (r, i, df = '') => { if (i < 0) return df; return (r[i] || '').trim() || df; };
      const pal = { cowos: '#3b82f6', info: '#10b981', soic: '#f59e0b' };
      const map = new Map(), order = []; let last = 'Layer 1';
      rows.slice(1).forEach(r => {
        let fn = str(r, ci.floor, ''); if (!fn) fn = last; else last = fn;
        if (!map.has(fn)) { map.set(fn, { id: uid(), name: fn, w: num(r, ci.fw, 120), d: num(r, ci.fd, 120), h: num(r, ci.fh, 12), grid: num(r, ci.grid, 1), thickness: num(r, ci.thick, 0.4), comps: [], keepouts: [] }); order.push(fn); }
        const f = map.get(fn), nm = str(r, ci.name, ''); if (!nm) return;
        const cat = str(r, ci.cat, 'Custom'), color = pal[cat.toLowerCase().replace(/[^a-z]/g, '')] || '#64748b';
        f.comps.push({ id: uid(), cat, type: 'custom', name: nm, color, w: num(r, ci.w, 10), d: num(r, ci.d, 10), h: num(r, ci.h, 2), x: this._storeX(num(r, ci.x, 0), f), y: this._storeY(num(r, ci.y, 0), f), z: num(r, ci.z, 0), rot: num(r, ci.rot, 0), gap: str(r, ci.gap, '') });
      });
      const floors = order.map(n => map.get(n)); if (!floors.length) throw new Error('未解析到樓層'); return floors;
    }
    exportSpecCSV() {
      const head = 'floor,floor_w,floor_d,floor_h,grid,thickness,category,component,width,depth,height,x,y,z,rotation,gap_note';
      const q = v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const lines = [head];
      this.state.floors.forEach(f => {
        if (!f.comps.length) { lines.push([f.name, f.w, f.d, f.h, f.grid || 1, this._slabT(f), '', '(empty)', '', '', '', '', '', '', '', ''].map(q).join(',')); return; }
        f.comps.forEach((c, i) => lines.push([i === 0 ? f.name : '', i === 0 ? f.w : '', i === 0 ? f.d : '', i === 0 ? f.h : '', i === 0 ? (f.grid || 1) : '', i === 0 ? this._slabT(f) : '', c.cat, c.name, c.w, c.d, c.h, +this._dispX(c.x, f).toFixed(3), +this._dispY(c.y, f).toFixed(3), c.z || 0, c.rot || 0, c.gap || ''].map(q).join(',')));
      });
      return lines.join('\n');
    }
    exportBOM() {
      const q = v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const lines = ['Floor,Cumulative Top,Floor WxD,Grid,Category,Component,W,D,H,X,Y,Z,Rotation,Footprint,Gap'];
      let cum = 0;
      this.state.floors.forEach(f => { cum += f.h; f.comps.forEach((c, i) => lines.push([i === 0 ? f.name : '', i === 0 ? cum.toFixed(2) : '', i === 0 ? `${f.w}x${f.d}` : '', i === 0 ? (f.grid || 1) : '', c.cat, c.name, c.w, c.d, c.h, +this._dispX(c.x, f).toFixed(3), +this._dispY(c.y, f).toFixed(3), c.z || 0, c.rot || 0, (c.w * c.d).toFixed(1), c.gap || ''].map(q).join(','))); });
      const tot = this.state.floors.reduce((s, f) => s + f.h, 0);
      lines.push('', '# Summary', `Coordinate basis,${this.state.coordBasis === 'center' ? 'Center' : 'Lower-left'}`, `Total stack height,${tot.toFixed(2)}`);
      return lines.join('\n');
    }
    exportJSON() { return JSON.stringify({ floors: this.state.floors }, null, 2); }
    importJSON(json) { const o = typeof json === 'string' ? JSON.parse(json) : json; if (o && o.floors) this._loadSchemes([{ name: o.name || '方案 1', floors: o.floors }]); }
    _loadSchemes(schemes) { this._pushHistory(); this.state.schemes = schemes; this._reindexUid(); this.state.activeScheme = 0; this.state.floors = schemes[0].floors; this.state.activeFloor = 0; this.state.selected = null; this._render(); }
    _reindexUid() { let mx = 0; (this.state.schemes || []).forEach(s => (s.floors || []).forEach(f => [...(f.comps || []), ...(f.keepouts || [])].forEach(o => { const n = parseInt(String(o.id).replace(/\D/g, ''), 10); if (n > mx) mx = n; }))); bumpUid(mx); }

    // ===========================================================================
    // 進度儲存（與 WebGL 版共用 localStorage 鍵）
    // ===========================================================================
    _lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
    _lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
    _serialize() { return { v: 1, savedAt: new Date().toISOString(), schemes: this.state.schemes, activeScheme: this.state.activeScheme, activeFloor: this.state.activeFloor, coordBasis: this.state.coordBasis, names: this.state.names, drc: { ...this.state.drc } }; }
    _applySnapshot(s) {
      if (!s || !Array.isArray(s.schemes) || !s.schemes.length) return false;
      this.state.schemes = s.schemes; this.state.activeScheme = Math.min(s.activeScheme || 0, s.schemes.length - 1);
      this.state.floors = this.state.schemes[this.state.activeScheme].floors;
      this.state.activeFloor = Math.min(s.activeFloor || 0, this.state.floors.length - 1);
      this.state.coordBasis = s.coordBasis || 'LL'; if (s.names != null) this.state.names = !!s.names; if (s.drc) Object.assign(this.state.drc, s.drc);
      this.state.selected = null; this._reindexUid(); return true;
    }
    _tryRestoreAuto() { const s = this._lsGet(LS_AUTO); if (s) this._applySnapshot(s); }
    _autoSave() { clearTimeout(this._autoT); this._autoT = setTimeout(() => { if (this._lsSet(LS_AUTO, this._serialize())) this._setStatus('✓ 已自動儲存 ' + new Date().toLocaleTimeString()); }, 800); }
    _setStatus(m) { const t = this.el.toast; if (!t) return; t.textContent = m; t.classList.add('on'); clearTimeout(this._toastT); this._toastT = setTimeout(() => t.classList.remove('on'), 2000); }
    _saveNamed() { const name = prompt('儲存進度名稱：', '進度 ' + new Date().toLocaleString()); if (!name) return; const saves = this._lsGet(LS_SAVES) || {}; saves[name] = this._serialize(); if (this._lsSet(LS_SAVES, saves)) this._setStatus('✓ 已儲存「' + name + '」'); else alert('儲存失敗'); }
    _showLoadMenu() {
      const saves = this._lsGet(LS_SAVES) || {}, auto = this._lsGet(LS_AUTO), prev = this._lsGet(LS_PREV);
      const names = Object.keys(saves);
      const pick = prompt('輸入要載入的進度名稱：\n' + (auto ? 'auto — 自動存檔\n' : '') + (prev ? 'prev — 上一份（新建/載入前備份）\n' : '') + names.map(n => '• ' + n).join('\n'));
      if (!pick) return;
      const key = pick.trim().toLowerCase();
      const snap = key === 'auto' ? auto : key === 'prev' ? prev : saves[pick.trim()];
      if (!snap) { alert('找不到該進度'); return; }
      this._backupPrev();                                   // 載入前先備份目前
      this._pushHistory(); if (this._applySnapshot(snap)) { this._syncToggles(); this._render(); this._setStatus('✓ 已載入'); }
    }

    // ---------- 復原/重做 ----------
    _snapshot() { return JSON.stringify({ schemes: this.state.schemes, activeScheme: this.state.activeScheme, activeFloor: this.state.activeFloor }); }
    _pushHistory() { if (!this._hist) return; this._hist.undo.push(this._snapshot()); if (this._hist.undo.length > 60) this._hist.undo.shift(); this._hist.redo = []; this._editDirty = false; }
    _restore(j) { const o = JSON.parse(j); this.state.schemes = o.schemes; this.state.activeScheme = o.activeScheme; this.state.floors = this.state.schemes[o.activeScheme].floors; this.state.activeFloor = Math.min(o.activeFloor, this.state.floors.length - 1); this.state.selected = null; this._render(); }
    _undo() { if (!this._hist || !this._hist.undo.length) return; this._hist.redo.push(this._snapshot()); this._restore(this._hist.undo.pop()); }
    _redo() { if (!this._hist || !this._hist.redo.length) return; this._hist.undo.push(this._snapshot()); this._restore(this._hist.redo.pop()); }
  }

  if (!customElements.get('chip-floor-planner-2d')) customElements.define('chip-floor-planner-2d', ChipFloorPlanner2D);
})();
