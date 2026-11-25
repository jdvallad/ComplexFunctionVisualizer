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
    coordSystem: "cartesian", /* "cartesian" | "polar" | "logx" | "loglog" */
    savedRectRatio: null,
    savedRectView: null,
    squareMoved: false,

    /* 2D Vector Shapes, Landmark Points, Landmark Lines, Text Boxes & Interactive Grid/Cell Polygons */
    shapes: [],
    points: [],
    lines: [],
    texts: [],
    layerOrder: [],
    polygons: [],
    polyGridMap: new Map(),
    selectedPolyIds: new Set(),
    polyTool: "move", /* "move" | "pan" | "freehand" | "infline" | "ray" | "seg" | "arc" | "circle" | "rect" | "polygon" | "point" | "text" | "select" | "deselect" | "add" */
    polyMarquee: null,
    polyPendingClick: null,
    polyPaint: null,
    polyUndoStack: [],
    drawing: null,
    polyDraft: null,
    dragShape: null,
    dragResize: null,
    dragRotate: null,
    dragGroup: null,
    marquee: null,
    shapeUndoStack: [],
    lastUndoKind: "elements",
    gridR: 32,
    gridMinX: -32,
    gridMaxX: 32,
    gridMinY: -32,
    gridMaxY: 32,
    gridW: 64,
    gridH: 64,
    spaceHeld: false,
    nextShapeId: 1,
    nextPointId: 1,
    nextLineId: 1,
    nextTextId: 1,
    nextPolyId: 1,
    selectedShapeId: null,
    selectedShapeIds: new Set(),
    selectedPointId: null,
    selectedPointIds: new Set(),
    selectedLineId: null,
    selectedTextId: null,
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
    snapHint: null,
  };

  const canvas = document.getElementById("canvas-real");
  const ctx = canvas.getContext("2d");
  const card = document.getElementById("real-plane-card");
  const legendCard = document.getElementById("real-legend-card");
  const legendHdr = document.getElementById("real-legend-hdr");
  const btnMinRealLegend = document.getElementById("btn-min-real-legend");
  const realLegendResizeHandle = document.getElementById("real-legend-resize-handle");
  const legendX = document.getElementById("real-legend-x");
  const legendRows = document.getElementById("real-legend-rows");
  const planeSub = document.getElementById("real-plane-sub");
  const readoutIn = document.getElementById("readout-in");
  const readoutOut = document.getElementById("readout-out");
  const realPolyDock = document.getElementById("real-poly-dock");
  const realSelBanner = document.getElementById("real-selection-banner");
  const realSelBannerText = document.getElementById("real-sel-banner-text");
  let realLegendMinimized = false;
  let savedRealLegendSize = null;

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
    state.lastUndoKind = "polys";
  }

  const realCoordSelect = document.getElementById("real-coord-select");
  function setCoordSystem(cs, silent = false) {
    const valid = new Set(["cartesian", "polar", "logx", "loglog"]);
    const next = valid.has(cs) ? cs : "cartesian";
    state.coordSystem = next;
    if (realCoordSelect) realCoordSelect.value = next;
    requestRender();
    if (!silent) notifyState(true, true);
  }
  if (realCoordSelect) {
    realCoordSelect.addEventListener("change", () => setCoordSystem(realCoordSelect.value, false));
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
    const isCellTool = state.polyTool === "select" || state.polyTool === "deselect" || state.polyTool === "add";
    const hasPolys = state.polygons.length > 0 || isCellTool;
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
      card.style.cursor =
        state.polyTool === "pan" || state.spaceHeld ? "grab" :
        state.polyTool === "move" ? "default" :
        state.polyTool === "deselect" ? "cell" : "crosshair";
    }
  }

  function setPolyTool(tool) {
    state.polyTool = tool || "move";
    state.polyMarquee = null;
    state.polyPaint = null;
    state.polyPendingClick = null;
    state.drawing = null;
    state.polyDraft = null;
    state.dragResize = null;
    state.dragRotate = null;
    state.dragGroup = null;
    state.marquee = null;
    updatePolyUI();
    requestRender();
  }

  async function syncSeedToServer() {
    if (state._paramCache) state._paramCache.clear();
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
  function themeCol(col, opts) {
    return (window.CFVTheme && window.CFVTheme.adaptColor) ? window.CFVTheme.adaptColor(col, opts) : (col || "#38bdf8");
  }
  function hexToRgba(hex, a, opts) {
    if (window.CFVTheme && window.CFVTheme.adaptRgba) return window.CFVTheme.adaptRgba(hex, a, opts);
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
      const implResults = await Promise.all(
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
          if (!res.ok) return null;
          const buf = await res.arrayBuffer();
          return {
            cardId: c.id, title: c.title, color: c.color,
            lineStyle: c.lineStyle || "solid", lineWidth: normLineWidth(c.lineWidth, 2.2),
            opacity: normOpacity(c.opacity, 1.0),
            nx, ny,
            xmin: state.view.xmin, xmax: state.view.xmax,
            ymin: state.view.ymin, ymax: state.view.ymax,
            grid: new Float32Array(buf),
          };
        })
      );
      for (const r of implResults) if (r) implicits.push(r);
    }

    /* 5. Continuous Parametric Curves (x(t), y(t)) via 4-thread C11 binary endpoint!
     * Cache results per-card keyed ONLY on the parameters referenced by that card's C code,
     * so panning, zooming, and 60 FPS dynamic camera follow make ZERO redundant HTTP fetches! */
    if (paramList.length > 0 && compiled) {
      const paramCache = state._paramCache || (state._paramCache = new Map());
      const allRealCards = typeof ws().getRealCards === "function" ? ws().getRealCards() : [];
      const paramNames = Object.keys(paramMap).sort();
      const paramResults = await Promise.all(
        paramList.map(async (c) => {
          const tmin = Number.isFinite(c.tMin) ? c.tMin : 0.0;
          const tmax = Number.isFinite(c.tMax) && c.tMax > tmin ? c.tMax : Math.PI * 2;
          const span = tmax - tmin;
          const pSamples = span >= 100
            ? Math.min(4800, Math.max(1600, Math.round(span) + 1))
            : (isAnim ? 1600 : 2800);
          const codeStr = String(c.compiledCode || c.code || "");
          const usesHelper = /\bf\d+\s*\(/.test(codeStr);
          const relevantCode = usesHelper
            ? allRealCards.map((rc) => String(rc.compiledCode || rc.code || "")).join("\n")
            : codeStr;
          const isStateful = /\breal_(life|seed)_/.test(relevantCode);
          let pKey = "";
          for (const nm of paramNames) {
            if (new RegExp(`\\b${nm}\\b`).test(relevantCode)) {
              pKey += `${nm}=${paramMap[nm]};`;
            }
          }
          const cacheKey = `${c.slot}|${tmin}|${tmax}|${pSamples}|${codeStr.length}|${codeStr.slice(0, 64)}|${codeStr.slice(-48)}|${pKey}`;
          let xy = isStateful ? null : paramCache.get(cacheKey);
          if (!xy) {
            const res = await fetch("/api/workspace/parametric", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slot: c.slot, tmin, tmax, samples: pSamples, params }),
            });
            if (!res.ok) return null;
            const buf = await res.arrayBuffer();
            xy = new Float32Array(buf);
            if (!isStateful) {
              if (paramCache.size > 48) {
                const firstKey = paramCache.keys().next().value;
                if (firstKey !== undefined) paramCache.delete(firstKey);
              }
              paramCache.set(cacheKey, xy);
            }
          }
          return {
            cardId: c.id, title: c.title, color: c.color,
            lineStyle: c.lineStyle || "solid", lineWidth: normLineWidth(c.lineWidth, 2.3),
            opacity: normOpacity(c.opacity, 1.0),
            xy,
          };
        })
      );
      for (const r of paramResults) if (r) parametrics.push(r);
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
    if (window.CFVGeom && window.CFVGeom.isLightTheme) return window.CFVGeom.isLightTheme();
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
    for (const s of state.shapes) valid.set(`shape:${s.id}`, { kind: "shape", id: s.id });
    for (const l of state.lines) valid.set(`guide_line:${l.id}`, { kind: "guide_line", id: l.id });
    for (const p of state.points) valid.set(`point:${p.id}`, { kind: "point", id: p.id });
    for (const t of state.texts) valid.set(`text:${t.id}`, { kind: "text", id: t.id });
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
    const sMap = new Map(state.shapes.map((s) => [s.id, s]));
    const lMap = new Map(state.lines.map((l) => [l.id, l]));
    const pMap = new Map(state.points.map((p) => [p.id, p]));
    const tMap = new Map(state.texts.map((t) => [t.id, t]));
    const out = [];
    for (const e of state.layerOrder) {
      const item =
        e.kind === "shape" ? sMap.get(e.id) :
        e.kind === "guide_line" ? lMap.get(e.id) :
        e.kind === "text" ? tMap.get(e.id) :
        pMap.get(e.id);
      if (item) out.push({ kind: e.kind, id: e.id, item });
    }
    return out;
  }
  function rebuildFormulaElements() {
    const pm = ws() && typeof ws().getParamMap === "function" ? ws().getParamMap() : {};
    if (window.CFVGeom && window.CFVGeom.rebuildFormulaElementsInState) {
      window.CFVGeom.rebuildFormulaElementsInState(state, pm);
      return;
    }
    const ev = window.CFVComplex && window.CFVComplex.evalParamExpr;
    if (!ev) return;
    for (const p of state.points) {
      if (p.xExpr && String(p.xExpr).trim()) {
        const vx = ev(p.xExpr, pm);
        if (Number.isFinite(vx)) p.x = vx;
      }
      if (p.yExpr && String(p.yExpr).trim()) {
        const vy = ev(p.yExpr, pm);
        if (Number.isFinite(vy)) p.y = vy;
      }
    }
    for (const ln of state.lines) {
      if (ln.valExpr && String(ln.valExpr).trim()) {
        const vv = ev(ln.valExpr, pm);
        if (Number.isFinite(vv)) ln.value = vv;
      }
    }
    for (const tb of state.texts) {
      if (tb.xExpr && String(tb.xExpr).trim()) {
        const vx = ev(tb.xExpr, pm);
        if (Number.isFinite(vx)) tb.x = vx;
      }
      if (tb.yExpr && String(tb.yExpr).trim()) {
        const vy = ev(tb.yExpr, pm);
        if (Number.isFinite(vy)) tb.y = vy;
      }
    }
  }
  async function rebuildShapeFromFormula(shape) {
    if (!shape || !shape.formula || !window.CFVGeom) return false;
    const pm = ws() && typeof ws().getParamMap === "function" ? ws().getParamMap() : {};
    const res = window.CFVGeom.evalShapeFormula(shape.formula, pm);
    if (!res || res.rawPts.length < 2) return false;
    shape.rawPts = res.rawPts;
    if (shape.formula.kind !== "parametric") shape.closed = res.closed;
    requestRender();
    return true;
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
    const ySpan = Math.max(1e-6, state.view.ymax - state.view.ymin);
    const trace = () => {
      ctx.beginPath();
      let down = false, psy = 0, prevY = 0;
      for (let i = 0; i < xs.length; i++) {
        const y = ys[i];
        if (y === null || !Number.isFinite(y)) { down = false; continue; }
        const sx = xToS(xs[i]);
        const sy = Math.max(-h * 2, Math.min(h * 3, yToS(y)));
        /* Asymptotic jump / pole discontinuity detection (prevents vertical spikes on tan(x), 1/(x-a), etc.) */
        if (down && !step) {
          const dy = Math.abs(y - prevY);
          const signFlip = (y > 0 && prevY < 0) || (y < 0 && prevY > 0);
          if ((signFlip && dy > ySpan * 3.5) || dy > ySpan * 14.0) {
            down = false;
          }
        }
        if (!down) { ctx.moveTo(sx, sy); down = true; }
        else if (step) { ctx.lineTo(sx, psy); ctx.lineTo(sx, sy); }
        else ctx.lineTo(sx, sy);
        psy = sy;
        prevY = y;
      }
    };
    ctx.save();
    ctx.globalAlpha = op;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    applyLineStyle(ctx, lineStyle || "solid");
    const col = themeCol(color);
    if (glow) { trace(); ctx.strokeStyle = hexToRgba(color, 0.24); ctx.lineWidth = width + 4; ctx.stroke(); }
    trace(); ctx.strokeStyle = col; ctx.lineWidth = width; ctx.stroke();
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
    const col = themeCol(color);
    trace(); ctx.strokeStyle = hexToRgba(color, 0.24); ctx.lineWidth = width + 4; ctx.stroke();
    trace(); ctx.strokeStyle = col; ctx.lineWidth = width; ctx.stroke();
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
    const col = themeCol(color);
    traceSegs(); ctx.strokeStyle = hexToRgba(color, 0.24); ctx.lineWidth = width + 4; ctx.stroke();
    traceSegs(); ctx.strokeStyle = col; ctx.lineWidth = width; ctx.stroke();
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
    const col = themeCol(color);
    trace(); ctx.strokeStyle = hexToRgba(color, 0.25); ctx.lineWidth = width + 4; ctx.stroke();
    trace(); ctx.strokeStyle = col; ctx.lineWidth = width; ctx.stroke();
    ctx.restore();
  }

  function expandRealLinearPts(s) {
    if (!s || !s.rawPts || s.rawPts.length < 2) return s ? s.rawPts : [];
    if (s.kind !== "ray" && s.kind !== "infline") return s.rawPts;
    const a = s.rawPts[0], b = s.rawPts[s.rawPts.length - 1];
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
    const span = Math.max(10, Math.hypot(state.view.xmax - state.view.xmin, state.view.ymax - state.view.ymin) * 4);
    if (s.kind === "ray") return [a, { x: a.x + dx * span, y: a.y + dy * span }];
    return [{ x: a.x - dx * span, y: a.y - dy * span }, { x: a.x + dx * span, y: a.y + dy * span }];
  }

  function drawRealShape(s) {
    if (!s || !s.visible || !s.rawPts || s.rawPts.length < 2) return;
    const defaultOp = s.closed ? 0.22 : 1.0;
    const op = normOpacity(s.opacity, defaultOp);
    if (op <= 0.001) return;
    const strokeAlpha = s.closed ? (op < 0.22 ? op / 0.22 : 1.0) : op;
    const lw = normLineWidth(s.lineWidth, 2.2);
    const hi = isShapeSelected(s.id);
    const hiCol = isLightTheme() ? "#0f172a" : "#ffffff";
    const fillCol = themeCol(s.color || "#38bdf8", { solidFill: s.closed && op >= 0.85 });
    const strokeCol = themeCol(s.color || "#38bdf8");
    const drawPts = expandRealLinearPts(s);

    const trace = () => {
      ctx.beginPath();
      for (let i = 0; i < drawPts.length; i++) {
        const sx = xToS(drawPts[i].x), sy = yToS(drawPts[i].y);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      if (s.closed && drawPts.length >= 3) ctx.closePath();
    };

    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (s.closed && drawPts.length >= 3) {
      trace();
      ctx.fillStyle = op >= 0.995 ? fillCol : hexToRgba(s.color || "#38bdf8", op);
      ctx.fill("nonzero");
    }
    if (lw > 0 || hi) {
      ctx.globalAlpha = strokeAlpha;
      applyLineStyle(ctx, s.lineStyle || "solid");
      if (lw > 0 && op < 0.85) {
        trace();
        ctx.strokeStyle = hexToRgba(s.color || "#38bdf8", hi ? 0.48 : 0.24);
        ctx.lineWidth = lw + (hi ? 6 : 4);
        ctx.stroke();
      }
      trace();
      ctx.strokeStyle = hi ? hiCol : strokeCol;
      ctx.lineWidth = lw > 0 ? (hi ? lw + 0.7 : lw) : 1.4;
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.kind === "ray") {
        const aSp = { x: xToS(s.rawPts[0].x), y: yToS(s.rawPts[0].y) };
        ctx.fillStyle = hi ? hiCol : strokeCol;
        ctx.beginPath(); ctx.arc(aSp.x, aSp.y, 4.2, 0, Math.PI * 2); ctx.fill();
      }
      if (hi && !s.locked && (s.kind === "line" || s.kind === "seg" || s.kind === "ray" || s.kind === "infline")) {
        for (const ep of [s.rawPts[0], s.rawPts[s.rawPts.length - 1]]) {
          ctx.fillStyle = "#0a0e17"; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(xToS(ep.x), yToS(ep.y), 4.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  function drawSingleGuideLine(ln, w, h) {
    if (!ln.visible) return;
    const op = normOpacity(ln.opacity, 1.0);
    if (op <= 0.001) return;
    const sel = ln.id === state.selectedLineId;
    const col = themeCol(ln.color || "#fbbf24");
    const lw = normLineWidth(ln.lineWidth, 1.6);
    const hiCol = isLightTheme() ? "#0f172a" : "#ffffff";

    ctx.save();
    ctx.globalAlpha = op;
    ctx.font = '600 10.5px "JetBrains Mono", monospace';
    ctx.strokeStyle = sel ? hiCol : hexToRgba(ln.color || "#fbbf24", 0.85);
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
    const sel = isPointSelected(p.id);
    const col = themeCol(p.color || "#34d399");
    ctx.save();
    ctx.globalAlpha = op;
    ctx.font = '10.5px "JetBrains Mono", monospace';
    if (drawIcon) {
      drawIcon(ctx, sx, sy, p.icon || "dot", col, p.size || 5, sel);
    } else {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(sx, sy, p.size || 5, 0, Math.PI * 2); ctx.fill();
    }
    if (p.showLabel !== false && p.label) {
      ctx.fillStyle = col;
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

    ctx.fillStyle = light ? "#f5f7fb" : "#0a0e17";
    ctx.fillRect(0, 0, w, h);

    const xSpan = state.view.xmax - state.view.xmin;
    const ySpan = state.view.ymax - state.view.ymin;
    const xStep = niceStep((xSpan * 90) / Math.max(1, w));
    const yStep = niceStep((ySpan * 65) / Math.max(1, h));

    if (state.coordSystem === "polar") {
      if (window.CFVProjections && window.CFVProjections.drawProjectionOverlay) {
        const realW2S = (_v, _c, wx, wy) => ({ x: xToS(wx), y: yToS(wy) });
        const polarView = { ...state.view, scaleX: w / Math.max(1e-9, xSpan), scaleY: h / Math.max(1e-9, ySpan) };
        window.CFVProjections.drawProjectionOverlay(ctx, canvas, polarView, realW2S, "polar", light);
      }
    } else if (state.coordSystem === "logx" || state.coordSystem === "loglog") {
      /* Logarithmic Decade & Sub-Decade Grid (10^k) */
      const logMajCol = light ? "rgba(15,23,42,0.16)" : "rgba(148,163,184,0.20)";
      const logMinCol = light ? "rgba(15,23,42,0.06)" : "rgba(148,163,184,0.08)";
      const drawLogX = () => {
        const x0 = Math.max(1e-4, state.view.xmin);
        const x1 = Math.max(x0 * 1.1, state.view.xmax);
        if (state.view.xmax <= 0) return;
        const dMin = Math.floor(Math.log10(x0));
        const dMax = Math.ceil(Math.log10(x1));
        for (let d = dMin; d <= dMax; d++) {
          const base = Math.pow(10, d);
          for (let m = 1; m <= 9; m++) {
            const v = m * base;
            if (v < state.view.xmin || v > state.view.xmax) continue;
            const sx = Math.round(xToS(v)) + 0.5;
            ctx.strokeStyle = m === 1 ? logMajCol : logMinCol;
            ctx.lineWidth = m === 1 ? 1.1 : 0.75;
            ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
          }
        }
      };
      const drawLogY = () => {
        const y0 = Math.max(1e-4, state.view.ymin);
        const y1 = Math.max(y0 * 1.1, state.view.ymax);
        if (state.view.ymax <= 0) return;
        const dMin = Math.floor(Math.log10(y0));
        const dMax = Math.ceil(Math.log10(y1));
        for (let d = dMin; d <= dMax; d++) {
          const base = Math.pow(10, d);
          for (let m = 1; m <= 9; m++) {
            const v = m * base;
            if (v < state.view.ymin || v > state.view.ymax) continue;
            const sy = Math.round(yToS(v)) + 0.5;
            ctx.strokeStyle = m === 1 ? logMajCol : logMinCol;
            ctx.lineWidth = m === 1 ? 1.1 : 0.75;
            ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
          }
        }
      };
      drawLogX();
      if (state.coordSystem === "loglog") {
        drawLogY();
      } else {
        ctx.strokeStyle = light ? "rgba(15,23,42,0.09)" : "rgba(148,163,184,0.11)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let y = Math.floor(state.view.ymin / yStep) * yStep; y <= state.view.ymax; y += yStep) {
          const sy = Math.round(yToS(y)) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(w, sy);
        }
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = light ? "rgba(15,23,42,0.09)" : "rgba(148,163,184,0.11)"; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.floor(state.view.xmin / xStep) * xStep; x <= state.view.xmax; x += xStep) {
        const sx = Math.round(xToS(x)) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
      }
      for (let y = Math.floor(state.view.ymin / yStep) * yStep; y <= state.view.ymax; y += yStep) {
        const sy = Math.round(yToS(y)) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(w, sy);
      }
      ctx.stroke();
    }

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
    rebuildFormulaElements();
    /* Unified Element Layering Order (back -> front: shapes, guide lines, points) */
    for (const el of getOrderedElements()) {
      if (el.kind === "shape") drawRealShape(el.item);
      else if (el.kind === "guide_line") drawSingleGuideLine(el.item, w, h);
      else if (el.kind === "point") drawSinglePoint(el.item, w, h);
    }
    if (window.CFVAnnotations && state.texts.length > 0) {
      window.CFVAnnotations.drawTextBoxes(ctx, canvas, state.texts, {
        isLight: light,
        selectedTextId: state.selectedTextId,
        hoveredTextId: state.hoveredTextId,
        worldToScreen: (wx, wy) => ({ x: xToS(wx), y: yToS(wy) }),
      });
    } else {
      canvas._textLayouts = [];
    }
    /* Live vector drawing preview */
    if (state.drawing && state.drawing.rawPts && state.drawing.rawPts.length >= 2) {
      const d = state.drawing;
      const col = themeCol(d.color || "#38bdf8");
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let i = 0; i < d.rawPts.length; i++) {
        const sx = xToS(d.rawPts[i].x), sy = yToS(d.rawPts[i].y);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      if (d.closed || d.snapActive) ctx.closePath();
      ctx.stroke();
      if (d.kind === "freehand" && d.rawPts.length >= 6) {
        const stx = xToS(d.rawPts[0].x), sty = yToS(d.rawPts[0].y);
        ctx.strokeStyle = d.snapActive ? "#10b981" : (light ? "rgba(15,23,42,0.35)" : "rgba(255,255,255,0.45)");
        ctx.beginPath(); ctx.arc(stx, sty, d.snapActive ? 10 : 5, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
    if (state.polyDraft && state.polyDraft.rawPts && state.polyDraft.rawPts.length >= 1) {
      const pd = state.polyDraft;
      const pts = pd.hoverPt ? [...pd.rawPts, pd.hoverPt] : pd.rawPts;
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = themeCol(pd.color || "#38bdf8");
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const sx = xToS(pts[i].x), sy = yToS(pts[i].y);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
      ctx.restore();
    }
    /* Move-Mode Selection Overlay: Group Box, Resize Handles, Rotate Knob & Marquee */
    if (state.polyTool === "move") {
      const grpBox = getGroupBox();
      if (grpBox) {
        const tl = { x: xToS(grpBox.xmin), y: yToS(grpBox.ymax) };
        const br = { x: xToS(grpBox.xmax), y: yToS(grpBox.ymin) };
        const rx = Math.min(tl.x, br.x), ry = Math.min(tl.y, br.y);
        const rw = Math.abs(br.x - tl.x), rh = Math.abs(br.y - tl.y);
        ctx.save();
        ctx.fillStyle = "rgba(56,189,248,0.06)";
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1.3;
        ctx.setLineDash([5, 4]);
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
        for (const gh of getGroupHandles(grpBox)) {
          const sx = xToS(gh.x), sy = yToS(gh.y);
          ctx.fillStyle = light ? "#ffffff" : "#0a0e17";
          ctx.strokeStyle = "#38bdf8";
          ctx.lineWidth = 2;
          ctx.fillRect(sx - 4.5, sy - 4.5, 9, 9);
          ctx.strokeRect(sx - 4.5, sy - 4.5, 9, 9);
        }
        ctx.restore();
      } else if (state.selectedShapeId !== null) {
        const selSh = state.shapes.find((x) => x.id === state.selectedShapeId);
        if (selSh && selSh.visible !== false && !selSh.locked) {
          ctx.save();
          for (const h of getResizeHandles(selSh)) {
            const sx = xToS(h.x), sy = yToS(h.y);
            ctx.fillStyle = light ? "#ffffff" : "#0a0e17";
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 2;
            if (h.shapeKind === "line" || h.shapeKind === "polygon" || h.shapeKind === "circle") {
              ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            } else {
              ctx.fillRect(sx - 4.5, sy - 4.5, 9, 9);
              ctx.strokeRect(sx - 4.5, sy - 4.5, 9, 9);
            }
          }
          ctx.restore();
        }
      }
      const rotInfo = getSelectionRotateInfo();
      if (rotInfo) {
        ctx.save();
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1.6;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(rotInfo.stemX, rotInfo.stemY);
        ctx.lineTo(rotInfo.handleX, rotInfo.handleY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = state.dragRotate ? "#38bdf8" : (light ? "#ffffff" : "#0a0e17");
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(rotInfo.handleX, rotInfo.handleY, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (state.dragRotate) {
          const deg = Math.round(((state.dragRotate.angle || 0) * 180) / Math.PI);
          const pill = `${deg}°`;
          ctx.font = '600 11px "JetBrains Mono", monospace';
          const tw = ctx.measureText(pill).width + 12;
          ctx.fillStyle = "rgba(15,23,42,0.9)";
          ctx.beginPath(); ctx.roundRect(rotInfo.handleX + 10, rotInfo.handleY - 10, tw, 20, 5); ctx.fill();
          ctx.fillStyle = "#38bdf8";
          ctx.fillText(pill, rotInfo.handleX + 16, rotInfo.handleY + 4);
        }
        ctx.restore();
      }
      if (state.marquee) {
        const m = state.marquee;
        const x0 = Math.min(m.x0, m.x1), y0 = Math.min(m.y0, m.y1);
        const mw = Math.abs(m.x1 - m.x0), mh = Math.abs(m.y1 - m.y0);
        ctx.save();
        ctx.fillStyle = "rgba(56,189,248,0.12)";
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1.3;
        ctx.setLineDash([5, 4]);
        ctx.fillRect(x0, y0, mw, mh);
        ctx.strokeRect(x0, y0, mw, mh);
        ctx.restore();
      }
    }
    /* Standardized Smart Magnetic Snap Indicator (Shared across Complex, Real & Vector!) */
    if (state.snapHint && window.CFVGeom && window.CFVGeom.drawSnapIndicator) {
      window.CFVGeom.drawSnapIndicator(ctx, state.snapHint, xToS, yToS, light);
    }
    ctx.restore();
  }

  function drawPolygons(w, h) {
    const isCellTool = state.polyTool === "select" || state.polyTool === "deselect" || state.polyTool === "add";
    const hasPolys = state.polygons.length > 0 || isCellTool;
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
      row.innerHTML = `<span class="real-legend-name"><span class="real-legend-swatch" style="background:${themeCol(c.color)}"></span>${c.title}</span><span class="real-legend-val">${val !== null && Number.isFinite(val) ? val.toFixed(4) : "—"}</span>`;
      legendRows.appendChild(row);
    });
    for (const pc of parametrics || []) {
      const row = document.createElement("div");
      row.className = "real-legend-row";
      row.innerHTML = `<span class="real-legend-name"><span class="real-legend-swatch" style="background:${themeCol(pc.color)}"></span>${pc.title}</span><span class="real-legend-val">(x(t), y(t))</span>`;
      legendRows.appendChild(row);
    }
    for (const v of verticals || []) {
      const row = document.createElement("div");
      row.className = "real-legend-row";
      row.innerHTML = `<span class="real-legend-name"><span class="real-legend-swatch" style="background:${themeCol(v.color)}"></span>${v.title}</span><span class="real-legend-val">x=${v.xVal.toFixed(3)}</span>`;
      legendRows.appendChild(row);
    }
    for (const xc of xOfYCurves || []) {
      const row = document.createElement("div");
      row.className = "real-legend-row";
      row.innerHTML = `<span class="real-legend-name"><span class="real-legend-swatch" style="background:${themeCol(xc.color)}"></span>${xc.title}</span><span class="real-legend-val">x=g(y)</span>`;
      legendRows.appendChild(row);
    }
    for (const imp of implicits || []) {
      const row = document.createElement("div");
      row.className = "real-legend-row";
      row.innerHTML = `<span class="real-legend-name"><span class="real-legend-swatch" style="background:${themeCol(imp.color)}"></span>${imp.title}</span><span class="real-legend-val">F(x,y)=0</span>`;
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

  function distSegSq(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    const ex = px - (ax + t * dx), ey = py - (ay + t * dy);
    return ex * ex + ey * ey;
  }

  function ptInPoly(wx, wy, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if (yi > wy !== yj > wy && wx < ((xj - xi) * (wy - yi)) / (yj - yi + 1e-30) + xi) inside = !inside;
    }
    return inside;
  }

  const HANDLE_HIT_PX = 10;
  const SNAP_PX = 14;

  /* Standardized Smart Magnetic Snapping (Shared CFVGeom Engine + Real Curve y=f(x) fallback!) */
  function findRealSnapTarget(sx, sy, excludeShapeId = null, excludePointId = null, shiftKey = false) {
    let best = null;
    if (window.CFVGeom && window.CFVGeom.findSmartSnap) {
      best = window.CFVGeom.findSmartSnap(sx, sy, {
        shapes: state.shapes,
        points: state.points,
        lines: state.lines,
        xToS,
        yToS,
        sToX,
        sToY,
        excludeShapeId,
        excludePointId,
        snapPx: SNAP_PX,
        shiftKey: Boolean(shiftKey),
        includeGrid: Boolean(shiftKey),
      });
    }
    /* Also snap to graphed curve y = f(x) when no higher-priority geometric landmark is within radius! */
    if ((!best || best.kind === "grid") && state.cache && state.cache.xs && state.cache.xs.length >= 2) {
      const wx = sToX(sx);
      let bestDist = 10;
      for (const c of state.cache.curves || []) {
        const yv = sampleAt(state.cache.xs, c.ys, wx);
        if (yv !== null && Number.isFinite(yv)) {
          const d = Math.abs(sy - yToS(yv));
          if (d <= bestDist) {
            bestDist = d;
            best = { x: wx, y: yv, kind: "curve", label: "Curve" };
          }
        }
      }
    }
    return best;
  }

  function bboxOf(pts) {
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const p of pts || []) {
      if (p.x < xmin) xmin = p.x;
      if (p.x > xmax) xmax = p.x;
      if (p.y < ymin) ymin = p.y;
      if (p.y > ymax) ymax = p.y;
    }
    if (!Number.isFinite(xmin)) return { xmin: 0, xmax: 0, ymin: 0, ymax: 0, cx: 0, cy: 0 };
    return { xmin, xmax, ymin, ymax, cx: 0.5 * (xmin + xmax), cy: 0.5 * (ymin + ymax) };
  }

  function isShapeSelected(id) {
    return state.selectedShapeIds.has(id) || state.selectedShapeId === id;
  }

  function isPointSelected(id) {
    return state.selectedPointIds.has(id) || state.selectedPointId === id;
  }

  function clearSelection() {
    state.selectedShapeIds.clear();
    state.selectedPointIds.clear();
    state.selectedShapeId = null;
    state.selectedPointId = null;
    state.selectedLineId = null;
    state.selectedTextId = null;
  }

  function syncPrimarySelection() {
    const sArr = [...state.selectedShapeIds].filter((id) => state.shapes.some((s) => s.id === id));
    state.selectedShapeIds = new Set(sArr);
    state.selectedShapeId = sArr.length > 0 ? sArr[sArr.length - 1] : null;
    const pArr = [...state.selectedPointIds].filter((id) => state.points.some((p) => p.id === id));
    state.selectedPointIds = new Set(pArr);
    state.selectedPointId = pArr.length > 0 ? pArr[pArr.length - 1] : null;
  }

  function getSelectedMovableItems() {
    const shapes = state.shapes.filter((s) => !s.locked && s.visible !== false && isShapeSelected(s.id) && s.rawPts && s.rawPts.length >= 2);
    const points = state.points.filter((p) => !p.locked && p.visible !== false && isPointSelected(p.id));
    return { shapes, points, total: shapes.length + points.length };
  }

  function getGroupBox() {
    const { shapes, points, total } = getSelectedMovableItems();
    if (total < 2) return null;
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const s of shapes) {
      for (const p of s.rawPts) {
        if (p.x < xmin) xmin = p.x;
        if (p.x > xmax) xmax = p.x;
        if (p.y < ymin) ymin = p.y;
        if (p.y > ymax) ymax = p.y;
      }
    }
    for (const pt of points) {
      if (pt.x < xmin) xmin = pt.x;
      if (pt.x > xmax) xmax = pt.x;
      if (pt.y < ymin) ymin = pt.y;
      if (pt.y > ymax) ymax = pt.y;
    }
    if (!Number.isFinite(xmin)) return null;
    if (xmax - xmin < 1e-4) { xmin -= 0.12; xmax += 0.12; }
    if (ymax - ymin < 1e-4) { ymin -= 0.12; ymax += 0.12; }
    return { xmin, xmax, ymin, ymax, cx: 0.5 * (xmin + xmax), cy: 0.5 * (ymin + ymax) };
  }

  function getGroupHandles(bb) {
    if (!bb) return [];
    return [
      { id: "nw", x: bb.xmin, y: bb.ymax, cursor: "nwse-resize" },
      { id: "n", x: bb.cx, y: bb.ymax, cursor: "ns-resize" },
      { id: "ne", x: bb.xmax, y: bb.ymax, cursor: "nesw-resize" },
      { id: "e", x: bb.xmax, y: bb.cy, cursor: "ew-resize" },
      { id: "se", x: bb.xmax, y: bb.ymin, cursor: "nwse-resize" },
      { id: "s", x: bb.cx, y: bb.ymin, cursor: "ns-resize" },
      { id: "sw", x: bb.xmin, y: bb.ymin, cursor: "nesw-resize" },
      { id: "w", x: bb.xmin, y: bb.cy, cursor: "ew-resize" },
    ];
  }

  function hitGroupHandle(sx, sy) {
    const bb = getGroupBox();
    if (!bb) return null;
    for (const h of getGroupHandles(bb)) {
      if (Math.hypot(sx - xToS(h.x), sy - yToS(h.y)) <= HANDLE_HIT_PX + 1) return { box: bb, handle: h };
    }
    return null;
  }

  function hitGroupBox(sx, sy) {
    const bb = getGroupBox();
    if (!bb) return false;
    const x0 = Math.min(xToS(bb.xmin), xToS(bb.xmax)) - 6;
    const x1 = Math.max(xToS(bb.xmin), xToS(bb.xmax)) + 6;
    const y0 = Math.min(yToS(bb.ymax), yToS(bb.ymin)) - 6;
    const y1 = Math.max(yToS(bb.ymax), yToS(bb.ymin)) + 6;
    return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
  }

  function rectLocalFrame(pts) {
    if (!pts || pts.length !== 4) return null;
    const p0 = pts[0], p1 = pts[1], p2 = pts[2], p3 = pts[3];
    const cx = 0.25 * (p0.x + p1.x + p2.x + p3.x);
    const cy = 0.25 * (p0.y + p1.y + p2.y + p3.y);
    const e01x = p1.x - p0.x, e01y = p1.y - p0.y;
    const e03x = p3.x - p0.x, e03y = p3.y - p0.y;
    const w = Math.hypot(e01x, e01y);
    const h = Math.hypot(e03x, e03y);
    if (w < 1e-9 || h < 1e-9) {
      const bb = bboxOf(pts);
      return { cx: bb.cx, cy: bb.cy, ux: 1, uy: 0, vx: 0, vy: 1, w: Math.max(0.03, bb.xmax - bb.xmin), h: Math.max(0.03, bb.ymax - bb.ymin) };
    }
    return { cx, cy, ux: e01x / w, uy: e01y / w, vx: e03x / h, vy: e03y / h, w, h };
  }

  function getResizeHandles(shape) {
    if (!shape || !shape.visible || shape.locked || !shape.rawPts || shape.rawPts.length < 2) return [];
    const bb = bboxOf(shape.rawPts);
    if (shape.kind === "circle") {
      const r = 0.25 * (bb.xmax - bb.xmin + (bb.ymax - bb.ymin));
      return [
        { id: "e", x: bb.cx + r, y: bb.cy, cursor: "ew-resize", shapeKind: "circle" },
        { id: "w", x: bb.cx - r, y: bb.cy, cursor: "ew-resize", shapeKind: "circle" },
        { id: "n", x: bb.cx, y: bb.cy + r, cursor: "ns-resize", shapeKind: "circle" },
        { id: "s", x: bb.cx, y: bb.cy - r, cursor: "ns-resize", shapeKind: "circle" },
      ];
    }
    if (shape.kind === "rect" && shape.rawPts.length === 4) {
      const [p0, p1, p2, p3] = shape.rawPts;
      return [
        { id: "nw", x: p3.x, y: p3.y, cursor: "nwse-resize", shapeKind: "rect" },
        { id: "ne", x: p2.x, y: p2.y, cursor: "nesw-resize", shapeKind: "rect" },
        { id: "se", x: p1.x, y: p1.y, cursor: "nwse-resize", shapeKind: "rect" },
        { id: "sw", x: p0.x, y: p0.y, cursor: "nesw-resize", shapeKind: "rect" },
        { id: "n", x: 0.5 * (p2.x + p3.x), y: 0.5 * (p2.y + p3.y), cursor: "ns-resize", shapeKind: "rect" },
        { id: "s", x: 0.5 * (p0.x + p1.x), y: 0.5 * (p0.y + p1.y), cursor: "ns-resize", shapeKind: "rect" },
        { id: "e", x: 0.5 * (p1.x + p2.x), y: 0.5 * (p1.y + p2.y), cursor: "ew-resize", shapeKind: "rect" },
        { id: "w", x: 0.5 * (p3.x + p0.x), y: 0.5 * (p3.y + p0.y), cursor: "ew-resize", shapeKind: "rect" },
      ];
    }
    if (shape.kind === "rect") {
      return [
        { id: "nw", x: bb.xmin, y: bb.ymax, cursor: "nwse-resize", shapeKind: "rect" },
        { id: "ne", x: bb.xmax, y: bb.ymax, cursor: "nesw-resize", shapeKind: "rect" },
        { id: "se", x: bb.xmax, y: bb.ymin, cursor: "nwse-resize", shapeKind: "rect" },
        { id: "sw", x: bb.xmin, y: bb.ymin, cursor: "nesw-resize", shapeKind: "rect" },
        { id: "n", x: bb.cx, y: bb.ymax, cursor: "ns-resize", shapeKind: "rect" },
        { id: "s", x: bb.cx, y: bb.ymin, cursor: "ns-resize", shapeKind: "rect" },
        { id: "e", x: bb.xmax, y: bb.cy, cursor: "ew-resize", shapeKind: "rect" },
        { id: "w", x: bb.xmin, y: bb.cy, cursor: "ew-resize", shapeKind: "rect" },
      ];
    }
    if (shape.kind === "line" || shape.kind === "seg" || shape.kind === "ray" || shape.kind === "infline") {
      return [
        { id: "start", x: shape.rawPts[0].x, y: shape.rawPts[0].y, cursor: "move", shapeKind: "line" },
        { id: "end", x: shape.rawPts[shape.rawPts.length - 1].x, y: shape.rawPts[shape.rawPts.length - 1].y, cursor: "move", shapeKind: "line" },
      ];
    }
    if (shape.kind === "polygon" && shape.rawPts.length <= 16) {
      return shape.rawPts.map((p, idx) => ({ id: `v${idx}`, vertexIndex: idx, x: p.x, y: p.y, cursor: "move", shapeKind: "polygon" }));
    }
    return [
      { id: "nw", x: bb.xmin, y: bb.ymax, cursor: "nwse-resize", shapeKind: "scale" },
      { id: "ne", x: bb.xmax, y: bb.ymax, cursor: "nesw-resize", shapeKind: "scale" },
      { id: "se", x: bb.xmax, y: bb.ymin, cursor: "nwse-resize", shapeKind: "scale" },
      { id: "sw", x: bb.xmin, y: bb.ymin, cursor: "nesw-resize", shapeKind: "scale" },
    ];
  }

  function hitResizeHandle(sx, sy) {
    if (getSelectedMovableItems().total >= 2) return null;
    const s = state.shapes.find((x) => x.id === state.selectedShapeId);
    if (!s || !s.visible || s.locked) return null;
    for (const h of getResizeHandles(s)) {
      if (Math.hypot(sx - xToS(h.x), sy - yToS(h.y)) <= HANDLE_HIT_PX) return { shape: s, handle: h };
    }
    return null;
  }

  function getSelectionRotateInfo() {
    const items = getSelectedMovableItems();
    if (items.total === 0) return null;
    if (items.total === 1 && items.shapes.length === 0) return null;
    const bb = items.total >= 2 ? getGroupBox() : bboxOf(items.shapes[0].rawPts);
    if (!bb || !Number.isFinite(bb.xmin)) return null;
    const stemX = xToS(bb.cx), stemY = yToS(bb.ymax);
    return { bb, cx: bb.cx, cy: bb.cy, stemX, stemY, handleX: stemX, handleY: stemY - 26, items };
  }

  function hitRotateHandle(sx, sy) {
    const info = getSelectionRotateInfo();
    if (!info) return null;
    if (Math.hypot(sx - info.handleX, sy - info.handleY) <= HANDLE_HIT_PX + 2) return info;
    return null;
  }

  function hitRealShape(sx, sy) {
    const wx = sToX(sx), wy = sToY(sy);
    for (let i = state.shapes.length - 1; i >= 0; i--) {
      const s = state.shapes[i];
      if (!s.visible || !s.rawPts || s.rawPts.length < 2) continue;
      const pts = expandRealLinearPts(s);
      const segs = s.closed ? pts.length : pts.length - 1;
      for (let k = 0; k < segs; k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length];
        if (distSegSq(sx, sy, xToS(a.x), yToS(a.y), xToS(b.x), yToS(b.y)) <= 144) return s;
      }
      if (s.closed && pts.length >= 3 && ptInPoly(wx, wy, pts)) return s;
    }
    return null;
  }

  function makeRealCircle(cx, cy, r, n = 64) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function makeRealRect(x0, y0, x1, y1) {
    const xmin = Math.min(x0, x1), xmax = Math.max(x0, x1);
    const ymin = Math.min(y0, y1), ymax = Math.max(y0, y1);
    return [{ x: xmin, y: ymin }, { x: xmax, y: ymin }, { x: xmax, y: ymax }, { x: xmin, y: ymax }];
  }

  function cloneShapeUndoSnap() {
    return {
      shapes: state.shapes.map((s) => ({
        ...s,
        rawPts: (s.rawPts || []).map((p) => ({ x: p.x, y: p.y })),
      })),
      points: state.points.map((p) => ({ ...p })),
      lines: state.lines.map((l) => ({ ...l })),
      texts: state.texts.map((t) => ({ ...t })),
      layerOrder: (state.layerOrder || []).map((e) => ({ ...e })),
    };
  }

  function pushShapeUndo() {
    state.shapeUndoStack.push(cloneShapeUndoSnap());
    if (state.shapeUndoStack.length > 40) state.shapeUndoStack.shift();
    state.shapeRedoStack = [];
    state.lastUndoKind = "elements";
  }

  function applyShapeSnap(snap) {
    if (Array.isArray(snap)) {
      state.shapes = snap;
    } else {
      state.shapes = snap.shapes || [];
      state.points = snap.points || [];
      state.lines = snap.lines || [];
      state.texts = snap.texts || [];
      state.layerOrder = snap.layerOrder || [];
    }
    clearSelection();
    notifyDomain();
    notifyState(true);
    requestRender();
  }

  function undoShapeAction() {
    if (state.shapeUndoStack.length === 0) return false;
    if (!Array.isArray(state.shapeRedoStack)) state.shapeRedoStack = [];
    state.shapeRedoStack.push(cloneShapeUndoSnap());
    if (state.shapeRedoStack.length > 40) state.shapeRedoStack.shift();
    applyShapeSnap(state.shapeUndoStack.pop());
    return true;
  }

  function redoShapeAction() {
    if (!Array.isArray(state.shapeRedoStack) || state.shapeRedoStack.length === 0) return false;
    state.shapeUndoStack.push(cloneShapeUndoSnap());
    if (state.shapeUndoStack.length > 40) state.shapeUndoStack.shift();
    applyShapeSnap(state.shapeRedoStack.pop());
    return true;
  }

  async function undoRealAction() {
    if (state.lastUndoKind === "polys" && state.polyUndoStack.length > 0) {
      return undoPolygonAction();
    }
    if (state.shapeUndoStack.length > 0) {
      return undoShapeAction();
    }
    if (state.polyUndoStack.length > 0) {
      return undoPolygonAction();
    }
    return false;
  }

  async function redoRealAction() {
    if (Array.isArray(state.shapeRedoStack) && state.shapeRedoStack.length > 0) {
      return redoShapeAction();
    }
    return false;
  }

  function deleteSelectedItems() {
    const remShapeIds = new Set(state.shapes.filter((s) => !s.locked && isShapeSelected(s.id)).map((s) => s.id));
    const remPointIds = new Set(state.points.filter((p) => !p.locked && isPointSelected(p.id)).map((p) => p.id));
    const remLine = (remShapeIds.size === 0 && remPointIds.size === 0 && state.selectedLineId !== null)
      ? state.lines.find((l) => l.id === state.selectedLineId && !l.locked)
      : null;
    const remText = (remShapeIds.size === 0 && remPointIds.size === 0 && !remLine && state.selectedTextId !== null)
      ? state.texts.find((t) => t.id === state.selectedTextId && !t.locked)
      : null;
    if (remShapeIds.size === 0 && remPointIds.size === 0 && !remLine && !remText) return false;
    pushShapeUndo();
    if (remShapeIds.size > 0) state.shapes = state.shapes.filter((s) => !remShapeIds.has(s.id));
    if (remPointIds.size > 0) state.points = state.points.filter((p) => !remPointIds.has(p.id));
    if (remLine) state.lines = state.lines.filter((l) => l.id !== remLine.id);
    if (remText) state.texts = state.texts.filter((t) => t.id !== remText.id);
    clearSelection();
    notifyDomain();
    notifyState(true);
    requestRender();
    return true;
  }

  function addShape(opts = {}, silent = false) {
    if (!silent) pushShapeUndo();
    const closed = opts.closed !== undefined ? Boolean(opts.closed) : (opts.kind !== "line" && opts.kind !== "freehand");
    const col = opts.color || PALETTE[state.colorIdx++ % PALETTE.length];
    const kind = opts.kind || "circle";
    let pts = Array.isArray(opts.rawPts) ? opts.rawPts.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })) : [];
    if (pts.length < 2) {
      const cx = 0.5 * (state.view.xmin + state.view.xmax);
      const cy = 0.5 * (state.view.ymin + state.view.ymax);
      const r = Math.max(0.5, (state.view.xmax - state.view.xmin) * 0.14);
      if (kind === "rect") pts = makeRealRect(cx - r, cy - r * 0.7, cx + r, cy + r * 0.7);
      else if (kind === "line") pts = [{ x: cx - r, y: cy }, { x: cx + r, y: cy }];
      else pts = makeRealCircle(cx, cy, r);
    }
    const sh = {
      id: state.nextShapeId++,
      kind,
      label: opts.label || (closed ? (kind === "freehand" ? "Closed Loop" : kind[0].toUpperCase() + kind.slice(1)) : "Path"),
      color: col,
      lineWidth: normLineWidth(opts.lineWidth, 2.2),
      opacity: normOpacity(opts.opacity, closed ? 0.22 : 1.0),
      lineStyle: opts.lineStyle || "solid",
      locked: Boolean(opts.locked),
      closed,
      visible: opts.visible !== undefined ? Boolean(opts.visible) : true,
      rawPts: pts,
    };
    state.shapes.push(sh);
    clearSelection();
    state.selectedShapeId = sh.id;
    state.selectedShapeIds.add(sh.id);
    notifyDomain();
    if (!silent) notifyState(true);
    requestRender();
    return sh;
  }

  function deleteShape(id) {
    const target = state.shapes.find((s) => s.id === id);
    if (!target || target.locked) return;
    pushShapeUndo();
    state.shapes = state.shapes.filter((s) => s.id !== id);
    state.selectedShapeIds.delete(id);
    syncPrimarySelection();
    notifyDomain();
    notifyState(true);
    requestRender();
  }

  function selectShape(id) {
    clearSelection();
    state.selectedShapeId = id;
    if (id !== null && id !== undefined) state.selectedShapeIds.add(id);
    notifyDomain();
    requestRender();
  }

  function toggleCloseShape(id) {
    const s = state.shapes.find((q) => q.id === (id ?? state.selectedShapeId));
    if (!s || s.locked || !s.rawPts || s.rawPts.length < 3) return;
    pushShapeUndo();
    s.closed = !s.closed;
    if (s.closed && s.opacity === 1.0) s.opacity = 0.22;
    notifyDomain();
    notifyState(true);
    requestRender();
  }

  function clearShapes() {
    const hadUnlocked = state.shapes.some((s) => !s.locked);
    if (!hadUnlocked) return;
    pushShapeUndo();
    state.shapes = state.shapes.filter((s) => s.locked);
    state.selectedShapeId = null;
    notifyDomain();
    notifyState(true);
    requestRender();
  }

  function finishPolyDraft() {
    const pd = state.polyDraft;
    if (!pd) return;
    state.polyDraft = null;
    if (pd.rawPts.length >= 3) {
      addShape({
        kind: "polygon",
        label: `Polygon (${pd.rawPts.length}v)`,
        color: pd.color,
        closed: true,
        rawPts: pd.rawPts,
      });
    } else {
      requestRender();
    }
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
    /* 1. Unified layer-ordered Shapes, Points & Guide Lines (topmost first) */
    const els = getOrderedElements();
    const wx = sToX(sx), wy = sToY(sy);
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
      } else if (el.kind === "shape") {
        const pts = el.item.rawPts || [];
        if (pts.length >= 2) {
          const segs = el.item.closed ? pts.length : pts.length - 1;
          for (let k = 0; k < segs; k++) {
            const a = pts[k], b = pts[(k + 1) % pts.length];
            if (distSegSq(sx, sy, xToS(a.x), yToS(a.y), xToS(b.x), yToS(b.y)) <= 144) return el;
          }
          if (el.item.closed && pts.length >= 3 && ptInPoly(wx, wy, pts)) return el;
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
    /* Hit-test text boxes on the Real plane so users can drag or resize any text box directly! */
    if (e.button === 0 && !state.spaceHeld && window.CFVAnnotations && state.texts.length > 0) {
      const tbHit = window.CFVAnnotations.hitTestTextBoxes(ctx, canvas, state.texts, pos.x, pos.y, {});
      if (tbHit) {
        selectTextBox(tbHit.tb.id);
        if (!tbHit.tb.locked) {
          state.dragText = {
            tb: tbHit.tb,
            mode: tbHit.hit,
            startX: pos.x,
            startY: pos.y,
            origBx: tbHit.bx,
            origBy: tbHit.by,
            origW: tbHit.boxW,
            origH: tbHit.boxH,
            origWorldX: Number(tbHit.tb.x) || 0,
            origWorldY: Number(tbHit.tb.y) || 0,
            moved: false,
          };
          canvas.style.cursor = tbHit.hit === "resize" ? "nwse-resize" : "grabbing";
        }
        requestRender();
        return;
      }
    }
    if (e.button === 1 || e.button === 2 || state.spaceHeld) {
      state.pan = { sx: pos.x, sy: pos.y, ov: { ...state.view }, rightClick: e.button === 2 };
      card.classList.add("panning");
      return;
    }
    if (state.calc.showIntegral) {
      if (Math.abs(pos.x - xToS(state.calc.a)) <= 12) { state.calc.draggingGate = "a"; return; }
      if (Math.abs(pos.x - xToS(state.calc.b)) <= 12) { state.calc.draggingGate = "b"; return; }
    }

    /* Interactive 2D Real Landmark Placement Tools (with Magnetic Snapping!) */
    if (state.polyTool === "point") {
      const sn = findRealSnapTarget(pos.x, pos.y);
      const wx = Number((sn ? sn.x : sToX(pos.x)).toFixed(4));
      const wy = Number((sn ? sn.y : sToY(pos.y)).toFixed(4));
      state.snapHint = null;
      addPoint({ x: wx, y: wy, label: `P${state.points.length + 1}` });
      return;
    }
    if (state.polyTool === "vline") {
      const wx = Number(sToX(pos.x).toFixed(3));
      addGuideLine({ orientation: "vertical", value: wx, label: `x = ${wx}` });
      return;
    }
    if (state.polyTool === "hline") {
      const wy = Number(sToY(pos.y).toFixed(3));
      addGuideLine({ orientation: "horizontal", value: wy, label: `y = ${wy}` });
      return;
    }

    /* Unified Click-to-Place & Vector Drawing Tools in Real Mode */
    if (state.polyTool === "text") {
      const cw = canvas.clientWidth || 600, ch = canvas.clientHeight || 400;
      addTextBox({
        title: "Note",
        text: "Click to edit in sidebar, or drag & resize directly on the graph.",
        anchor: "free",
        nx: Number(Math.max(0.02, Math.min(0.82, pos.x / cw)).toFixed(4)),
        ny: Number(Math.max(0.06, Math.min(0.84, pos.y / ch)).toFixed(4)),
        x: Number(sToX(pos.x).toFixed(3)),
        y: Number(sToY(pos.y).toFixed(3)),
        color: PALETTE[state.colorIdx % PALETTE.length],
      });
      return;
    }
    if (state.polyTool === "polygon") {
      const sn = findRealSnapTarget(pos.x, pos.y);
      const wpt = sn ? { x: sn.x, y: sn.y } : { x: sToX(pos.x), y: sToY(pos.y) };
      if (!state.polyDraft) {
        state.polyDraft = { color: PALETTE[state.colorIdx % PALETTE.length], rawPts: [wpt], hoverPt: wpt };
      } else {
        const first = state.polyDraft.rawPts[0];
        if (state.polyDraft.rawPts.length >= 3 && Math.hypot(pos.x - xToS(first.x), pos.y - yToS(first.y)) < 14) {
          finishPolyDraft();
          return;
        }
        state.polyDraft.rawPts.push(wpt);
      }
      requestRender();
      return;
    }
    if (
      state.polyTool === "freehand" || state.polyTool === "line" || state.polyTool === "seg" ||
      state.polyTool === "ray" || state.polyTool === "infline" || state.polyTool === "arc" ||
      state.polyTool === "circle" || state.polyTool === "rect"
    ) {
      const sn = findRealSnapTarget(pos.x, pos.y);
      const startPt = sn ? { x: sn.x, y: sn.y } : { x: sToX(pos.x), y: sToY(pos.y) };
      state.snapHint = sn;
      state.drawing = {
        kind: state.polyTool,
        color: PALETTE[state.colorIdx % PALETTE.length],
        start: startPt,
        startPx: { x: pos.x, y: pos.y },
        closed: state.polyTool === "circle" || state.polyTool === "rect",
        snapActive: false,
        rawPts: [startPt, { ...startPt }],
      };
      requestRender();
      return;
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

    /* Move Mode: Rotate, Group Resize/Move, Single Resize, Multi-Select & Marquee (Exact Parity with Complex Mode!) */
    if (state.polyTool === "move") {
      const multiMod = Boolean(e.ctrlKey || e.metaKey || e.shiftKey);
      const rotHit = !multiMod ? hitRotateHandle(pos.x, pos.y) : null;
      if (rotHit) {
        pushShapeUndo();
        const wx = sToX(pos.x), wy = sToY(pos.y);
        state.dragRotate = {
          cx: rotHit.cx,
          cy: rotHit.cy,
          startAngle: Math.atan2(wy - rotHit.cy, wx - rotHit.cx),
          angle: 0,
          shapes: rotHit.items.shapes.map((s) => ({ shape: s, origPts: s.rawPts.map((p) => ({ x: p.x, y: p.y })) })),
          points: rotHit.items.points.map((p) => ({ point: p, origX: p.x, origY: p.y })),
        };
        card.classList.add("panning");
        requestRender();
        return;
      }
      const grpH = !multiMod ? hitGroupHandle(pos.x, pos.y) : null;
      if (grpH) {
        pushShapeUndo();
        const items = getSelectedMovableItems();
        state.dragGroup = {
          mode: "resize",
          handleId: grpH.handle.id,
          origBox: { ...grpH.box },
          startX: sToX(pos.x),
          startY: sToY(pos.y),
          shapes: items.shapes.map((s) => ({ shape: s, origPts: s.rawPts.map((p) => ({ x: p.x, y: p.y })) })),
          points: items.points.map((p) => ({ point: p, origX: p.x, origY: p.y })),
        };
        requestRender();
        return;
      }
      const hHit = !multiMod ? hitResizeHandle(pos.x, pos.y) : null;
      if (hHit) {
        pushShapeUndo();
        state.dragResize = {
          shape: hHit.shape,
          handle: hHit.handle,
          origPts: hHit.shape.rawPts.map((p) => ({ x: p.x, y: p.y })),
          origBox: bboxOf(hHit.shape.rawPts),
        };
        requestRender();
        return;
      }
      const pHit = hitPoint(pos.x, pos.y);
      if (pHit) {
        if (multiMod) {
          if (state.selectedPointIds.has(pHit.id)) state.selectedPointIds.delete(pHit.id);
          else state.selectedPointIds.add(pHit.id);
          syncPrimarySelection();
          notifyDomain();
          requestRender();
          return;
        }
        if (isPointSelected(pHit.id) && getSelectedMovableItems().total >= 2) {
          pushShapeUndo();
          const items = getSelectedMovableItems();
          state.dragGroup = {
            mode: "move",
            startX: sToX(pos.x),
            startY: sToY(pos.y),
            shapes: items.shapes.map((s) => ({ shape: s, origPts: s.rawPts.map((p) => ({ x: p.x, y: p.y })) })),
            points: items.points.map((p) => ({ point: p, origX: p.x, origY: p.y })),
          };
          card.classList.add("panning");
          requestRender();
          return;
        }
        clearSelection();
        state.selectedPointId = pHit.id;
        state.selectedPointIds.add(pHit.id);
        if (!pHit.locked) {
          pushShapeUndo();
          state.dragPoint = { point: pHit };
          card.classList.add("panning");
        }
        notifyDomain();
        requestRender();
        return;
      }
      const lHit = hitGuideLine(pos.x, pos.y);
      if (lHit) {
        clearSelection();
        state.selectedLineId = lHit.id;
        if (!lHit.locked) {
          pushShapeUndo();
          state.dragLine = { line: lHit };
          card.classList.add("panning");
        }
        notifyDomain();
        requestRender();
        return;
      }
      const sHit = hitRealShape(pos.x, pos.y);
      if (sHit) {
        if (multiMod) {
          if (state.selectedShapeIds.has(sHit.id)) state.selectedShapeIds.delete(sHit.id);
          else state.selectedShapeIds.add(sHit.id);
          syncPrimarySelection();
          notifyDomain();
          requestRender();
          return;
        }
        if (isShapeSelected(sHit.id) && getSelectedMovableItems().total >= 2) {
          pushShapeUndo();
          const items = getSelectedMovableItems();
          state.dragGroup = {
            mode: "move",
            startX: sToX(pos.x),
            startY: sToY(pos.y),
            shapes: items.shapes.map((s) => ({ shape: s, origPts: s.rawPts.map((p) => ({ x: p.x, y: p.y })) })),
            points: items.points.map((p) => ({ point: p, origX: p.x, origY: p.y })),
          };
          card.classList.add("panning");
          requestRender();
          return;
        }
        clearSelection();
        state.selectedShapeId = sHit.id;
        state.selectedShapeIds.add(sHit.id);
        if (!sHit.locked) {
          pushShapeUndo();
          state.dragShape = {
            shape: sHit,
            startX: sToX(pos.x),
            startY: sToY(pos.y),
            origPts: sHit.rawPts.map((p) => ({ x: p.x, y: p.y })),
          };
          card.classList.add("panning");
        }
        notifyDomain();
        requestRender();
        return;
      }
      if (!multiMod && hitGroupBox(pos.x, pos.y)) {
        pushShapeUndo();
        const items = getSelectedMovableItems();
        state.dragGroup = {
          mode: "move",
          startX: sToX(pos.x),
          startY: sToY(pos.y),
          shapes: items.shapes.map((s) => ({ shape: s, origPts: s.rawPts.map((p) => ({ x: p.x, y: p.y })) })),
          points: items.points.map((p) => ({ point: p, origX: p.x, origY: p.y })),
        };
        card.classList.add("panning");
        requestRender();
        return;
      }
      if (!multiMod) clearSelection();
      state.marquee = {
        x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y,
        additive: multiMod,
        prevShapes: new Set(state.selectedShapeIds),
        prevPoints: new Set(state.selectedPointIds),
      };
      notifyDomain();
      requestRender();
      return;
    }

    const pHit = hitPoint(pos.x, pos.y);
    if (pHit) {
      clearSelection();
      state.selectedPointId = pHit.id;
      state.selectedPointIds.add(pHit.id);
      if (!pHit.locked) {
        pushShapeUndo();
        state.dragPoint = { point: pHit };
        card.classList.add("panning");
      }
      notifyDomain();
      requestRender();
      return;
    }
    const lHit = hitGuideLine(pos.x, pos.y);
    if (lHit) {
      clearSelection();
      state.selectedLineId = lHit.id;
      if (!lHit.locked) {
        pushShapeUndo();
        state.dragLine = { line: lHit };
        card.classList.add("panning");
      }
      notifyDomain();
      requestRender();
      return;
    }
    clearSelection();
    state.pan = { sx: pos.x, sy: pos.y, ov: { ...state.view } };
    card.classList.add("panning");
  });

  canvas.addEventListener("pointermove", (e) => {
    const pos = localPos(e);
    if (state.dragText) {
      const dt = state.dragText;
      const dx = pos.x - dt.startX;
      const dy = pos.y - dt.startY;
      if (Math.hypot(dx, dy) >= 2) dt.moved = true;
      const cw = canvas.clientWidth || 600, ch = canvas.clientHeight || 400;
      if (dt.mode === "resize") {
        dt.tb.width = Math.round(Math.max(150, Math.min(cw - 24, dt.origW + dx)));
        dt.tb.height = Math.round(Math.max(44, Math.min(ch - 24, dt.origH + dy)));
      } else if (dt.tb.anchor === "world") {
        const vw = Math.max(1e-9, state.view.xmax - state.view.xmin);
        const vh = Math.max(1e-9, state.view.ymax - state.view.ymin);
        dt.tb.x = Number((dt.origWorldX + (dx / cw) * vw).toFixed(4));
        dt.tb.y = Number((dt.origWorldY - (dy / ch) * vh).toFixed(4));
        dt.tb.xExpr = "";
        dt.tb.yExpr = "";
      } else {
        dt.tb.anchor = "free";
        dt.tb.nx = Number(Math.max(0.01, Math.min(0.95, (dt.origBx + dx) / cw)).toFixed(4));
        dt.tb.ny = Number(Math.max(0.01, Math.min(0.95, (dt.origBy + dy) / ch)).toFixed(4));
      }
      requestRender();
      return;
    }
    if (state.dragRotate) {
      const dr = state.dragRotate;
      const wx = sToX(pos.x), wy = sToY(pos.y);
      let dAng = Math.atan2(wy - dr.cy, wx - dr.cx) - dr.startAngle;
      if (e.shiftKey) {
        const snap = Math.PI / 12;
        dAng = Math.round(dAng / snap) * snap;
      }
      dr.angle = dAng;
      const cs = Math.cos(dAng), sn = Math.sin(dAng);
      for (const item of dr.shapes) {
        item.shape.rawPts = item.origPts.map((p) => {
          const rx = p.x - dr.cx, ry = p.y - dr.cy;
          return { x: dr.cx + rx * cs - ry * sn, y: dr.cy + rx * sn + ry * cs };
        });
      }
      for (const item of dr.points) {
        const rx = item.origX - dr.cx, ry = item.origY - dr.cy;
        item.point.x = Number((dr.cx + rx * cs - ry * sn).toFixed(4));
        item.point.y = Number((dr.cy + rx * sn + ry * cs).toFixed(4));
        if (ws() && typeof ws().syncPointCoords === "function") ws().syncPointCoords(item.point);
      }
      requestRender();
      return;
    }
    if (state.dragGroup) {
      const dg = state.dragGroup;
      const wx = sToX(pos.x), wy = sToY(pos.y);
      if (dg.mode === "move") {
        const dx = wx - dg.startX, dy = wy - dg.startY;
        for (const item of dg.shapes) {
          item.shape.rawPts = item.origPts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        }
        for (const item of dg.points) {
          item.point.x = Number((item.origX + dx).toFixed(4));
          item.point.y = Number((item.origY + dy).toFixed(4));
          if (ws() && typeof ws().syncPointCoords === "function") ws().syncPointCoords(item.point);
        }
      } else {
        const ob = dg.origBox;
        let nx0 = ob.xmin, nx1 = ob.xmax, ny0 = ob.ymin, ny1 = ob.ymax;
        const hid = dg.handleId;
        if (hid.includes("w")) nx0 = Math.min(nx1 - 0.04, wx);
        if (hid.includes("e")) nx1 = Math.max(nx0 + 0.04, wx);
        if (hid.includes("s")) ny0 = Math.min(ny1 - 0.04, wy);
        if (hid.includes("n")) ny1 = Math.max(ny0 + 0.04, wy);
        const ow = Math.max(1e-6, ob.xmax - ob.xmin), oh = Math.max(1e-6, ob.ymax - ob.ymin);
        const sxF = (nx1 - nx0) / ow, syF = (ny1 - ny0) / oh;
        for (const item of dg.shapes) {
          item.shape.rawPts = item.origPts.map((p) => ({
            x: nx0 + (p.x - ob.xmin) * sxF,
            y: ny0 + (p.y - ob.ymin) * syF,
          }));
        }
        for (const item of dg.points) {
          item.point.x = Number((nx0 + (item.origX - ob.xmin) * sxF).toFixed(4));
          item.point.y = Number((ny0 + (item.origY - ob.ymin) * syF).toFixed(4));
          if (ws() && typeof ws().syncPointCoords === "function") ws().syncPointCoords(item.point);
        }
      }
      requestRender();
      return;
    }
    if (state.dragResize) {
      const dr = state.dragResize;
      const sh = dr.shape;
      const h = dr.handle;
      const ob = dr.origBox;
      const sn = findRealSnapTarget(pos.x, pos.y, sh.id, null, e.shiftKey);
      state.snapHint = sn && sn.kind !== "grid" ? sn : null;
      const wx = sn ? sn.x : sToX(pos.x), wy = sn ? sn.y : sToY(pos.y);
      if (h.shapeKind === "circle") {
        const origR = Math.max(1e-6, 0.25 * ((ob.xmax - ob.xmin) + (ob.ymax - ob.ymin)));
        const r = Math.max(0.03, Math.hypot(wx - ob.cx, wy - ob.cy));
        const ratio = r / origR;
        sh.rawPts = dr.origPts.map((p) => ({
          x: ob.cx + (p.x - ob.cx) * ratio,
          y: ob.cy + (p.y - ob.cy) * ratio,
        }));
      } else if (h.shapeKind === "line") {
        const pts = dr.origPts.map((p) => ({ x: p.x, y: p.y }));
        if (h.id === "start") pts[0] = { x: wx, y: wy };
        else pts[pts.length - 1] = { x: wx, y: wy };
        sh.rawPts = pts;
      } else if (h.shapeKind === "polygon") {
        const pts = dr.origPts.map((p) => ({ x: p.x, y: p.y }));
        pts[h.vertexIndex] = { x: wx, y: wy };
        sh.rawPts = pts;
      } else if (h.shapeKind === "rect") {
        const rf = rectLocalFrame(dr.origPts);
        if (rf) {
          let uMin = -0.5 * rf.w, uMax = 0.5 * rf.w;
          let vMin = -0.5 * rf.h, vMax = 0.5 * rf.h;
          const dx = wx - rf.cx, dy = wy - rf.cy;
          const pu = dx * rf.ux + dy * rf.uy;
          const pv = dx * rf.vx + dy * rf.vy;
          if (h.id.includes("w")) uMin = Math.min(uMax - 0.03, pu);
          if (h.id.includes("e")) uMax = Math.max(uMin + 0.03, pu);
          if (h.id.includes("s")) vMin = Math.min(vMax - 0.03, pv);
          if (h.id.includes("n")) vMax = Math.max(vMin + 0.03, pv);
          const mk = (u, v) => ({ x: rf.cx + u * rf.ux + v * rf.vx, y: rf.cy + u * rf.uy + v * rf.vy });
          sh.rawPts = [mk(uMin, vMin), mk(uMax, vMin), mk(uMax, vMax), mk(uMin, vMax)];
        } else {
          let nx0 = ob.xmin, nx1 = ob.xmax, ny0 = ob.ymin, ny1 = ob.ymax;
          if (h.id.includes("w")) nx0 = Math.min(nx1 - 0.03, wx);
          if (h.id.includes("e")) nx1 = Math.max(nx0 + 0.03, wx);
          if (h.id.includes("s")) ny0 = Math.min(ny1 - 0.03, wy);
          if (h.id.includes("n")) ny1 = Math.max(ny0 + 0.03, wy);
          sh.rawPts = makeRealRect(nx0, ny0, nx1, ny1);
        }
      } else {
        let nx0 = ob.xmin, nx1 = ob.xmax, ny0 = ob.ymin, ny1 = ob.ymax;
        if (h.id.includes("w")) nx0 = Math.min(nx1 - 0.03, wx);
        if (h.id.includes("e")) nx1 = Math.max(nx0 + 0.03, wx);
        if (h.id.includes("s")) ny0 = Math.min(ny1 - 0.03, wy);
        if (h.id.includes("n")) ny1 = Math.max(ny0 + 0.03, wy);
        const ow = Math.max(1e-6, ob.xmax - ob.xmin), oh = Math.max(1e-6, ob.ymax - ob.ymin);
        let sxF = (nx1 - nx0) / ow, syF = (ny1 - ny0) / oh;
        if (e.shiftKey) {
          const u = Math.max(sxF, syF);
          sxF = u; syF = u;
        }
        sh.rawPts = dr.origPts.map((p) => ({
          x: ob.cx + (p.x - ob.cx) * sxF,
          y: ob.cy + (p.y - ob.cy) * syF,
        }));
      }
      requestRender();
      return;
    }
    if (state.marquee) {
      const m = state.marquee;
      m.x1 = pos.x; m.y1 = pos.y;
      const sx0 = Math.min(m.x0, m.x1), sx1 = Math.max(m.x0, m.x1);
      const sy0 = Math.min(m.y0, m.y1), sy1 = Math.max(m.y0, m.y1);
      const nextS = m.additive ? new Set(m.prevShapes) : new Set();
      const nextP = m.additive ? new Set(m.prevPoints) : new Set();
      for (const s of state.shapes) {
        if (!s.visible || !s.rawPts || s.rawPts.length < 2) continue;
        const bb = bboxOf(s.rawPts);
        const cx = xToS(bb.cx), cy = yToS(bb.cy);
        if (cx >= sx0 && cx <= sx1 && cy >= sy0 && cy <= sy1) nextS.add(s.id);
      }
      for (const p of state.points) {
        if (!p.visible) continue;
        const px = xToS(p.x), py = yToS(p.y);
        if (px >= sx0 && px <= sx1 && py >= sy0 && py <= sy1) nextP.add(p.id);
      }
      state.selectedShapeIds = nextS;
      state.selectedPointIds = nextP;
      syncPrimarySelection();
      requestRender();
      return;
    }
    if (!state.pan && !state.drawing && !state.dragShape && !state.dragPoint && !state.dragLine) {
      if (window.CFVAnnotations && state.texts.length > 0) {
        const th = window.CFVAnnotations.hitTestTextBoxes(ctx, canvas, state.texts, pos.x, pos.y, {});
        const nextHov = th ? th.tb.id : null;
        if (nextHov !== state.hoveredTextId) {
          state.hoveredTextId = nextHov;
          requestRender();
        }
        if (th && !th.tb.locked) {
          canvas.style.cursor = th.hit === "resize" ? "nwse-resize" : "grab";
          state.hoverPx = pos.x; state.hoverX = sToX(pos.x);
          updateLegend(); requestRender();
          return;
        }
      }
      if (state.polyTool === "move") {
        if (hitRotateHandle(pos.x, pos.y)) { canvas.style.cursor = "grab"; }
        else {
          const gh = hitGroupHandle(pos.x, pos.y);
          const hh = gh ? gh.handle : (hitResizeHandle(pos.x, pos.y)?.handle || null);
          if (hh) canvas.style.cursor = hh.cursor;
          else if (hitGroupBox(pos.x, pos.y) || hitPoint(pos.x, pos.y) || hitGuideLine(pos.x, pos.y) || hitRealShape(pos.x, pos.y)) canvas.style.cursor = "move";
          else canvas.style.cursor = "default";
        }
      } else if (canvas.style.cursor) {
        canvas.style.cursor = "";
      }
    }
    if (state.polyDraft) {
      const sn = findRealSnapTarget(pos.x, pos.y);
      state.snapHint = sn;
      state.polyDraft.hoverPt = sn ? { x: sn.x, y: sn.y } : { x: sToX(pos.x), y: sToY(pos.y) };
      requestRender();
      return;
    }
    if (state.drawing) {
      const d = state.drawing;
      const sn = d.kind === "freehand" ? null : findRealSnapTarget(pos.x, pos.y, null, null, e.shiftKey);
      state.snapHint = sn && sn.kind !== "grid" ? sn : null;
      const cur = sn ? { x: sn.x, y: sn.y } : { x: sToX(pos.x), y: sToY(pos.y) };
      if (d.kind === "freehand") {
        const last = d.rawPts[d.rawPts.length - 1];
        if (Math.hypot(xToS(cur.x) - xToS(last.x), yToS(cur.y) - yToS(last.y)) >= 4) {
          d.rawPts.push(cur);
        }
        d.snapActive = d.rawPts.length >= 8 && Math.hypot(pos.x - xToS(d.rawPts[0].x), pos.y - yToS(d.rawPts[0].y)) <= 16;
      } else if (d.kind === "line" || d.kind === "seg" || d.kind === "ray" || d.kind === "infline") {
        d.rawPts = [d.start, cur];
      } else if (d.kind === "arc") {
        const r = Math.max(1e-4, Math.hypot(cur.x - d.start.x, cur.y - d.start.y));
        const a0 = Math.atan2(cur.y - d.start.y, cur.x - d.start.x);
        d.rawPts = [];
        for (let i = 0; i <= 48; i++) {
          const ang = a0 + (i / 48) * Math.PI;
          d.rawPts.push({ x: d.start.x + r * Math.cos(ang), y: d.start.y + r * Math.sin(ang) });
        }
      } else if (d.kind === "circle") {
        const r = Math.hypot(cur.x - d.start.x, cur.y - d.start.y);
        d.rawPts = makeRealCircle(d.start.x, d.start.y, Math.max(1e-4, r));
      } else if (d.kind === "rect") {
        d.rawPts = makeRealRect(d.start.x, d.start.y, cur.x, cur.y);
      }
      requestRender();
      return;
    }
    if (state.dragShape) {
      const ds = state.dragShape;
      const dx = sToX(pos.x) - ds.startX;
      const dy = sToY(pos.y) - ds.startY;
      ds.shape.rawPts = ds.origPts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      requestRender();
      return;
    }
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
      const sn = findRealSnapTarget(pos.x, pos.y, null, pt.id);
      state.snapHint = sn;
      pt.x = Number((sn ? sn.x : sToX(pos.x)).toFixed(4));
      pt.y = Number((sn ? sn.y : sToY(pos.y)).toFixed(4));
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
    if (state.dragText) {
      const moved = state.dragText.moved;
      state.dragText = null;
      canvas.style.cursor = "";
      if (moved) {
        notifyDomain();
        notifyState(true, true);
      }
      requestRender();
      return;
    }
    if (state.drawing) {
      const d = state.drawing;
      state.drawing = null;
      state.snapHint = null;
      const endPos = localPos(e);
      const dragDistPx = d.startPx ? Math.hypot(endPos.x - d.startPx.x, endPos.y - d.startPx.y) : 99;
      if (dragDistPx < 5 && d.kind !== "freehand") {
        const rx = Math.max(0.2, (state.view.xmax - state.view.xmin) * 0.12);
        const ry = Math.max(0.2, (state.view.ymax - state.view.ymin) * 0.12);
        const r = Math.min(rx, ry);
        const ax = d.start.x, ay = d.start.y;
        if (d.kind === "circle") { d.rawPts = makeRealCircle(ax, ay, r); d.closed = true; }
        else if (d.kind === "rect") { d.rawPts = makeRealRect(ax - r, ay - r * 0.72, ax + r, ay + r * 0.72); d.closed = true; }
        else if (d.kind === "arc") {
          d.rawPts = [];
          for (let i = 0; i <= 48; i++) {
            const ang = (i / 48) * Math.PI;
            d.rawPts.push({ x: ax + r * Math.cos(ang), y: ay + r * Math.sin(ang) });
          }
          d.closed = false;
        } else if (d.kind === "ray") {
          d.rawPts = [{ x: ax, y: ay }, { x: ax + rx, y: ay }];
          d.closed = false;
        } else {
          d.rawPts = [{ x: ax - rx, y: ay }, { x: ax + rx, y: ay }];
          d.closed = false;
        }
      }
      const hasSpan = d.rawPts && d.rawPts.length >= 2 && (
        d.rawPts.length > 2 ||
        Math.hypot(xToS(d.rawPts[1].x) - xToS(d.rawPts[0].x), yToS(d.rawPts[1].y) - yToS(d.rawPts[0].y)) >= 3
      );
      if (hasSpan) {
        const lbl =
          d.kind === "infline" ? "Line" :
          d.kind === "ray" ? "Ray" :
          d.kind === "seg" || d.kind === "line" ? "Segment" :
          d.kind === "arc" ? "Arc" : undefined;
        addShape({
          kind: d.kind,
          label: lbl,
          color: d.color,
          closed: (d.kind === "ray" || d.kind === "infline") ? false : (d.closed || d.snapActive),
          rawPts: d.rawPts,
        });
      } else {
        requestRender();
      }
      return;
    }
    if (state.dragRotate) { state.dragRotate = null; card.classList.remove("panning"); notifyDomain(); notifyState(true, true); requestRender(); return; }
    if (state.dragGroup) { state.dragGroup = null; card.classList.remove("panning"); notifyDomain(); notifyState(true, true); requestRender(); return; }
    if (state.dragResize) { state.dragResize = null; notifyDomain(); notifyState(true, true); requestRender(); return; }
    if (state.marquee) { state.marquee = null; notifyDomain(); requestRender(); return; }
    if (state.dragShape) { state.dragShape = null; card.classList.remove("panning"); notifyDomain(); notifyState(true, true); return; }
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
    if (state.dragPoint) { state.dragPoint = null; state.snapHint = null; card.classList.remove("panning"); notifyDomain(); notifyState(true, true); requestRender(); return; }
    if (state.dragLine) { state.dragLine = null; card.classList.remove("panning"); notifyDomain(); notifyState(true, true); return; }
    if (state.pan) {
      const p = state.pan;
      state.pan = null;
      card.classList.remove("panning");
      const pos = localPos(e);
      if (p.rightClick && Math.hypot(pos.x - p.sx, pos.y - p.sy) < 5) {
        const tbHit = window.CFVAnnotations && state.texts.length > 0
          ? window.CFVAnnotations.hitTestTextBoxes(ctx, canvas, state.texts, pos.x, pos.y, {})
          : null;
        if (tbHit && ws() && typeof ws().openItemSettingsAt === "function") {
          selectTextBox(tbHit.tb.id);
          ws().openItemSettingsAt("text", tbHit.tb.id, e.clientX, e.clientY);
          return;
        }
        const hit = hitRealElement(pos.x, pos.y);
        if (hit && ws() && typeof ws().openItemSettingsAt === "function") {
          if (hit.kind === "shape") selectShape(hit.id);
          else if (hit.kind === "point") selectPoint(hit.id);
          else if (hit.kind === "guide_line") selectGuideLine(hit.id);
          ws().openItemSettingsAt(hit.kind, hit.id, e.clientX, e.clientY);
          return;
        }
      }
      scheduleSample(true);
      notifyState(false, false);
    }
  });

  canvas.addEventListener("dblclick", () => { if (state.polyDraft) finishPolyDraft(); });

  /* 2D Real Dock & Selection Banner Buttons + Keyboard Shortcuts */
  document.querySelectorAll(".real-dock-tool").forEach((b) => {
    b.addEventListener("click", () => setPolyTool(b.dataset.realTool));
  });
  const btnRealCloseShape = document.getElementById("btn-real-close-shape");
  const btnRealUndoShape = document.getElementById("btn-real-undo-shape");
  const btnRealClearShapes = document.getElementById("btn-real-clear-shapes");
  if (btnRealCloseShape) btnRealCloseShape.addEventListener("click", () => toggleCloseShape());
  if (btnRealUndoShape) btnRealUndoShape.addEventListener("click", () => undoRealAction());
  if (btnRealClearShapes) btnRealClearShapes.addEventListener("click", () => clearShapes());

  /* Draggable, Minimizable & Resizable Curves & Relations Legend Panel (mirrors Contour Integrals) */
  if (btnMinRealLegend && legendCard) {
    btnMinRealLegend.addEventListener("click", (ev) => {
      ev.stopPropagation();
      realLegendMinimized = !realLegendMinimized;
      if (realLegendMinimized) {
        savedRealLegendSize = { w: legendCard.style.width, h: legendCard.style.height, mh: legendCard.style.maxHeight };
        legendCard.style.width = "";
        legendCard.style.height = "";
      } else if (savedRealLegendSize) {
        legendCard.style.width = savedRealLegendSize.w || "";
        legendCard.style.height = savedRealLegendSize.h || "";
        legendCard.style.maxHeight = savedRealLegendSize.mh || "";
      }
      legendCard.classList.toggle("minimized", realLegendMinimized);
      btnMinRealLegend.textContent = realLegendMinimized ? "+" : "−";
    });
  }
  if (realLegendResizeHandle && legendCard) {
    let rlRes = null;
    realLegendResizeHandle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cardRect = card.getBoundingClientRect();
      const panelRect = legendCard.getBoundingClientRect();
      const startLeft = panelRect.left - cardRect.left;
      const startTop = panelRect.top - cardRect.top;
      legendCard.style.left = `${startLeft}px`;
      legendCard.style.top = `${startTop}px`;
      legendCard.style.right = "auto";
      legendCard.style.bottom = "auto";
      rlRes = { startX: e.clientX, startY: e.clientY, startW: panelRect.width, startH: panelRect.height, startLeft, startTop };
      legendCard.classList.add("dragging");
      if (realLegendResizeHandle.setPointerCapture) realLegendResizeHandle.setPointerCapture(e.pointerId);
    });
    realLegendResizeHandle.addEventListener("pointermove", (e) => {
      if (!rlRes) return;
      const maxW = Math.max(200, card.clientWidth - rlRes.startLeft - 8);
      const maxH = Math.max(90, card.clientHeight - rlRes.startTop - 8);
      const nw = Math.max(195, Math.min(maxW, rlRes.startW + (e.clientX - rlRes.startX)));
      const nh = Math.max(82, Math.min(maxH, rlRes.startH + (e.clientY - rlRes.startY)));
      legendCard.style.width = `${Math.round(nw)}px`;
      legendCard.style.height = `${Math.round(nh)}px`;
      legendCard.style.maxWidth = "none";
      legendCard.style.maxHeight = "none";
    });
    const endRlRes = () => {
      if (!rlRes) return;
      rlRes = null;
      legendCard.classList.remove("dragging");
    };
    realLegendResizeHandle.addEventListener("pointerup", endRlRes);
    realLegendResizeHandle.addEventListener("pointercancel", endRlRes);
  }
  if (legendHdr && legendCard) {
    let rlDrag = null;
    legendHdr.addEventListener("pointerdown", (e) => {
      if (e.target && e.target.closest && e.target.closest("#btn-min-real-legend")) return;
      e.preventDefault();
      e.stopPropagation();
      const cardRect = card.getBoundingClientRect();
      const panelRect = legendCard.getBoundingClientRect();
      const startLeft = panelRect.left - cardRect.left;
      const startTop = panelRect.top - cardRect.top;
      legendCard.style.left = `${startLeft}px`;
      legendCard.style.top = `${startTop}px`;
      legendCard.style.right = "auto";
      legendCard.style.bottom = "auto";
      rlDrag = { startX: e.clientX, startY: e.clientY, startLeft, startTop };
      legendCard.classList.add("dragging");
      if (legendHdr.setPointerCapture) legendHdr.setPointerCapture(e.pointerId);
    });
    legendHdr.addEventListener("pointermove", (e) => {
      if (!rlDrag) return;
      const maxL = Math.max(6, card.clientWidth - legendCard.offsetWidth - 6);
      const maxT = Math.max(6, card.clientHeight - legendCard.offsetHeight - 6);
      const nl = Math.max(6, Math.min(maxL, rlDrag.startLeft + (e.clientX - rlDrag.startX)));
      const nt = Math.max(6, Math.min(maxT, rlDrag.startTop + (e.clientY - rlDrag.startY)));
      legendCard.style.left = `${Math.round(nl)}px`;
      legendCard.style.top = `${Math.round(nt)}px`;
    });
    const endRlDrag = () => {
      if (!rlDrag) return;
      rlDrag = null;
      legendCard.classList.remove("dragging");
    };
    legendHdr.addEventListener("pointerup", endRlDrag);
    legendHdr.addEventListener("pointercancel", endRlDrag);
  }
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
    if (!state.active || (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable))) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
      if (state.shapeUndoStack.length > 0 || state.polyUndoStack.length > 0) {
        e.preventDefault();
        undoRealAction();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      if (state.polygons.length > 0) {
        e.preventDefault();
        selectAllPolygons();
      } else if (state.shapes.length > 0 || state.points.length > 0) {
        e.preventDefault();
        state.selectedShapeIds = new Set(state.shapes.filter((s) => s.visible !== false).map((s) => s.id));
        state.selectedPointIds = new Set(state.points.filter((p) => p.visible !== false).map((p) => p.id));
        syncPrimarySelection();
        notifyDomain();
        requestRender();
      }
      return;
    }
    if (e.key === "Escape") {
      clearPolySelection();
      clearSelection();
      state.polyDraft = null;
      notifyDomain();
      requestRender();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (state.selectedPolyIds.size > 0) {
        e.preventDefault();
        deleteSelectedPolygons();
      } else if (deleteSelectedItems()) {
        e.preventDefault();
      }
      return;
    }
    if (e.code === "Space") { state.spaceHeld = true; updatePolyUI(); }
    else if (state.polygons.length > 0) {
      if (e.key === "v" || e.key === "V") setPolyTool("select");
      else if (e.key === "d" || e.key === "D") setPolyTool("deselect");
      else if (e.key === "a" || e.key === "A") setPolyTool("add");
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") { state.spaceHeld = false; updatePolyUI(); }
  });
  canvas.addEventListener("pointerleave", () => { state.hoverX = null; state.hoverPx = null; state.snapHint = null; updateLegend(); requestRender(); });
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

  if (window.CFVGeom && typeof window.CFVGeom.attachPinchController === "function") {
    window.CFVGeom.attachPinchController(canvas, {
      onPinch(factor, sx, sy) {
        const f = 1 / Math.max(0.5, Math.min(2.0, factor));
        const wx = sToX(sx), wy = sToY(sy);
        state.view.xmin = wx + (state.view.xmin - wx) * f;
        state.view.xmax = wx + (state.view.xmax - wx) * f;
        state.view.ymin = wy + (state.view.ymin - wy) * f;
        state.view.ymax = wy + (state.view.ymax - wy) * f;
        requestRender(); scheduleSample(false);
      },
      onTwoFingerPan(dx, dy) {
        const w = canvas.clientWidth || 600, h = canvas.clientHeight || 400;
        const dWorldX = -(dx / w) * (state.view.xmax - state.view.xmin);
        const dWorldY = (dy / h) * (state.view.ymax - state.view.ymin);
        state.view.xmin += dWorldX; state.view.xmax += dWorldX;
        state.view.ymin += dWorldY; state.view.ymax += dWorldY;
        requestRender(); scheduleSample(false);
      },
    });
  }

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
    if (!silent) pushShapeUndo();
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
    clearSelection();
    state.selectedPointId = p.id;
    state.selectedPointIds.add(p.id);
    notifyDomain();
    if (!silent) notifyState(true);
    requestRender();
    return p;
  }

  function deletePoint(id) {
    const target = state.points.find((p) => p.id === id);
    if (!target || target.locked) return;
    pushShapeUndo();
    state.points = state.points.filter((p) => p.id !== id);
    state.selectedPointIds.delete(id);
    syncPrimarySelection();
    notifyDomain();
    notifyState(true);
    requestRender();
  }

  function selectPoint(id) {
    clearSelection();
    state.selectedPointId = id;
    if (id !== null && id !== undefined) state.selectedPointIds.add(id);
    notifyDomain();
    requestRender();
  }

  function addGuideLine(opts = {}, silent = false) {
    if (!silent) pushShapeUndo();
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
    clearSelection();
    state.selectedLineId = ln.id;
    notifyDomain();
    if (!silent) notifyState(true);
    requestRender();
    return ln;
  }

  function deleteGuideLine(id) {
    const target = state.lines.find((l) => l.id === id);
    if (!target || target.locked) return;
    pushShapeUndo();
    state.lines = state.lines.filter((l) => l.id !== id);
    if (state.selectedLineId === id) state.selectedLineId = null;
    notifyDomain();
    notifyState(true);
    requestRender();
  }

  function selectGuideLine(id) {
    clearSelection();
    state.selectedLineId = id;
    notifyDomain();
    requestRender();
  }

  function addQuickShape(kind) {
    const cx = 0.5 * (state.view.xmin + state.view.xmax);
    const cy = 0.5 * (state.view.ymin + state.view.ymax);
    const r = Math.max(0.25, 0.2 * Math.min(state.view.xmax - state.view.xmin, state.view.ymax - state.view.ymin));
    const rawPts = [];
    let closed = false, label = "Segment";
    if (kind === "arc") {
      label = `Arc (${state.shapes.length + 1})`;
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI;
        rawPts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
    } else if (kind === "circle") {
      label = `Circle (${state.shapes.length + 1})`;
      closed = true;
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        rawPts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
    } else if (kind === "rect") {
      label = `Rect (${state.shapes.length + 1})`;
      closed = true;
      rawPts.push({ x: cx - r, y: cy - r * 0.75 }, { x: cx + r, y: cy - r * 0.75 }, { x: cx + r, y: cy + r * 0.75 }, { x: cx - r, y: cy + r * 0.75 });
    } else {
      label = `Segment (${state.shapes.length + 1})`;
      rawPts.push({ x: cx - r * 1.2, y: cy }, { x: cx + r * 1.2, y: cy });
    }
    return addShape({ kind: kind === "line" ? "line" : kind, label, rawPts, closed }, false);
  }

  function addTextBox(opts = {}, silent = false) {
    if (!silent) pushShapeUndo();
    const cx = 0.5 * (state.view.xmin + state.view.xmax);
    const cy = 0.5 * (state.view.ymin + state.view.ymax);
    const tb = {
      id: state.nextTextId++,
      kind: "text",
      title: opts.title !== undefined ? String(opts.title) : "Note",
      text: opts.text !== undefined ? String(opts.text) : "Explain the theorem or what to explore here…",
      anchor: opts.anchor || "bottom-left",
      x: opts.x !== undefined ? Number(opts.x) : Number(cx.toFixed(3)),
      y: opts.y !== undefined ? Number(opts.y) : Number(cy.toFixed(3)),
      nx: Number.isFinite(Number(opts.nx)) ? Number(opts.nx) : undefined,
      ny: Number.isFinite(Number(opts.ny)) ? Number(opts.ny) : undefined,
      xExpr: opts.xExpr ? String(opts.xExpr) : "",
      yExpr: opts.yExpr ? String(opts.yExpr) : "",
      color: opts.color || "#38bdf8",
      width: Number(opts.width || opts.maxWidth) || 305,
      height: Number(opts.height) > 0 ? Number(opts.height) : 0,
      fontSize: Number(opts.fontSize) || 12,
      opacity: normOpacity(opts.opacity, 0.94),
      locked: Boolean(opts.locked),
      visible: opts.visible !== undefined ? Boolean(opts.visible) : true,
      collapsed: Boolean(opts.collapsed),
      cardHeight: Number(opts.cardHeight) > 0 ? Number(opts.cardHeight) : 0,
    };
    state.texts.push(tb);
    clearSelection();
    state.selectedTextId = tb.id;
    notifyDomain();
    if (!silent) notifyState(true);
    requestRender();
    return tb;
  }

  function deleteTextBox(id) {
    const target = state.texts.find((t) => t.id === id);
    if (!target || target.locked) return;
    pushShapeUndo();
    state.texts = state.texts.filter((t) => t.id !== id);
    if (state.selectedTextId === id) state.selectedTextId = null;
    notifyDomain();
    notifyState(true);
    requestRender();
  }

  function selectTextBox(id) {
    clearSelection();
    state.selectedTextId = id;
    notifyDomain();
    requestRender();
  }

  function r4(n) { return Math.round((Number(n) || 0) * 10000) / 10000; }

  function exportSnapshot() {
    const ordered = getOrderedElements();
    const shIdx = new Map(state.shapes.map((s, i) => [s.id, i]));
    const ptIdx = new Map(state.points.map((p, i) => [p.id, i]));
    const lnIdx = new Map(state.lines.map((l, i) => [l.id, i]));
    const txIdx = new Map(state.texts.map((t, i) => [t.id, i]));
    const lo = ordered.map((e) => (
      e.kind === "shape" ? `s:${shIdx.get(e.id)}` :
      e.kind === "point" ? `p:${ptIdx.get(e.id)}` :
      e.kind === "text" ? `t:${txIdx.get(e.id)}` : `l:${lnIdx.get(e.id)}`
    ));
    const snap = {
      vw: [r4(state.view.xmin), r4(state.view.xmax), r4(state.view.ymin), r4(state.view.ymax)],
      sq: state.squareAspect ? 1 : 0,
      cs: state.coordSystem || "cartesian",
      sp: state.showPrimes ? 1 : 0,
      sz: state.showZeros ? 1 : 0,
      lo,
      sh: state.shapes.map((s) => ({
        k: s.kind || "polygon",
        l: s.label || "",
        c: s.color || "#38bdf8",
        w: normLineWidth(s.lineWidth, 2.2),
        op: r4(normOpacity(s.opacity, s.closed ? 0.22 : 1.0)),
        st: s.lineStyle || "solid",
        cl: s.closed ? 1 : 0,
        lk: s.locked ? 1 : 0,
        v: s.visible !== false ? 1 : 0,
        ...(s.collapsed ? { col: 1 } : {}),
        ...(Number(s.cardHeight) > 0 ? { ch: Math.round(Number(s.cardHeight)) } : {}),
        p: (s.rawPts || []).reduce((acc, q) => { acc.push(r4(q.x), r4(q.y)); return acc; }, []),
      })),
      pt: state.points.map((p) => ({
        x: r4(p.x), y: r4(p.y),
        ...(p.xExpr ? { xe: p.xExpr } : {}),
        ...(p.yExpr ? { ye: p.yExpr } : {}),
        l: p.label || "", i: p.icon || "dot", c: p.color || "#34d399",
        s: Number(p.size) || 5, op: r4(normOpacity(p.opacity, 1.0)),
        lk: p.locked ? 1 : 0, v: p.visible !== false ? 1 : 0, sl: p.showLabel !== false ? 1 : 0,
        ...(p.collapsed ? { col: 1 } : {}),
        ...(Number(p.cardHeight) > 0 ? { ch: Math.round(Number(p.cardHeight)) } : {}),
      })),
      ln: state.lines.map((ln) => ({
        o: ln.orientation === "horizontal" ? "h" : "v", val: r4(ln.value),
        ...(ln.valExpr ? { ve: ln.valExpr } : {}),
        l: ln.label || "", c: ln.color || "#fbbf24", w: normLineWidth(ln.lineWidth, 1.5),
        op: r4(normOpacity(ln.opacity, 1.0)),
        st: ln.lineStyle || "dashed", lk: ln.locked ? 1 : 0, v: ln.visible !== false ? 1 : 0, sl: ln.showLabel !== false ? 1 : 0,
        ...(ln.collapsed ? { col: 1 } : {}),
        ...(Number(ln.cardHeight) > 0 ? { ch: Math.round(Number(ln.cardHeight)) } : {}),
      })),
      tx: state.texts.map((tb) => ({
        t: tb.title || "", b: tb.text || "", a: tb.anchor || "bottom-left",
        x: r4(tb.x || 0), y: r4(tb.y || 0),
        ...(Number.isFinite(Number(tb.nx)) ? { nx: r4(Number(tb.nx)) } : {}),
        ...(Number.isFinite(Number(tb.ny)) ? { ny: r4(Number(tb.ny)) } : {}),
        ...(tb.xExpr ? { xe: tb.xExpr } : {}),
        ...(tb.yExpr ? { ye: tb.yExpr } : {}),
        c: tb.color || "#38bdf8", w: Number(tb.width) || 305,
        ...(Number(tb.height) > 0 ? { h: Math.round(Number(tb.height)) } : {}),
        fs: Number(tb.fontSize) || 12,
        op: r4(normOpacity(tb.opacity, 0.94)), lk: tb.locked ? 1 : 0, v: tb.visible !== false ? 1 : 0,
        ...(tb.collapsed ? { col: 1 } : {}),
        ...(Number(tb.cardHeight) > 0 ? { ch: Math.round(Number(tb.cardHeight)) } : {}),
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
        if (parts[0] === "s" && state.shapes[idx]) state.layerOrder.push({ kind: "shape", id: state.shapes[idx].id });
        else if (parts[0] === "p" && state.points[idx]) state.layerOrder.push({ kind: "point", id: state.points[idx].id });
        else if (parts[0] === "l" && state.lines[idx]) state.layerOrder.push({ kind: "guide_line", id: state.lines[idx].id });
        else if (parts[0] === "t" && state.texts[idx]) state.layerOrder.push({ kind: "text", id: state.texts[idx].id });
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
    setCoordSystem(snap.cs || "cartesian", true);
    const sqBtn = document.getElementById("real-square");
    if (sqBtn) sqBtn.classList.toggle("active", wantSq);
    if (wantSq) enforceSquareView(true);
    state.shapes = (snap.sh || []).map((s) => {
      const pts = [];
      const flat = Array.isArray(s.p) ? s.p : [];
      for (let i = 0; i + 1 < flat.length; i += 2) pts.push({ x: Number(flat[i]) || 0, y: Number(flat[i + 1]) || 0 });
      const closed = Boolean(s.cl);
      return {
        id: state.nextShapeId++,
        kind: s.k || "polygon",
        label: s.l || "Shape",
        color: s.c || "#38bdf8",
        lineWidth: normLineWidth(s.w, 2.2),
        opacity: normOpacity(s.op, closed ? 0.22 : 1.0),
        lineStyle: s.st || "solid",
        closed,
        locked: Boolean(s.lk),
        visible: s.v !== 0,
        collapsed: Boolean(s.col),
        cardHeight: Number(s.ch) > 0 ? Number(s.ch) : 0,
        rawPts: pts,
      };
    });
    state.points = (snap.pt || []).map((p) => ({
      id: state.nextPointId++,
      kind: "point",
      x: Number(p.x) || 0,
      y: Number(p.y) || 0,
      xExpr: p.xe ? String(p.xe) : "",
      yExpr: p.ye ? String(p.ye) : "",
      label: p.l || "",
      icon: p.i || "diamond",
      color: p.c || "#34d399",
      size: Number(p.s) || 5,
      opacity: normOpacity(p.op, 1.0),
      locked: Boolean(p.lk),
      visible: p.v !== 0,
      showLabel: p.sl !== 0,
      collapsed: Boolean(p.col),
      cardHeight: Number(p.ch) > 0 ? Number(p.ch) : 0,
    }));
    state.lines = (snap.ln || []).map((ln) => ({
      id: state.nextLineId++,
      kind: "guide_line",
      orientation: ln.o === "h" ? "horizontal" : "vertical",
      value: Number(ln.val) || 0,
      valExpr: ln.ve ? String(ln.ve) : "",
      label: ln.l || "",
      color: ln.c || "#fbbf24",
      lineWidth: normLineWidth(ln.w, 1.5),
      opacity: normOpacity(ln.op, 1.0),
      lineStyle: ln.st || "dashed",
      locked: Boolean(ln.lk),
      visible: ln.v !== 0,
      showLabel: ln.sl !== 0,
      collapsed: Boolean(ln.col),
      cardHeight: Number(ln.ch) > 0 ? Number(ln.ch) : 0,
    }));
    state.texts = (snap.tx || []).map((tb) => ({
      id: state.nextTextId++,
      kind: "text",
      title: tb.t || "",
      text: tb.b || "",
      anchor: tb.a || "bottom-left",
      x: Number(tb.x) || 0,
      y: Number(tb.y) || 0,
      nx: Number.isFinite(Number(tb.nx)) ? Number(tb.nx) : undefined,
      ny: Number.isFinite(Number(tb.ny)) ? Number(tb.ny) : undefined,
      xExpr: tb.xe ? String(tb.xe) : "",
      yExpr: tb.ye ? String(tb.ye) : "",
      color: tb.c || "#38bdf8",
      width: Number(tb.w) || 305,
      height: Number(tb.h) > 0 ? Number(tb.h) : 0,
      fontSize: Number(tb.fs) || 12,
      opacity: normOpacity(tb.op, 0.94),
      locked: Boolean(tb.lk),
      visible: tb.v !== 0,
      collapsed: Boolean(tb.col),
      cardHeight: Number(tb.ch) > 0 ? Number(tb.ch) : 0,
    }));
    applyLayerRefs(snap.lo);
    state.polyUndoStack = [];
    state.shapeUndoStack = [];
    if (Array.isArray(snap.pg) && snap.pg.length >= 2) {
      const cells = [];
      for (let i = 0; i + 1 < snap.pg.length; i += 2) cells.push([snap.pg[i], snap.pg[i + 1]]);
      setPolygonsFromCells(cells, { silentUndo: true });
      setPolyTool("select");
    } else {
      state.polygons = [];
      state.polyGridMap.clear();
      state.selectedPolyIds.clear();
      setPolyTool("move");
    }
    clearSelection();
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
    addShape,
    addQuickShape,
    deleteShape,
    selectShape,
    toggleCloseShape,
    undoShapeAction,
    undoRealAction,
    redoRealAction,
    deleteSelectedItems,
    clearShapes,
    addPoint,
    deletePoint,
    selectPoint,
    addGuideLine,
    deleteGuideLine,
    selectGuideLine,
    addTextBox,
    deleteTextBox,
    selectTextBox,
    rebuildFormulaElements,
    rebuildShapeFromFormula,
    getOrderedElements,
    reorderElement,
    moveElementLayer,
    setPolyTool,
    setCoordSystem,
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
      state.shapes = [];
      state.points = [];
      state.lines = [];
      state.texts = [];
      clearSelection();
      state.layerOrder = [];
      state.polygons = [];
      state.polyGridMap.clear();
      state.selectedPolyIds.clear();
      state.polyUndoStack = [];
      state.shapeUndoStack = [];
      state.shapeRedoStack = [];
      state.drawing = null;
      state.polyDraft = null;
      state.polyTool = "move";
      setCoordSystem("cartesian", true);
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
    setTool(t) { setPolyTool(t); },
    async recomputeImageElements() {
      const w = ws();
      if (!w || !w.state) return;
      const evalRealPts = async (fnCardId, expr, pts) => {
        const fc = w.resolveFnCardByNameOrId ? w.resolveFnCardByNameOrId(expr || "", fnCardId) : null;
        const slot = fc && typeof fc.slot === "number" ? fc.slot : 0;
        const params = w.getParamValues ? w.getParamValues() : [];
        const out = [];
        for (const p of pts) {
          try {
            const res = await fetch("/api/workspace/real_sample", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ slot, xmin: p.x - 1e-4, xmax: p.x + 1e-4, samples: 8, params }),
            });
            if (res.ok) {
              const d = await res.json();
              const ys = d && d.ys ? d.ys : [];
              const mid = ys[Math.floor(ys.length / 2)];
              out.push(mid !== null && Number.isFinite(Number(mid)) ? { x: p.x, y: Number(mid) } : { x: p.x, y: p.y });
            } else out.push({ x: p.x, y: p.y });
          } catch (_) { out.push({ x: p.x, y: p.y }); }
        }
        return out;
      };
      for (const p of state.points) {
        if (!p.visible || !p.imageOf) continue;
        const src = state.points.find((q) => q.id === p.imageOf.sourceId);
        if (!src) continue;
        const mp = await evalRealPts(p.imageOf.fnCardId, p.imageOf.expr, [{ x: src.x, y: src.y }]);
        if (mp && mp[0]) { p.x = mp[0].x; p.y = mp[0].y; }
      }
      for (const s of state.shapes) {
        if (!s.visible || !s.imageOf) continue;
        const src = state.shapes.find((q) => q.id === s.imageOf.sourceId);
        if (!src || !src.rawPts || src.rawPts.length < 2) continue;
        const step = Math.max(1, Math.floor(src.rawPts.length / 24));
        const samplePts = src.rawPts.filter((_, idx) => idx % step === 0 || idx === src.rawPts.length - 1);
        const mp = await evalRealPts(s.imageOf.fnCardId, s.imageOf.expr, samplePts);
        if (mp && mp.length >= 2) { s.rawPts = mp; s.closed = Boolean(src.closed); }
      }
      requestRender();
    },
    async createImageFromSources(sources, def = {}) {
      if (!Array.isArray(sources) || sources.length === 0) return null;
      if (sources.length === 1 && sources[0].kind === "point") {
        const src = state.points.find((p) => p.id === sources[0].id);
        if (!src) return null;
        const img = {
          id: state.nextPointId++, x: src.x, y: src.y,
          label: `${def.labelPrefix || "f"}(${src.label || "P"})`, icon: "diamond", color: "#fbbf24",
          size: 6, opacity: 1.0, locked: false, visible: true, showLabel: true,
          imageOf: { sourceKind: "point", sourceId: src.id, sources: sources.map((s) => ({ ...s })), fnCardId: def.fnCardId ?? null, expr: def.expr || "f1(x)" },
        };
        state.points.push(img);
        syncLayerOrder();
        await this.recomputeImageElements();
        notifyDomain(); notifyState(true); requestRender();
        return img;
      }
      const firstShape = sources.find((sr) => sr.kind === "shape");
      const src = firstShape ? state.shapes.find((s) => s.id === firstShape.id) : null;
      if (!src) return null;
      const img = {
        id: state.nextShapeId++, kind: "path",
        label: `${def.labelPrefix || "f"}(${src.label || "Shape"})`, color: "#fbbf24",
        lineWidth: 2.3, opacity: src.closed ? 0.18 : 1.0, lineStyle: "solid",
        closed: Boolean(src.closed), locked: false, visible: true,
        imageOf: { sourceKind: "shape", sourceId: src.id, sources: sources.map((s) => ({ ...s })), fnCardId: def.fnCardId ?? null, expr: def.expr || "f1(x)" },
        rawPts: src.rawPts.map((p) => ({ x: p.x, y: p.y })),
      };
      state.shapes.push(img);
      syncLayerOrder();
      await this.recomputeImageElements();
      notifyDomain(); notifyState(true); requestRender();
      return img;
    },
    async loadExampleAndPreset(ex, preset) {
      const pr = preset || (ex.presets && ex.presets[0]) || {};
      state.showPrimes = Boolean(ex.showPrimes);
      state.showZeros = Boolean(ex.showZeros);
      setCoordSystem(pr.coordSystem || ex.coordSystem || "cartesian", true);
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
        x: Number(pt.x) || 0,
        y: Number(pt.y) || 0,
        xExpr: pt.xExpr ? String(pt.xExpr) : "",
        yExpr: pt.yExpr ? String(pt.yExpr) : "",
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
        valExpr: ln.valExpr ? String(ln.valExpr) : "",
        label: ln.label || "",
        color: ln.color || "#fbbf24",
        lineWidth: Number(ln.lineWidth) || 1.5,
        lineStyle: ln.lineStyle || "dashed",
        locked: ln.locked !== undefined ? Boolean(ln.locked) : true,
        visible: ln.visible !== undefined ? Boolean(ln.visible) : true,
        showLabel: ln.showLabel !== undefined ? Boolean(ln.showLabel) : true,
      }));
      const srcTexts = pr.texts !== undefined ? pr.texts : (ex.defaultTexts || []);
      state.texts = (srcTexts || []).map((tb) => ({
        id: state.nextTextId++,
        kind: "text",
        title: tb.title || "",
        text: tb.text || "",
        anchor: tb.anchor || "bottom-left",
        x: Number(tb.x) || 0,
        y: Number(tb.y) || 0,
        nx: Number.isFinite(Number(tb.nx)) ? Number(tb.nx) : undefined,
        ny: Number.isFinite(Number(tb.ny)) ? Number(tb.ny) : undefined,
        xExpr: tb.xExpr ? String(tb.xExpr) : "",
        yExpr: tb.yExpr ? String(tb.yExpr) : "",
        color: tb.color || "#38bdf8",
        width: Number(tb.width || tb.maxWidth) || 305,
        height: Number(tb.height) > 0 ? Number(tb.height) : 0,
        fontSize: Number(tb.fontSize) || 12,
        opacity: normOpacity(tb.opacity, 0.94),
        locked: tb.locked !== undefined ? Boolean(tb.locked) : false,
        visible: tb.visible !== undefined ? Boolean(tb.visible) : true,
        collapsed: Boolean(tb.collapsed),
        cardHeight: Number(tb.cardHeight) > 0 ? Number(tb.cardHeight) : 0,
      }));
      const srcShapes = pr.shapes || ex.defaultShapes || [];
      state.shapes = srcShapes.map((sh) => {
        const closed = sh.closed !== undefined ? Boolean(sh.closed) : true;
        return {
          id: state.nextShapeId++,
          kind: sh.kind || "polygon",
          label: sh.label || "Shape",
          color: sh.color || "#38bdf8",
          lineWidth: normLineWidth(sh.lineWidth, 2.2),
          opacity: normOpacity(sh.opacity, closed ? 0.22 : 1.0),
          lineStyle: sh.lineStyle || "solid",
          closed,
          locked: Boolean(sh.locked),
          visible: sh.visible !== undefined ? Boolean(sh.visible) : true,
          collapsed: Boolean(sh.collapsed),
          cardHeight: Number(sh.cardHeight) > 0 ? Number(sh.cardHeight) : 0,
          rawPts: Array.isArray(sh.rawPts) ? sh.rawPts.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })) : [],
        };
      });
      state.selectedShapeId = null;
      state.selectedPointId = null;
      state.selectedLineId = null;
      state.polyUndoStack = [];
      state.shapeUndoStack = [];
      state.shapeRedoStack = [];
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
        setPolyTool("move");
      }
      ensureCanvasSize();
      updatePolyUI();
      notifyDomain();
      scheduleSample(true);
    },
  };
})();
