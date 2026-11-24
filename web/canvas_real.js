(() => {
  "use strict";

  /*
   * 2D Real Multi-Card Cartesian Canvas Engine
   * Supports:
   *  - Classic functions y = f(x)
   *  - Vertical lines x = c (or x = expr(params))
   *  - Inverted curves x = g(y)
   *  - General implicit relations F(x, y) = 0 (4-thread C11 grid + Marching Squares!)
   *  - Draggable/lockable 2D Landmark Points & Landmark Lines (vertical / horizontal)
   *  - Per-card style settings (color, thickness, solid/dashed/dotted, step)
   *  - Calculus toolkit & Web Audio synth
   */

  const PALETTE = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#fb923c"];
  const SMALL_PRIMES = [];
  for (let n = 2; n <= 500; n++) {
    let ok = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { ok = false; break; }
    if (ok) SMALL_PRIMES.push(n);
  }

  const FIRST_GAMMAS = [
    14.1347, 21.0220, 25.0109, 30.4249, 32.9351, 37.5862, 40.9187, 43.3271,
    48.0052, 49.7738, 52.9703, 56.4462, 59.3470, 60.8318, 65.1125, 67.0798,
    69.5464, 72.0672, 75.7047, 77.1448, 79.3374, 82.9104, 84.7355, 87.4253,
  ];

  const state = {
    active: false,
    view: { xmin: -10.0, xmax: 10.0, ymin: -10.0, ymax: 10.0 },
    defaultView: { xmin: -10.0, xmax: 10.0, ymin: -10.0, ymax: 10.0 },
    showPrimes: true,
    showZeros: false,
    showMarkers: true,
    showErrorFill: false,
    squareAspect: true,
    savedRectRatio: null,
    savedRectView: null,
    squareMoved: false,

    /* 2D Landmark Points, Landmark Lines & Interactive Grid/Cell Polygons */
    points: [],
    lines: [],
    layerOrder: [],
    polygons: [],
    polyGridMap: new Map(),
    selectedPolyIds: new Set(),
    polyTool: "pan", /* "pan" | "select" | "deselect" | "add" */
    polyMarquee: null,
    polyPendingClick: null,
    polyPaint: null,
    polyUndoStack: [],
    gridR: 32,
    gridMinX: -32,
    gridMaxX: 32,
    gridMinY: -32,
    gridMaxY: 32,
    gridW: 64,
    gridH: 64,
    spaceHeld: false,
    nextPointId: 1,
    nextLineId: 1,
    nextPolyId: 1,
    selectedPointId: null,
    selectedLineId: null,
    dragPoint: null,
    dragLine: null,
    colorIdx: 0,

    /* Sampled data: { xs, curves, verticals, xOfYCurves, implicits, parametrics } */
    cache: null,
    fetchTimer: null,
    fetchBusy: false,
    fetchQueued: false,

    /* Calculus toolkit */
    calc: {
      showDeriv: false,
      showTangent: false,
      showIntegral: false,
      a: 2.0,
      b: 20.0,
      derivXs: null,
      derivYs: null,
      draggingGate: null,
    },

    /* Interaction */
    pan: null,
    hoverX: null,
    hoverPx: null,
  };

  const canvas = document.getElementById("canvas-real");
  const ctx = canvas.getContext("2d");
  const card = document.getElementById("real-plane-card");
  const legendX = document.getElementById("real-legend-x");
  const legendRows = document.getElementById("real-legend-rows");
  const planeSub = document.getElementById("real-plane-sub");
  const readoutIn = document.getElementById("readout-in");
  const readoutOut = document.getElementById("readout-out");
  const realPolyDock = document.getElementById("real-poly-dock");
  const realSelBanner = document.getElementById("real-selection-banner");
  const realSelBannerText = document.getElementById("real-sel-banner-text");

  function ws() { return window.CFVWorkspace; }
  function notifyDomain() {
    if (ws() && typeof ws().renderDomainCards === "function") ws().renderDomainCards();
  }

  /* -------------------------------------------------------------------------
   * Interactive 2D Real Cell Polygons (Select, Deselect, Box-Deselect, Delete, Undo & C11 Seed Sync)
   * ------------------------------------------------------------------------- */

  function rebuildPolyGridMap() {
    state.polyGridMap.clear();
    for (const p of state.polygons) state.polyGridMap.set(`${p.gx},${p.gy}`, p);
  }

  function getActiveGridDims() {
    const pm = ws() && typeof ws().getParamMap === "function" ? ws().getParamMap() : {};
    const rRaw = Number(pm.R);
    if (Number.isFinite(rRaw) && rRaw >= 2) {
      const r = Math.min(60, Math.max(4, Math.round(rRaw)));
      state.gridR = r;
      state.gridMinX = -r;
      state.gridMaxX = r;
      state.gridMinY = -r;
      state.gridMaxY = r;
      state.gridW = 2 * r;
      state.gridH = 2 * r;
      return { r, minX: -r, maxX: r, minY: -r, maxY: r, w: 2 * r, h: 2 * r, centered: true };
    }
    const wRaw = Number(pm.W);
    const hRaw = Number(pm.H);
    if (Number.isFinite(wRaw) && wRaw >= 4) {
      const w = Math.min(62, Math.max(4, Math.round(wRaw)));
      const h = Number.isFinite(hRaw) && hRaw >= 4 ? Math.min(64, Math.max(4, Math.round(hRaw))) : (state.gridH || 40);
      state.gridMinX = 0; state.gridMaxX = w;
      state.gridMinY = 0; state.gridMaxY = h;
      state.gridW = w; state.gridH = h;
      return { r: Math.round(w / 2), minX: 0, maxX: w, minY: 0, maxY: h, w, h, centered: false };
    }
    const r = state.gridR || 32;
    state.gridMinX = -r; state.gridMaxX = r;
    state.gridMinY = -r; state.gridMaxY = r;
    state.gridW = 2 * r; state.gridH = 2 * r;
    return { r, minX: -r, maxX: r, minY: -r, maxY: r, w: 2 * r, h: 2 * r, centered: true };
  }

  function pushPolyUndoSnapshot() {
    state.polyUndoStack.push(state.polygons.map((p) => ({ id: p.id, gx: p.gx, gy: p.gy, color: p.color })));
    if (state.polyUndoStack.length > 40) state.polyUndoStack.shift();
  }

  function updatePolyUI() {
    const dims = getActiveGridDims();
    const fillBtn = document.getElementById("btn-real-fill-grid");
    if (fillBtn) {
      fillBtn.textContent = dims.centered ? `Fill [±${dims.r}]²` : `Fill ${dims.w}×${dims.h}`;
      fillBtn.title = dims.centered
        ? `Fill entire [-${dims.r}, ${dims.r}]×[-${dims.r}, ${dims.r}] (${dims.w}×${dims.h}) play area with square polygons`
        : `Fill entire ${dims.w}×${dims.h} play area with square polygons`;
    }
    const hasPolys = state.polygons.length > 0 || state.polyTool !== "pan";
    if (realPolyDock) realPolyDock.classList.toggle("hidden", !hasPolys);
    const nSel = state.selectedPolyIds.size;
    if (realSelBanner) {
      realSelBanner.classList.toggle("hidden", nSel === 0);
      if (realSelBannerText) {
        realSelBannerText.textContent = `${nSel} cell${nSel === 1 ? "" : "s"} selected · Ctrl/Shift+Click or Deselect tool · Del to delete`;
      }
    }
    document.querySelectorAll(".real-dock-tool").forEach((b) => {
      b.classList.toggle("active", b.dataset.realTool === state.polyTool);
    });
    if (card) {
      card.style.cursor = state.polyTool === "pan" || state.spaceHeld ? "" : state.polyTool === "deselect" ? "cell" : "crosshair";
    }
  }

  function setPolyTool(tool) {
    state.polyTool = tool || "pan";
    state.polyMarquee = null;
    state.polyPaint = null;
    state.polyPendingClick = null;
    updatePolyUI();
    requestRender();
  }

  async function syncSeedToServer() {
    const cells = [];
    for (const p of state.polygons) {
      if (p.gx >= -64 && p.gx < 64 && p.gy >= -64 && p.gy < 64) {
        cells.push(p.gx, p.gy);
      }
    }
    try {
      await fetch("/api/real/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cells }),
      });
    } catch (_) {}
  }

  async function commitPolygonChange(markDirty = true) {
    rebuildPolyGridMap();
    updatePolyUI();
    notifyDomain();
    if (markDirty) notifyState(true, true);
    await syncSeedToServer();
    scheduleSample(true);
    requestRender();
  }

  function setPolygonsFromCells(cells, opts = {}) {
    if (!opts.silentUndo) pushPolyUndoSnapshot();
    state.polygons = [];
    state.selectedPolyIds.clear();
    const seen = new Set();
    const col = opts.color || "#34d399";
    for (const c of cells || []) {
      const gx = Math.floor(Number(c[0] ?? c.gx ?? c.x));
      const gy = Math.floor(Number(c[1] ?? c.gy ?? c.y));
      if (!Number.isFinite(gx) || !Number.isFinite(gy) || gx < -64 || gx >= 64 || gy < -64 || gy >= 64) continue;
      const key = `${gx},${gy}`;
      if (seen.has(key)) continue;
      seen.add(key);
      state.polygons.push({ id: state.nextPolyId++, gx, gy, color: col });
    }
    if (opts.selectAll) {
      for (const p of state.polygons) state.selectedPolyIds.add(p.id);
    }
    rebuildPolyGridMap();
    updatePolyUI();
    notifyDomain();
    return syncSeedToServer();
  }

  async function fillGridPolygons(gw, gh, selectAll = false) {
    const dims = getActiveGridDims();
    let minX = dims.minX, maxX = dims.maxX, minY = dims.minY, maxY = dims.maxY;
    if (Number.isFinite(gw) && gw >= 4 && Number.isFinite(gh) && gh >= 4) {
      minX = 0; maxX = Math.min(62, Math.round(gw));
      minY = 0; maxY = Math.min(64, Math.round(gh));
      state.gridMinX = minX; state.gridMaxX = maxX;
      state.gridMinY = minY; state.gridMaxY = maxY;
      state.gridW = maxX - minX; state.gridH = maxY - minY;
    } else if (Number.isFinite(gw) && gw >= 2 && gh === undefined) {
      const r = Math.min(60, Math.max(4, Math.round(gw)));
      minX = -r; maxX = r; minY = -r; maxY = r;
      state.gridR = r;
      state.gridMinX = minX; state.gridMaxX = maxX;
      state.gridMinY = minY; state.gridMaxY = maxY;
      state.gridW = 2 * r; state.gridH = 2 * r;
    }
    const cells = [];
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) cells.push([x, y]);
    }
    await setPolygonsFromCells(cells, { selectAll });
    setPolyTool("select");
    notifyState(true, true);
    scheduleSample(true);
    requestRender();
  }

  function selectAllPolygons() {
    state.selectedPolyIds.clear();
    for (const p of state.polygons) state.selectedPolyIds.add(p.id);
    updatePolyUI();
    notifyDomain();
    requestRender();
  }

  function clearPolySelection() {
    if (state.selectedPolyIds.size === 0) return;
    state.selectedPolyIds.clear();
    updatePolyUI();
    notifyDomain();
    requestRender();
  }

  function invertPolygonSelection() {
    const next = new Set();
    for (const p of state.polygons) {
      if (!state.selectedPolyIds.has(p.id)) next.add(p.id);
    }
    state.selectedPolyIds = next;
    updatePolyUI();
    notifyDomain();
    requestRender();
  }

  async function deleteSelectedPolygons() {
    if (state.selectedPolyIds.size === 0) {
      if (state.selectedPointId !== null) {
        const pt = state.points.find((p) => p.id === state.selectedPointId && !p.locked);
        if (pt) { deletePoint(pt.id); return true; }
      }
      if (state.selectedLineId !== null) {
        const ln = state.lines.find((l) => l.id === state.selectedLineId && !l.locked);
        if (ln) { deleteGuideLine(ln.id); return true; }
      }
      return false;
    }
    pushPolyUndoSnapshot();
    const del = state.selectedPolyIds;
    state.polygons = state.polygons.filter((p) => !del.has(p.id));
    state.selectedPolyIds.clear();
    await commitPolygonChange(true);
    return true;
  }

  async function undoPolygonAction() {
    if (state.polyUndoStack.length === 0) return false;
    state.polygons = state.polyUndoStack.pop();
    state.selectedPolyIds.clear();
    await commitPolygonChange(true);
    return true;
  }

  async function clearPolygons() {
    if (state.polygons.length === 0) return;
    pushPolyUndoSnapshot();
    state.polygons = [];
    state.selectedPolyIds.clear();
    await commitPolygonChange(true);
  }

  function addPolygonCell(gx, gy) {
    const dims = getActiveGridDims();
    if (gx < dims.minX || gx >= dims.maxX || gy < dims.minY || gy >= dims.maxY) return null;
    const key = `${gx},${gy}`;
    if (state.polyGridMap.has(key)) return state.polyGridMap.get(key);
    const p = { id: state.nextPolyId++, gx, gy, color: "#34d399" };
    state.polygons.push(p);
    state.polyGridMap.set(key, p);
    return p;
  }

  function hitPolygonAtScreen(sx, sy) {
    if (state.polygons.length === 0) return null;
    const gx = Math.floor(sToX(sx));
    const gy = Math.floor(sToY(sy));
    return state.polyGridMap.get(`${gx},${gy}`) || null;
  }
  function notifyState(immediate = false, markDirty = true) {
    if (ws() && typeof ws().notifyStateChanged === "function") ws().notifyStateChanged(immediate, markDirty);
  }

  function enforceSquareView(contain = false) {
    if (!state.squareAspect) return;
    const w = Math.max(1, canvas.clientWidth || card.clientWidth || 640);
    const h = Math.max(1, canvas.clientHeight || card.clientHeight || 480);
    const cx = 0.5 * (state.view.xmin + state.view.xmax);
    const cy = 0.5 * (state.view.ymin + state.view.ymax);
    const xSpan = Math.max(1e-6, state.view.xmax - state.view.xmin);
    const ySpan = Math.max(1e-6, state.view.ymax - state.view.ymin);
    const xUpp = xSpan / w;
    const yUpp = ySpan / h;
    const isSymmetricSquare = Math.abs(xSpan - ySpan) < 1e-3;
    const upp = (contain || isSymmetricSquare) ? Math.max(xUpp, yUpp) : Math.sqrt(xUpp * yUpp);
    state.view.xmin = cx - 0.5 * upp * w;
    state.view.xmax = cx + 0.5 * upp * w;
    state.view.ymin = cy - 0.5 * upp * h;
    state.view.ymax = cy + 0.5 * upp * h;
  }

  function setSquareAspect(enabled, forceEnforce = false) {
    const on = Boolean(enabled);
    const btn = document.getElementById("real-square");
    if (btn) btn.classList.toggle("active", on);
    if (on === state.squareAspect) {
      if (on && forceEnforce) {
        enforceSquareView(true);
        scheduleSample(true);
        requestRender();
      }
      return;
    }
    const w = Math.max(1, canvas.clientWidth || card.clientWidth || 640);
    const h = Math.max(1, canvas.clientHeight || card.clientHeight || 480);
    if (on) {
      const xUpp = (state.view.xmax - state.view.xmin) / w;
      const yUpp = (state.view.ymax - state.view.ymin) / h;
      state.savedRectRatio = xUpp > 1e-12 ? yUpp / xUpp : 1.0;
      state.savedRectView = { ...state.view };
      state.squareMoved = false;
      state.squareAspect = true;
      if (btn) btn.classList.add("active");
      enforceSquareView();
    } else {
      state.squareAspect = false;
      if (btn) btn.classList.remove("active");
      if (!state.squareMoved && state.savedRectView) {
        state.view = { ...state.savedRectView };
      } else {
        const cx = 0.5 * (state.view.xmin + state.view.xmax);
        const cy = 0.5 * (state.view.ymin + state.view.ymax);
        const upp = Math.max(1e-9, (state.view.xmax - state.view.xmin) / w);
        const ratio = Number.isFinite(state.savedRectRatio) && state.savedRectRatio > 1e-6 ? state.savedRectRatio : 1.0;
        const halfX = 0.5 * upp * w;
        const halfY = 0.5 * (upp * ratio) * h;
        state.view = { xmin: cx - halfX, xmax: cx + halfX, ymin: cy - halfY, ymax: cy + halfY };
      }
    }
    scheduleSample(true);
    requestRender();
  }

  function ensureCanvasSize() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 2 || h < 2) return false;
    const tw = Math.round(w * dpr);
    const th = Math.round(h * dpr);
    if (canvas.width !== tw || canvas.height !== th) {
      canvas.width = tw;
      canvas.height = th;
    }
    return true;
  }

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (state.active) resize();
    });
    ro.observe(card);
  }

  function xToS(x) { return ((x - state.view.xmin) / (state.view.xmax - state.view.xmin)) * canvas.clientWidth; }
  function yToS(y) { return canvas.clientHeight - ((y - state.view.ymin) / (state.view.ymax - state.view.ymin)) * canvas.clientHeight; }
  function sToX(sx) { return state.view.xmin + (sx / canvas.clientWidth) * (state.view.xmax - state.view.xmin); }
  function sToY(sy) { return state.view.ymin + ((canvas.clientHeight - sy) / canvas.clientHeight) * (state.view.ymax - state.view.ymin); }

  function niceStep(raw) {
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    const e = Math.floor(Math.log10(raw)), f = raw / Math.pow(10, e);
    return (f <= 1.2 ? 1 : f <= 2.5 ? 2 : f <= 5.5 ? 5 : 10) * Math.pow(10, e);
  }
  function fmtTick(v) {
    if (Math.abs(v) < 1e-10) return "0";
    if (Math.abs(v) >= 10000 || Math.abs(v) < 0.005) return v.toExponential(1);
    return Number(v.toFixed(4)).toString();
  }
  function hexToRgba(hex, a) {
    if (!hex || hex[0] !== "#" || hex.length < 7) return `rgba(56,189,248,${a})`;
    return `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
  }
  function applyLineStyle(context, lineStyle) {
    if (lineStyle === "dashed") context.setLineDash([7, 5]);
    else if (lineStyle === "dotted") context.setLineDash([2, 4]);
    else context.setLineDash([]);
  }

  /* Safe numeric fallback for simple `x = c` when server compile is disabled (public safe mode) */
  function evalSimpleConstant(expr, paramMap) {
    const clean = (expr || "").trim();
    if (!clean) return NaN;
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(clean)) return parseFloat(clean);
    if (paramMap && Object.prototype.hasOwnProperty.call(paramMap, clean)) return Number(paramMap[clean]);
    if (clean === "M_PI" || clean === "pi") return Math.PI;
    if (clean === "-M_PI" || clean === "-pi") return -Math.PI;
    if (clean === "M_E") return Math.E;
    if (/^-[a-zA-Z_][a-zA-Z0-9_]*$/.test(clean) && paramMap && Object.prototype.hasOwnProperty.call(paramMap, clean.slice(1))) {
      return -Number(paramMap[clean.slice(1)]);
    }
    return NaN;
  }

  /* -------------------------------------------------------------------------
   * Sampling All Visible 2D Cards (Functions + Verticals + x=g(y) + Implicits + Parametrics!)
   * Single-flight coalescing prevents slider animations from ever starving/dropping frames.
   * ------------------------------------------------------------------------- */

  function scheduleSample(immediate = false) {
    if (!state.active) return;
    if (state.fetchTimer) {
      clearTimeout(state.fetchTimer);
      state.fetchTimer = null;
    }
    if (immediate) {
      if (state.fetchBusy) {
        state.fetchQueued = true;
        return;
      }
      runSampleLoop();
    } else {
      state.fetchTimer = setTimeout(() => {
        state.fetchTimer = null;
        scheduleSample(true);
      }, 28);
    }
  }

  async function runSampleLoop() {
    if (state.fetchBusy) {
      state.fetchQueued = true;
      return;
    }
    state.fetchBusy = true;
    try {
      do {
        state.fetchQueued = false;
        await fetchSamplesOnce();
      } while (state.fetchQueued && state.active);
    } finally {
      state.fetchBusy = false;
    }
  }

  async function fetchSamplesOnce() {
    if (!state.active || !ws()) return;
    const cards = ws().getVisibleRealCards();
    if (cards.length === 0) {
      state.cache = { xs: [], curves: [], verticals: [], xOfYCurves: [], implicits: [], parametrics: [] };
      updateLegend(); requestRender(); return;
    }

    const w = canvas.clientWidth || 900;
    const isAnim = ws().isAnySliderPlaying();
    const samples = isAnim
      ? Math.min(280, Math.max(180, Math.round(w * 0.30)))
      : Math.min(620, Math.max(380, Math.round(w * 0.58)));

    let xs = [];
    const curves = [];
    const verticals = [];
    const xOfYCurves = [];
    const implicits = [];
    const parametrics = [];

    const compiled = ws().isWorkspaceCompiled("real");
    const params = ws().getParamValues();
    const paramMap = ws().getParamMap();

    const fnList = cards.filter((c) => (c.realKind || "fn") === "fn");
    const vertList = cards.filter((c) => c.realKind === "vertical");
    const xOfYList = cards.filter((c) => c.realKind === "x_of_y");
    const implList = cards.filter((c) => c.realKind === "implicit");
    const paramList = cards.filter((c) => c.realKind === "parametric");

    /* 1. Standard y = f(x) functions */
    if (fnList.length > 0) {
      if (compiled) {
        const res = await fetch("/api/workspace/real_sample", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            xmin: state.view.xmin, xmax: state.view.xmax, samples,
            slots: fnList.map((c) => c.slot), params,
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        xs = data.xs || [];
        (data.series || []).forEach((s, i) => {
          const c = fnList[i];
          curves.push({
            cardId: c.id, title: c.title, color: c.color, step: Boolean(c.step),
            lineStyle: c.lineStyle || "solid", lineWidth: normLineWidth(c.lineWidth, 2.1),
            opacity: normOpacity(c.opacity, 1.0), ys: s.ys,
          });
        });
      } else {
        for (const c of fnList) {
          const b = c.builtin || { fn: 0, kind: "exact" };
          const ks = b.kind === "approx" ? [b.paramName ? Math.round(paramMap[b.paramName] ?? 25) : b.k ?? 20] : [];
          const res = await fetch("/api/real/sample", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fn: b.fn, xmin: state.view.xmin, xmax: state.view.xmax, samples,
              exact: b.kind === "exact", baseline: b.kind === "baseline", ks,
            }),
          });
          if (!res.ok) return;
          const d = await res.json();
          xs = d.xs || xs;
          const ys = b.kind === "exact" ? d.exact : b.kind === "baseline" ? d.baseline : (d.approx && d.approx[0] ? d.approx[0].ys : []);
          curves.push({
            cardId: c.id, title: c.title, color: c.color, step: Boolean(c.step),
            lineStyle: c.lineStyle || "solid", lineWidth: normLineWidth(c.lineWidth, 2.1),
            opacity: normOpacity(c.opacity, 1.0), ys,
          });
        }
      }
    }

    /* 2. Vertical Lines x = expr */
    if (vertList.length > 0) {
      if (compiled) {
        const res = await fetch("/api/workspace/real_sample", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            xmin: 0, xmax: 1, samples: 8,
            slots: vertList.map((c) => c.slot), params,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          (data.series || []).forEach((s, i) => {
            const c = vertList[i];
            const xv = s.ys && s.ys.length > 0 ? s.ys[0] : null;
            if (xv !== null && Number.isFinite(xv)) {
              verticals.push({
                cardId: c.id, title: c.title, color: c.color, xVal: xv,
                lineStyle: c.lineStyle || "solid", lineWidth: normLineWidth(c.lineWidth, 2.2),
                opacity: normOpacity(c.opacity, 1.0),
              });
            }
          });
        }
      } else {
        for (const c of vertList) {
          const xv = evalSimpleConstant(c.compiledCode, paramMap);
          if (Number.isFinite(xv)) {
            verticals.push({
              cardId: c.id, title: c.title, color: c.color, xVal: xv,
              lineStyle: c.lineStyle || "solid", lineWidth: normLineWidth(c.lineWidth, 2.2),
              opacity: normOpacity(c.opacity, 1.0),
            });
          }
        }
      }
    }

    /* 3. Inverted Curves x = g(y) sampled along [ymin, ymax] */
    if (xOfYList.length > 0 && compiled) {
      const res = await fetch("/api/workspace/real_sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          xmin: state.view.ymin, xmax: state.view.ymax, samples: Math.min(480, samples),
          slots: xOfYList.map((c) => c.slot), params,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const yGrid = data.xs || [];
        (data.series || []).forEach((s, i) => {
          const c = xOfYList[i];
          xOfYCurves.push({
            cardId: c.id, title: c.title, color: c.color,
            lineStyle: c.lineStyle || "solid", lineWidth: normLineWidth(c.lineWidth, 2.2),
            opacity: normOpacity(c.opacity, 1.0),
            ys: yGrid, xs: s.ys,
          });
        });
      }
    }

    /* 4. Implicit Relations F(x, y) = 0 via native C11 pthreads grid + Marching Squares */
    if (implList.length > 0 && compiled) {
      const nx = isAnim ? 76 : 124;
      const ny = isAnim ? 54 : 92;
      await Promise.all(
        implList.map(async (c) => {
          const res = await fetch("/api/workspace/implicit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              slot: c.slot,
              xmin: state.view.xmin, xmax: state.view.xmax,
              ymin: state.view.ymin, ymax: state.view.ymax,
              nx, ny, params,
            }),
          });
          if (!res.ok) return;
          const buf = await res.arrayBuffer();
          implicits.push({
            cardId: c.id, title: c.title, color: c.color,
            lineStyle: c.lineStyle || "solid", lineWidth: normLineWidth(c.lineWidth, 2.2),
            opacity: normOpacity(c.opacity, 1.0),
            nx, ny,
            xmin: state.view.xmin, xmax: state.view.xmax,
            ymin: state.view.ymin, ymax: state.view.ymax,
            grid: new Float32Array(buf),
          });
        })
      );
    }

    /* 5. Continuous Parametric Curves (x(t), y(t)) via 4-thread C11 binary endpoint! */
    if (paramList.length > 0 && compiled) {
      await Promise.all(
        paramList.map(async (c) => {
          const tmin = Number.isFinite(c.tMin) ? c.tMin : 0.0;
          const tmax = Number.isFinite(c.tMax) && c.tMax > tmin ? c.tMax : Math.PI * 2;
          const span = tmax - tmin;
          const pSamples = span >= 100
            ? Math.min(4800, Math.max(1200, Math.round(span) + 1))
            : (isAnim ? 720 : 1200);
          const res = await fetch("/api/workspace/parametric", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slot: c.slot, tmin, tmax, samples: pSamples, params }),
          });
          if (!res.ok) return;
          const buf = await res.arrayBuffer();
          parametrics.push({
            cardId: c.id, title: c.title, color: c.color,
            lineStyle: c.lineStyle || "solid", lineWidth: normLineWidth(c.lineWidth, 2.3),
            opacity: normOpacity(c.opacity, 1.0),
            xy: new Float32Array(buf),
          });
        })
      );
    }

    if (!state.active) return;
    state.cache = { xs, curves, verticals, xOfYCurves, implicits, parametrics };
    planeSub.textContent = cards[0] ? `${cards[0].title}${cards.length > 1 ? ` + ${cards.length - 1} more` : ""}` : "y = f(x)";
    updateLegend();
    if ((state.calc.showDeriv || state.calc.showIntegral) && fnList.length > 0) refreshCalculus();
    requestRender();
  }

  async function refreshCalculus() {
    if (!state.active || !ws()) return;
    const cards = ws().getVisibleRealCards().filter((c) => (c.realKind || "fn") === "fn");
    if (cards.length === 0) return;
    const first = cards[0];
    const payload = {
      xmin: state.view.xmin, xmax: state.view.xmax, samples: 320,
      a: state.calc.a, b: state.calc.b,
      deriv: state.calc.showDeriv, integral: state.calc.showIntegral,
    };
    if (ws().isWorkspaceCompiled("real")) {
      payload.slot = first.slot;
      payload.params = ws().getParamValues();
    } else {
      payload.fn = first.builtin ? first.builtin.fn : 0;
    }
    const res = await fetch("/api/real/calculus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return;
    const data = await res.json();
    state.calc.derivXs = data.xs || null;
    state.calc.derivYs = data.deriv || null;
    const iv = document.getElementById("calc-int-val");
    if (iv) iv.textContent = state.calc.showIntegral ? Number(data.integral).toFixed(6) : "—";
    requestRender();
  }

  /* -------------------------------------------------------------------------
   * Rendering (Curves, Vertical Lines, x=g(y), Implicit Marching Squares, Points & Guides)
   * ------------------------------------------------------------------------- */

  let rq = false;
  function requestRender() {
    if (!state.active) return;
    if (!rq) { rq = true; requestAnimationFrame(renderFrame); }
  }

  function resize() {
    if (!state.active) return;
    ensureCanvasSize();
    if (state.squareAspect) {
      const w = Math.max(1, canvas.clientWidth || card.clientWidth || 640);
      const h = Math.max(1, canvas.clientHeight || card.clientHeight || 480);
      const cx = 0.5 * (state.view.xmin + state.view.xmax);
      const upp = Math.max(1e-9, (state.view.ymax - state.view.ymin) / h);
      state.view.xmin = cx - 0.5 * upp * w;
      state.view.xmax = cx + 0.5 * upp * w;
      scheduleSample(false);
    }
    requestRender();
  }

  function isLightTheme() {
    return typeof document !== "undefined" && document.documentElement.dataset.theme === "light";
  }
  function normLineWidth(v, fallback = 2.1) {
    if (v === undefined || v === null || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, n) : fallback;
  }
  function normOpacity(v, fallback = 1.0) {
    if (v === undefined || v === null || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
  }
  function syncLayerOrder() {
    const valid = new Map();
    for (const l of state.lines) valid.set(`guide_line:${l.id}`, { kind: "guide_line", id: l.id });
    for (const p of state.points) valid.set(`point:${p.id}`, { kind: "point", id: p.id });
    const next = [];
    const seen = new Set();
    for (const e of state.layerOrder || []) {
      const k = `${e.kind}:${e.id}`;
      if (valid.has(k) && !seen.has(k)) { seen.add(k); next.push({ kind: e.kind, id: e.id }); }
    }
    for (const [k, rec] of valid.entries()) {
      if (!seen.has(k)) { seen.add(k); next.push(rec); }
    }
    state.layerOrder = next;
    return next;
  }
  function getOrderedElements() {
    syncLayerOrder();
    const lMap = new Map(state.lines.map((l) => [l.id, l]));
    const pMap = new Map(state.points.map((p) => [p.id, p]));
    const out = [];
    for (const e of state.layerOrder) {
      const item = e.kind === "guide_line" ? lMap.get(e.id) : pMap.get(e.id);
      if (item) out.push({ kind: e.kind, id: e.id, item });
    }
    return out;
  }
  function reorderElement(fromIdx, toIdx) {
    syncLayerOrder();
    const n = state.layerOrder.length;
    if (fromIdx < 0 || fromIdx >= n || toIdx < 0 || toIdx >= n || fromIdx === toIdx) return false;
    const [moved] = state.layerOrder.splice(fromIdx, 1);
    state.layerOrder.splice(toIdx, 0, moved);
    notifyDomain();
    notifyState(true);
    requestRender();
    return true;
  }
  function moveElementLayer(kind, id, action) {
    syncLayerOrder();
    const idx = state.layerOrder.findIndex((e) => e.kind === kind && e.id === id);
    if (idx < 0) return false;
    const n = state.layerOrder.length;
    let target = idx;
    if (action === "forward") target = Math.min(n - 1, idx + 1);
    else if (action === "backward") target = Math.max(0, idx - 1);
    else if (action === "front") target = n - 1;
    else if (action === "back") target = 0;
    return reorderElement(idx, target);
  }

  function sampleAt(xs, ys, tx) {
    if (!xs || !ys || xs.length < 2) return null;
    const x0 = xs[0], x1 = xs[xs.length - 1];
    if (tx < x0 || tx > x1) return null;
    const f = ((tx - x0) / (x1 - x0)) * (xs.length - 1);
    const i = Math.max(0, Math.min(xs.length - 2, Math.floor(f)));
    const a = ys[i], b = ys[i + 1];
    if (a === null || b === null) return a ?? b;
    return a + (b - a) * (f - i);
  }

  function drawCurve(xs, ys, color, lw, lineStyle, step, glow, opacity = 1.0) {
    if (!xs || !ys || xs.length < 2) return;
    const width = normLineWidth(lw, 2.1);
    const op = normOpacity(opacity, 1.0);
    if (width <= 0 || op <= 0.001) return;
    const h = canvas.clientHeight;
    const trace = () => {
      ctx.beginPath();
      let down = false, psy = 0;
      for (let i = 0; i < xs.length; i++) {
        const y = ys[i];
        if (y === null || !Number.isFinite(y)) { down = false; continue; }
        const sx = xToS(xs[i]);
        const sy = Math.max(-h * 2, Math.min(h * 3, yToS(y)));
        if (!down) { ctx.moveTo(sx, sy); down = true; }
        else if (step) { ctx.lineTo(sx, psy); ctx.lineTo(sx, sy); }
        else ctx.lineTo(sx, sy);
        psy = sy;
      }
    };
    ctx.save();
    ctx.globalAlpha = op;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    applyLineStyle(ctx, lineStyle || "solid");
    if (glow) { trace(); ctx.strokeStyle = hexToRgba(color, 0.24); ctx.lineWidth = width + 4; ctx.stroke(); }
    trace(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    ctx.restore();
  }

  function drawXOfYCurve(c) {
    const { xs, ys, color, lineWidth, lineStyle, opacity } = c;
    const width = normLineWidth(lineWidth, 2.2);
    const op = normOpacity(opacity, 1.0);
    if (!xs || !ys || xs.length < 2 || width <= 0 || op <= 0.001) return;
    const w = canvas.clientWidth;
    const trace = () => {
      ctx.beginPath();
      let down = false;
      for (let i = 0; i < ys.length; i++) {
        const x = xs[i];
        if (x === null || !Number.isFinite(x)) { down = false; continue; }
        const sx = Math.max(-w * 2, Math.min(w * 3, xToS(x)));
        const sy = yToS(ys[i]);
        if (!down) { ctx.moveTo(sx, sy); down = true; }
        else ctx.lineTo(sx, sy);
      }
    };
    ctx.save();
    ctx.globalAlpha = op;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    applyLineStyle(ctx, lineStyle || "solid");
    trace(); ctx.strokeStyle = hexToRgba(color, 0.24); ctx.lineWidth = width + 4; ctx.stroke();
    trace(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    ctx.restore();
  }

  function drawImplicitContour(imp) {
    const { grid, nx, ny, xmin, xmax, ymin, ymax, color, lineWidth, lineStyle, opacity } = imp;
    const width = normLineWidth(lineWidth, 2.2);
    const op = normOpacity(opacity, 1.0);
    if (!grid || grid.length < nx * ny || width <= 0 || op <= 0.001) return;
    const dx = (xmax - xmin) / (nx - 1);
    const dy = (ymax - ymin) / (ny - 1);

    const interp = (a, b, va, vb) => {
      const denom = va - vb;
      const t = Math.abs(denom) > 1e-12 ? va / denom : 0.5;
      return a + Math.max(0, Math.min(1, t)) * (b - a);
    };

    const traceSegs = () => {
      ctx.beginPath();
      for (let j = 0; j < ny - 1; j++) {
        const y0 = ymin + j * dy;
        const y1 = y0 + dy;
        const r0 = j * nx;
        const r1 = r0 + nx;
        for (let i = 0; i < nx - 1; i++) {
          const v00 = grid[r0 + i];
          const v10 = grid[r0 + i + 1];
          const v11 = grid[r1 + i + 1];
          const v01 = grid[r1 + i];
          if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v11) || !Number.isFinite(v01)) continue;
          const m = (v00 > 0 ? 1 : 0) | (v10 > 0 ? 2 : 0) | (v11 > 0 ? 4 : 0) | (v01 > 0 ? 8 : 0);
          if (m === 0 || m === 15) continue;

          const x0 = xmin + i * dx;
          const x1 = x0 + dx;
          const pts = [];
          /* Edge 0: bottom (00-10) */
          if ((m & 1) !== ((m >> 1) & 1)) pts.push([interp(x0, x1, v00, v10), y0]);
          /* Edge 1: right (10-11) */
          if (((m >> 1) & 1) !== ((m >> 2) & 1)) pts.push([x1, interp(y0, y1, v10, v11)]);
          /* Edge 2: top (01-11) */
          if (((m >> 3) & 1) !== ((m >> 2) & 1)) pts.push([interp(x0, x1, v01, v11), y1]);
          /* Edge 3: left (00-01) */
          if ((m & 1) !== ((m >> 3) & 1)) pts.push([x0, interp(y0, y1, v00, v01)]);

          if (pts.length === 2) {
            ctx.moveTo(xToS(pts[0][0]), yToS(pts[0][1]));
            ctx.lineTo(xToS(pts[1][0]), yToS(pts[1][1]));
          } else if (pts.length === 4) {
            ctx.moveTo(xToS(pts[0][0]), yToS(pts[0][1]));
            ctx.lineTo(xToS(pts[1][0]), yToS(pts[1][1]));
            ctx.moveTo(xToS(pts[2][0]), yToS(pts[2][1]));
            ctx.lineTo(xToS(pts[3][0]), yToS(pts[3][1]));
          }
        }
      }
    };

    ctx.save();
    ctx.globalAlpha = op;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    applyLineStyle(ctx, lineStyle || "solid");
    traceSegs(); ctx.strokeStyle = hexToRgba(color, 0.24); ctx.lineWidth = width + 4; ctx.stroke();
    traceSegs(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    ctx.restore();
  }

  function drawParametricCurve(pc) {
    const { xy, color, lineWidth, lineStyle, opacity } = pc;
    const width = normLineWidth(lineWidth, 2.3);
    const op = normOpacity(opacity, 1.0);
    if (!xy || xy.length < 4 || width <= 0 || op <= 0.001) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const trace = () => {
      ctx.beginPath();
      let down = false;
      for (let i = 0; i + 1 < xy.length; i += 2) {
        const px = xy[i], py = xy[i + 1];
        if (!Number.isFinite(px) || !Number.isFinite(py)) { down = false; continue; }
        const sx = Math.max(-w * 2, Math.min(w * 3, xToS(px)));
        const sy = Math.max(-h * 2, Math.min(h * 3, yToS(py)));
        if (!down) { ctx.moveTo(sx, sy); down = true; }
        else ctx.lineTo(sx, sy);
      }
    };
    ctx.save();
    ctx.globalAlpha = op;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    applyLineStyle(ctx, lineStyle || "solid");
    trace(); ctx.strokeStyle = hexToRgba(color, 0.25); ctx.lineWidth = width + 4; ctx.stroke();
    trace(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    ctx.restore();
  }

  function drawSingleGuideLine(ln, w, h) {
    if (!ln.visible) return;
    const op = normOpacity(ln.opacity, 1.0);
    if (op <= 0.001) return;
    const sel = ln.id === state.selectedLineId;
    const col = ln.color || "#fbbf24";
    const lw = normLineWidth(ln.lineWidth, 1.6);
    const hiCol = isLightTheme() ? "#0f172a" : "#ffffff";

    ctx.save();
    ctx.globalAlpha = op;
    ctx.font = '600 10.5px "JetBrains Mono", monospace';
    ctx.strokeStyle = sel ? hiCol : hexToRgba(col, 0.85);
    ctx.lineWidth = lw + (sel ? 0.8 : 0);
    applyLineStyle(ctx, ln.lineStyle || "dashed");

    if (ln.orientation === "horizontal") {
      const sy = yToS(ln.value);
      if (sy >= -6 && sy <= h + 6) {
        if (lw > 0 || sel) { ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke(); }
        if (ln.showLabel !== false && ln.label) {
          ctx.setLineDash([]);
          ctx.fillStyle = col;
          ctx.fillText(ln.label, 12, Math.max(54, sy - 6));
        }
      }
    } else {
      const sx = xToS(ln.value);
      if (sx >= -6 && sx <= w + 6) {
        if (lw > 0 || sel) { ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke(); }
        if (ln.showLabel !== false && ln.label) {
          ctx.setLineDash([]);
          ctx.fillStyle = col;
          ctx.fillText(ln.label, sx + 6, 58);
        }
      }
    }
    ctx.restore();
  }

  function drawSinglePoint(p, w, h) {
    if (!p.visible) return;
    const op = normOpacity(p.opacity, 1.0);
    if (op <= 0.001) return;
    const sx = xToS(p.x), sy = yToS(p.y);
    if (sx < -36 || sx > w + 36 || sy < -36 || sy > h + 36) return;
    const drawIcon = window.CFVComplex && window.CFVComplex.drawPointIcon;
    const sel = p.id === state.selectedPointId;
    ctx.save();
    ctx.globalAlpha = op;
    ctx.font = '10.5px "JetBrains Mono", monospace';
    if (drawIcon) {
      drawIcon(ctx, sx, sy, p.icon || "dot", p.color || "#34d399", p.size || 5, sel);
    } else {
      ctx.fillStyle = p.color || "#34d399";
      ctx.beginPath(); ctx.arc(sx, sy, p.size || 5, 0, Math.PI * 2); ctx.fill();
    }
    if (p.showLabel !== false && p.label) {
      ctx.fillStyle = p.color || (isLightTheme() ? "#0f172a" : "#e2e8f0");
      ctx.fillText(p.label, sx + (p.size || 5) + 6, sy + 3);
    }
    ctx.restore();
  }

  function renderFrame() {
    rq = false;
    if (!state.active) return;
    if (!ensureCanvasSize()) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const light = isLightTheme();
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = light ? "#f8fafc" : "#0a0e17";
    ctx.fillRect(0, 0, w, h);

    const xSpan = state.view.xmax - state.view.xmin;
    const ySpan = state.view.ymax - state.view.ymin;
    const xStep = niceStep((xSpan * 90) / Math.max(1, w));
    const yStep = niceStep((ySpan * 65) / Math.max(1, h));

    ctx.strokeStyle = light ? "rgba(15,23,42,0.09)" : "rgba(148,163,184,0.11)"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(state.view.xmin / xStep) * xStep; x <= state.view.xmax; x += xStep) {
      const sx = Math.round(xToS(x)) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
    }
    for (let y = Math.floor(state.view.ymin / yStep) * yStep; y <= state.view.ymax; y += yStep) {
      const sy = Math.round(yToS(y)) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(w, sy);
    }
    ctx.stroke();

    if (state.showMarkers) {
      if (state.showPrimes && xSpan <= 115) {
        ctx.save(); ctx.font = '10px "JetBrains Mono", monospace';
        const showLbl = xSpan <= 55;
        for (const p of SMALL_PRIMES) {
          if (p < state.view.xmin || p > state.view.xmax) continue;
          const sx = xToS(p);
          ctx.strokeStyle = "rgba(52,211,153,0.13)"; ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
          if (showLbl) { ctx.fillStyle = "rgba(52,211,153,0.7)"; ctx.fillText(String(p), sx + 2, h - 14); }
        }
        ctx.restore();
      } else if (state.showZeros) {
        ctx.save(); ctx.font = '10px "JetBrains Mono", monospace';
        FIRST_GAMMAS.forEach((g, idx) => {
          if (g < state.view.xmin || g > state.view.xmax) return;
          const sx = xToS(g);
          ctx.strokeStyle = "rgba(251,191,36,0.24)"; ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
          ctx.fillStyle = "rgba(251,191,36,0.8)"; ctx.fillText(`γ${idx + 1}`, sx + 3, 56);
        });
        ctx.restore();
      }
    }

    const ox = xToS(0), oy = yToS(0);
    ctx.strokeStyle = light ? "rgba(15,23,42,0.34)" : "rgba(203,213,225,0.36)"; ctx.lineWidth = 1.25;
    ctx.beginPath();
    if (oy >= 0 && oy <= h) { ctx.moveTo(0, oy); ctx.lineTo(w, oy); }
    if (ox >= 0 && ox <= w) { ctx.moveTo(ox, 0); ctx.lineTo(ox, h); }
    ctx.stroke();

    ctx.fillStyle = light ? "rgba(51,65,85,0.8)" : "rgba(148,163,184,0.7)"; ctx.font = '10px "JetBrains Mono", monospace';
    const xly = Math.min(h - 14, Math.max(42, oy + 14));
    const ylx = Math.min(w - 40, Math.max(8, ox + 6));
    for (let x = Math.floor(state.view.xmin / xStep) * xStep; x <= state.view.xmax; x += xStep) {
      const sx = xToS(x); if (sx > 24 && sx < w - 24) ctx.fillText(fmtTick(x), sx - 9, xly);
    }
    for (let y = Math.floor(state.view.ymin / yStep) * yStep; y <= state.view.ymax; y += yStep) {
      if (Math.abs(y) < yStep * 0.2) continue;
      const sy = yToS(y); if (sy > 42 && sy < h - 20) ctx.fillText(fmtTick(y), ylx, sy + 3);
    }

    if (state.cache) {
      const { xs, curves, verticals, xOfYCurves, implicits, parametrics } = state.cache;

      /* Implicit Relations F(x,y) = 0 */
      for (const imp of implicits || []) drawImplicitContour(imp);

      /* Continuous Parametric Curves (x(t), y(t)) */
      for (const pc of parametrics || []) drawParametricCurve(pc);

      /* Inverted curves x = g(y) */
      for (const xc of xOfYCurves || []) drawXOfYCurve(xc);

      /* Vertical lines x = expr */
      for (const v of verticals || []) {
        const vw = normLineWidth(v.lineWidth, 2.2);
        const vop = normOpacity(v.opacity, 1.0);
        if (vw <= 0 || vop <= 0.001) continue;
        const sx = xToS(v.xVal);
        if (sx < -10 || sx > w + 10) continue;
        ctx.save();
        ctx.globalAlpha = vop;
        applyLineStyle(ctx, v.lineStyle || "solid");
        ctx.strokeStyle = hexToRgba(v.color, 0.28); ctx.lineWidth = vw + 4;
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
        ctx.strokeStyle = v.color; ctx.lineWidth = vw;
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = v.color;
        ctx.font = '600 10.5px "JetBrains Mono", monospace';
        ctx.fillText(`x = ${Number(v.xVal.toFixed(3))}`, sx + 6, 74);
        ctx.restore();
      }

      /* Standard y = f(x) curves */
      if (curves && curves.length > 0) {
        if (state.showErrorFill && curves.length >= 2) {
          const ref = curves[0];
          const cmp = [...curves].reverse().find((c) => c !== ref && c.lineStyle === "solid");
          if (cmp) {
            ctx.save();
            ctx.fillStyle = hexToRgba(cmp.color, 0.13);
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < xs.length; i++) {
              if (ref.ys[i] === null || cmp.ys[i] === null) continue;
              const sx = xToS(xs[i]), sy = yToS(cmp.ys[i]);
              if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
            }
            for (let i = xs.length - 1; i >= 0; i--) {
              if (ref.ys[i] === null || cmp.ys[i] === null) continue;
              ctx.lineTo(xToS(xs[i]), yToS(ref.ys[i]));
            }
            ctx.closePath(); ctx.fill();
            ctx.restore();
          }
        }

        if (state.calc.showIntegral && curves[0]) {
          const ys = curves[0].ys;
          const lo = Math.min(state.calc.a, state.calc.b), hi = Math.max(state.calc.a, state.calc.b);
          const zy = yToS(0);
          ctx.save();
          ctx.fillStyle = "rgba(52,211,153,0.2)";
          ctx.beginPath();
          let st = false, lsx = 0;
          for (let i = 0; i < xs.length; i++) {
            if (xs[i] < lo || xs[i] > hi || ys[i] === null) continue;
            const sx = xToS(xs[i]), sy = yToS(ys[i]);
            if (!st) { ctx.moveTo(sx, zy); ctx.lineTo(sx, sy); st = true; } else ctx.lineTo(sx, sy);
            lsx = sx;
          }
          if (st) { ctx.lineTo(lsx, zy); ctx.closePath(); ctx.fill(); }
          for (const [lbl, gx] of [["a", state.calc.a], ["b", state.calc.b]]) {
            const sx = xToS(gx);
            ctx.strokeStyle = "#34d399"; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
            ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = "#34d399"; ctx.beginPath(); ctx.roundRect(sx - 13, 46, 26, 19, 4); ctx.fill();
            ctx.fillStyle = "#061019"; ctx.font = '700 11px "JetBrains Mono", monospace'; ctx.fillText(lbl, sx - 3.5, 59);
          }
          ctx.restore();
        }

        for (let i = 1; i < curves.length; i++) {
          const c = curves[i];
          drawCurve(xs, c.ys, c.color, c.lineWidth, c.lineStyle, c.step, i === curves.length - 1, c.opacity);
        }
        drawCurve(xs, curves[0].ys, curves[0].color, curves[0].lineWidth, curves[0].lineStyle, curves[0].step, true, curves[0].opacity);

        if (state.calc.showDeriv && state.calc.derivXs && state.calc.derivYs) {
          drawCurve(state.calc.derivXs, state.calc.derivYs, "#fb7185", 1.8, "solid", false, false);
        }

        if (state.calc.showTangent && state.hoverX !== null && curves[0]) {
          const y0 = sampleAt(xs, curves[0].ys, state.hoverX);
          const hdx = Math.max(1e-3, xSpan * 0.004);
          const yp = sampleAt(xs, curves[0].ys, state.hoverX + hdx);
          const ym = sampleAt(xs, curves[0].ys, state.hoverX - hdx);
          if (y0 !== null && yp !== null && ym !== null) {
            const sl = (yp - ym) / (2 * hdx), sp = xSpan * 0.14;
            ctx.save(); ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(xToS(state.hoverX - sp), yToS(y0 - sl * sp)); ctx.lineTo(xToS(state.hoverX + sp), yToS(y0 + sl * sp)); ctx.stroke();
            ctx.restore();
          }
        }
      }

      if (state.hoverX !== null && state.hoverPx !== null) {
        const sx = state.hoverPx;
        ctx.save();
        ctx.strokeStyle = "rgba(148,163,184,0.35)"; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke(); ctx.setLineDash([]);
        for (const c of curves || []) {
          const v = sampleAt(xs, c.ys, state.hoverX);
          if (v === null || !Number.isFinite(v)) continue;
          const sy = yToS(v);
          if (sy < -10 || sy > h + 10) continue;
          ctx.fillStyle = "#fff"; ctx.strokeStyle = c.color; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(sx, sy, 3.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
      }
    }

    drawPolygons(w, h);
    /* Unified Element Layering Order (back -> front) */
    for (const el of getOrderedElements()) {
      if (el.kind === "guide_line") drawSingleGuideLine(el.item, w, h);
      else if (el.kind === "point") drawSinglePoint(el.item, w, h);
    }
    ctx.restore();
  }

  function drawPolygons(w, h) {
    const hasPolys = state.polygons.length > 0 || state.polyTool !== "pan";
    if (!hasPolys) return;

    const pm = ws() && typeof ws().getParamMap === "function" ? ws().getParamMap() : {};
    const dims = getActiveGridDims();
    const genG = Number(pm.G);
    const simRunning = Number.isFinite(genG) && genG >= 0.5;

    ctx.save();
    /* Subtle grid backdrop across [minX, maxX] x [minY, maxY] when editing cell polygons */
    const gx0 = xToS(dims.minX), gx1 = xToS(dims.maxX);
    const gy0 = yToS(dims.minY), gy1 = yToS(dims.maxY);
    const cellW = (gx1 - gx0) / Math.max(1, dims.w);
    const cellH = (gy0 - gy1) / Math.max(1, dims.h);
    if (cellW >= 4.5 && cellH >= 4.5) {
      ctx.strokeStyle = "rgba(148, 163, 184, 0.09)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = dims.minX; x <= dims.maxX; x++) {
        const sx = xToS(x);
        if (sx >= -2 && sx <= w + 2) { ctx.moveTo(sx, Math.max(0, gy1)); ctx.lineTo(sx, Math.min(h, gy0)); }
      }
      for (let y = dims.minY; y <= dims.maxY; y++) {
        const sy = yToS(y);
        if (sy >= -2 && sy <= h + 2) { ctx.moveTo(Math.max(0, gx0), sy); ctx.lineTo(Math.min(w, gx1), sy); }
      }
      ctx.stroke();
    }

    /* Batch draw unselected vs selected square cell polygons for smooth 60 FPS even at 2,400 cells! */
    const pad = Math.min(0.11, 1.2 / Math.max(cellW, 6));
    const fillUnsel = simRunning ? "rgba(52, 211, 153, 0.06)" : "rgba(52, 211, 153, 0.30)";
    const strokeUnsel = simRunning ? "rgba(52, 211, 153, 0.20)" : "rgba(52, 211, 153, 0.85)";
    const fillSel = "rgba(56, 189, 248, 0.42)";
    const strokeSel = "#38bdf8";

    ctx.fillStyle = fillUnsel;
    ctx.strokeStyle = strokeUnsel;
    ctx.lineWidth = cellW >= 8 ? 1.15 : 0.8;
    ctx.beginPath();
    let anyUnsel = false;
    for (const p of state.polygons) {
      if (state.selectedPolyIds.has(p.id)) continue;
      const sx0 = xToS(p.gx + pad), sx1 = xToS(p.gx + 1 - pad);
      const syTop = yToS(p.gy + 1 - pad), syBot = yToS(p.gy + pad);
      if (sx1 < -2 || sx0 > w + 2 || syBot < -2 || syTop > h + 2) continue;
      ctx.rect(sx0, syTop, Math.max(1, sx1 - sx0), Math.max(1, syBot - syTop));
      anyUnsel = true;
    }
    if (anyUnsel) { ctx.fill(); if (cellW >= 4.5) ctx.stroke(); }

    if (state.selectedPolyIds.size > 0) {
      ctx.fillStyle = fillSel;
      ctx.strokeStyle = strokeSel;
      ctx.lineWidth = cellW >= 8 ? 1.4 : 0.9;
      ctx.beginPath();
      let anySel = false;
      for (const p of state.polygons) {
        if (!state.selectedPolyIds.has(p.id)) continue;
        const sx0 = xToS(p.gx + pad), sx1 = xToS(p.gx + 1 - pad);
        const syTop = yToS(p.gy + 1 - pad), syBot = yToS(p.gy + pad);
        if (sx1 < -2 || sx0 > w + 2 || syBot < -2 || syTop > h + 2) continue;
        ctx.rect(sx0, syTop, Math.max(1, sx1 - sx0), Math.max(1, syBot - syTop));
        anySel = true;
      }
      if (anySel) { ctx.fill(); if (cellW >= 4.5) ctx.stroke(); }
    }

    /* Live Marquee Box (sky-blue for Select, rose-red for Deselect) */
    if (state.polyMarquee) {
      const m = state.polyMarquee;
      const x0 = Math.min(m.x0, m.x1), y0 = Math.min(m.y0, m.y1);
      const mw = Math.abs(m.x1 - m.x0), mh = Math.abs(m.y1 - m.y0);
      ctx.fillStyle = m.mode === "sub" ? "rgba(251, 113, 133, 0.16)" : "rgba(56, 189, 248, 0.16)";
      ctx.strokeStyle = m.mode === "sub" ? "#fb7185" : "#38bdf8";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 3]);
      ctx.fillRect(x0, y0, mw, mh);
      ctx.strokeRect(x0, y0, mw, mh);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function updateLegend() {
    if (!state.active) return;
    const x = state.hoverX;
    legendX.textContent = x !== null ? `x = ${x.toFixed(3)}` : "Hover graph";
    if (x !== null) readoutIn.textContent = x.toFixed(4);
    legendRows.innerHTML = "";
    if (!state.cache) return;

    const { xs, curves, verticals, xOfYCurves, implicits, parametrics } = state.cache;
    (curves || []).forEach((c, idx) => {
      const val = x !== null ? sampleAt(xs, c.ys, x) : null;
      if (idx === 0 && x !== null) readoutOut.textContent = val !== null && Number.isFinite(val) ? val.toFixed(4) : "—";
      const row = document.createElement("div");
      row.className = "real-legend-row";
      row.innerHTML = `<span class="real-legend-name"><span class="real-legend-swatch" style="background:${c.color}"></span>${c.title}</span><span class="real-legend-val">${val !== null && Number.isFinite(val) ? val.toFixed(4) : "—"}</span>`;
      legendRows.appendChild(row);
    });
    for (const pc of parametrics || []) {
      const row = document.createElement("div");
      row.className = "real-legend-row";
      row.innerHTML = `<span class="real-legend-name"><span class="real-legend-swatch" style="background:${pc.color}"></span>${pc.title}</span><span class="real-legend-val">(x(t), y(t))</span>`;
      legendRows.appendChild(row);
    }
    for (const v of verticals || []) {
      const row = document.createElement("div");
      row.className = "real-legend-row";
      row.innerHTML = `<span class="real-legend-name"><span class="real-legend-swatch" style="background:${v.color}"></span>${v.title}</span><span class="real-legend-val">x=${v.xVal.toFixed(3)}</span>`;
      legendRows.appendChild(row);
    }
    for (const xc of xOfYCurves || []) {
      const row = document.createElement("div");
      row.className = "real-legend-row";
      row.innerHTML = `<span class="real-legend-name"><span class="real-legend-swatch" style="background:${xc.color}"></span>${xc.title}</span><span class="real-legend-val">x=g(y)</span>`;
      legendRows.appendChild(row);
    }
    for (const imp of implicits || []) {
      const row = document.createElement("div");
      row.className = "real-legend-row";
      row.innerHTML = `<span class="real-legend-name"><span class="real-legend-swatch" style="background:${imp.color}"></span>${imp.title}</span><span class="real-legend-val">F(x,y)=0</span>`;
      legendRows.appendChild(row);
    }
  }

  function fitY() {
    if (!state.cache) return;
    let ymin = Infinity, ymax = -Infinity;
    for (const c of state.cache.curves || []) {
      for (const v of c.ys) if (v !== null && Number.isFinite(v) && Math.abs(v) < 1e6) { ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); }
    }
    for (const pc of state.cache.parametrics || []) {
      for (let i = 1; i < pc.xy.length; i += 2) {
        const v = pc.xy[i];
        if (Number.isFinite(v) && Math.abs(v) < 1e6) { ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); }
      }
    }
    if (!Number.isFinite(ymin)) return;
    const pad = Math.max(0.4, (ymax - ymin) * 0.12);
    state.view.ymin = ymin - pad; state.view.ymax = ymax + pad;
    if (state.squareAspect) {
      const w = Math.max(1, canvas.clientWidth || card.clientWidth || 640);
      const h = Math.max(1, canvas.clientHeight || card.clientHeight || 480);
      const cx = 0.5 * (state.view.xmin + state.view.xmax);
      const upp = (state.view.ymax - state.view.ymin) / h;
      state.view.xmin = cx - 0.5 * upp * w;
      state.view.xmax = cx + 0.5 * upp * w;
      state.squareMoved = true;
      scheduleSample(true);
    }
    requestRender();
  }

  /* Hit-testing 2D Landmark Points & Landmark Lines */
  function hitPoint(sx, sy) {
    for (let i = state.points.length - 1; i >= 0; i--) {
      const p = state.points[i];
      if (!p.visible) continue;
      const px = xToS(p.x), py = yToS(p.y);
      if (Math.hypot(sx - px, sy - py) <= Math.max(10, (p.size || 5) + 6)) return p;
    }
    return null;
  }

  function hitGuideLine(sx, sy) {
    for (let i = state.lines.length - 1; i >= 0; i--) {
      const ln = state.lines[i];
      if (!ln.visible) continue;
      if (ln.orientation === "horizontal") {
        if (Math.abs(sy - yToS(ln.value)) <= 8) return ln;
      } else {
        if (Math.abs(sx - xToS(ln.value)) <= 8) return ln;
      }
    }
    return null;
  }

  function hitRealElement(sx, sy) {
    /* 1. Unified layer-ordered Points & Guide Lines (topmost first) */
    const els = getOrderedElements();
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (!el.item || !el.item.visible) continue;
      if (el.kind === "point") {
        if (Math.hypot(sx - xToS(el.item.x), sy - yToS(el.item.y)) <= Math.max(10, (el.item.size || 5) + 6)) return el;
      } else if (el.kind === "guide_line") {
        if (el.item.orientation === "horizontal") {
          if (Math.abs(sy - yToS(el.item.value)) <= 8) return el;
        } else {
          if (Math.abs(sx - xToS(el.item.value)) <= 8) return el;
        }
      }
    }
    /* 2. Graphed Curves (y=f(x), parametric, vertical, x=g(y)) */
    if (state.cache) {
      const { xs, curves, verticals, xOfYCurves, parametrics } = state.cache;
      const wx = sToX(sx), wy = sToY(sy);
      for (const c of curves || []) {
        const yv = sampleAt(xs, c.ys, wx);
        if (yv !== null && Number.isFinite(yv) && Math.abs(sy - yToS(yv)) <= 10) return { kind: "fn", id: c.cardId };
      }
      for (const v of verticals || []) {
        if (Math.abs(sx - xToS(v.xVal)) <= 10) return { kind: "fn", id: v.cardId };
      }
      for (const xc of xOfYCurves || []) {
        const xv = sampleAt(xc.ys, xc.xs, wy);
        if (xv !== null && Number.isFinite(xv) && Math.abs(sx - xToS(xv)) <= 10) return { kind: "fn", id: xc.cardId };
      }
      for (const pc of parametrics || []) {
        const xy = pc.xy || [];
        for (let i = 0; i + 1 < xy.length; i += 2) {
          const px = xy[i], py = xy[i + 1];
          if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
          if (Math.hypot(sx - xToS(px), sy - yToS(py)) <= 10) return { kind: "fn", id: pc.cardId };
        }
      }
    }
    return null;
  }

  /* Pointer events */
  function localPos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const pos = localPos(e);
    if (e.button === 1 || e.button === 2 || state.spaceHeld) {
      state.pan = { sx: pos.x, sy: pos.y, ov: { ...state.view }, rightClick: e.button === 2 };
      card.classList.add("panning");
      return;
    }
    if (state.calc.showIntegral) {
      if (Math.abs(pos.x - xToS(state.calc.a)) <= 12) { state.calc.draggingGate = "a"; return; }
      if (Math.abs(pos.x - xToS(state.calc.b)) <= 12) { state.calc.draggingGate = "b"; return; }
    }

    /* Interactive 2D Real Cell Polygon Tools */
    if (state.polyTool === "select") {
      const multiMod = Boolean(e.ctrlKey || e.metaKey || e.shiftKey);
      const subMod = Boolean(e.altKey);
      const hitP = hitPolygonAtScreen(pos.x, pos.y);
      state.polyPendingClick = {
        x0: pos.x, y0: pos.y,
        hitPoly: hitP,
        multiMod,
        subMod,
        prevSelected: new Set(state.selectedPolyIds),
      };
      return;
    }
    if (state.polyTool === "deselect") {
      if (e.shiftKey) {
        state.polyMarquee = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y, mode: "sub", prevSelected: new Set(state.selectedPolyIds) };
        requestRender();
        return;
      }
      state.polyPaint = { mode: "deselect", changed: false };
      const hitP = hitPolygonAtScreen(pos.x, pos.y);
      if (hitP && state.selectedPolyIds.has(hitP.id)) {
        state.selectedPolyIds.delete(hitP.id);
        state.polyPaint.changed = true;
        updatePolyUI();
        notifyDomain();
        requestRender();
      }
      return;
    }
    if (state.polyTool === "add") {
      pushPolyUndoSnapshot();
      state.polyPaint = { mode: "add", changed: false };
      const dims = getActiveGridDims();
      const gx = Math.floor(sToX(pos.x)), gy = Math.floor(sToY(pos.y));
      if (gx >= dims.minX && gx < dims.maxX && gy >= dims.minY && gy < dims.maxY && !state.polyGridMap.has(`${gx},${gy}`)) {
        addPolygonCell(gx, gy);
        state.polyPaint.changed = true;
        updatePolyUI();
        requestRender();
      }
      return;
    }

    const pHit = hitPoint(pos.x, pos.y);
    if (pHit) {
      state.selectedPointId = pHit.id;
      state.selectedLineId = null;
      if (!pHit.locked) {
        state.dragPoint = { point: pHit };
        card.classList.add("panning");
      }
      notifyDomain();
      requestRender();
      return;
    }
    const lHit = hitGuideLine(pos.x, pos.y);
    if (lHit) {
      state.selectedLineId = lHit.id;
      state.selectedPointId = null;
      if (!lHit.locked) {
        state.dragLine = { line: lHit };
        card.classList.add("panning");
      }
      notifyDomain();
      requestRender();
      return;
    }
    state.selectedPointId = null;
    state.selectedLineId = null;
    state.pan = { sx: pos.x, sy: pos.y, ov: { ...state.view } };
    card.classList.add("panning");
  });

  canvas.addEventListener("pointermove", (e) => {
    const pos = localPos(e);
    if (state.calc.draggingGate) {
      state.calc[state.calc.draggingGate] = sToX(pos.x);
      document.getElementById("calc-a").value = state.calc.a.toFixed(2);
      document.getElementById("calc-b").value = state.calc.b.toFixed(2);
      refreshCalculus(); requestRender(); return;
    }
    if (state.polyPendingClick) {
      const pc = state.polyPendingClick;
      if (Math.hypot(pos.x - pc.x0, pos.y - pc.y0) >= 5) {
        state.polyMarquee = {
          x0: pc.x0, y0: pc.y0, x1: pos.x, y1: pos.y,
          mode: pc.subMod ? "sub" : pc.multiMod ? "add" : "replace",
          prevSelected: pc.prevSelected,
        };
        state.polyPendingClick = null;
      }
    }
    if (state.polyMarquee) {
      const m = state.polyMarquee;
      m.x1 = pos.x; m.y1 = pos.y;
      const sx0 = Math.min(m.x0, m.x1), sx1 = Math.max(m.x0, m.x1);
      const sy0 = Math.min(m.y0, m.y1), sy1 = Math.max(m.y0, m.y1);
      const next = m.mode === "replace" ? new Set() : new Set(m.prevSelected);
      for (const p of state.polygons) {
        const cx = xToS(p.gx + 0.5), cy = yToS(p.gy + 0.5);
        if (cx >= sx0 && cx <= sx1 && cy >= sy0 && cy <= sy1) {
          if (m.mode === "sub") next.delete(p.id);
          else next.add(p.id);
        }
      }
      state.selectedPolyIds = next;
      updatePolyUI();
      requestRender();
      return;
    }
    if (state.polyPaint) {
      if (state.polyPaint.mode === "deselect") {
        const hitP = hitPolygonAtScreen(pos.x, pos.y);
        if (hitP && state.selectedPolyIds.has(hitP.id)) {
          state.selectedPolyIds.delete(hitP.id);
          state.polyPaint.changed = true;
          updatePolyUI();
          requestRender();
        }
      } else if (state.polyPaint.mode === "add") {
        const dims = getActiveGridDims();
        const gx = Math.floor(sToX(pos.x)), gy = Math.floor(sToY(pos.y));
        if (gx >= dims.minX && gx < dims.maxX && gy >= dims.minY && gy < dims.maxY && !state.polyGridMap.has(`${gx},${gy}`)) {
          addPolygonCell(gx, gy);
          state.polyPaint.changed = true;
          updatePolyUI();
          requestRender();
        }
      }
      return;
    }
    if (state.dragPoint) {
      const pt = state.dragPoint.point;
      pt.x = Number(sToX(pos.x).toFixed(4));
      pt.y = Number(sToY(pos.y).toFixed(4));
      if (ws() && typeof ws().syncPointCoords === "function") ws().syncPointCoords(pt);
      requestRender();
      return;
    }
    if (state.dragLine) {
      const ln = state.dragLine.line;
      ln.value = Number((ln.orientation === "horizontal" ? sToY(pos.y) : sToX(pos.x)).toFixed(4));
      if (ws() && typeof ws().syncGuideLine === "function") ws().syncGuideLine(ln);
      requestRender();
      return;
    }
    if (state.pan) {
      const ov = state.pan.ov;
      const dx = ((pos.x - state.pan.sx) / canvas.clientWidth) * (ov.xmax - ov.xmin);
      const dy = ((pos.y - state.pan.sy) / canvas.clientHeight) * (ov.ymax - ov.ymin);
      state.view.xmin = ov.xmin - dx; state.view.xmax = ov.xmax - dx;
      state.view.ymin = ov.ymin + dy; state.view.ymax = ov.ymax + dy;
      if (state.squareAspect) state.squareMoved = true;
      requestRender(); scheduleSample(false); return;
    }
    state.hoverPx = pos.x; state.hoverX = sToX(pos.x);
    updateLegend(); requestRender();
  });

  canvas.addEventListener("pointerup", async (e) => {
    if (state.calc.draggingGate) { state.calc.draggingGate = null; refreshCalculus(); return; }
    if (state.polyPendingClick) {
      const pc = state.polyPendingClick;
      state.polyPendingClick = null;
      if (pc.hitPoly) {
        if (pc.subMod) {
          state.selectedPolyIds.delete(pc.hitPoly.id);
        } else if (pc.multiMod) {
          /* Ctrl+Click / Shift+Click toggles (deselects if already selected!) */
          if (state.selectedPolyIds.has(pc.hitPoly.id)) state.selectedPolyIds.delete(pc.hitPoly.id);
          else state.selectedPolyIds.add(pc.hitPoly.id);
        } else {
          state.selectedPolyIds.clear();
          state.selectedPolyIds.add(pc.hitPoly.id);
        }
      } else if (!pc.multiMod && !pc.subMod) {
        state.selectedPolyIds.clear();
      }
      updatePolyUI();
      notifyDomain();
      requestRender();
      return;
    }
    if (state.polyMarquee) {
      state.polyMarquee = null;
      updatePolyUI();
      notifyDomain();
      requestRender();
      return;
    }
    if (state.polyPaint) {
      const pp = state.polyPaint;
      state.polyPaint = null;
      if (pp.mode === "add") {
        if (pp.changed) await commitPolygonChange(true);
        else if (state.polyUndoStack.length > 0) state.polyUndoStack.pop();
      } else if (pp.changed) {
        notifyDomain();
        requestRender();
      }
      return;
    }
    if (state.dragPoint) { state.dragPoint = null; card.classList.remove("panning"); notifyDomain(); notifyState(true, true); return; }
    if (state.dragLine) { state.dragLine = null; card.classList.remove("panning"); notifyDomain(); notifyState(true, true); return; }
    if (state.pan) {
      const p = state.pan;
      state.pan = null;
      card.classList.remove("panning");
      const pos = localPos(e);
      if (p.rightClick && Math.hypot(pos.x - p.sx, pos.y - p.sy) < 5) {
        const hit = hitRealElement(pos.x, pos.y);
        if (hit && ws() && typeof ws().openItemSettingsAt === "function") {
          if (hit.kind === "point") selectPoint(hit.id);
          else if (hit.kind === "guide_line") selectGuideLine(hit.id);
          ws().openItemSettingsAt(hit.kind, hit.id, e.clientX, e.clientY);
          return;
        }
      }
      scheduleSample(true);
      notifyState(false, false);
    }
  });

  /* 2D Real Dock & Selection Banner Buttons + Keyboard Shortcuts */
  document.querySelectorAll(".real-dock-tool").forEach((b) => {
    b.addEventListener("click", () => setPolyTool(b.dataset.realTool));
  });
  const btnRealSelAll = document.getElementById("btn-real-select-all");
  if (btnRealSelAll) btnRealSelAll.addEventListener("click", () => selectAllPolygons());
  const btnRealDelPolys = document.getElementById("btn-real-del-polys");
  if (btnRealDelPolys) btnRealDelPolys.addEventListener("click", () => deleteSelectedPolygons());
  const btnRealUndoPolys = document.getElementById("btn-real-undo-polys");
  if (btnRealUndoPolys) btnRealUndoPolys.addEventListener("click", () => undoPolygonAction());
  const btnRealFillGrid = document.getElementById("btn-real-fill-grid");
  if (btnRealFillGrid) btnRealFillGrid.addEventListener("click", () => fillGridPolygons(undefined, undefined, false));
  const btnRealClearPolys = document.getElementById("btn-real-clear-polys");
  if (btnRealClearPolys) btnRealClearPolys.addEventListener("click", () => clearPolygons());
  const btnRealSelInvert = document.getElementById("btn-real-sel-invert");
  if (btnRealSelInvert) btnRealSelInvert.addEventListener("click", () => invertPolygonSelection());
  const btnRealSelDel = document.getElementById("btn-real-sel-del");
  if (btnRealSelDel) btnRealSelDel.addEventListener("click", () => deleteSelectedPolygons());
  const btnRealSelClear = document.getElementById("btn-real-sel-clear");
  if (btnRealSelClear) btnRealSelClear.addEventListener("click", () => clearPolySelection());

  window.addEventListener("keydown", (e) => {
    if (!state.active || (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA"))) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
      if (state.polyUndoStack.length > 0) {
        e.preventDefault();
        undoPolygonAction();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      if (state.polygons.length > 0) {
        e.preventDefault();
        selectAllPolygons();
      }
      return;
    }
    if (e.key === "Escape") {
      clearPolySelection();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (state.selectedPolyIds.size > 0 || state.selectedPointId !== null || state.selectedLineId !== null) {
        e.preventDefault();
        deleteSelectedPolygons();
      }
      return;
    }
    if (e.code === "Space") { state.spaceHeld = true; updatePolyUI(); }
    else if (state.polygons.length > 0 || state.polyTool !== "pan") {
      if (e.key === "v" || e.key === "V") setPolyTool("select");
      else if (e.key === "d" || e.key === "D") setPolyTool("deselect");
      else if (e.key === "a" || e.key === "A") setPolyTool("add");
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") { state.spaceHeld = false; updatePolyUI(); }
  });
  canvas.addEventListener("pointerleave", () => { state.hoverX = null; state.hoverPx = null; updateLegend(); requestRender(); });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const pos = localPos(e), f = e.deltaY < 0 ? 1 / 1.16 : 1.16;
    const wx = sToX(pos.x), wy = sToY(pos.y);
    const scaleXOnly = e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
    const scaleYOnly = (e.ctrlKey || e.metaKey || e.altKey) && !e.shiftKey;
    if (scaleXOnly) {
      if (state.squareAspect) { state.squareAspect = false; const b = document.getElementById("real-square"); if (b) b.classList.remove("active"); }
      state.view.xmin = wx + (state.view.xmin - wx) * f;
      state.view.xmax = wx + (state.view.xmax - wx) * f;
    } else if (scaleYOnly) {
      if (state.squareAspect) { state.squareAspect = false; const b = document.getElementById("real-square"); if (b) b.classList.remove("active"); }
      state.view.ymin = wy + (state.view.ymin - wy) * f;
      state.view.ymax = wy + (state.view.ymax - wy) * f;
    } else {
      state.view.xmin = wx + (state.view.xmin - wx) * f; state.view.xmax = wx + (state.view.xmax - wx) * f;
      state.view.ymin = wy + (state.view.ymin - wy) * f; state.view.ymax = wy + (state.view.ymax - wy) * f;
      if (state.squareAspect) state.squareMoved = true;
    }
    requestRender(); scheduleSample(false); notifyState(false, false);
  }, { passive: false });

  const btnRealSquare = document.getElementById("real-square");
  if (btnRealSquare) btnRealSquare.addEventListener("click", () => setSquareAspect(!state.squareAspect));
  const scaleRealAxis = (fx, fy) => {
    if (state.squareAspect) { state.squareAspect = false; if (btnRealSquare) btnRealSquare.classList.remove("active"); }
    const cx = 0.5 * (state.view.xmin + state.view.xmax), cy = 0.5 * (state.view.ymin + state.view.ymax);
    const hw = 0.5 * (state.view.xmax - state.view.xmin) * fx, hh = 0.5 * (state.view.ymax - state.view.ymin) * fy;
    state.view = { xmin: cx - hw, xmax: cx + hw, ymin: cy - hh, ymax: cy + hh };
    scheduleSample(true); notifyState(false, false);
  };
  const bindRealBtn = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
  bindRealBtn("real-zoom-x-in", () => scaleRealAxis(1 / 1.3, 1));
  bindRealBtn("real-zoom-x-out", () => scaleRealAxis(1.3, 1));
  bindRealBtn("real-zoom-y-in", () => scaleRealAxis(1, 1 / 1.3));
  bindRealBtn("real-zoom-y-out", () => scaleRealAxis(1, 1.3));
  document.getElementById("real-fit-y").addEventListener("click", () => { fitY(); notifyState(false, false); });
  document.getElementById("real-zoom-in").addEventListener("click", () => {
    const cx = 0.5 * (state.view.xmin + state.view.xmax), cy = 0.5 * (state.view.ymin + state.view.ymax);
    const hw = 0.5 * (state.view.xmax - state.view.xmin) / 1.3, hh = 0.5 * (state.view.ymax - state.view.ymin) / 1.3;
    state.view = { xmin: cx - hw, xmax: cx + hw, ymin: cy - hh, ymax: cy + hh };
    if (state.squareAspect) state.squareMoved = true;
    scheduleSample(true); notifyState(false, false);
  });
  document.getElementById("real-zoom-out").addEventListener("click", () => {
    const cx = 0.5 * (state.view.xmin + state.view.xmax), cy = 0.5 * (state.view.ymin + state.view.ymax);
    const hw = 0.5 * (state.view.xmax - state.view.xmin) * 1.3, hh = 0.5 * (state.view.ymax - state.view.ymin) * 1.3;
    state.view = { xmin: cx - hw, xmax: cx + hw, ymin: cy - hh, ymax: cy + hh };
    if (state.squareAspect) state.squareMoved = true;
    scheduleSample(true); notifyState(false, false);
  });
  document.getElementById("real-reset").addEventListener("click", () => {
    state.view = { ...state.defaultView };
    if (state.squareAspect) { enforceSquareView(); state.squareMoved = true; }
    scheduleSample(true); notifyState(false, false);
  });

  /* Web Audio: Music of the Primes */
  let audioCtx = null, audioOscs = [], audioPlaying = false;
  function stopAudio() {
    for (const o of audioOscs) { try { o.stop(); } catch (_) {} }
    audioOscs = []; audioPlaying = false;
    const b = document.getElementById("btn-audio-play");
    if (b) { b.textContent = "Play Riemann Zero Chord"; b.classList.remove("playing"); }
  }
  function startAudio() {
    stopAudio();
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const master = audioCtx.createGain();
    master.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    master.gain.exponentialRampToValueAtTime(0.11, audioCtx.currentTime + 0.3);
    master.connect(audioCtx.destination);
    const cnt = parseInt(document.getElementById("audio-voices").value, 10) || 10;
    for (let i = 0; i < cnt && i < FIRST_GAMMAS.length; i++) {
      const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.frequency.value = FIRST_GAMMAS[i] * 13.0;
      g.gain.value = (14.1347 / FIRST_GAMMAS[i]) / Math.sqrt(cnt);
      osc.connect(g); g.connect(master); osc.start();
      audioOscs.push(osc);
    }
    audioPlaying = true;
    const b = document.getElementById("btn-audio-play");
    if (b) { b.textContent = "Stop Audio Synth"; b.classList.add("playing"); }
  }

  document.getElementById("btn-audio-play").addEventListener("click", () => (audioPlaying ? stopAudio() : startAudio()));
  document.getElementById("audio-voices").addEventListener("input", (e) => {
    document.getElementById("audio-voices-val").textContent = e.target.value;
    if (audioPlaying) startAudio();
  });

  function addPoint(opts = {}, silent = false) {
    const cx = 0.5 * (state.view.xmin + state.view.xmax);
    const cy = 0.5 * (state.view.ymin + state.view.ymax);
    const col = opts.color || PALETTE[state.colorIdx++ % PALETTE.length];
    const p = {
      id: state.nextPointId++,
      kind: "point",
      x: opts.x !== undefined ? Number(opts.x) : Number(cx.toFixed(3)),
      y: opts.y !== undefined ? Number(opts.y) : Number(cy.toFixed(3)),
      label: opts.label || `P${state.points.length + 1}`,
      icon: opts.icon || "dot",
      color: col,
      size: opts.size || 5.5,
      locked: Boolean(opts.locked),
      visible: opts.visible !== undefined ? Boolean(opts.visible) : true,
      showLabel: opts.showLabel !== undefined ? Boolean(opts.showLabel) : true,
    };
    state.points.push(p);
    state.selectedPointId = p.id;
    state.selectedLineId = null;
    notifyDomain();
    if (!silent) notifyState(true);
    requestRender();
    return p;
  }

  function deletePoint(id) {
    state.points = state.points.filter((p) => p.id !== id);
    if (state.selectedPointId === id) state.selectedPointId = null;
    notifyDomain();
    notifyState(true);
    requestRender();
  }

  function selectPoint(id) {
    state.selectedPointId = id;
    state.selectedLineId = null;
    notifyDomain();
    requestRender();
  }

  function addGuideLine(opts = {}, silent = false) {
    const orient = opts.orientation === "horizontal" ? "horizontal" : "vertical";
    const defVal = orient === "horizontal"
      ? Number((0.5 * (state.view.ymin + state.view.ymax)).toFixed(3))
      : Number((0.5 * (state.view.xmin + state.view.xmax)).toFixed(3));
    const val = opts.value !== undefined ? Number(opts.value) : defVal;
    const ln = {
      id: state.nextLineId++,
      kind: "guide_line",
      orientation: orient,
      value: val,
      label: opts.label || (orient === "horizontal" ? `y = ${val}` : `x = ${val}`),
      color: opts.color || "#fbbf24",
      lineWidth: Number(opts.lineWidth) || 1.6,
      lineStyle: opts.lineStyle || "dashed",
      locked: Boolean(opts.locked),
      visible: opts.visible !== undefined ? Boolean(opts.visible) : true,
      showLabel: opts.showLabel !== undefined ? Boolean(opts.showLabel) : true,
    };
    state.lines.push(ln);
    state.selectedLineId = ln.id;
    state.selectedPointId = null;
    notifyDomain();
    if (!silent) notifyState(true);
    requestRender();
    return ln;
  }

  function deleteGuideLine(id) {
    state.lines = state.lines.filter((l) => l.id !== id);
    if (state.selectedLineId === id) state.selectedLineId = null;
    notifyDomain();
    notifyState(true);
    requestRender();
  }

  function selectGuideLine(id) {
    state.selectedLineId = id;
    state.selectedPointId = null;
    notifyDomain();
    requestRender();
  }

  function r4(n) { return Math.round((Number(n) || 0) * 10000) / 10000; }

  function exportSnapshot() {
    const ordered = getOrderedElements();
    const ptIdx = new Map(state.points.map((p, i) => [p.id, i]));
    const lnIdx = new Map(state.lines.map((l, i) => [l.id, i]));
    const lo = ordered.map((e) => (e.kind === "point" ? `p:${ptIdx.get(e.id)}` : `l:${lnIdx.get(e.id)}`));
    const snap = {
      vw: [r4(state.view.xmin), r4(state.view.xmax), r4(state.view.ymin), r4(state.view.ymax)],
      sq: state.squareAspect ? 1 : 0,
      sp: state.showPrimes ? 1 : 0,
      sz: state.showZeros ? 1 : 0,
      lo,
      pt: state.points.map((p) => ({
        x: r4(p.x), y: r4(p.y), l: p.label || "", i: p.icon || "dot", c: p.color || "#34d399",
        s: Number(p.size) || 5, op: r4(normOpacity(p.opacity, 1.0)),
        lk: p.locked ? 1 : 0, v: p.visible !== false ? 1 : 0, sl: p.showLabel !== false ? 1 : 0,
      })),
      ln: state.lines.map((ln) => ({
        o: ln.orientation === "horizontal" ? "h" : "v", val: r4(ln.value),
        l: ln.label || "", c: ln.color || "#fbbf24", w: normLineWidth(ln.lineWidth, 1.5),
        op: r4(normOpacity(ln.opacity, 1.0)),
        st: ln.lineStyle || "dashed", lk: ln.locked ? 1 : 0, v: ln.visible !== false ? 1 : 0, sl: ln.showLabel !== false ? 1 : 0,
      })),
    };
    if (state.polygons.length > 0 && state.polygons.length <= 15000) {
      const cells = [];
      for (const p of state.polygons) cells.push(p.gx, p.gy);
      snap.pg = cells;
    }
    return snap;
  }

  function applyLayerRefs(refs) {
    state.layerOrder = [];
    if (Array.isArray(refs) && refs.length > 0) {
      for (const r of refs) {
        const parts = String(r).split(":");
        if (parts.length !== 2) continue;
        const idx = parseInt(parts[1], 10);
        if (parts[0] === "p" && state.points[idx]) state.layerOrder.push({ kind: "point", id: state.points[idx].id });
        else if (parts[0] === "l" && state.lines[idx]) state.layerOrder.push({ kind: "guide_line", id: state.lines[idx].id });
      }
    }
    syncLayerOrder();
  }

  function restoreSnapshot(snap) {
    if (!snap) return;
    state.showPrimes = Boolean(snap.sp);
    state.showZeros = Boolean(snap.sz);
    if (Array.isArray(snap.vw) && snap.vw.length >= 4) {
      state.defaultView = { xmin: Number(snap.vw[0]), xmax: Number(snap.vw[1]), ymin: Number(snap.vw[2]), ymax: Number(snap.vw[3]) };
      state.view = { ...state.defaultView };
    }
    ensureCanvasSize();
    const wantSq = snap.sq !== undefined ? Boolean(snap.sq) : true;
    state.squareAspect = wantSq;
    const sqBtn = document.getElementById("real-square");
    if (sqBtn) sqBtn.classList.toggle("active", wantSq);
    if (wantSq) enforceSquareView(true);
    state.points = (snap.pt || []).map((p) => ({
      id: state.nextPointId++,
      kind: "point",
      x: Number(p.x) || 0,
      y: Number(p.y) || 0,
      label: p.l || "",
      icon: p.i || "diamond",
      color: p.c || "#34d399",
      size: Number(p.s) || 5,
      opacity: normOpacity(p.op, 1.0),
      locked: Boolean(p.lk),
      visible: p.v !== 0,
      showLabel: p.sl !== 0,
    }));
    state.lines = (snap.ln || []).map((ln) => ({
      id: state.nextLineId++,
      kind: "guide_line",
      orientation: ln.o === "h" ? "horizontal" : "vertical",
      value: Number(ln.val) || 0,
      label: ln.l || "",
      color: ln.c || "#fbbf24",
      lineWidth: normLineWidth(ln.w, 1.5),
      opacity: normOpacity(ln.op, 1.0),
      lineStyle: ln.st || "dashed",
      locked: Boolean(ln.lk),
      visible: ln.v !== 0,
      showLabel: ln.sl !== 0,
    }));
    applyLayerRefs(snap.lo);
    state.polyUndoStack = [];
    if (Array.isArray(snap.pg) && snap.pg.length >= 2) {
      const cells = [];
      for (let i = 0; i + 1 < snap.pg.length; i += 2) cells.push([snap.pg[i], snap.pg[i + 1]]);
      setPolygonsFromCells(cells, { silentUndo: true });
      setPolyTool("select");
    } else {
      state.polygons = [];
      state.polyGridMap.clear();
      state.selectedPolyIds.clear();
      setPolyTool("pan");
    }
    state.selectedPointId = null;
    state.selectedLineId = null;
    ensureCanvasSize();
    notifyDomain();
    scheduleSample(true);
  }

  window.CFVReal = {
    state,
    canvas,
    resize,
    requestRender,
    scheduleSample,
    isFetchBusy: () => state.fetchBusy,
    refreshCalculus,
    stopAudio,
    addPoint,
    deletePoint,
    selectPoint,
    addGuideLine,
    deleteGuideLine,
    selectGuideLine,
    getOrderedElements,
    reorderElement,
    moveElementLayer,
    setPolyTool,
    setPolygonsFromCells,
    getActiveGridDims,
    fillGridPolygons,
    selectAllPolygons,
    clearPolySelection,
    invertPolygonSelection,
    deleteSelectedPolygons,
    undoPolygonAction,
    clearPolygons,
    syncSeedToServer,
    setSquareAspect,
    exportSnapshot,
    restoreSnapshot,
    clearToBlank() {
      state.showPrimes = false;
      state.showZeros = false;
      state.points = [];
      state.lines = [];
      state.polygons = [];
      state.polyGridMap.clear();
      state.selectedPolyIds.clear();
      state.polyUndoStack = [];
      state.polyTool = "pan";
      state.selectedPointId = null;
      state.selectedLineId = null;
      state.defaultView = { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
      state.view = { ...state.defaultView };
      state.squareAspect = true;
      const sqBtn = document.getElementById("real-square");
      if (sqBtn) sqBtn.classList.add("active");
      state.cache = { xs: [], curves: [], verticals: [], xOfYCurves: [], implicits: [], parametrics: [] };
      planeSub.textContent = "y = f(x)";
      ensureCanvasSize();
      enforceSquareView(true);
      updatePolyUI();
      updateLegend();
      notifyDomain();
      requestRender();
    },
    setViewBounds(v) {
      if (!v) return;
      state.defaultView = { ...v };
      state.view = { ...v };
      if (state.squareAspect) enforceSquareView(true);
      scheduleSample(true);
    },
    async loadExampleAndPreset(ex, preset) {
      const pr = preset || (ex.presets && ex.presets[0]) || {};
      state.showPrimes = Boolean(ex.showPrimes);
      state.showZeros = Boolean(ex.showZeros);
      state.defaultView = pr.view ? { ...pr.view } : { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
      state.view = { ...state.defaultView };
      ensureCanvasSize();
      const wantSq = pr.squareAspect !== undefined ? Boolean(pr.squareAspect) : true;
      state.squareAspect = wantSq;
      const sqBtn = document.getElementById("real-square");
      if (sqBtn) sqBtn.classList.toggle("active", wantSq);
      if (wantSq) enforceSquareView(true);
      const srcPts = pr.points || ex.defaultPoints || [];
      state.points = srcPts.map((pt) => ({
        id: state.nextPointId++,
        kind: "point",
        x: pt.x,
        y: pt.y,
        label: pt.label || "",
        icon: pt.icon || "diamond",
        color: pt.color || "#34d399",
        size: pt.size || 5,
        locked: pt.locked !== undefined ? Boolean(pt.locked) : true,
        visible: pt.visible !== undefined ? Boolean(pt.visible) : true,
        showLabel: pt.showLabel !== undefined ? Boolean(pt.showLabel) : true,
      }));
      const srcLines = pr.lines || ex.defaultLines || [];
      state.lines = srcLines.map((ln) => ({
        id: state.nextLineId++,
        kind: "guide_line",
        orientation: ln.orientation || "vertical",
        value: Number(ln.value) || 0,
        label: ln.label || "",
        color: ln.color || "#fbbf24",
        lineWidth: Number(ln.lineWidth) || 1.5,
        lineStyle: ln.lineStyle || "dashed",
        locked: ln.locked !== undefined ? Boolean(ln.locked) : true,
        visible: ln.visible !== undefined ? Boolean(ln.visible) : true,
        showLabel: ln.showLabel !== undefined ? Boolean(ln.showLabel) : true,
      }));
      state.selectedPointId = null;
      state.selectedLineId = null;
      state.polyUndoStack = [];
      if (pr.fillGrid) {
        const dims = getActiveGridDims();
        const r = pr.fillGrid.r ? Math.min(60, Math.max(4, Math.round(pr.fillGrid.r))) : dims.r;
        const minX = pr.fillGrid.w ? 0 : -r;
        const maxX = pr.fillGrid.w ? pr.fillGrid.w : r;
        const minY = pr.fillGrid.h ? 0 : -r;
        const maxY = pr.fillGrid.h ? pr.fillGrid.h : r;
        state.gridR = r;
        state.gridMinX = minX; state.gridMaxX = maxX;
        state.gridMinY = minY; state.gridMaxY = maxY;
        state.gridW = maxX - minX; state.gridH = maxY - minY;
        const cells = [];
        for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) cells.push([x, y]);
        await setPolygonsFromCells(cells, { silentUndo: true, selectAll: Boolean(pr.selectAllPolygons) });
        setPolyTool(pr.polyTool || "select");
      } else if (Array.isArray(pr.polygons)) {
        getActiveGridDims();
        await setPolygonsFromCells(pr.polygons, { silentUndo: true, selectAll: Boolean(pr.selectAllPolygons) });
        setPolyTool(pr.polyTool || "select");
      } else {
        state.polygons = [];
        state.polyGridMap.clear();
        state.selectedPolyIds.clear();
        setPolyTool("pan");
      }
      ensureCanvasSize();
      updatePolyUI();
      notifyDomain();
      scheduleSample(true);
    },
  };
})();
