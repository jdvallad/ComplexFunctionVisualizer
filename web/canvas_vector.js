(() => {
  "use strict";

  /* =========================================================================
   * 2D Vector Calculus Interactive Canvas (window.CFVVector)
   * 100% Unified Elements & Layers Framework (Shapes, Points, Guide Lines,
   * Inline LaTeX Text Boxes, Rotation-Preserving Resize, Rotate Handle,
   * Right-Click Settings, Undo/Redo, Full Project Save/Load!)
   *
   * High-Performance 60 FPS Rendering Pipeline:
   *  - Offscreen Static Layer Cache (_staticCanvas): bakes Heatmap + Grid +
   *    Cached Marching Squares Equipotential Path2D + RK4 Streamlines +
   *    Quiver Arrows ONCE per field/view change (~0.2ms blit per particle frame!)
   *  - Adaptive Grid Resolution (44x34 live drag -> 80x64 settled)
   *  - Single-Flight Fetch Queue & Single-Flight Integral Drag Throttling
   * ========================================================================= */

  const HANDLE_HIT_PX = 10;

  const state = {
    active: false,
    view: { xmin: -5.0, xmax: 5.0, ymin: -3.6, ymax: 3.6 },
    defaultView: { xmin: -5.0, xmax: 5.0, ymin: -3.6, ymax: 3.6 },
    squareAspect: true,

    /* Display options (all OFF by default on blank projects for an uncluttered canvas!) */
    heatmap: "none", /* "none" | "phi" | "mag" | "div" | "curl" */
    showArrows: false,
    showStreamlines: false,
    showEquipotentials: false,
    showParticles: false,
    showTransformGrid: false,
    arrowDensity: 20,
    arrowScale: 1.0,
    heatmapOpacity: 0.62,

    /* Cached C11 grid, streamlines, parametric curve & offscreen static layer */
    grid: null,
    curvePts: [],
    curveTIdx: 0,
    dragCurveDot: false,
    heatmapCanvas: null,
    equipotPath: null,
    streamlines: [],
    staticDirty: true,
    staticCanvas: null,
    fetchReqId: 0,
    fetchBusy: false,
    fetchQueued: false,
    fetchQueuedFast: false,
    settleTimer: null,
    intBusy: false,
    intQueuedShape: null,

    /* 60 FPS Advected Flow Particles */
    particles: [],
    particleRaf: 0,
    lastParticleTs: 0,

    /* Unified Elements & Layers (identical schema to Complex & Real!) */
    tool: "move",
    shapes: [],
    points: [],
    lines: [],
    texts: [],
    layerOrder: [],
    nextShapeId: 1,
    nextPointId: 1,
    nextLineId: 1,
    nextTextId: 1,
    selectedShapeId: null,
    selectedPointId: null,
    selectedShapeIds: new Set(),
    selectedPointIds: new Set(),
    selectedLineId: null,
    selectedTextId: null,
    hoveredShapeId: null,
    hoveredPointId: null,
    hoveredTextId: null,
    drawing: null,
    polyDraft: null,
    dragShape: null,
    dragResize: null,
    dragRotate: null,
    dragGroup: null,
    marquee: null,
    dragPoint: null,
    dragLine: null,
    dragText: null,
    dragVecCard: null,
    pan: null,
    spaceHeld: false,
    undoStack: [],
    redoStack: [],

    /* Live cursor probe & magnetic snap indicator */
    hoverWorld: null,
    snapIndicator: null,
    hoveredVecHandle: null,
  };

  const canvas = document.getElementById("canvas-vector");
  const ctx = canvas ? canvas.getContext("2d") : null;
  const cardEl = document.getElementById("vector-plane-card");
  const readoutIn = document.getElementById("readout-in");
  const readoutOut = document.getElementById("readout-out");
  const intPanel = document.getElementById("vector-integral-panel");
  const intRows = document.getElementById("vector-integral-rows");

  const ws = () => window.CFVWorkspace;
  const isLightTheme = () => (window.CFVGeom && window.CFVGeom.isLightTheme)
    ? window.CFVGeom.isLightTheme()
    : (typeof document !== "undefined" && document.documentElement.dataset.theme === "light");
  const themeCol = (c) => (window.CFVTheme ? window.CFVTheme.adaptColor(c) : (c || "#38bdf8"));
  const themeRgba = (c, a) => (window.CFVTheme ? window.CFVTheme.adaptRgba(c, a) : `rgba(56,189,248,${a})`);

  function normOpacity(v, fb) {
    return (v !== undefined && v !== null && Number.isFinite(Number(v))) ? Math.max(0, Math.min(1, Number(v))) : fb;
  }
  function normLineWidth(v, fb) {
    return (v !== undefined && v !== null && Number.isFinite(Number(v))) ? Math.max(0, Number(v)) : fb;
  }
  function applyLineStyle(c, style) {
    if (style === "dashed") c.setLineDash([7, 5]);
    else if (style === "dotted") c.setLineDash([2, 4]);
    else c.setLineDash([]);
  }

  function ensureCanvasSize() {
    if (!canvas) return false;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w < 4 || h < 4) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      state.staticDirty = true;
    }
    return true;
  }

  function applySquareAspect() {
    if (!state.squareAspect || !canvas) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w < 10 || h < 10) return;
    const cy = 0.5 * (state.view.ymin + state.view.ymax);
    const xSpan = state.view.xmax - state.view.xmin;
    const halfY = 0.5 * xSpan * (h / w);
    state.view.ymin = cy - halfY;
    state.view.ymax = cy + halfY;
  }

  function xToS(x) { return ((x - state.view.xmin) / (state.view.xmax - state.view.xmin)) * (canvas.clientWidth || 600); }
  function yToS(y) { return ((state.view.ymax - y) / (state.view.ymax - state.view.ymin)) * (canvas.clientHeight || 400); }
  function sToX(sx) { return state.view.xmin + (sx / (canvas.clientWidth || 600)) * (state.view.xmax - state.view.xmin); }
  function sToY(sy) { return state.view.ymax - (sy / (canvas.clientHeight || 400)) * (state.view.ymax - state.view.ymin); }
  function localPos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  function activeVectorPayload() {
    const w = ws();
    return (w && typeof w.getActiveVectorPayload === "function") ? w.getActiveVectorPayload() : null;
  }
  function getActiveKindInfo() {
    const tgt = activeVectorPayload();
    if (!tgt) return { tgt: null, isScalar: false, isVectorLike: false, isCurve: false, isS2S: false };
    const isCurve = tgt.vecKind === "curve";
    const isS2S = tgt.vecKind === "s2s";
    const isScalar = tgt.vecKind === "potential" || tgt.matDims === "1x2";
    const isVectorLike = !isScalar && !isCurve && !isS2S && (tgt.vecKind === "field" || tgt.vecKind === "matrix");
    return { tgt, isScalar, isVectorLike, isCurve, isS2S };
  }
  function notifyDomain() { if (ws() && typeof ws().renderDomainCards === "function") ws().renderDomainCards(); }
  function notifyState(dirty = false) { if (ws() && typeof ws().notifyStateChanged === "function") ws().notifyStateChanged(dirty, dirty); }

  /* -------------------------------------------------------------------------
   * Unified Layer Ordering (Back -> Front, Identical to Complex & Real!)
   * ------------------------------------------------------------------------- */
  function syncLayerOrder() {
    const valid = new Set();
    for (const s of state.shapes) valid.add(`shape:${s.id}`);
    for (const l of state.lines) valid.add(`guide_line:${l.id}`);
    for (const p of state.points) valid.add(`point:${p.id}`);
    for (const t of state.texts) valid.add(`text:${t.id}`);

    const seen = new Set();
    state.layerOrder = (state.layerOrder || []).filter((e) => {
      if (!e) return false;
      const k = `${e.kind}:${e.id}`;
      if (!valid.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const addMissing = (kind, list) => {
      for (const it of list) {
        const k = `${kind}:${it.id}`;
        if (!seen.has(k)) { state.layerOrder.push({ kind, id: it.id }); seen.add(k); }
      }
    };
    addMissing("shape", state.shapes);
    addMissing("guide_line", state.lines);
    addMissing("point", state.points);
    addMissing("text", state.texts);
  }

  function getOrderedElements() {
    syncLayerOrder();
    const out = [];
    for (const e of state.layerOrder) {
      let item = null;
      if (e.kind === "shape") item = state.shapes.find((s) => s.id === e.id);
      else if (e.kind === "guide_line") item = state.lines.find((l) => l.id === e.id);
      else if (e.kind === "point") item = state.points.find((p) => p.id === e.id);
      else if (e.kind === "text") item = state.texts.find((t) => t.id === e.id);
      if (item) out.push({ kind: e.kind, id: e.id, item });
    }
    return out;
  }

  function reorderElement(fromIdx, toIdx) {
    syncLayerOrder();
    if (fromIdx < 0 || fromIdx >= state.layerOrder.length || toIdx < 0 || toIdx >= state.layerOrder.length || fromIdx === toIdx) return;
    const [moved] = state.layerOrder.splice(fromIdx, 1);
    state.layerOrder.splice(toIdx, 0, moved);
    notifyDomain();
    notifyState(true);
    requestRender();
  }

  /* -------------------------------------------------------------------------
   * Standardized Multi-Select & CRUD Helpers (Unified API across all modes!)
   * ------------------------------------------------------------------------- */
  function isShapeSelected(id) { return state.selectedShapeIds.has(id) || state.selectedShapeId === id; }
  function isPointSelected(id) { return state.selectedPointIds.has(id) || state.selectedPointId === id; }
  function syncPrimarySelection() {
    const sIds = [...state.selectedShapeIds].filter((id) => state.shapes.some((s) => s.id === id));
    const pIds = [...state.selectedPointIds].filter((id) => state.points.some((p) => p.id === id));
    state.selectedShapeIds = new Set(sIds);
    state.selectedPointIds = new Set(pIds);
    state.selectedShapeId = sIds.length > 0 ? sIds[sIds.length - 1] : null;
    state.selectedPointId = pIds.length > 0 ? pIds[pIds.length - 1] : null;
  }
  function getSelectedMovableItems() {
    const shapes = state.shapes.filter((s) => s.visible && !s.locked && !s.imageOf && isShapeSelected(s.id) && s.rawPts && s.rawPts.length >= 2);
    const points = state.points.filter((p) => p.visible && !p.locked && !p.imageOf && isPointSelected(p.id));
    return { shapes, points, total: shapes.length + points.length };
  }
  function getGroupBox() {
    const { shapes, points, total } = getSelectedMovableItems();
    if (total < 2 || !window.CFVGeom) return null;
    return window.CFVGeom.computeGroupBounds(shapes, points);
  }
  function getGroupRotateInfo() {
    const bb = getGroupBox();
    if (!bb) return null;
    const stemX = xToS(bb.cx), stemY = yToS(bb.ymax);
    return { bb, cx: bb.cx, cy: bb.cy, stemX, stemY, handleX: stemX, handleY: stemY - 26 };
  }
  function hitGroupHandle(sx, sy) {
    const bb = getGroupBox();
    if (!bb || !window.CFVGeom) return null;
    for (const hd of window.CFVGeom.getGroupHandles(bb)) {
      if (Math.hypot(sx - xToS(hd.x), sy - yToS(hd.y)) <= HANDLE_HIT_PX + 2) return { bb, handle: hd };
    }
    return null;
  }
  function hitGroupBox(sx, sy) {
    const bb = getGroupBox();
    if (!bb) return false;
    const x0 = xToS(bb.xmin), x1 = xToS(bb.xmax), y0 = yToS(bb.ymax), y1 = yToS(bb.ymin);
    return sx >= Math.min(x0, x1) - 4 && sx <= Math.max(x0, x1) + 4 && sy >= Math.min(y0, y1) - 4 && sy <= Math.max(y0, y1) + 4;
  }
  function clearSelection() {
    state.selectedShapeId = null;
    state.selectedPointId = null;
    state.selectedShapeIds.clear();
    state.selectedPointIds.clear();
    state.selectedLineId = null;
    state.selectedTextId = null;
  }
  function selectShape(id, opts = {}) {
    if (opts.toggle) {
      if (state.selectedShapeIds.has(id)) state.selectedShapeIds.delete(id);
      else state.selectedShapeIds.add(id);
      state.selectedLineId = null; state.selectedTextId = null;
      syncPrimarySelection();
    } else {
      clearSelection();
      if (id !== null && id !== undefined) { state.selectedShapeIds.add(id); state.selectedShapeId = id; }
    }
    updateIntegralPanel();
    notifyDomain(); requestRender();
  }
  function selectPoint(id, opts = {}) {
    if (opts.toggle) {
      if (state.selectedPointIds.has(id)) state.selectedPointIds.delete(id);
      else state.selectedPointIds.add(id);
      state.selectedLineId = null; state.selectedTextId = null;
      syncPrimarySelection();
    } else {
      clearSelection();
      if (id !== null && id !== undefined) { state.selectedPointIds.add(id); state.selectedPointId = id; }
    }
    updateIntegralPanel();
    notifyDomain(); requestRender();
  }
  function selectGuideLine(id) { clearSelection(); state.selectedLineId = id; updateIntegralPanel(); notifyDomain(); requestRender(); }
  function selectTextBox(id) { clearSelection(); state.selectedTextId = id; updateIntegralPanel(); notifyDomain(); requestRender(); }

  function deleteSelectedItems() {
    const remS = new Set(state.shapes.filter((s) => !s.locked && isShapeSelected(s.id)).map((s) => s.id));
    const remP = new Set(state.points.filter((p) => !p.locked && isPointSelected(p.id)).map((p) => p.id));
    if (remS.size > 0 || remP.size > 0) {
      pushUndo();
      if (remS.size > 0) state.shapes = state.shapes.filter((s) => !remS.has(s.id));
      if (remP.size > 0) state.points = state.points.filter((p) => !remP.has(p.id));
      clearSelection();
      syncLayerOrder();
      updateIntegralPanel();
      if (remP.size > 0) scheduleFetch(true, false);
      notifyDomain(); notifyState(true); requestRender();
      return true;
    }
    if (state.selectedLineId !== null) { deleteGuideLine(state.selectedLineId); return true; }
    if (state.selectedTextId !== null) { deleteTextBox(state.selectedTextId); return true; }
    return false;
  }

  function deleteShape(id) {
    if (!state.shapes.some((s) => s.id === id && !s.locked)) return;
    pushUndo();
    state.shapes = state.shapes.filter((s) => s.id !== id);
    state.selectedShapeIds.delete(id);
    syncPrimarySelection();
    syncLayerOrder(); updateIntegralPanel(); notifyDomain(); notifyState(true); requestRender();
  }
  function deletePoint(id) {
    if (!state.points.some((p) => p.id === id && !p.locked)) return;
    pushUndo();
    state.points = state.points.filter((p) => p.id !== id);
    state.selectedPointIds.delete(id);
    syncPrimarySelection();
    syncLayerOrder(); scheduleFetch(true, false); notifyDomain(); notifyState(true); requestRender();
  }
  function deleteGuideLine(id) {
    if (!state.lines.some((l) => l.id === id && !l.locked)) return;
    pushUndo();
    state.lines = state.lines.filter((l) => l.id !== id);
    if (state.selectedLineId === id) state.selectedLineId = null;
    syncLayerOrder(); notifyDomain(); notifyState(true); requestRender();
  }
  function deleteTextBox(id) {
    if (!state.texts.some((t) => t.id === id && !t.locked)) return;
    pushUndo();
    state.texts = state.texts.filter((t) => t.id !== id);
    if (state.selectedTextId === id) state.selectedTextId = null;
    syncLayerOrder(); notifyDomain(); notifyState(true); requestRender();
  }

  function addPoint(opts = {}) {
    pushUndo();
    const cx = 0.5 * (state.view.xmin + state.view.xmax), cy = 0.5 * (state.view.ymin + state.view.ymax);
    const p = {
      id: state.nextPointId++,
      x: opts.x !== undefined ? Number(opts.x) : Number(cx.toFixed(3)),
      y: opts.y !== undefined ? Number(opts.y) : Number(cy.toFixed(3)),
      xExpr: opts.xExpr || "",
      yExpr: opts.yExpr || "",
      label: opts.label || `Pt ${state.points.length + 1}`,
      icon: opts.icon || "dot",
      color: opts.color || "#fbbf24",
      size: opts.size || 5.5,
      opacity: normOpacity(opts.opacity, 1.0),
      locked: Boolean(opts.locked),
      visible: opts.visible !== undefined ? Boolean(opts.visible) : true,
      showLabel: opts.showLabel !== false,
    };
    state.points.push(p);
    selectPoint(p.id);
    syncLayerOrder();
    scheduleFetch(true, false);
    notifyState(true);
    return p;
  }

  function addGuideLine(opts = {}) {
    pushUndo();
    const ln = {
      id: state.nextLineId++,
      orientation: opts.orientation || "vertical",
      value: opts.value !== undefined ? Number(opts.value) : 0,
      valExpr: opts.valExpr || "",
      label: opts.label || "",
      color: opts.color || "#38bdf8",
      lineWidth: normLineWidth(opts.lineWidth, 1.8),
      lineStyle: opts.lineStyle || "dashed",
      opacity: normOpacity(opts.opacity, 0.85),
      locked: Boolean(opts.locked),
      visible: opts.visible !== undefined ? Boolean(opts.visible) : true,
    };
    state.lines.push(ln);
    selectGuideLine(ln.id);
    syncLayerOrder();
    notifyState(true);
    return ln;
  }

  function addTextBox(opts = {}) {
    pushUndo();
    const tb = {
      id: state.nextTextId++,
      title: opts.title !== undefined ? opts.title : "Note",
      text: opts.text !== undefined ? opts.text : "Vector calculus note ($\\nabla\\cdot\\mathbf{F}$, $\\nabla\\times\\mathbf{F}$)",
      plane: "real",
      anchor: opts.anchor || "free",
      nx: opts.nx !== undefined ? opts.nx : 0.04,
      ny: opts.ny !== undefined ? opts.ny : 0.72,
      x: Number(opts.x) || 0,
      y: Number(opts.y) || 0,
      xExpr: opts.xExpr || "",
      yExpr: opts.yExpr || "",
      color: opts.color || "#38bdf8",
      width: Number(opts.width) || 280,
      height: Number(opts.height) || 0,
      fontSize: Number(opts.fontSize) || 12,
      opacity: normOpacity(opts.opacity, 0.94),
      locked: Boolean(opts.locked),
      visible: opts.visible !== undefined ? Boolean(opts.visible) : true,
    };
    state.texts.push(tb);
    selectTextBox(tb.id);
    syncLayerOrder();
    notifyState(true);
    return tb;
  }

  /* -------------------------------------------------------------------------
   * Undo / Redo Stack
   * ------------------------------------------------------------------------- */
  function cloneSnap() {
    return {
      shapes: state.shapes.map((s) => ({ ...s, rawPts: (s.rawPts || []).map((p) => ({ x: p.x, y: p.y })), integral: s.integral ? { ...s.integral } : null })),
      points: state.points.map((p) => ({ ...p })),
      lines: state.lines.map((l) => ({ ...l })),
      texts: state.texts.map((t) => ({ ...t })),
      layerOrder: (state.layerOrder || []).map((e) => ({ ...e })),
    };
  }
  function pushUndo() {
    state.undoStack.push(cloneSnap());
    if (state.undoStack.length > 40) state.undoStack.shift();
    state.redoStack = [];
  }
  function applySnap(snap) {
    state.shapes = snap.shapes || [];
    state.points = snap.points || [];
    state.lines = snap.lines || [];
    state.texts = snap.texts || [];
    state.layerOrder = snap.layerOrder || [];
    clearSelection();
    recomputeAllIntegrals();
    notifyDomain();
    notifyState(true);
    requestRender();
  }
  function undoAction() {
    if (!state.undoStack.length) return false;
    state.redoStack.push(cloneSnap());
    applySnap(state.undoStack.pop());
    return true;
  }
  function redoAction() {
    if (!state.redoStack.length) return false;
    state.undoStack.push(cloneSnap());
    applySnap(state.redoStack.pop());
    return true;
  }

  /* -------------------------------------------------------------------------
   * Bilinear Field Lookup on Cached Grid (Powers 60 FPS Particles & Cursor!)
   * ------------------------------------------------------------------------- */
  function sampleGridField(x, y) {
    const g = state.grid;
    if (!g || !g.data) return null;
    const u = ((x - g.xmin) / (g.xmax - g.xmin)) * (g.nx - 1);
    const v = ((y - g.ymin) / (g.ymax - g.ymin)) * (g.ny - 1);
    if (u < 0 || v < 0 || u > g.nx - 1 || v > g.ny - 1) return null;
    const i0 = Math.min(g.nx - 2, Math.max(0, Math.floor(u)));
    const j0 = Math.min(g.ny - 2, Math.max(0, Math.floor(v)));
    const tx = u - i0, ty = v - j0;
    const d = g.data;
    const idx00 = (j0 * g.nx + i0) * 6, idx10 = (j0 * g.nx + i0 + 1) * 6;
    const idx01 = ((j0 + 1) * g.nx + i0) * 6, idx11 = ((j0 + 1) * g.nx + i0 + 1) * 6;
    const lerp4 = (k) => {
      const a = d[idx00 + k], b = d[idx10 + k], c = d[idx01 + k], e = d[idx11 + k];
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(e)) return NaN;
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty;
    };
    const fx = lerp4(0), fy = lerp4(1);
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) return null;
    return { fx, fy, mag: Math.hypot(fx, fy), div: lerp4(3), curl: lerp4(4), phi: lerp4(5) };
  }

  /* -------------------------------------------------------------------------
   * Cached Heatmap + Cached Marching Squares Equipotential Path2D!
   * Computed ONCE per grid update — NEVER repeated inside the 60 FPS particle loop!
   * ------------------------------------------------------------------------- */
  function buildHeatmapCanvas() {
    const g = state.grid;
    if (!g || !g.data || state.heatmap === "none") {
      state.heatmapCanvas = null;
      return;
    }
    const ch = state.heatmap === "mag" ? 2 : state.heatmap === "div" ? 3 : state.heatmap === "curl" ? 4 : 5;
    const diverging = state.heatmap === "div" || state.heatmap === "curl" || state.heatmap === "phi";
    const vals = [];
    for (let i = 0; i < g.nx * g.ny; i++) {
      const v = g.data[i * 6 + ch];
      if (Number.isFinite(v)) vals.push(Math.abs(v));
    }
    if (!vals.length) { state.heatmapCanvas = null; return; }
    vals.sort((a, b) => a - b);
    const scale = Math.max(1e-4, vals[Math.floor(vals.length * 0.92)] || 1.0);

    const off = state.heatmapCanvas || (state.heatmapCanvas = document.createElement("canvas"));
    if (off.width !== g.nx || off.height !== g.ny) { off.width = g.nx; off.height = g.ny; }
    const octx = off.getContext("2d");
    const img = octx.createImageData(g.nx, g.ny);
    const px = img.data;
    const isLight = isLightTheme();
    const baseR = isLight ? 242 : 14, baseG = isLight ? 246 : 20, baseB = isLight ? 250 : 34;

    for (let row = 0; row < g.ny; row++) {
      const srcRow = g.ny - 1 - row;
      for (let col = 0; col < g.nx; col++) {
        const v = g.data[(srcRow * g.nx + col) * 6 + ch];
        const p = (row * g.nx + col) * 4;
        if (!Number.isFinite(v)) { px[p + 3] = 0; continue; }
        if (diverging) {
          const t = Math.tanh((v / scale) * 1.45);
          const a = Math.abs(t);
          if (state.heatmap === "phi") {
            if (t >= 0) {
              px[p] = (baseR + (251 - baseR) * a) | 0;
              px[p + 1] = (baseG + (146 - baseG) * a) | 0;
              px[p + 2] = (baseB + (60 - baseB) * a) | 0;
            } else {
              px[p] = (baseR + (56 - baseR) * a) | 0;
              px[p + 1] = (baseG + (130 - baseG) * a) | 0;
              px[p + 2] = (baseB + (246 - baseB) * a) | 0;
            }
          } else {
            if (t >= 0) {
              px[p] = (baseR + (244 - baseR) * a) | 0;
              px[p + 1] = (baseG + (63 - baseG) * a) | 0;
              px[p + 2] = (baseB + (94 - baseB) * a) | 0;
            } else {
              px[p] = (baseR + (6 - baseR) * a) | 0;
              px[p + 1] = (baseG + (182 - baseG) * a) | 0;
              px[p + 2] = (baseB + (212 - baseB) * a) | 0;
            }
          }
          px[p + 3] = ((0.12 + 0.88 * Math.pow(a, 0.7)) * 255) | 0;
        } else {
          const t = Math.tanh((v / scale) * 1.35);
          let r, gr, b;
          if (t < 0.35) { const k = t / 0.35; r = 10 + 18 * k; gr = 18 + 76 * k; b = 46 + 115 * k; }
          else if (t < 0.72) { const k = (t - 0.35) / 0.37; r = 28 + 180 * k; gr = 94 + 86 * k; b = 161 - 85 * k; }
          else { const k = (t - 0.72) / 0.28; r = 208 + 47 * k; gr = 180 + 68 * k; b = 76 + 110 * k; }
          px[p] = r | 0; px[p + 1] = gr | 0; px[p + 2] = b | 0; px[p + 3] = 240;
        }
      }
    }
    octx.putImageData(img, 0, 0);
  }

  function buildEquipotentialSegments() {
    const g = state.grid;
    const { isScalar } = getActiveKindInfo();
    /* Strict mathematical separation: Contours ONLY graph level curves of Scalar f(x,y) -> R! */
    if (!g || !g.data || !state.showEquipotentials || !isScalar) { state.equipotPath = null; return; }
    let pMin = Infinity, pMax = -Infinity, validCnt = 0;
    for (let i = 0; i < g.nx * g.ny; i++) {
      const v = g.data[i * 6 + 5];
      if (Number.isFinite(v) && Math.abs(v) < 1e6) {
        if (v < pMin) pMin = v;
        if (v > pMax) pMax = v;
        validCnt++;
      }
    }
    if (validCnt < 16 || pMax - pMin < 1e-6) { state.equipotPath = null; return; }
    const ch = 5;
    const levels = 12;
    const dx = (g.xmax - g.xmin) / (g.nx - 1), dy = (g.ymax - g.ymin) / (g.ny - 1);
    const interp = (a, b, va, vb, lv) => {
      const d = vb - va;
      return Math.abs(d) < 1e-12 ? 0.5 * (a + b) : a + ((lv - va) / d) * (b - a);
    };
    const segs = [];
    for (let l = 1; l < levels; l++) {
      const lv = pMin + ((pMax - pMin) * l) / levels;
      for (let j = 0; j < g.ny - 1; j++) {
        const y0 = g.ymin + j * dy, y1 = y0 + dy;
        for (let i = 0; i < g.nx - 1; i++) {
          const v00 = g.data[(j * g.nx + i) * 6 + ch];
          const v10 = g.data[(j * g.nx + i + 1) * 6 + ch];
          const v11 = g.data[((j + 1) * g.nx + i + 1) * 6 + ch];
          const v01 = g.data[((j + 1) * g.nx + i) * 6 + ch];
          if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v11) || !Number.isFinite(v01)) continue;
          const m = (v00 > lv ? 1 : 0) | (v10 > lv ? 2 : 0) | (v11 > lv ? 4 : 0) | (v01 > lv ? 8 : 0);
          if (m === 0 || m === 15) continue;
          const x0 = g.xmin + i * dx, x1 = x0 + dx;
          const pts = [];
          if ((m & 1) !== ((m >> 1) & 1)) pts.push(interp(x0, x1, v00, v10, lv), y0);
          if (((m >> 1) & 1) !== ((m >> 2) & 1)) pts.push(x1, interp(y0, y1, v10, v11, lv));
          if (((m >> 3) & 1) !== ((m >> 2) & 1)) pts.push(interp(x0, x1, v01, v11, lv), y1);
          if ((m & 1) !== ((m >> 3) & 1)) pts.push(x0, interp(y0, y1, v00, v01, lv));
          if (pts.length >= 4) segs.push(pts[0], pts[1], pts[2], pts[3]);
          if (pts.length === 8) segs.push(pts[4], pts[5], pts[6], pts[7]);
        }
      }
    }
    state.equipotPath = new Float32Array(segs);
  }

  /* -------------------------------------------------------------------------
   * Single-Flight Native 4-Thread C11 Grid, Streamline & Integral Engine
   * ------------------------------------------------------------------------- */
  function scheduleFetch(immediate = false, fast = false) {
    if (!state.active) return;
    if (fast) {
      if (state.settleTimer) clearTimeout(state.settleTimer);
      state.settleTimer = setTimeout(() => {
        state.settleTimer = null;
        if (state.active) triggerFetch(false);
      }, 95);
    } else if (state.settleTimer) {
      clearTimeout(state.settleTimer);
      state.settleTimer = null;
    }
    if (immediate) {
      triggerFetch(fast);
    } else {
      if (state.fetchTimer) clearTimeout(state.fetchTimer);
      state.fetchTimer = setTimeout(() => {
        state.fetchTimer = null;
        triggerFetch(fast);
      }, fast ? 16 : 32);
    }
  }

  function triggerFetch(fast) {
    if (state.fetchBusy) {
      state.fetchQueued = true;
      state.fetchQueuedFast = state.fetchQueuedFast && fast;
      return;
    }
    fetchFieldLoop(fast);
  }

  async function fetchFieldLoop(initialFast) {
    state.fetchBusy = true;
    let fast = Boolean(initialFast);
    try {
      do {
        state.fetchQueued = false;
        await fetchFieldOnce(fast);
        fast = state.fetchQueuedFast;
        state.fetchQueuedFast = true;
      } while (state.fetchQueued && state.active);
    } finally {
      state.fetchBusy = false;
    }
  }

  async function fetchFieldOnce(fast) {
    if (!state.active || !canvas) return;
    const tgt = activeVectorPayload();
    if (!tgt) {
      state.grid = null;
      state.streamlines = [];
      state.particles = [];
      state.heatmapCanvas = null;
      state.equipotPath = null;
      state.staticDirty = true;
      if (state.particleRaf) { cancelAnimationFrame(state.particleRaf); state.particleRaf = 0; }
      requestRender();
      return;
    }
    const reqId = ++state.fetchReqId;
    applySquareAspect();
    const { isCurve, isS2S } = getActiveKindInfo();
    if (isCurve || isS2S) {
      /* Scalar-input functions (ℝ→ℝ and ℝ→ℝ²) are pure callable helpers — NEVER graphed on the 2D field canvas! */
      state.curvePts = [];
      state.grid = null;
      state.streamlines = [];
      state.equipotPath = null;
      state.heatmapCanvas = null;
      state.staticDirty = true;
      requestRender();
      return;
    }
    state.curvePts = [];
    const { xmin, xmax, ymin, ymax } = state.view;
    /* 45% overscan buffer around viewport so panning NEVER clips arrows, contours, heatmaps, or streams at the edges! */
    const padX = (xmax - xmin) * 0.45;
    const padY = (ymax - ymin) * 0.45;
    const gxmin = xmin - padX, gxmax = xmax + padX;
    const gymin = ymin - padY, gymax = ymax + padY;
    /* Adaptive grid over overscanned region: ~1.5ms in 4-thread C11! */
    const nx = fast ? 60 : 108;
    const ny = fast ? 48 : 88;

    try {
      const gridRes = await fetch("/api/workspace/vector_grid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...tgt, xmin: gxmin, xmax: gxmax, ymin: gymin, ymax: gymax, nx, ny }),
      });
      if (!gridRes.ok || reqId !== state.fetchReqId) return;
      const buf = await gridRes.arrayBuffer();
      if (reqId !== state.fetchReqId) return;
      state.grid = { nx, ny, xmin: gxmin, xmax: gxmax, ymin: gymin, ymax: gymax, data: new Float32Array(buf) };
      buildHeatmapCanvas();
      buildEquipotentialSegments();
      initParticlesIfNeeded();

      /* Compute RK4 streamlines ONLY when a Vector-Valued Function is selected! */
      const { isVectorLike } = getActiveKindInfo();
      if (state.showStreamlines && isVectorLike && (!fast || state.streamlines.length === 0)) {
        const seeds = [];
        const gx = 10, gy = 8;
        for (let j = 0; j < gy; j++) {
          const y = gymin + (gymax - gymin) * ((j + 0.5) / gy);
          for (let i = 0; i < gx; i++) {
            const x = gxmin + (gxmax - gxmin) * ((i + 0.5) / gx);
            seeds.push(x, y);
          }
        }
        for (const pt of state.points) {
          if (pt.visible) seeds.push(pt.x, pt.y);
        }
        const sRes = await fetch("/api/workspace/vector_streamlines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...tgt, xmin: gxmin, xmax: gxmax, ymin: gymin, ymax: gymax, steps: 64, seeds }),
        });
        if (sRes.ok && reqId === state.fetchReqId) {
          const sd = await sRes.json();
          state.streamlines = Array.isArray(sd.lines) ? sd.lines : [];
        }
      } else if (!state.showStreamlines) {
        state.streamlines = [];
      }

      state.staticDirty = true;
      if (!fast) await recomputeAllIntegrals();
      requestRender();
    } catch (_) {}
  }

  function viewOutsideGridMargin() {
    const g = state.grid;
    if (!g) return true;
    const vx = state.view.xmax - state.view.xmin;
    const vy = state.view.ymax - state.view.ymin;
    const gx = g.xmax - g.xmin;
    /* Refetch if zoomed significantly or panned within 8% of overscan edge */
    if (gx < vx * 1.15 || gx > vx * 3.2) return true;
    return state.view.xmin < g.xmin + vx * 0.08 ||
           state.view.xmax > g.xmax - vx * 0.08 ||
           state.view.ymin < g.ymin + vy * 0.08 ||
           state.view.ymax > g.ymax - vy * 0.08;
  }

  async function recomputeShapeIntegral(sh) {
    const tgt = activeVectorPayload();
    if (!tgt || !sh || !sh.rawPts || sh.rawPts.length < 2) {
      if (sh) sh.integral = null;
      return;
    }
    try {
      const flatPts = [];
      for (const p of sh.rawPts) flatPts.push(p.x, p.y);
      const res = await fetch("/api/workspace/vector_integral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...tgt,
          closed: Boolean(sh.closed),
          points: flatPts,
        }),
      });
      if (!res.ok) return;
      sh.integral = await res.json();
    } catch (_) {}
  }

  function queueShapeIntegralLive(sh) {
    if (state.intBusy) { state.intQueuedShape = sh; return; }
    (async () => {
      state.intBusy = true;
      let cur = sh;
      try {
        while (cur) {
          state.intQueuedShape = null;
          await recomputeShapeIntegral(cur);
          updateIntegralPanel();
          cur = state.intQueuedShape;
        }
      } finally {
        state.intBusy = false;
      }
    })();
  }

  async function recomputeAllIntegrals() {
    const visibleShapes = state.shapes.filter((s) => s && s.visible && s.rawPts && s.rawPts.length >= 2 && !s.locked);
    await Promise.all(visibleShapes.map((s) => recomputeShapeIntegral(s)));
    updateIntegralPanel();
  }

  function fmtVal(v) {
    if (!Number.isFinite(v)) return "—";
    if (Math.abs(v) < 1e-6) return "0.0000";
    return (v >= 0 ? "+" : "") + v.toFixed(4);
  }

  function updateIntegralPanel() {
    if (!intPanel || !intRows) return;
    const items = state.shapes.filter((s) => s && s.visible && !s.locked && s.integral);
    if (!items.length || !state.active) {
      intPanel.classList.add("hidden");
      return;
    }
    intPanel.classList.remove("hidden");
    const minSum = document.getElementById("vector-integral-min-sum");
    if (minSum && items[0] && items[0].integral) {
      minSum.textContent = `W=${fmtVal(items[0].integral.work)} · Φ=${fmtVal(items[0].integral.flux)}`;
    }
    intRows.innerHTML = "";
    for (const s of items) {
      const iv = s.integral;
      const sym = s.closed ? "∮" : "∫";
      const piWork = Math.abs(iv.work) > 0.05 ? `${(iv.work / (2 * Math.PI)).toFixed(2)}·2π` : "";
      const piFlux = Math.abs(iv.flux) > 0.05 ? `${(iv.flux / (2 * Math.PI)).toFixed(2)}·2π` : "";
      const row = window.CFVGeom && window.CFVGeom.createIntegralRowCard
        ? window.CFVGeom.createIntegralRowCard({
            id: s.id,
            color: s.color || "#34d399",
            title: s.label || "Shape",
            badgeText: s.closed ? `Closed · L=${(iv.arc_length || 0).toFixed(2)}` : `Open γ · L=${(iv.arc_length || 0).toFixed(2)}`,
            badgeClass: s.closed ? "ccw" : "",
            selected: isShapeSelected(s.id),
            tooltip: "Click to highlight & select this path on the graph",
            onReverse: () => reverseShape(s.id),
            onSelect: () => {
              if (state.selectedShapeId === s.id && state.selectedShapeIds.size <= 1) {
                clearSelection();
                updateIntegralPanel();
                notifyDomain();
                requestRender();
              } else {
                selectShape(s.id);
              }
            },
            onHover: (on) => {
              state.hoveredShapeId = on ? s.id : null;
              requestRender();
            },
            metrics: [
              { label: `${sym} F·dr (Work/Circ)`, value: fmtVal(iv.work), hint: piWork, valClass: "integral-row-main" },
              { label: `${sym} F·n ds (Flux)`, value: fmtVal(iv.flux), hint: piFlux, valClass: "integral-row-res" },
            ],
          })
        : null;
      if (row) intRows.appendChild(row);
    }
    if (window.CFVWorkspace && window.CFVWorkspace.syncShapeBadges) window.CFVWorkspace.syncShapeBadges();
  }

  /* -------------------------------------------------------------------------
   * 60 FPS Client-Side Advected Particle Swarm (Zero-HTTP!)
   * ------------------------------------------------------------------------- */
  function spawnParticle(p) {
    const { xmin, xmax, ymin, ymax } = state.view;
    p.x = xmin + Math.random() * (xmax - xmin);
    p.y = ymin + Math.random() * (ymax - ymin);
    p.px = p.x; p.py = p.y;
    p.age = 0; p.maxAge = 45 + Math.random() * 75;
  }
  function initParticlesIfNeeded() {
    const targetN = 185;
    if (state.particles.length !== targetN) {
      state.particles = [];
      for (let i = 0; i < targetN; i++) {
        const p = {}; spawnParticle(p); p.age = Math.random() * p.maxAge;
        state.particles.push(p);
      }
    }
  }
  function stepParticles(dtSec) {
    if (!state.grid || !state.showParticles) return;
    const span = Math.hypot(state.view.xmax - state.view.xmin, state.view.ymax - state.view.ymin);
    const stepBase = span * 0.22 * Math.min(0.05, dtSec);
    const { xmin, xmax, ymin, ymax } = state.view;
    for (const p of state.particles) {
      p.px = p.x; p.py = p.y; p.age += 1;
      const f1 = sampleGridField(p.x, p.y);
      if (!f1 || f1.mag < 1e-4 || p.age > p.maxAge) { spawnParticle(p); continue; }
      const v1 = Math.min(2.2, 0.35 + 0.55 * Math.log1p(f1.mag)) / f1.mag;
      const f2 = sampleGridField(p.x + 0.5 * stepBase * f1.fx * v1, p.y + 0.5 * stepBase * f1.fy * v1) || f1;
      const v2 = Math.min(2.2, 0.35 + 0.55 * Math.log1p(f2.mag)) / Math.max(1e-6, f2.mag);
      p.x += stepBase * f2.fx * v2;
      p.y += stepBase * f2.fy * v2;
      if (p.x < xmin || p.x > xmax || p.y < ymin || p.y > ymax) spawnParticle(p);
    }
  }
  function startParticleLoop() {
    if (state.particleRaf) return;
    const tick = (ts) => {
      if (!state.active || !state.showParticles) { state.particleRaf = 0; return; }
      const dt = state.lastParticleTs ? (ts - state.lastParticleTs) / 1000 : 0.016;
      state.lastParticleTs = ts;
      stepParticles(dt);
      render();
      state.particleRaf = requestAnimationFrame(tick);
    };
    state.particleRaf = requestAnimationFrame(tick);
  }

  /* -------------------------------------------------------------------------
   * Offscreen Static Field Layer Baker (10x Particle Loop Speedup!)
   * ------------------------------------------------------------------------- */
  function arrowColorForMag(mag, refMag) {
    const t = Math.tanh((mag / Math.max(1e-4, refMag)) * 1.15);
    const light = isLightTheme();
    if (t < 0.5) {
      const k = t * 2;
      return `rgb(${((light ? 2 : 56) + ((light ? 14 : 52) - (light ? 2 : 56)) * k) | 0},${((light ? 132 : 189) + ((light ? 165 : 211) - (light ? 132 : 189)) * k) | 0},${((light ? 199 : 248) + ((light ? 130 : 153) - (light ? 199 : 248)) * k) | 0})`;
    }
    const k = (t - 0.5) * 2;
    return `rgb(${((light ? 14 : 52) + (251 - (light ? 14 : 52)) * k) | 0},${((light ? 165 : 211) + ((light ? 113 : 191) - (light ? 165 : 211)) * k) | 0},${((light ? 130 : 153) + ((light ? 24 : 36) - (light ? 130 : 153)) * k) | 0})`;
  }

  function rebuildStaticLayer(w, h, dpr) {
    const off = state.staticCanvas || (state.staticCanvas = document.createElement("canvas"));
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (off.width !== pw || off.height !== ph) { off.width = pw; off.height = ph; }
    const sctx = off.getContext("2d");
    const light = isLightTheme();

    sctx.save();
    sctx.scale(dpr, dpr);
    sctx.fillStyle = light ? "#f5f7fb" : "#080c14";
    sctx.fillRect(0, 0, w, h);

    const { isScalar, isVectorLike } = getActiveKindInfo();

    /* 1. Background Color Map (Scalar f(x,y) only for scalar functions; |F|/div/curl only for vector functions) */
    const hmAllowed = state.heatmap !== "none" && ((state.heatmap === "phi" && isScalar) || (state.heatmap !== "phi" && isVectorLike));
    if (hmAllowed && state.heatmapCanvas && state.grid) {
      const g = state.grid;
      const sx0 = xToS(g.xmin), sy0 = yToS(g.ymax), sx1 = xToS(g.xmax), sy1 = yToS(g.ymin);
      sctx.save();
      sctx.globalAlpha = state.heatmapOpacity;
      sctx.imageSmoothingEnabled = true;
      sctx.drawImage(state.heatmapCanvas, sx0, sy0, sx1 - sx0, sy1 - sy0);
      sctx.restore();
    }

    /* 2. Grid & Axes */
    const niceStep = window.CFVGeom ? window.CFVGeom.niceStep : ((r) => Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, r)))));
    const fmtTick = window.CFVGeom ? window.CFVGeom.fmtTick : ((v) => Number(v.toPrecision(4)).toString());
    const xStep = niceStep((state.view.xmax - state.view.xmin) / 9);
    const yStep = niceStep((state.view.ymax - state.view.ymin) / 7);
    sctx.strokeStyle = light ? "rgba(15,23,42,0.09)" : "rgba(148,163,184,0.11)";
    sctx.lineWidth = 1;
    sctx.beginPath();
    for (let x = Math.floor(state.view.xmin / xStep) * xStep; x <= state.view.xmax; x += xStep) {
      const sx = Math.round(xToS(x)) + 0.5; sctx.moveTo(sx, 0); sctx.lineTo(sx, h);
    }
    for (let y = Math.floor(state.view.ymin / yStep) * yStep; y <= state.view.ymax; y += yStep) {
      const sy = Math.round(yToS(y)) + 0.5; sctx.moveTo(0, sy); sctx.lineTo(w, sy);
    }
    sctx.stroke();

    const ox = xToS(0), oy = yToS(0);
    sctx.strokeStyle = light ? "rgba(15,23,42,0.34)" : "rgba(203,213,225,0.34)";
    sctx.lineWidth = 1.25;
    sctx.beginPath();
    if (oy >= 0 && oy <= h) { sctx.moveTo(0, oy); sctx.lineTo(w, oy); }
    if (ox >= 0 && ox <= w) { sctx.moveTo(ox, 0); sctx.lineTo(ox, h); }
    sctx.stroke();

    sctx.fillStyle = light ? "rgba(51,65,85,0.78)" : "rgba(148,163,184,0.68)";
    sctx.font = '10px "JetBrains Mono", monospace';
    const xly = Math.min(h - 14, Math.max(44, oy + 14));
    const ylx = Math.min(w - 40, Math.max(8, ox + 6));
    for (let x = Math.floor(state.view.xmin / xStep) * xStep; x <= state.view.xmax; x += xStep) {
      if (Math.abs(x) < xStep * 0.25) continue;
      const sx = xToS(x); if (sx > 24 && sx < w - 24) sctx.fillText(fmtTick(x), sx - 9, xly);
    }
    for (let y = Math.floor(state.view.ymin / yStep) * yStep; y <= state.view.ymax; y += yStep) {
      if (Math.abs(y) < yStep * 0.25) continue;
      const sy = yToS(y); if (sy > 44 && sy < h - 20) sctx.fillText(fmtTick(y), ylx, sy + 3);
    }

    /* 3. Level Curves / Contours (ONLY when a Scalar f(x,y) -> R function is selected!) */
    if (state.showEquipotentials && isScalar && state.equipotPath && state.equipotPath.length >= 4) {
      sctx.save();
      sctx.strokeStyle = light ? "rgba(180, 83, 9, 0.58)" : "rgba(251, 191, 36, 0.56)";
      sctx.lineWidth = 1.35;
      sctx.beginPath();
      const segs = state.equipotPath;
      for (let i = 0; i < segs.length; i += 4) {
        sctx.moveTo(xToS(segs[i]), yToS(segs[i + 1]));
        sctx.lineTo(xToS(segs[i + 2]), yToS(segs[i + 3]));
      }
      sctx.stroke();
      sctx.restore();
    }

    /* 4. RK4 Streamlines (ONLY for Vector-Valued Functions!) */
    if (state.showStreamlines && isVectorLike && state.streamlines.length > 0) {
      sctx.save();
      sctx.strokeStyle = light ? "rgba(2, 132, 199, 0.50)" : "rgba(125, 211, 252, 0.48)";
      sctx.lineWidth = 1.4;
      sctx.lineCap = "round";
      sctx.beginPath();
      for (const line of state.streamlines) {
        if (!line || line.length < 4) continue;
        for (let i = 0; i + 1 < line.length; i += 2) {
          const sx = xToS(line[i]), sy = yToS(line[i + 1]);
          if (i === 0) sctx.moveTo(sx, sy); else sctx.lineTo(sx, sy);
        }
      }
      sctx.stroke();
      sctx.restore();
    }

    /* 5. Color-Mapped Quiver Arrows (ONLY for Vector-Valued Functions! World-Anchored so panning never clips!) */
    if (state.showArrows && isVectorLike && state.grid) {
      const g = state.grid;
      const cols = Math.max(10, Math.min(32, Math.round(state.arrowDensity)));
      const viewW = state.view.xmax - state.view.xmin;
      const viewH = state.view.ymax - state.view.ymin;
      const rawStep = viewW / cols;
      /* Snap spacing to clean dyadic-like power so arrows don't jump while panning, only rescale smoothly on zoom */
      const stepX = rawStep;
      const stepY = state.squareAspect ? stepX : (viewH / Math.max(8, Math.round(cols * (h / Math.max(1, w)))));
      const cellPx = Math.min((stepX / Math.max(1e-9, viewW)) * w, (stepY / Math.max(1e-9, viewH)) * h);
      const maxLenPx = cellPx * 0.72 * state.arrowScale;
      let magSum = 0, magCnt = 0;
      for (let i = 0; i < g.nx * g.ny; i += 3) {
        const m = g.data[i * 6 + 2];
        if (Number.isFinite(m) && m < 1e4) { magSum += m; magCnt++; }
      }
      const refMag = magCnt > 0 ? Math.max(0.2, magSum / magCnt) : 1.0;

      const xStart = Math.floor(state.view.xmin / stepX) * stepX;
      const yStart = Math.floor(state.view.ymin / stepY) * stepY;

      sctx.save();
      sctx.lineWidth = 1.45;
      sctx.lineCap = "round";
      for (let wy = yStart; wy <= state.view.ymax + stepY; wy += stepY) {
        for (let wx = xStart; wx <= state.view.xmax + stepX; wx += stepX) {
          const f = sampleGridField(wx, wy);
          if (!f || f.mag < 1e-5) continue;
          const sx = xToS(wx), sy = yToS(wy);
          if (sx < -maxLenPx || sx > w + maxLenPx || sy < -maxLenPx || sy > h + maxLenPx) continue;
          const len = maxLenPx * (0.28 + 0.72 * Math.tanh(f.mag / refMag));
          const ux = f.fx / f.mag, uy = -f.fy / f.mag;
          const x0 = sx - ux * len * 0.45, y0 = sy - uy * len * 0.45;
          const x1 = sx + ux * len * 0.55, y1 = sy + uy * len * 0.55;
          const col = arrowColorForMag(f.mag, refMag);
          sctx.strokeStyle = col; sctx.fillStyle = col;
          sctx.beginPath(); sctx.moveTo(x0, y0); sctx.lineTo(x1, y1); sctx.stroke();
          const ah = Math.min(6.2, len * 0.34), aw = ah * 0.52;
          sctx.beginPath();
          sctx.moveTo(x1, y1);
          sctx.lineTo(x1 - ux * ah - uy * aw, y1 - uy * ah + ux * aw);
          sctx.lineTo(x1 - ux * ah + uy * aw, y1 - uy * ah - ux * aw);
          sctx.closePath();
          sctx.fill();
        }
      }
      sctx.restore();
    }
    sctx.restore();
    state.staticDirty = false;
  }

  /* -------------------------------------------------------------------------
   * Geometry Helpers (Resize & Rotate Handles matching Complex & Real!)
   * ------------------------------------------------------------------------- */
  function expandLinearPts(s) {
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

  function getResizeHandles(s) {
    if (!s || !s.rawPts || s.rawPts.length < 2 || s.locked) return [];
    const bb = window.CFVGeom ? window.CFVGeom.getShapeBounds(s.rawPts) : null;
    if (!bb) return [];
    if (s.kind === "circle") {
      const r = 0.5 * Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
      return [
        { id: "e", x: bb.cx + r, y: bb.cy, shapeKind: "circle" },
        { id: "w", x: bb.cx - r, y: bb.cy, shapeKind: "circle" },
        { id: "n", x: bb.cx, y: bb.cy + r, shapeKind: "circle" },
        { id: "s", x: bb.cx, y: bb.cy - r, shapeKind: "circle" },
      ];
    }
    if (s.kind === "rect" && s.rawPts.length === 4) {
      const [p0, p1, p2, p3] = s.rawPts;
      return [
        { id: "nw", x: p3.x, y: p3.y, shapeKind: "rect" },
        { id: "ne", x: p2.x, y: p2.y, shapeKind: "rect" },
        { id: "se", x: p1.x, y: p1.y, shapeKind: "rect" },
        { id: "sw", x: p0.x, y: p0.y, shapeKind: "rect" },
      ];
    }
    if (s.kind === "seg" || s.kind === "line" || s.kind === "ray" || s.kind === "infline" || s.kind === "vector") {
      return [
        { id: "start", x: s.rawPts[0].x, y: s.rawPts[0].y, shapeKind: "line" },
        { id: "end", x: s.rawPts[s.rawPts.length - 1].x, y: s.rawPts[s.rawPts.length - 1].y, shapeKind: "line" },
      ];
    }
    return [
      { id: "nw", x: bb.minX, y: bb.maxY, shapeKind: "scale" },
      { id: "ne", x: bb.maxX, y: bb.maxY, shapeKind: "scale" },
      { id: "se", x: bb.maxX, y: bb.minY, shapeKind: "scale" },
      { id: "sw", x: bb.minX, y: bb.minY, shapeKind: "scale" },
    ];
  }

  function getRotateHandle(s) {
    if (!s || s.locked || !s.rawPts || s.rawPts.length < 2) return null;
    const bb = window.CFVGeom ? window.CFVGeom.getShapeBounds(s.rawPts) : null;
    if (!bb) return null;
    const stemX = xToS(bb.cx), stemY = yToS(bb.maxY);
    return { cx: bb.cx, cy: bb.cy, stemX, stemY, handleX: stemX, handleY: stemY - 24 };
  }

  /* -------------------------------------------------------------------------
   * 2D Linear Algebra Renderer (Warped Grid, Determinant Area, Basis,
   * Real Eigenvector Spans, Transformed Shapes & Draggable Vector Cards!)
   * ------------------------------------------------------------------------- */
  function drawCrispArrow(c, x0, y0, x1, y1, color, lw, headLen = 10, dashed = false) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1.5) return;
    const ang = Math.atan2(dy, dx);
    c.save();
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = lw;
    c.lineCap = "round";
    if (dashed) c.setLineDash([6, 4]);
    const stop = Math.max(0, len - headLen * 0.72);
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x0 + Math.cos(ang) * stop, y0 + Math.sin(ang) * stop);
    c.stroke();
    c.setLineDash([]);
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x1 - headLen * Math.cos(ang - 0.36), y1 - headLen * Math.sin(ang - 0.36));
    c.lineTo(x1 - headLen * Math.cos(ang + 0.36), y1 - headLen * Math.sin(ang + 0.36));
    c.closePath();
    c.fill();
    c.restore();
  }

  function drawLinearAlgebraOverlay(c, light) {
    if (!ws() || typeof ws().evalLinearAlgebraState !== "function") return;
    const { isScalar } = getActiveKindInfo();
    const la = ws().evalLinearAlgebraState();
    const A = la.activeMatrix && la.activeMatrix.info ? la.activeMatrix.info : null;
    const ox = xToS(0), oy = yToS(0);

    /* M Grid ONLY graphs vector-valued / 2x2 matrix maps — NEVER when a Scalar f(x,y) -> R is selected! */
    if (A && state.showTransformGrid && !isScalar) {
      /* 1. Infinite Linearly Transformed Coordinate Grid A * Z^2 (computed via A^-1 of viewport corners!) */
      c.save();
      const detA = A.a * A.d - A.b * A.c;
      let uMin = -18, uMax = 18, vMin = -18, vMax = 18;
      let gStep = 1;
      if (Math.abs(detA) > 1e-4) {
        const inv = 1 / detA;
        const corners = [
          [state.view.xmin, state.view.ymin],
          [state.view.xmax, state.view.ymin],
          [state.view.xmax, state.view.ymax],
          [state.view.xmin, state.view.ymax],
        ];
        uMin = Infinity; uMax = -Infinity; vMin = Infinity; vMax = -Infinity;
        for (const [cx, cy] of corners) {
          const ux = (A.d * cx - A.b * cy) * inv;
          const uy = (-A.c * cx + A.a * cy) * inv;
          if (ux < uMin) uMin = ux; if (ux > uMax) uMax = ux;
          if (uy < vMin) vMin = uy; if (uy > vMax) vMax = uy;
        }
        const spanU = Math.max(1, uMax - uMin), spanV = Math.max(1, vMax - vMin);
        const maxSpan = Math.max(spanU, spanV);
        const ns = window.CFVGeom ? window.CFVGeom.niceStep : ((r) => Math.max(1, Math.pow(10, Math.floor(Math.log10(Math.max(1, r))))));
        gStep = maxSpan > 48 ? ns(maxSpan / 28) : 1;
        uMin = Math.floor(uMin / gStep) * gStep - gStep;
        uMax = Math.ceil(uMax / gStep) * gStep + gStep;
        vMin = Math.floor(vMin / gStep) * gStep - gStep;
        vMax = Math.ceil(vMax / gStep) * gStep + gStep;
        /* Safety cap to keep drawing fast even for near-singular matrices */
        const maxLines = 64;
        if ((uMax - uMin) / gStep > maxLines) { const mid = 0.5 * (uMin + uMax); uMin = mid - 0.5 * maxLines * gStep; uMax = mid + 0.5 * maxLines * gStep; }
        if ((vMax - vMin) / gStep > maxLines) { const mid = 0.5 * (vMin + vMax); vMin = mid - 0.5 * maxLines * gStep; vMax = mid + 0.5 * maxLines * gStep; }
      } else {
        const ext = Math.max(20, Math.hypot(state.view.xmax - state.view.xmin, state.view.ymax - state.view.ymin) * 1.5);
        uMin = -ext; uMax = ext; vMin = -ext; vMax = ext;
        gStep = ext > 36 ? Math.ceil(ext / 20) : 1;
      }

      for (let k = uMin; k <= uMax + 1e-6; k += gStep) {
        const isAxis = Math.abs(k) < gStep * 0.1;
        c.strokeStyle = isAxis
          ? (light ? "rgba(16, 185, 129, 0.72)" : "rgba(52, 211, 153, 0.58)")
          : (light ? "rgba(14, 165, 233, 0.24)" : "rgba(56, 189, 248, 0.20)");
        c.lineWidth = isAxis ? 1.85 : 0.95;
        c.beginPath();
        c.moveTo(xToS(A.a * k + A.b * vMin), yToS(A.c * k + A.d * vMin));
        c.lineTo(xToS(A.a * k + A.b * vMax), yToS(A.c * k + A.d * vMax));
        c.stroke();
      }
      for (let k = vMin; k <= vMax + 1e-6; k += gStep) {
        const isAxis = Math.abs(k) < gStep * 0.1;
        c.strokeStyle = isAxis
          ? (light ? "rgba(244, 63, 94, 0.72)" : "rgba(251, 113, 133, 0.58)")
          : (light ? "rgba(139, 92, 246, 0.24)" : "rgba(167, 139, 250, 0.20)");
        c.lineWidth = isAxis ? 1.85 : 0.95;
        c.beginPath();
        c.moveTo(xToS(A.a * uMin + A.b * k), yToS(A.c * uMin + A.d * k));
        c.lineTo(xToS(A.a * uMax + A.b * k), yToS(A.c * uMax + A.d * k));
        c.stroke();
      }

      /* 2. Real Eigenvector Spans (Dashed Gold Lines through Origin) */
      if (A.eigen && A.eigen.real && A.eigen.vecs.length > 0) {
        c.setLineDash([7, 5]);
        c.lineWidth = 1.6;
        c.strokeStyle = light ? "rgba(217, 119, 6, 0.72)" : "rgba(251, 191, 36, 0.65)";
        const ext = Math.max(state.view.xmax - state.view.xmin, state.view.ymax - state.view.ymin) * 1.5;
        for (const ev of A.eigen.vecs) {
          c.beginPath();
          c.moveTo(xToS(-ev.x * ext), yToS(-ev.y * ext));
          c.lineTo(xToS(ev.x * ext), yToS(ev.y * ext));
          c.stroke();
        }
        c.setLineDash([]);
      }

      /* 3. Shaded Unit Square Determinant Parallelogram (0 -> Ai -> A(i+j) -> Aj) */
      const ix = xToS(A.a), iy = yToS(A.c);
      const jx = xToS(A.b), jy = yToS(A.d);
      const ijx = xToS(A.a + A.b), ijy = yToS(A.c + A.d);
      const det = A.det;
      c.fillStyle = det < -1e-5
        ? "rgba(251, 113, 133, 0.20)"
        : Math.abs(det) < 1e-5
          ? "rgba(251, 191, 36, 0.20)"
          : "rgba(52, 211, 153, 0.18)";
      c.strokeStyle = det < -1e-5 ? "rgba(251, 113, 133, 0.70)" : "rgba(52, 211, 153, 0.65)";
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(ox, oy); c.lineTo(ix, iy); c.lineTo(ijx, ijy); c.lineTo(jx, jy);
      c.closePath();
      c.fill(); c.stroke();

      /* Live det(A) label at parallelogram centroid */
      const pcx = 0.25 * (ox + ix + ijx + jx), pcy = 0.25 * (oy + iy + ijy + jy);
      c.font = '700 10.5px "JetBrains Mono", monospace';
      c.fillStyle = det < -1e-5 ? "#fb7185" : Math.abs(det) < 1e-5 ? "#fbbf24" : "#34d399";
      c.textAlign = "center";
      c.fillText(`det=${det.toFixed(2)}`, pcx, pcy + 3);
      c.textAlign = "left";

      /* 4. Transformed Basis Vectors A*i (emerald) & A*j (coral/rose) */
      drawCrispArrow(c, ox, oy, ix, iy, "#34d399", 2.8, 10.5);
      drawCrispArrow(c, ox, oy, jx, jy, "#fb7185", 2.8, 10.5);
      c.font = '700 11.5px "JetBrains Mono", monospace';
      c.fillStyle = "#34d399"; c.fillText("î′", ix + 6, iy - 5);
      c.fillStyle = "#fb7185"; c.fillText("ĵ′", jx + 6, jy - 5);
      c.restore();

      /* 5. Live Linear Image A(S) of every visible Shape S (skip tethered imageOf shapes & shapes with an explicit visible f(S)!) */
      for (const s of state.shapes) {
        if (!s.visible || s.imageOf || !s.rawPts || s.rawPts.length < 2) continue;
        if (state.shapes.some((q) => q.visible && q.imageOf && q.imageOf.sourceId === s.id)) continue;
        c.save();
        const col = "#fbbf24";
        if (s.kind === "vector") {
          const p0 = s.rawPts[0], p1 = s.rawPts[s.rawPts.length - 1];
          const q0x = xToS(A.a * p0.x + A.b * p0.y), q0y = yToS(A.c * p0.x + A.d * p0.y);
          const q1x = xToS(A.a * p1.x + A.b * p1.y), q1y = yToS(A.c * p1.x + A.d * p1.y);
          drawCrispArrow(c, q0x, q0y, q1x, q1y, col, 2.7, 10.5);
        } else {
          c.beginPath();
          for (let i = 0; i < s.rawPts.length; i++) {
            const p = s.rawPts[i];
            const tx = xToS(A.a * p.x + A.b * p.y), ty = yToS(A.c * p.x + A.d * p.y);
            if (i === 0) c.moveTo(tx, ty); else c.lineTo(tx, ty);
          }
          if (s.closed) c.closePath();
          if (s.closed) {
            c.fillStyle = "rgba(251, 191, 36, 0.16)";
            c.fill();
          }
          c.strokeStyle = col;
          c.lineWidth = 2.2;
          c.stroke();
        }
        c.restore();
      }
    }

    /* 6. Interactive Draggable 2D Vector Cards v_k & their Live Matrix Image A*v_k */
    for (const vr of la.vectors) {
      if (!vr.visible || !vr.vec) continue;
      const vx = xToS(vr.vec.x), vy = yToS(vr.vec.y);
      const col = themeCol(vr.color || "#38bdf8");

      /* Transformed image A*v */
      if (vr.mapped) {
        const mx = xToS(vr.mapped.x), my = yToS(vr.mapped.y);
        const mag = Math.hypot(vr.vec.x, vr.vec.y);
        const mMag = Math.hypot(vr.mapped.x, vr.mapped.y);
        const isEig = mag > 1e-4 && mMag > 1e-4 && Math.abs(vr.vec.x * vr.mapped.y - vr.vec.y * vr.mapped.x) / (mag * mMag) < 0.035;
        const outCol = isEig ? "#fde047" : "#fbbf24";

        /* Faint dashed motion link v ---> A*v */
        c.save();
        c.strokeStyle = isEig ? "rgba(253, 224, 71, 0.65)" : "rgba(251, 191, 36, 0.42)";
        c.lineWidth = 1.4;
        c.setLineDash([4, 4]);
        c.beginPath(); c.moveTo(vx, vy); c.lineTo(mx, my); c.stroke();
        c.restore();

        drawCrispArrow(c, ox, oy, mx, my, outCol, isEig ? 3.4 : 2.8, 11);
        c.save();
        c.font = '700 11.5px "JetBrains Mono", monospace';
        c.fillStyle = outCol;
        c.fillText(`${vr.matSym}${vr.sym}${isEig ? " ★" : ""}`, mx + 8, my - 6);
        c.restore();
      }

      /* Input vector v */
      drawCrispArrow(c, ox, oy, vx, vy, col, 3.0, 11);
      if (vr.editable) {
        c.save();
        c.fillStyle = state.dragVecCard && state.dragVecCard.cardId === vr.id ? "#ffffff" : col;
        c.strokeStyle = light ? "#ffffff" : "#080c14";
        c.lineWidth = 2;
        c.beginPath(); c.arc(vx, vy, 5.5, 0, Math.PI * 2); c.fill(); c.stroke();
        c.restore();
      }
      c.save();
      c.font = '700 11.5px "JetBrains Mono", monospace';
      c.fillStyle = light ? "#0f172a" : "#f8fafc";
      c.fillText(`${vr.sym}(${vr.vec.x.toFixed(1)}, ${vr.vec.y.toFixed(1)})`, vx + 8, vy + 12);
      c.restore();
    }
  }

  function hitVecCardTip(sx, sy) {
    if (!ws() || typeof ws().evalLinearAlgebraState !== "function") return null;
    const la = ws().evalLinearAlgebraState();
    for (let i = la.vectors.length - 1; i >= 0; i--) {
      const vr = la.vectors[i];
      if (!vr.visible || !vr.editable || !vr.vec) continue;
      if (Math.hypot(sx - xToS(vr.vec.x), sy - yToS(vr.vec.y)) <= 14) return vr;
    }
    return null;
  }

  /* -------------------------------------------------------------------------
   * Main Composite Frame Renderer (0.2ms static blit + particles + LA + elements!)
   * ------------------------------------------------------------------------- */
  let _rafPending = false;
  function requestRender(markStatic = false) {
    if (markStatic) state.staticDirty = true;
    if (state.showParticles && state.active) { startParticleLoop(); return; }
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(() => { _rafPending = false; render(); });
  }

  function render() {
    if (!state.active || !canvas || !ctx || !ensureCanvasSize()) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const dpr = canvas.width / w;
    const light = isLightTheme();

    if (state.staticDirty || !state.staticCanvas || state.staticCanvas.width !== canvas.width || state.staticCanvas.height !== canvas.height) {
      rebuildStaticLayer(w, h, dpr);
    }

    ctx.save();
    /* 1. Ultra-fast GPU blit of pre-baked static field layer (0.2ms!) */
    ctx.drawImage(state.staticCanvas, 0, 0);
    ctx.scale(dpr, dpr);

    /* 2. 60 FPS Advected Flow Particles (ONLY for Vector-Valued Functions!) */
    const { isVectorLike } = getActiveKindInfo();
    if (state.showParticles && isVectorLike && state.grid && state.particles.length > 0) {
      ctx.save();
      ctx.lineCap = "round";
      for (const p of state.particles) {
        const fade = Math.sin(Math.min(1, p.age / Math.max(1, p.maxAge)) * Math.PI);
        if (fade < 0.05) continue;
        const x0 = xToS(p.px), y0 = yToS(p.py), x1 = xToS(p.x), y1 = yToS(p.y);
        if (Math.hypot(x1 - x0, y1 - y0) > 60) continue;
        ctx.strokeStyle = light ? `rgba(2, 132, 199, ${0.62 * fade})` : `rgba(224, 242, 254, ${0.76 * fade})`;
        ctx.lineWidth = 1.85;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.fillStyle = light ? `rgba(3, 105, 161, ${0.82 * fade})` : `rgba(56, 189, 248, ${0.95 * fade})`;
        ctx.beginPath(); ctx.arc(x1, y1, 1.9, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    /* 2.5. Live 2x2 Matrix & 2D Vector Linear Algebra Overlay (scalar-input helpers ℝ→ℝ / ℝ→ℝ² are NEVER graphed!) */
    drawLinearAlgebraOverlay(ctx, light);

    /* 3. Unified Elements & Layers (Back -> Front) */
    for (const el of getOrderedElements()) {
      if (el.kind === "guide_line") {
        const ln = el.item;
        if (!ln.visible) continue;
        const col = themeCol(ln.color || "#38bdf8");
        const isSel = ln.id === state.selectedLineId;
        ctx.save();
        ctx.globalAlpha = normOpacity(ln.opacity, 0.85);
        applyLineStyle(ctx, ln.lineStyle || "dashed");
        ctx.strokeStyle = isSel ? (light ? "#0f172a" : "#ffffff") : col;
        ctx.lineWidth = normLineWidth(ln.lineWidth, 1.8) + (isSel ? 0.8 : 0);
        ctx.beginPath();
        if (ln.orientation === "horizontal") {
          const sy = yToS(ln.value); ctx.moveTo(0, sy); ctx.lineTo(w, sy);
        } else {
          const sx = xToS(ln.value); ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
        }
        ctx.stroke();
        ctx.restore();
      } else if (el.kind === "shape") {
        const s = el.item;
        if (!s.visible) continue;
        /* Multi-element tethered Image Element rendering (maps multiple shapes, vectors & points as one!) */
        if (s.kind === "image" && Array.isArray(s._mappedItems) && s._mappedItems.length > 0) {
          const col = themeCol(s.color || "#fbbf24");
          const lw = normLineWidth(s.lineWidth, 2.4);
          const isSel = isShapeSelected(s.id);
          const isHi = isSel || s.id === state.hoveredShapeId;
          ctx.save();
          for (const mi of s._mappedItems) {
            if (mi.kind === "vector" && mi.pts && mi.pts.length >= 2) {
              drawCrispArrow(ctx, xToS(mi.pts[0].x), yToS(mi.pts[0].y), xToS(mi.pts[1].x), yToS(mi.pts[1].y), isHi ? (light ? "#0f172a" : "#ffffff") : col, Math.max(2.4, lw), 11);
            } else if (mi.kind === "point" && mi.pt) {
              const px = xToS(mi.pt.x), py = yToS(mi.pt.y);
              ctx.fillStyle = col; ctx.strokeStyle = light ? "#ffffff" : "#0a0e17"; ctx.lineWidth = 1.6;
              ctx.beginPath(); ctx.arc(px, py, 5.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            } else if (mi.pts && mi.pts.length >= 2) {
              ctx.beginPath();
              for (let i = 0; i < mi.pts.length; i++) {
                const sx = xToS(mi.pts[i].x), sy = yToS(mi.pts[i].y);
                if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
              }
              if (mi.closed) { ctx.closePath(); ctx.fillStyle = themeRgba(s.color || "#fbbf24", 0.16); ctx.fill(); }
              ctx.strokeStyle = isHi ? (light ? "#0f172a" : "#ffffff") : col;
              ctx.lineWidth = lw;
              ctx.stroke();
            }
          }
          ctx.restore();
          continue;
        }
        if (!s.rawPts || s.rawPts.length < 2) continue;
        const pts = expandLinearPts(s);
        const isSel = isShapeSelected(s.id);
        const isHi = isSel || s.id === state.hoveredShapeId;
        const col = themeCol(s.color || "#34d399");
        const lw = normLineWidth(s.lineWidth, 2.4);
        const op = normOpacity(s.opacity, s.closed ? 0.14 : 1.0);
        ctx.save();
        if (s.kind === "vector" && s.rawPts.length >= 2) {
          const a = s.rawPts[0], b = s.rawPts[s.rawPts.length - 1];
          const ax = xToS(a.x), ay = yToS(a.y), bx = xToS(b.x), by = yToS(b.y);
          drawCrispArrow(ctx, ax, ay, bx, by, isHi ? (light ? "#0f172a" : "#ffffff") : col, Math.max(2.4, lw), 11);
          /* Show subtle grabbable endpoint dots on unlocked, non-tethered vectors */
          if (!s.locked && !s.imageOf) {
            const hovStart = state.hoveredVecHandle && state.hoveredVecHandle.shapeId === s.id && state.hoveredVecHandle.handleId === "start";
            const hovEnd = state.hoveredVecHandle && state.hoveredVecHandle.shapeId === s.id && state.hoveredVecHandle.handleId === "end";
            ctx.fillStyle = hovStart ? "#ffffff" : (light ? "#ffffff" : "#0a0e17");
            ctx.strokeStyle = hovStart ? "#38bdf8" : col;
            ctx.lineWidth = hovStart ? 2.4 : 1.8;
            ctx.beginPath(); ctx.arc(ax, ay, hovStart ? 5.2 : 3.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            if (hovEnd || isSel) {
              ctx.fillStyle = hovEnd ? "#ffffff" : "rgba(56, 189, 248, 0.25)";
              ctx.strokeStyle = "#38bdf8";
              ctx.lineWidth = hovEnd ? 2.2 : 1.5;
              ctx.beginPath(); ctx.arc(bx, by, hovEnd ? 6.0 : 4.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            }
          }
          ctx.restore();
          continue;
        }
        applyLineStyle(ctx, s.lineStyle || "solid");
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const sx = xToS(pts[i].x), sy = yToS(pts[i].y);
          if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
        if (s.closed) ctx.closePath();
        if (s.closed && op > 0.004) {
          ctx.fillStyle = themeRgba(s.color || "#34d399", op);
          ctx.fill();
        }
        if (lw > 0) {
          ctx.strokeStyle = themeRgba(s.color || "#34d399", isHi ? 0.5 : 0.24);
          ctx.lineWidth = lw + (isHi ? 5 : 3);
          ctx.stroke();
          ctx.strokeStyle = isHi ? (light ? "#0f172a" : "#ffffff") : col;
          ctx.lineWidth = lw;
          ctx.stroke();
        }
        /* Orientation arrow on paths & loops */
        if (s.rawPts.length >= 2 && s.kind !== "infline") {
          const mid = Math.floor(s.rawPts.length * 0.25);
          const a = s.rawPts[mid], b = s.rawPts[(mid + 1) % s.rawPts.length];
          if (a && b) {
            const ax = xToS(a.x), ay = yToS(a.y), bx = xToS(b.x), by = yToS(b.y);
            const ang = Math.atan2(by - ay, bx - ax);
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx - 9.5 * Math.cos(ang - 0.42), by - 9.5 * Math.sin(ang - 0.42));
            ctx.lineTo(bx - 9.5 * Math.cos(ang + 0.42), by - 9.5 * Math.sin(ang + 0.42));
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.restore();
      } else if (el.kind === "point") {
        const p = el.item;
        if (!p.visible) continue;
        const sx = xToS(p.x), sy = yToS(p.y);
        const col = themeCol(p.color || "#fbbf24");
        const sz = Math.max(4, Number(p.size) || 5.5);
        const isSel = isPointSelected(p.id);
        ctx.save();
        ctx.globalAlpha = normOpacity(p.opacity, 1.0);
        ctx.fillStyle = themeRgba(p.color || "#fbbf24", isSel ? 0.4 : 0.24);
        ctx.beginPath(); ctx.arc(sx, sy, sz + (isSel ? 6 : 4), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col;
        ctx.strokeStyle = isSel ? "#ffffff" : (light ? "#ffffff" : "#080c14");
        ctx.lineWidth = isSel ? 2.2 : 1.6;
        ctx.beginPath(); ctx.arc(sx, sy, sz, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (p.showLabel !== false && p.label) {
          ctx.font = '600 11px "JetBrains Mono", monospace';
          ctx.fillStyle = light ? "#0f172a" : "#f8fafc";
          ctx.fillText(p.label, sx + sz + 5, sy + 4);
        }
        ctx.restore();
      }
    }

    /* 4. Standardized Group Bounding Box OR Single-Shape Resize & Rotate Handles (Parity with Complex & Real!) */
    const groupBb = getGroupBox();
    if (groupBb && window.CFVGeom) {
      window.CFVGeom.drawGroupBoxAndHandles(ctx, groupBb, xToS, yToS, getGroupRotateInfo(), light, Boolean(state.dragGroup && state.dragGroup.mode === "rotate"));
    } else {
      const selShape = state.selectedShapeId !== null ? state.shapes.find((s) => s.id === state.selectedShapeId && s.visible && !s.locked && !s.imageOf) : null;
      if (selShape) {
        const handles = getResizeHandles(selShape);
        ctx.save();
        for (const hd of handles) {
          const sx = xToS(hd.x), sy = yToS(hd.y);
          ctx.fillStyle = light ? "#ffffff" : "#0a0e17"; ctx.strokeStyle = light ? "#0284c7" : "#38bdf8"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.rect(sx - 4.5, sy - 4.5, 9, 9); ctx.fill(); ctx.stroke();
        }
        const rot = getRotateHandle(selShape);
        if (rot) {
          ctx.strokeStyle = light ? "rgba(2, 132, 199, 0.85)" : "rgba(56, 189, 248, 0.85)"; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(rot.stemX, rot.stemY); ctx.lineTo(rot.handleX, rot.handleY); ctx.stroke();
          ctx.fillStyle = state.dragRotate ? "#38bdf8" : (light ? "#ffffff" : "#0a0e17");
          ctx.beginPath(); ctx.arc(rot.handleX, rot.handleY, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
      }
    }

    /* 4.5. Marquee Multi-Select Box (Standardized Move Mode!) */
    if (state.marquee && window.CFVGeom) {
      window.CFVGeom.drawMarqueeRect(ctx, state.marquee.x0, state.marquee.y0, state.marquee.x1, state.marquee.y1, light);
    }

    /* 4.6. Live Faint Gold Ghost Preview during Interactive f(·) Domain Selection Mode! */
    if (ws() && ws().isImagePickerActive && ws().isImagePickerActive() && ws().evalLinearAlgebraState) {
      const la = ws().evalLinearAlgebraState();
      const A = la && la.activeMatrix && la.activeMatrix.info ? la.activeMatrix.info : null;
      if (A) {
        ctx.save();
        ctx.globalAlpha = 0.52;
        ctx.setLineDash([5, 4]);
        for (const s of state.shapes) {
          if (!s.visible || !isShapeSelected(s.id) || !s.rawPts || s.rawPts.length < 2) continue;
          if (s.kind === "vector") {
            const p0 = s.rawPts[0], p1 = s.rawPts[s.rawPts.length - 1];
            const dx = p1.x - p0.x, dy = p1.y - p0.y;
            drawCrispArrow(ctx, xToS(p0.x), yToS(p0.y), xToS(p0.x + A.a * dx + A.b * dy), yToS(p0.y + A.c * dx + A.d * dy), "#fbbf24", 2.4, 9);
          } else {
            ctx.beginPath();
            s.rawPts.forEach((p, idx) => {
              const mx = xToS(A.a * p.x + A.b * p.y), my = yToS(A.c * p.x + A.d * p.y);
              if (idx === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
            });
            if (s.closed) ctx.closePath();
            ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 2; ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    /* 5. Live Drawing & Polygon Drafts */
    if (state.drawing && state.drawing.rawPts.length >= 2) {
      ctx.save();
      ctx.strokeStyle = state.drawing.color; ctx.lineWidth = 2.4; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      for (let i = 0; i < state.drawing.rawPts.length; i++) {
        const p = state.drawing.rawPts[i];
        if (i === 0) ctx.moveTo(xToS(p.x), yToS(p.y)); else ctx.lineTo(xToS(p.x), yToS(p.y));
      }
      if (state.drawing.closed) ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    if (state.polyDraft && state.polyDraft.rawPts.length >= 1) {
      const pts = state.polyDraft.hoverPt ? [...state.polyDraft.rawPts, state.polyDraft.hoverPt] : state.polyDraft.rawPts;
      ctx.save(); ctx.strokeStyle = "#34d399"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      pts.forEach((p, i) => { if (i === 0) ctx.moveTo(xToS(p.x), yToS(p.y)); else ctx.lineTo(xToS(p.x), yToS(p.y)); });
      ctx.stroke(); ctx.restore();
    }

    /* 5.5. Standardized Smart Magnetic Snap Indicator (Shared across Complex, Real & Vector!) */
    if (state.snapIndicator && window.CFVGeom && window.CFVGeom.drawSnapIndicator) {
      window.CFVGeom.drawSnapIndicator(ctx, state.snapIndicator, xToS, yToS, light);
    }

    /* 6. Live Cursor Probe & Tangent Vector Arrow */
    if (state.hoverWorld && state.grid) {
      const f = sampleGridField(state.hoverWorld.x, state.hoverWorld.y);
      if (f) {
        const sx = xToS(state.hoverWorld.x), sy = yToS(state.hoverWorld.y);
        const len = Math.min(44, Math.max(12, 16 * Math.log1p(f.mag)));
        const ux = f.mag > 1e-8 ? f.fx / f.mag : 0, uy = f.mag > 1e-8 ? -f.fy / f.mag : 0;
        ctx.save();
        ctx.strokeStyle = light ? "#0f172a" : "#ffffff"; ctx.lineWidth = 2.1;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + ux * len, sy + uy * len); ctx.stroke();
        ctx.fillStyle = "#38bdf8";
        ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    /* 7. Inline LaTeX Text Boxes */
    if (window.CFVAnnotations && state.texts.length > 0) {
      window.CFVAnnotations.drawTextBoxes(ctx, canvas, state.texts, {
        plane: "real",
        isLight: light,
        selectedTextId: state.selectedTextId,
        hoveredTextId: state.hoveredTextId,
        worldToScreen: (wx, wy) => ({ x: xToS(wx), y: yToS(wy) }),
      });
    } else if (canvas) {
      canvas._textLayouts = [];
    }

    ctx.restore();
  }

  /* -------------------------------------------------------------------------
   * Hit Testing, Tool Bar & Event Handlers
   * ------------------------------------------------------------------------- */
  function hitShape(sx, sy) {
    const wx = sToX(sx), wy = sToY(sy);
    for (let i = state.shapes.length - 1; i >= 0; i--) {
      const s = state.shapes[i];
      if (!s.visible || !s.rawPts || s.rawPts.length < 2) continue;
      const pts = expandLinearPts(s);
      const n = s.closed ? pts.length : pts.length - 1;
      for (let k = 0; k < n; k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length];
        const d = window.CFVGeom ? window.CFVGeom.distPtToSeg(sx, sy, xToS(a.x), yToS(a.y), xToS(b.x), yToS(b.y)) : 999;
        if (d <= 11) return s;
      }
      if (s.closed && window.CFVGeom && window.CFVGeom.pointInPolygon(wx, wy, pts)) return s;
    }
    return null;
  }
  function hitPoint(sx, sy) {
    for (let i = state.points.length - 1; i >= 0; i--) {
      const p = state.points[i];
      if (p.visible && Math.hypot(sx - xToS(p.x), sy - yToS(p.y)) <= 12) return p;
    }
    return null;
  }

  function setTool(t) {
    state.tool = t;
    state.polyDraft = null;
    document.querySelectorAll(".vec-dock-tool[data-vec-tool]").forEach((b) => b.classList.toggle("active", b.dataset.vecTool === t));
    if (cardEl) {
      cardEl.classList.toggle("move-mode", t === "move");
      cardEl.classList.toggle("pan-mode", t === "pan");
    }
  }

  function syncToolbarUI() {
    const { tgt, isScalar, isVectorLike } = getActiveKindInfo();
    const hmSel = document.getElementById("vec-heatmap-select");
    if (hmSel) hmSel.value = state.heatmap;
    const syncPair = (chkId, pillId, val, dimmed, dimReason) => {
      const c = document.getElementById(chkId), p = document.getElementById(pillId);
      if (c) c.checked = Boolean(val);
      if (p) {
        p.classList.toggle("active", Boolean(val));
        p.classList.toggle("dimmed-inactive", Boolean(dimmed));
        if (dimmed && dimReason) p.title = dimReason;
      }
    };
    const vecDim = !tgt || !isVectorLike;
    const scaDim = !tgt || !isScalar;
    syncPair("opt-vec-arrows", "btn-vec-arrows", state.showArrows, vecDim, "Arrows only graph Vector Functions F(x,y) → ℝ² (select a vector function)");
    syncPair("opt-vec-streamlines", "btn-vec-streams", state.showStreamlines, vecDim, "Streams only graph Vector Functions F(x,y) → ℝ² (select a vector function)");
    syncPair("opt-vec-equipot", "btn-vec-equipot", state.showEquipotentials, scaDim, "Contours only graph Scalar Functions f(x,y) → ℝ (select a scalar function)");
    syncPair("opt-vec-particles", "btn-vec-particles", state.showParticles, vecDim, "Flow only graphs Vector Functions F(x,y) → ℝ² (select a vector function)");
    const mgBtn = document.getElementById("btn-vec-mgrid");
    if (mgBtn) {
      mgBtn.classList.toggle("active", state.showTransformGrid);
      mgBtn.classList.toggle("dimmed-inactive", vecDim);
    }
    const sqBtn = document.getElementById("vec-square");
    if (sqBtn) sqBtn.classList.toggle("active", state.squareAspect);
  }

  function bindEvents() {
    if (!canvas) return;
    document.querySelectorAll(".vec-dock-tool[data-vec-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.vecTool)));

    const bindToggle = (chkId, pillId, key, refetch, rebuildStatic) => {
      const apply = (next) => {
        state[key] = Boolean(next);
        syncToolbarUI();
        if (key === "showEquipotentials") buildEquipotentialSegments();
        if (rebuildStatic) state.staticDirty = true;
        if (refetch) scheduleFetch(true, false);
        else requestRender();
        notifyState(true);
      };
      const c = document.getElementById(chkId);
      if (c) c.addEventListener("change", () => apply(c.checked));
      const p = document.getElementById(pillId);
      if (p) p.addEventListener("click", () => apply(!state[key]));
    };
    bindToggle("opt-vec-arrows", "btn-vec-arrows", "showArrows", false, true);
    bindToggle("opt-vec-streamlines", "btn-vec-streams", "showStreamlines", true, true);
    bindToggle("opt-vec-equipot", "btn-vec-equipot", "showEquipotentials", false, true);
    bindToggle("opt-vec-particles", "btn-vec-particles", "showParticles", false, false);
    bindToggle("__none__", "btn-vec-mgrid", "showTransformGrid", false, false);

    const hmSel = document.getElementById("vec-heatmap-select");
    if (hmSel) hmSel.addEventListener("change", () => {
      state.heatmap = hmSel.value;
      buildHeatmapCanvas();
      if (state.showEquipotentials) buildEquipotentialSegments();
      requestRender(true);
      notifyState(true);
    });
    const densEl = document.getElementById("opt-vec-density");
    if (densEl) densEl.addEventListener("input", () => {
      state.arrowDensity = Number(densEl.value) || 20;
      const v = document.getElementById("opt-vec-density-val");
      if (v) v.textContent = String(state.arrowDensity);
      requestRender(true);
    });

    const bJoin = document.getElementById("btn-vec-join-shapes");
    if (bJoin) bJoin.addEventListener("click", () => joinConnectedShapes());
    const bClose = document.getElementById("btn-vec-close-shape");
    if (bClose) bClose.addEventListener("click", async () => {
      const s = state.shapes.find((q) => q.id === state.selectedShapeId);
      if (!s || s.locked) return;
      pushUndo(); s.closed = !s.closed;
      await recomputeShapeIntegral(s); updateIntegralPanel(); notifyDomain(); requestRender();
    });
    const bRev = document.getElementById("btn-vec-reverse-shape");
    if (bRev) bRev.addEventListener("click", async () => {
      const s = state.shapes.find((q) => q.id === state.selectedShapeId);
      if (!s || s.locked) return;
      pushUndo(); s.rawPts.reverse();
      await recomputeShapeIntegral(s); updateIntegralPanel(); requestRender();
    });
    const bUndo = document.getElementById("btn-vec-undo");
    if (bUndo) bUndo.addEventListener("click", () => undoAction());
    const bClear = document.getElementById("btn-vec-clear");
    if (bClear) bClear.addEventListener("click", () => {
      if (!state.shapes.some((s) => !s.locked) && !state.points.some((p) => !p.locked)) return;
      pushUndo();
      state.shapes = state.shapes.filter((s) => s.locked);
      state.points = state.points.filter((p) => p.locked);
      state.lines = state.lines.filter((l) => l.locked);
      syncLayerOrder(); updateIntegralPanel(); notifyDomain(); notifyState(true); requestRender();
    });

    const sqBtn = document.getElementById("vec-square");
    if (sqBtn) sqBtn.addEventListener("click", () => {
      state.squareAspect = !state.squareAspect;
      sqBtn.classList.toggle("active", state.squareAspect);
      if (state.squareAspect) applySquareAspect();
      state.staticDirty = true;
      scheduleFetch(true, false);
    });
    const zoomVec = (f) => {
      const cx = 0.5 * (state.view.xmin + state.view.xmax), cy = 0.5 * (state.view.ymin + state.view.ymax);
      const hw = 0.5 * (state.view.xmax - state.view.xmin) * f, hh = 0.5 * (state.view.ymax - state.view.ymin) * f;
      state.view = { xmin: cx - hw, xmax: cx + hw, ymin: cy - hh, ymax: cy + hh };
      state.staticDirty = true;
      scheduleFetch(false, true);
    };
    const bZi = document.getElementById("vec-zoom-in"); if (bZi) bZi.addEventListener("click", () => zoomVec(1 / 1.3));
    const bZo = document.getElementById("vec-zoom-out"); if (bZo) bZo.addEventListener("click", () => zoomVec(1.3));
    const bRst = document.getElementById("vec-reset");
    if (bRst) bRst.addEventListener("click", () => { state.view = { ...state.defaultView }; applySquareAspect(); state.staticDirty = true; scheduleFetch(true, false); });

    if (intPanel && window.CFVGeom && window.CFVGeom.attachFloatingPanel) {
      window.CFVGeom.attachFloatingPanel(intPanel, {
        containerEl: cardEl,
        headerEl: document.getElementById("vector-integral-hdr"),
        minBtnEl: document.getElementById("btn-min-vec-integral"),
        resizeHandleEl: document.getElementById("vector-integral-resize-handle"),
        minSumEl: document.getElementById("vector-integral-min-sum"),
      });
    }

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      state.hoverWorld = null; /* Never leave the cursor probe stuck while dragging! */
      const pos = localPos(e);
      const wx = sToX(pos.x), wy = sToY(pos.y);

      if (e.button === 0 && window.CFVAnnotations && state.texts.length > 0) {
        const tbHit = window.CFVAnnotations.hitTestTextBoxes(ctx, canvas, state.texts, pos.x, pos.y, { plane: "real" });
        if (tbHit) {
          selectTextBox(tbHit.tb.id);
          if (!tbHit.tb.locked) {
            pushUndo();
            state.dragText = { tb: tbHit.tb, mode: tbHit.hit, startX: pos.x, startY: pos.y, origBx: tbHit.bx, origBy: tbHit.by, origW: tbHit.boxW, origH: tbHit.boxH };
          }
          return;
        }
      }

      if (e.button === 1 || e.button === 2 || state.tool === "pan" || state.spaceHeld || e.altKey) {
        state.pan = { startX: pos.x, startY: pos.y, orig: { ...state.view }, rightClick: e.button === 2, clientX: e.clientX, clientY: e.clientY };
        return;
      }

      if (state.tool === "point") {
        const sn = findSmartVecSnap(pos, { shiftKey: e.shiftKey });
        addPoint({ x: sn ? sn.x : wx, y: sn ? sn.y : wy });
        state.snapIndicator = null;
        return;
      }
      if (state.tool === "text") {
        addTextBox({ anchor: "free", nx: pos.x / (canvas.clientWidth || 600), ny: pos.y / (canvas.clientHeight || 400) });
        return;
      }
      if (state.tool === "polygon") {
        const sn = findSmartVecSnap(pos, { shiftKey: e.shiftKey });
        const pt = sn ? { x: sn.x, y: sn.y } : { x: wx, y: wy };
        if (!state.polyDraft) state.polyDraft = { rawPts: [pt], hoverPt: pt };
        else state.polyDraft.rawPts.push(pt);
        requestRender();
        return;
      }

      if (state.tool === "move") {
        const multiMod = Boolean(e.shiftKey || e.ctrlKey || e.metaKey);
        const startGroupDrag = (mode, handle, narrowTo) => {
          const items = getSelectedMovableItems();
          if (items.total < 2) return false;
          pushUndo();
          const bb = getGroupBox();
          state.dragGroup = {
            mode, handle, startWx: wx, startWy: wy, origBox: bb,
            cx: bb ? bb.cx : 0, cy: bb ? bb.cy : 0,
            startAng: bb ? Math.atan2(wy - bb.cy, wx - bb.cx) : 0,
            shapes: items.shapes.map((s) => ({ sh: s, origPts: s.rawPts.map((p) => ({ x: p.x, y: p.y })) })),
            points: items.points.map((p) => ({ pt: p, origX: p.x, origY: p.y })),
            moved: false, narrowTo: narrowTo || null,
          };
          return true;
        };

        /* Magnetic snap helper: snaps vector nodes to Origin (0,0), visible Points, or Shift-grid */
        const hitVecEnd = (sx, sy) => {
          for (let i = state.shapes.length - 1; i >= 0; i--) {
            const s = state.shapes[i];
            if (!s.visible || s.locked || s.imageOf || s.kind !== "vector" || !s.rawPts || s.rawPts.length < 2) continue;
            const p0 = s.rawPts[0], p1 = s.rawPts[s.rawPts.length - 1];
            if (Math.hypot(sx - xToS(p1.x), sy - yToS(p1.y)) <= 14) {
              return { sh: s, handle: { id: "end", x: p1.x, y: p1.y, shapeKind: "line" } };
            }
            if (Math.hypot(sx - xToS(p0.x), sy - yToS(p0.y)) <= 14) {
              return { sh: s, handle: { id: "start", x: p0.x, y: p0.y, shapeKind: "line" } };
            }
          }
          return null;
        };

        /* Check parametric curve γ(t) scrubbable dot first! */
        const { isCurve } = getActiveKindInfo();
        if (isCurve && state.curvePts && state.curvePts.length >= 2) {
          const idx = Math.max(0, Math.min(state.curvePts.length - 1, state.curveTIdx || 0));
          const cp = state.curvePts[idx];
          if (cp && Math.hypot(pos.x - xToS(cp.x), pos.y - yToS(cp.y)) <= 14) {
            state.dragCurveDot = true;
            return;
          }
        }
        /* 0. Check draggable 2D Vector Card tips first (60 FPS Linear Algebra dragging!) */
        const vcHit = !multiMod ? hitVecCardTip(pos.x, pos.y) : null;
        if (vcHit) {
          state.dragVecCard = { cardId: vcHit.id };
          return;
        }
        /* 0.5. Group Rotate & Group Resize Handles (when 2+ movable items selected!) */
        if (!multiMod && getSelectedMovableItems().total >= 2) {
          const gRot = getGroupRotateInfo();
          if (gRot && Math.hypot(pos.x - gRot.handleX, pos.y - gRot.handleY) <= HANDLE_HIT_PX + 3) {
            if (startGroupDrag("rotate", null, null)) return;
          }
          const gh = hitGroupHandle(pos.x, pos.y);
          if (gh) {
            if (startGroupDrag("resize", gh.handle, null)) return;
          }
        }
        /* 1. Check single selected shape rotate & resize handles (never on locked or tethered imageOf shapes!) */
        const selS = (!multiMod && getSelectedMovableItems().total < 2 && state.selectedShapeId !== null)
          ? state.shapes.find((s) => s.id === state.selectedShapeId && !s.locked && !s.imageOf)
          : null;
        if (selS) {
          const rot = getRotateHandle(selS);
          if (rot && Math.hypot(pos.x - rot.handleX, pos.y - rot.handleY) <= HANDLE_HIT_PX + 2) {
            pushUndo();
            state.dragRotate = {
              sh: selS, cx: rot.cx, cy: rot.cy,
              startAng: Math.atan2(wy - rot.cy, wx - rot.cx),
              origPts: selS.rawPts.map((p) => ({ x: p.x, y: p.y })),
            };
            return;
          }
          for (const hd of getResizeHandles(selS)) {
            if (Math.hypot(pos.x - xToS(hd.x), pos.y - yToS(hd.y)) <= HANDLE_HIT_PX + 3) {
              pushUndo();
              state.dragResize = {
                sh: selS, handle: hd,
                origPts: selS.rawPts.map((p) => ({ x: p.x, y: p.y })),
                origBounds: window.CFVGeom.getShapeBounds(selS.rawPts),
                origFrame: selS.kind === "rect" ? window.CFVGeom.rectLocalFrame(selS.rawPts) : null,
              };
              return;
            }
          }
        }
        /* 2. Direct single-endpoint grab on ANY unlocked vector (tip always wins; tail wins unless sitting on an unselected movable Point) */
        const ptHit = hitPoint(pos.x, pos.y);
        const veHit = !multiMod ? hitVecEnd(pos.x, pos.y) : null;
        if (veHit && (veHit.handle.id === "end" || !ptHit || ptHit.locked || ptHit.imageOf || veHit.sh.id === state.selectedShapeId)) {
          selectShape(veHit.sh.id);
          pushUndo();
          state.dragResize = {
            sh: veHit.sh, handle: veHit.handle,
            origPts: veHit.sh.rawPts.map((p) => ({ x: p.x, y: p.y })),
            origBounds: window.CFVGeom.getShapeBounds(veHit.sh.rawPts),
            origFrame: null,
          };
          return;
        }
        /* 3. Point hit (supports Shift/Ctrl toggle multi-select & group drag!) */
        if (ptHit && !((ptHit.locked || ptHit.imageOf) && !multiMod && hitGroupBox(pos.x, pos.y))) {
          if (multiMod) { selectPoint(ptHit.id, { toggle: true }); return; }
          if (isPointSelected(ptHit.id) && getSelectedMovableItems().total >= 2 && !ptHit.locked && !ptHit.imageOf) {
            if (startGroupDrag("move", null, { kind: "point", id: ptHit.id })) return;
          }
          selectPoint(ptHit.id);
          if (!ptHit.locked && !ptHit.imageOf) {
            pushUndo();
            state.dragPoint = { pt: ptHit, startWx: wx, startWy: wy, origX: ptHit.x, origY: ptHit.y };
          }
          return;
        }
        /* 4. Shape hit (supports Shift/Ctrl toggle multi-select & group drag!) */
        const shHit = hitShape(pos.x, pos.y);
        if (shHit) {
          if (multiMod) { selectShape(shHit.id, { toggle: true }); return; }
          if (isShapeSelected(shHit.id) && getSelectedMovableItems().total >= 2 && !shHit.locked && !shHit.imageOf) {
            if (startGroupDrag("move", null, { kind: "shape", id: shHit.id })) return;
          }
          selectShape(shHit.id);
          if (!shHit.locked && !shHit.imageOf) {
            pushUndo();
            state.dragShape = { sh: shHit, startWx: wx, startWy: wy, origPts: shHit.rawPts.map((p) => ({ x: p.x, y: p.y })) };
          }
          return;
        }
        /* 5. Drag inside existing multi-selection Group Bounding Box moves the whole group! */
        if (!multiMod && hitGroupBox(pos.x, pos.y)) {
          if (startGroupDrag("move", null, null)) return;
        }
        /* 6. Empty space in Move Mode -> Standardized Marquee Box Multi-Select (NEVER pans — use Pan tool / Right-drag / Space+drag to pan!) */
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

      const closed = state.tool === "circle" || state.tool === "rect";
      const snStart = findSmartVecSnap(pos, { shiftKey: e.shiftKey, includeGrid: true });
      const anchor = snStart ? { x: snStart.x, y: snStart.y } : { x: wx, y: wy };
      const anchorPointId = (state.tool === "vector" && snStart && snStart.kind === "point" && snStart.pointId !== undefined) ? snStart.pointId : null;
      state.snapIndicator = snStart && snStart.kind !== "grid" ? snStart : null;
      state.drawing = { kind: state.tool, color: state.tool === "vector" ? "#38bdf8" : "#34d399", closed, anchor, anchorPointId, rawPts: [{ ...anchor }] };
      requestRender();
    });

    canvas.addEventListener("dblclick", async () => {
      if (state.polyDraft && state.polyDraft.rawPts.length >= 3) {
        pushUndo();
        const sh = {
          id: state.nextShapeId++, kind: "polygon", label: `Polygon ${state.shapes.length + 1}`,
          color: "#34d399", lineWidth: 2.4, opacity: 0.14, lineStyle: "solid",
          closed: true, locked: false, visible: true, rawPts: state.polyDraft.rawPts,
        };
        state.polyDraft = null;
        state.shapes.push(sh);
        selectShape(sh.id);
        syncLayerOrder();
        await recomputeShapeIntegral(sh);
        updateIntegralPanel();
        notifyState(true);
      }
    });

    function findSmartVecSnap(pos, opts = {}) {
      if (!window.CFVGeom || !window.CFVGeom.findSmartSnap) return null;
      return window.CFVGeom.findSmartSnap(pos.x, pos.y, {
        shapes: state.shapes,
        points: state.points,
        lines: state.lines,
        xToS,
        yToS,
        sToX,
        sToY,
        snapPx: 14,
        ...opts,
      });
    }

    const snapVectorNode = (pos, wx, wy, shiftKey, excludeShapeId = null, excludePointId = null) => {
      const sn = findSmartVecSnap(pos, { shiftKey, includeGrid: true, excludeShapeId, excludePointId });
      if (sn) {
        return {
          x: sn.x,
          y: sn.y,
          snap: sn.kind !== "grid" ? sn : null,
          anchorPointId: sn.kind === "point" && sn.pointId !== undefined ? sn.pointId : null,
        };
      }
      return { x: wx, y: wy, snap: null, anchorPointId: null };
    };

    canvas.addEventListener("pointermove", (e) => {
      const pos = localPos(e);
      const wx = sToX(pos.x), wy = sToY(pos.y);

      if (state.dragCurveDot && state.curvePts && state.curvePts.length >= 2) {
        let bestIdx = state.curveTIdx || 0, bestD = Infinity;
        for (let i = 0; i < state.curvePts.length; i++) {
          const cp = state.curvePts[i];
          if (!cp) continue;
          const d = Math.hypot(pos.x - xToS(cp.x), pos.y - yToS(cp.y));
          if (d < bestD) { bestD = d; bestIdx = i; }
        }
        state.curveTIdx = bestIdx;
        requestRender();
        return;
      }
      if (state.dragCurveDot) { state.dragCurveDot = false; return; }
      if (state.dragVecCard) {
        state.hoverWorld = null;
        const sn = snapVectorNode(pos, wx, wy, e.shiftKey);
        state.snapIndicator = sn.snap;
        if (ws() && ws().setVectorCardCoords) ws().setVectorCardCoords(state.dragVecCard.cardId, sn.x, sn.y, false);
        requestRender();
        return;
      }
      if (state.dragText) {
        const dt = state.dragText, dx = pos.x - dt.startX, dy = pos.y - dt.startY;
        const cw = canvas.clientWidth || 600, ch = canvas.clientHeight || 400;
        if (dt.mode === "resize") {
          dt.tb.width = Math.round(Math.max(150, Math.min(cw - 20, dt.origW + dx)));
          dt.tb.height = Math.round(Math.max(44, Math.min(ch - 20, dt.origH + dy)));
        } else {
          dt.tb.anchor = "free";
          dt.tb.nx = Number(Math.max(0.01, Math.min(0.95, (dt.origBx + dx) / cw)).toFixed(4));
          dt.tb.ny = Number(Math.max(0.01, Math.min(0.95, (dt.origBy + dy) / ch)).toFixed(4));
        }
        requestRender(); return;
      }
      if (state.pan) {
        const w = canvas.clientWidth || 600, h = canvas.clientHeight || 400;
        const dx = -((pos.x - state.pan.startX) / w) * (state.pan.orig.xmax - state.pan.orig.xmin);
        const dy = ((pos.y - state.pan.startY) / h) * (state.pan.orig.ymax - state.pan.orig.ymin);
        state.view = { xmin: state.pan.orig.xmin + dx, xmax: state.pan.orig.xmax + dx, ymin: state.pan.orig.ymin + dy, ymax: state.pan.orig.ymax + dy };
        requestRender(true);
        /* Seamless overscan: only refetch mid-drag if panning approaches the 45% overscan edge! */
        if (viewOutsideGridMargin()) scheduleFetch(false, true);
        return;
      }
      if (state.marquee) {
        const m = state.marquee;
        m.x1 = pos.x; m.y1 = pos.y;
        const rx0 = Math.min(sToX(m.x0), sToX(m.x1)), rx1 = Math.max(sToX(m.x0), sToX(m.x1));
        const ry0 = Math.min(sToY(m.y0), sToY(m.y1)), ry1 = Math.max(sToY(m.y0), sToY(m.y1));
        const nextS = m.additive ? new Set(m.prevShapes) : new Set();
        const nextP = m.additive ? new Set(m.prevPoints) : new Set();
        for (const s of state.shapes) {
          if (s.visible && window.CFVGeom && window.CFVGeom.shapeIntersectsRect(s.rawPts, rx0, rx1, ry0, ry1)) nextS.add(s.id);
        }
        for (const p of state.points) {
          if (p.visible && p.x >= rx0 && p.x <= rx1 && p.y >= ry0 && p.y <= ry1) nextP.add(p.id);
        }
        state.selectedShapeIds = nextS;
        state.selectedPointIds = nextP;
        syncPrimarySelection();
        requestRender();
        return;
      }
      if (state.dragGroup) {
        const dg = state.dragGroup;
        dg.moved = true;
        if (dg.mode === "move") {
          const dx = wx - dg.startWx, dy = wy - dg.startWy;
          for (const it of dg.shapes) {
            if (it.sh.kind === "vector") it.sh.anchorPointId = null;
            it.sh.rawPts = it.origPts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
          }
          for (const it of dg.points) {
            it.pt.x = it.origX + dx; it.pt.y = it.origY + dy;
            if (ws() && ws().syncPointCoords) ws().syncPointCoords(it.pt);
          }
        } else if (dg.mode === "rotate") {
          let ang = Math.atan2(wy - dg.cy, wx - dg.cx) - dg.startAng;
          if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
          const ca = Math.cos(ang), sa = Math.sin(ang);
          for (const it of dg.shapes) {
            if (it.sh.kind === "vector") it.sh.anchorPointId = null;
            it.sh.rawPts = it.origPts.map((p) => {
              const rx = p.x - dg.cx, ry = p.y - dg.cy;
              return { x: dg.cx + rx * ca - ry * sa, y: dg.cy + rx * sa + ry * ca };
            });
          }
          for (const it of dg.points) {
            const rx = it.origX - dg.cx, ry = it.origY - dg.cy;
            it.pt.x = dg.cx + rx * ca - ry * sa;
            it.pt.y = dg.cy + rx * sa + ry * ca;
            if (ws() && ws().syncPointCoords) ws().syncPointCoords(it.pt);
          }
        } else if (dg.mode === "resize" && dg.origBox && dg.handle) {
          const b = dg.origBox, h = dg.handle;
          const ax = h.id.includes("w") ? b.xmax : (h.id.includes("e") ? b.xmin : b.cx);
          const ay = h.id.includes("s") ? b.ymax : (h.id.includes("n") ? b.ymin : b.cy);
          const denX = h.id.includes("w") ? (b.xmin - ax) : (h.id.includes("e") ? (b.xmax - ax) : 1);
          const denY = h.id.includes("s") ? (b.ymin - ay) : (h.id.includes("n") ? (b.ymax - ay) : 1);
          let sx = (h.id.includes("w") || h.id.includes("e")) && Math.abs(denX) > 1e-6 ? (wx - ax) / denX : 1;
          let sy = (h.id.includes("n") || h.id.includes("s")) && Math.abs(denY) > 1e-6 ? (wy - ay) / denY : 1;
          if (Math.abs(sx) < 0.04) sx = sx < 0 ? -0.04 : 0.04;
          if (Math.abs(sy) < 0.04) sy = sy < 0 ? -0.04 : 0.04;
          if (e.shiftKey && (h.id.length === 2)) {
            const u = Math.max(Math.abs(sx), Math.abs(sy));
            sx = Math.sign(sx || 1) * u; sy = Math.sign(sy || 1) * u;
          }
          for (const it of dg.shapes) {
            if (it.sh.kind === "vector") it.sh.anchorPointId = null;
            it.sh.rawPts = it.origPts.map((p) => ({ x: ax + (p.x - ax) * sx, y: ay + (p.y - ay) * sy }));
          }
          for (const it of dg.points) {
            it.pt.x = ax + (it.origX - ax) * sx;
            it.pt.y = ay + (it.origY - ay) * sy;
            if (ws() && ws().syncPointCoords) ws().syncPointCoords(it.pt);
          }
        }
        syncAnchoredVectors();
        scheduleImageRecompute();
        requestRender();
        return;
      }
      if (state.dragRotate) {
        const dr = state.dragRotate;
        let ang = Math.atan2(wy - dr.cy, wx - dr.cx) - dr.startAng;
        if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
        const ca = Math.cos(ang), sa = Math.sin(ang);
        dr.sh.rawPts = dr.origPts.map((p) => {
          const rx = p.x - dr.cx, ry = p.y - dr.cy;
          return { x: dr.cx + rx * ca - ry * sa, y: dr.cy + rx * sa + ry * ca };
        });
        scheduleImageRecompute();
        queueShapeIntegralLive(dr.sh);
        requestRender(); return;
      }
      if (state.dragResize) {
        const dr = state.dragResize, s = dr.sh, hd = dr.handle;
        const sn = snapVectorNode(pos, wx, wy, e.shiftKey, s.id, null);
        const tx = sn.x, ty = sn.y;
        state.snapIndicator = sn.snap;
        if (hd.shapeKind === "circle" && dr.origBounds) {
          const r = Math.max(0.05, Math.hypot(tx - dr.origBounds.cx, ty - dr.origBounds.cy));
          s.rawPts = window.CFVGeom.makeCirclePoints(dr.origBounds.cx, dr.origBounds.cy, r, 64);
        } else if (hd.shapeKind === "rect" && dr.origFrame) {
          const fr = dr.origFrame;
          const du = (tx - fr.cx) * fr.ux + (ty - fr.cy) * fr.uy;
          const dv = (tx - fr.cx) * fr.vx + (ty - fr.cy) * fr.vy;
          let u0 = -fr.halfU, u1 = fr.halfU, v0 = -fr.halfV, v1 = fr.halfV;
          if (hd.id.includes("e")) u1 = Math.max(u0 + 0.05, du);
          if (hd.id.includes("w")) u0 = Math.min(u1 - 0.05, du);
          if (hd.id.includes("n")) v1 = Math.max(v0 + 0.05, dv);
          if (hd.id.includes("s")) v0 = Math.min(v1 - 0.05, dv);
          const mk = (u, v) => ({ x: fr.cx + u * fr.ux + v * fr.vx, y: fr.cy + u * fr.uy + v * fr.vy });
          s.rawPts = [mk(u0, v0), mk(u1, v0), mk(u1, v1), mk(u0, v1)];
        } else if (hd.shapeKind === "line") {
          s.rawPts = dr.origPts.map((p) => ({ x: p.x, y: p.y }));
          if (s.kind === "vector") {
            if (hd.id === "start") {
              /* Drag ONLY the tail endpoint; tip stays fixed! Snaps to Origin, Points, Corners, Midpoints, Circle Diagonals, etc. */
              s.anchorPointId = sn.anchorPointId;
              s.rawPts[0] = { x: tx, y: ty };
            } else {
              /* Drag ONLY the tip endpoint; tail stays fixed! */
              s.rawPts[s.rawPts.length - 1] = { x: tx, y: ty };
            }
          } else {
            if (hd.id === "start") s.rawPts[0] = { x: tx, y: ty };
            else s.rawPts[s.rawPts.length - 1] = { x: tx, y: ty };
          }
        } else if (hd.shapeKind === "polygon" && Number.isInteger(hd.vertexIndex)) {
          s.rawPts = dr.origPts.map((p, idx) => (idx === hd.vertexIndex ? { x: tx, y: ty } : { x: p.x, y: p.y }));
        } else if (dr.origBounds) {
          const bb = dr.origBounds;
          const rx = Math.max(0.05, Math.abs(tx - bb.cx)) / Math.max(1e-4, 0.5 * (bb.maxX - bb.minX));
          const ry = Math.max(0.05, Math.abs(ty - bb.cy)) / Math.max(1e-4, 0.5 * (bb.maxY - bb.minY));
          s.rawPts = dr.origPts.map((p) => ({ x: bb.cx + (p.x - bb.cx) * rx, y: bb.cy + (p.y - bb.cy) * ry }));
        }
        scheduleImageRecompute();
        queueShapeIntegralLive(s);
        requestRender(); return;
      }
      if (state.dragPoint) {
        const pt = state.dragPoint.pt;
        const sn = snapVectorNode(pos, state.dragPoint.origX + (wx - state.dragPoint.startWx), state.dragPoint.origY + (wy - state.dragPoint.startWy), e.shiftKey, null, pt.id);
        state.snapIndicator = sn.snap;
        pt.x = sn.x;
        pt.y = sn.y;
        if (ws() && ws().syncPointCoords) ws().syncPointCoords(pt);
        syncAnchoredVectors();
        scheduleImageRecompute();
        requestRender(); return;
      }
      if (state.dragShape) {
        const dx = wx - state.dragShape.startWx, dy = wy - state.dragShape.startWy;
        if (state.dragShape.sh.kind === "vector") state.dragShape.sh.anchorPointId = null;
        state.dragShape.sh.rawPts = state.dragShape.origPts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
        scheduleImageRecompute();
        queueShapeIntegralLive(state.dragShape.sh);
        requestRender(); return;
      }
      if (state.polyDraft) {
        const sn = snapVectorNode(pos, wx, wy, e.shiftKey);
        state.snapIndicator = sn.snap;
        state.polyDraft.hoverPt = { x: sn.x, y: sn.y };
        requestRender(); return;
      }
      if (state.drawing) {
        const d = state.drawing;
        const sn = d.kind === "freehand" ? { x: wx, y: wy, snap: null } : snapVectorNode(pos, wx, wy, e.shiftKey);
        state.snapIndicator = sn.snap;
        const cx = sn.x, cy = sn.y;
        if (d.kind === "freehand") d.rawPts.push({ x: wx, y: wy });
        else if (d.kind === "vector" || d.kind === "seg" || d.kind === "ray" || d.kind === "infline") d.rawPts = [d.anchor, { x: cx, y: cy }];
        else if (d.kind === "circle") d.rawPts = window.CFVGeom.makeCirclePoints(d.anchor.x, d.anchor.y, Math.max(1e-3, Math.hypot(cx - d.anchor.x, cy - d.anchor.y)), 64);
        else if (d.kind === "rect") d.rawPts = window.CFVGeom.makeRectPoints(d.anchor.x, d.anchor.y, cx, cy);
        else if (d.kind === "arc") {
          const r = Math.max(1e-3, Math.hypot(cx - d.anchor.x, cy - d.anchor.y));
          const a0 = Math.atan2(cy - d.anchor.y, cx - d.anchor.x);
          d.rawPts = window.CFVGeom.makeArcPoints(d.anchor.x, d.anchor.y, r, a0, a0 + Math.PI, 48);
        }
        requestRender(); return;
      }

      /* Live hover highlight on group handles & vector endpoints in Move mode */
      let nextHov = null;
      let hoverCursor = "";
      if (state.tool === "move") {
        if (getSelectedMovableItems().total >= 2) {
          const gRot = getGroupRotateInfo();
          if (gRot && Math.hypot(pos.x - gRot.handleX, pos.y - gRot.handleY) <= HANDLE_HIT_PX + 3) hoverCursor = "grab";
          else {
            const gh = hitGroupHandle(pos.x, pos.y);
            if (gh) hoverCursor = gh.handle.cursor;
            else if (hitGroupBox(pos.x, pos.y)) hoverCursor = "move";
          }
        }
        if (!hoverCursor) {
          for (let i = state.shapes.length - 1; i >= 0; i--) {
            const s = state.shapes[i];
            if (!s.visible || s.locked || s.imageOf || s.kind !== "vector" || !s.rawPts || s.rawPts.length < 2) continue;
            const p0 = s.rawPts[0], p1 = s.rawPts[s.rawPts.length - 1];
            if (Math.hypot(pos.x - xToS(p1.x), pos.y - yToS(p1.y)) <= 14) { nextHov = { shapeId: s.id, handleId: "end" }; hoverCursor = "grab"; break; }
            if (Math.hypot(pos.x - xToS(p0.x), pos.y - yToS(p0.y)) <= 14) { nextHov = { shapeId: s.id, handleId: "start" }; hoverCursor = "grab"; break; }
          }
        }
      }
      const hovChanged = Boolean(nextHov) !== Boolean(state.hoveredVecHandle) ||
        (nextHov && state.hoveredVecHandle && (nextHov.shapeId !== state.hoveredVecHandle.shapeId || nextHov.handleId !== state.hoveredVecHandle.handleId));
      state.hoveredVecHandle = nextHov;
      canvas.style.cursor = hoverCursor;

      /* Live hover probe */
      state.hoverWorld = { x: wx, y: wy };
      const f = sampleGridField(wx, wy);
      if (readoutIn) readoutIn.textContent = `(${wx.toFixed(2)}, ${wy.toFixed(2)})`;
      if (readoutOut && f) {
        readoutOut.textContent = `(${f.fx.toFixed(2)}, ${f.fy.toFixed(2)}) · ∇·F=${Number.isFinite(f.div) ? f.div.toFixed(2) : "—"} · ∇×F=${Number.isFinite(f.curl) ? f.curl.toFixed(2) : "—"}`;
      }
      if (hovChanged || !state.showParticles) requestRender();
    });

    canvas.addEventListener("pointerup", async (e) => {
      state.snapIndicator = null;
      if (state.dragCurveDot) { state.dragCurveDot = false; return; }
      if (state.dragVecCard) {
        const cid = state.dragVecCard.cardId;
        state.dragVecCard = null;
        const pos = localPos(e);
        const sn = snapVectorNode(pos, sToX(pos.x), sToY(pos.y), e.shiftKey);
        if (ws() && ws().setVectorCardCoords) ws().setVectorCardCoords(cid, sn.x, sn.y, true);
        await recomputeImageElementsOnce();
        requestRender();
        return;
      }
      if (state.dragText) { state.dragText = null; notifyDomain(); notifyState(true); return; }
      if (state.pan) {
        const p = state.pan;
        state.pan = null;
        if (p.rightClick && Math.hypot(localPos(e).x - p.startX, localPos(e).y - p.startY) < 5) {
          const pos = localPos(e);
          const ptHit = hitPoint(pos.x, pos.y);
          if (ptHit && ws() && ws().openItemSettingsAt) { selectPoint(ptHit.id); ws().openItemSettingsAt("point", ptHit.id, e.clientX, e.clientY); return; }
          const shHit = hitShape(pos.x, pos.y);
          if (shHit && ws() && ws().openItemSettingsAt) { selectShape(shHit.id); ws().openItemSettingsAt("shape", shHit.id, e.clientX, e.clientY); return; }
        }
        scheduleFetch(true, false);
        return;
      }
      if (state.marquee) {
        state.marquee = null;
        syncPrimarySelection();
        notifyDomain();
        requestRender();
        return;
      }
      if (state.dragGroup) {
        const dg = state.dragGroup;
        state.dragGroup = null;
        if (!dg.moved && dg.narrowTo) {
          if (state.undoStack.length > 0) state.undoStack.pop();
          if (dg.narrowTo.kind === "shape") selectShape(dg.narrowTo.id);
          else if (dg.narrowTo.kind === "point") selectPoint(dg.narrowTo.id);
          return;
        }
        await recomputeImageElementsOnce();
        await recomputeAllIntegrals();
        if (dg.points.length > 0) scheduleFetch(true, false);
        notifyDomain();
        notifyState(true);
        requestRender();
        return;
      }
      if (state.dragPoint) { state.dragPoint = null; await recomputeImageElementsOnce(); scheduleFetch(true, false); notifyDomain(); notifyState(true); return; }
      if (state.dragRotate) { const sh = state.dragRotate.sh; state.dragRotate = null; await recomputeImageElementsOnce(); await recomputeShapeIntegral(sh); updateIntegralPanel(); notifyState(true); return; }
      if (state.dragResize) { const sh = state.dragResize.sh; state.dragResize = null; await recomputeImageElementsOnce(); await recomputeShapeIntegral(sh); updateIntegralPanel(); notifyDomain(); notifyState(true); return; }
      if (state.dragShape) { const sh = state.dragShape.sh; state.dragShape = null; await recomputeImageElementsOnce(); await recomputeShapeIntegral(sh); updateIntegralPanel(); notifyDomain(); notifyState(true); return; }
      if (state.drawing) {
        const d = state.drawing; state.drawing = null;
        if (d.rawPts.length >= 2) {
          pushUndo();
          let closed = d.closed;
          if (d.kind === "freehand" && d.rawPts.length > 6) {
            const p0 = d.rawPts[0], pn = d.rawPts[d.rawPts.length - 1];
            if (Math.hypot(xToS(pn.x) - xToS(p0.x), yToS(pn.y) - yToS(p0.y)) < 18) closed = true;
          }
          const sh = {
            id: state.nextShapeId++, kind: d.kind,
            label: d.kind === "vector" ? `u${state.shapes.filter((q) => q.kind === "vector").length + 1}` : (closed ? `Circle ${state.shapes.length + 1}` : `Path ${state.shapes.length + 1}`),
            color: d.color, lineWidth: d.kind === "vector" ? 2.8 : 2.4, opacity: closed ? 0.14 : 1.0, lineStyle: "solid",
            closed, locked: false, visible: true,
            ...(d.kind === "vector" && d.anchorPointId ? { anchorPointId: d.anchorPointId } : {}),
            rawPts: d.rawPts,
          };
          if (d.kind === "rect") sh.label = `Rect ${state.shapes.length + 1}`;
          else if (d.kind === "seg") sh.label = `Segment ${state.shapes.length + 1}`;
          else if (d.kind === "ray") sh.label = `Ray ${state.shapes.length + 1}`;
          else if (d.kind === "infline") sh.label = `Line ${state.shapes.length + 1}`;
          else if (d.kind === "arc") sh.label = `Arc ${state.shapes.length + 1}`;
          state.shapes.push(sh);
          selectShape(sh.id);
          syncLayerOrder();
          await recomputeShapeIntegral(sh);
          updateIntegralPanel();
          notifyState(true);
        }
        requestRender();
      }
    });

    canvas.addEventListener("pointerleave", () => {
      state.hoverWorld = null;
      state.snapIndicator = null;
      state.hoveredVecHandle = null;
      canvas.style.cursor = "";
      if (readoutIn) readoutIn.textContent = "—";
      if (readoutOut) readoutOut.textContent = "—";
      if (!state.showParticles) requestRender();
    });

    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const pos = localPos(e), f = e.deltaY < 0 ? 1 / 1.15 : 1.15;
      const wx = sToX(pos.x), wy = sToY(pos.y);
      state.view.xmin = wx + (state.view.xmin - wx) * f; state.view.xmax = wx + (state.view.xmax - wx) * f;
      state.view.ymin = wy + (state.view.ymin - wy) * f; state.view.ymax = wy + (state.view.ymax - wy) * f;
      requestRender(true);
      scheduleFetch(false, true);
    }, { passive: false });

    if (window.CFVGeom && typeof window.CFVGeom.attachPinchController === "function") {
      window.CFVGeom.attachPinchController(canvas, {
        onPinch(factor, sx, sy) {
          const f = 1 / Math.max(0.5, Math.min(2.0, factor));
          const wx = sToX(sx), wy = sToY(sy);
          state.view.xmin = wx + (state.view.xmin - wx) * f; state.view.xmax = wx + (state.view.xmax - wx) * f;
          state.view.ymin = wy + (state.view.ymin - wy) * f; state.view.ymax = wy + (state.view.ymax - wy) * f;
          requestRender(true); scheduleFetch(false, true);
        },
        onTwoFingerPan(dx, dy) {
          const w = canvas.clientWidth || 600, h = canvas.clientHeight || 400;
          const dwx = -(dx / w) * (state.view.xmax - state.view.xmin), dwy = (dy / h) * (state.view.ymax - state.view.ymin);
          state.view.xmin += dwx; state.view.xmax += dwx; state.view.ymin += dwy; state.view.ymax += dwy;
          requestRender(true); scheduleFetch(false, true);
        },
      });
    }

    window.addEventListener("keydown", (e) => {
      if (!state.active) return;
      const tag = (e.target && e.target.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); redoAction(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); undoAction(); return; }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        state.selectedShapeIds = new Set(state.shapes.filter((s) => s.visible).map((s) => s.id));
        state.selectedPointIds = new Set(state.points.filter((p) => p.visible).map((p) => p.id));
        syncPrimarySelection();
        notifyDomain();
        requestRender();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelectedItems();
      }
      if (e.code === "Space") state.spaceHeld = true;
    });
    window.addEventListener("keyup", (e) => { if (e.code === "Space") state.spaceHeld = false; });
  }

  function loadExampleAndPreset(ex, preset) {
    const pr = preset || (ex && ex.presets && ex.presets[0]) || {};
    const v = pr.view || (ex && ex.defaultView) || { xmin: -5, xmax: 5, ymin: -3.6, ymax: 3.6 };
    state.defaultView = { ...v }; state.view = { ...v };
    state.heatmap = pr.heatmap !== undefined ? pr.heatmap : "none";
    state.showArrows = pr.showArrows !== undefined ? Boolean(pr.showArrows) : false;
    state.showStreamlines = pr.showStreamlines !== undefined ? Boolean(pr.showStreamlines) : false;
    state.showEquipotentials = pr.showEquipotentials !== undefined ? Boolean(pr.showEquipotentials) : false;
    state.showParticles = pr.showParticles !== undefined ? Boolean(pr.showParticles) : false;
    state.showTransformGrid = pr.showTransformGrid !== undefined ? Boolean(pr.showTransformGrid) : false;

    const srcShapes = pr.shapes || (ex && ex.defaultShapes) || [];
    const idRemapShapes = new Map();
    state.shapes = srcShapes.map((sh, idx) => {
      const nid = state.nextShapeId++;
      if (sh.id !== undefined) idRemapShapes.set(sh.id, nid);
      idRemapShapes.set(`idx:${idx}`, nid);
      return {
        id: nid, kind: sh.kind || "circle", label: sh.label || "Shape",
        color: sh.color || "#34d399", lineWidth: normLineWidth(sh.lineWidth, 2.4),
        opacity: normOpacity(sh.opacity, sh.closed !== false ? 0.14 : 1.0), lineStyle: sh.lineStyle || "solid",
        closed: sh.closed !== undefined ? Boolean(sh.closed) : true,
        locked: Boolean(sh.locked), visible: sh.visible !== undefined ? Boolean(sh.visible) : true,
        anchorPointId: sh.anchorPointId ?? null,
        imageOf: sh.imageOf ? { ...sh.imageOf } : null,
        formula: sh.formula ? { ...sh.formula } : null,
        rawPts: (sh.rawPts || []).map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
      };
    });
    for (const s of state.shapes) {
      if (s.imageOf) {
        if (typeof s.imageOf.sourceIdx === "number" && idRemapShapes.has(`idx:${s.imageOf.sourceIdx}`)) {
          s.imageOf.sourceId = idRemapShapes.get(`idx:${s.imageOf.sourceIdx}`);
        } else if (idRemapShapes.has(s.imageOf.sourceId)) {
          s.imageOf.sourceId = idRemapShapes.get(s.imageOf.sourceId);
        }
        if (typeof s.imageOf.fnIdx === "number" && ws() && ws().state) {
          const fns = (ws().state.cards || []).filter((c) => c.kind === "fn");
          if (fns[s.imageOf.fnIdx]) s.imageOf.fnCardId = fns[s.imageOf.fnIdx].id;
        }
      }
    }
    const srcPts = pr.points || (ex && ex.defaultPoints) || [];
    const idRemapPts = new Map();
    state.points = srcPts.map((p, idx) => {
      const nid = state.nextPointId++;
      if (p.id !== undefined) idRemapPts.set(p.id, nid);
      idRemapPts.set(`idx:${idx}`, nid);
      return {
        id: nid, x: Number(p.x) || 0, y: Number(p.y) || 0,
        xExpr: p.xExpr || "", yExpr: p.yExpr || "",
        label: p.label || "Pt", icon: p.icon || "dot", color: p.color || "#fbbf24",
        size: p.size || 5.5, opacity: normOpacity(p.opacity, 1.0),
        locked: Boolean(p.locked), visible: p.visible !== undefined ? Boolean(p.visible) : true,
        showLabel: p.showLabel !== false,
        imageOf: p.imageOf ? { ...p.imageOf } : null,
      };
    });
    for (const s of state.shapes) {
      if (s.anchorPointId !== null && s.anchorPointId !== undefined) {
        if (typeof s.anchorPointId === "string" && idRemapPts.has(s.anchorPointId)) s.anchorPointId = idRemapPts.get(s.anchorPointId);
        else if (idRemapPts.has(s.anchorPointId)) s.anchorPointId = idRemapPts.get(s.anchorPointId);
      }
    }
    for (const p of state.points) {
      if (p.imageOf && idRemapPts.has(p.imageOf.sourceId)) p.imageOf.sourceId = idRemapPts.get(p.imageOf.sourceId);
    }
    state.lines = (pr.lines || (ex && ex.defaultLines) || []).map((l) => ({
      id: state.nextLineId++, orientation: l.orientation || "vertical", value: Number(l.value) || 0,
      valExpr: l.valExpr || "", label: l.label || "", color: l.color || "#38bdf8",
      lineWidth: normLineWidth(l.lineWidth, 1.8), lineStyle: l.lineStyle || "dashed",
      opacity: normOpacity(l.opacity, 0.85), locked: Boolean(l.locked), visible: l.visible !== false,
    }));
    const srcTexts = pr.texts || (ex && ex.defaultTexts) || [];
    state.texts = srcTexts.map((t) => ({
      id: state.nextTextId++, title: t.title || "", text: t.text || "",
      plane: "real", anchor: t.anchor || "bottom-left", nx: t.nx, ny: t.ny,
      x: Number(t.x) || 0, y: Number(t.y) || 0, xExpr: t.xExpr || "", yExpr: t.yExpr || "",
      color: t.color || "#38bdf8", width: Number(t.width) || 330, height: Number(t.height) || 0,
      fontSize: Number(t.fontSize) || 12, opacity: normOpacity(t.opacity, 0.94),
      visible: t.visible !== undefined ? Boolean(t.visible) : true, locked: Boolean(t.locked),
    }));
    state.layerOrder = [];
    syncLayerOrder();
    state.undoStack = []; state.redoStack = [];
    clearSelection();
    syncToolbarUI();
    ensureCanvasSize();
    applySquareAspect();
    state.staticDirty = true;
    updateIntegralPanel();
    notifyDomain();
    scheduleFetch(true, false);
    scheduleImageRecompute();
    if (state.showParticles && state.active) startParticleLoop();
  }

  function exportSnapshot() {
    return {
      view: { ...state.view }, squareAspect: state.squareAspect,
      heatmap: state.heatmap, showArrows: state.showArrows,
      showStreamlines: state.showStreamlines, showEquipotentials: state.showEquipotentials,
      showParticles: state.showParticles, showTransformGrid: state.showTransformGrid,
      shapes: state.shapes.map((s) => ({
        id: s.id, kind: s.kind, label: s.label, color: s.color, lineWidth: s.lineWidth,
        opacity: s.opacity, lineStyle: s.lineStyle, closed: s.closed, locked: s.locked, visible: s.visible,
        ...(s.anchorPointId ? { anchorPointId: s.anchorPointId } : {}),
        ...(s.imageOf ? { imageOf: { ...s.imageOf } } : {}),
        ...(s.formula ? { formula: { ...s.formula } } : {}),
        rawPts: s.rawPts.map((p) => ({ x: Number(p.x.toFixed(4)), y: Number(p.y.toFixed(4)) })),
      })),
      points: state.points.map((p) => ({
        id: p.id, x: p.x, y: p.y, xExpr: p.xExpr || "", yExpr: p.yExpr || "",
        label: p.label, icon: p.icon, color: p.color, size: p.size, opacity: p.opacity,
        locked: p.locked, visible: p.visible, showLabel: p.showLabel,
        ...(p.imageOf ? { imageOf: { ...p.imageOf } } : {}),
      })),
      lines: state.lines.map((l) => ({
        orientation: l.orientation, value: l.value, valExpr: l.valExpr || "",
        label: l.label, color: l.color, lineWidth: l.lineWidth, lineStyle: l.lineStyle,
        opacity: l.opacity, locked: l.locked, visible: l.visible,
      })),
      texts: state.texts.map((t) => ({
        title: t.title, text: t.text, anchor: t.anchor, nx: t.nx, ny: t.ny,
        x: t.x, y: t.y, color: t.color, width: t.width, height: t.height, visible: t.visible, locked: t.locked,
      })),
    };
  }

  function restoreSnapshot(snap) {
    if (!snap) return;
    loadExampleAndPreset({ defaultView: snap.view || state.defaultView }, snap);
  }

  async function joinConnectedShapes() {
    if (!window.CFVGeom || !window.CFVGeom.joinOpenPaths) return { mergedGroups: 0, mergedCount: 0, created: [] };
    const allOpen = state.shapes.filter(
      (s) => !s.closed && !s.locked && !s.imageOf && s.visible !== false && Array.isArray(s.rawPts) && s.rawPts.length >= 2
    );
    const selectedOpen = allOpen.filter((s) => isShapeSelected(s.id));
    const useSelectedMode = selectedOpen.length >= 2;
    const candidates = useSelectedMode ? selectedOpen : allOpen;
    if (candidates.length < 2) return { mergedGroups: 0, mergedCount: 0, created: [] };

    const pxPerWorld = (canvas.clientWidth || 600) / Math.max(1e-6, state.view.xmax - state.view.xmin);
    const tol = Math.max(0.06, 16 / Math.max(pxPerWorld, 1e-3));
    const { groups, removedIds, mergedCount } = window.CFVGeom.joinOpenPaths(candidates, {
      selectedId: state.selectedShapeId,
      tolerance: tol,
      useSelectedMode,
    });
    if (groups.length === 0) return { mergedGroups: 0, mergedCount: 0, created: [] };

    pushUndo();
    const created = groups.map((g) => ({
      id: state.nextShapeId++,
      kind: "path",
      label: g.closed ? `Joined Loop (${g.group.length})` : `Joined Path (${g.group.length})`,
      color: g.seed.color || "#34d399",
      lineWidth: g.seed.lineWidth || 2.4,
      opacity: g.closed ? 0.14 : 1.0,
      lineStyle: g.seed.lineStyle || "solid",
      closed: g.closed,
      locked: false,
      visible: true,
      formula: null,
      rawPts: g.pts,
    }));
    state.shapes = state.shapes.filter((s) => !removedIds.has(s.id));
    for (const m of created) {
      state.shapes.push(m);
      await recomputeShapeIntegral(m);
    }
    syncLayerOrder();
    selectShape(created[0].id);
    await recomputeImageElementsOnce();
    updateIntegralPanel();
    notifyDomain();
    notifyState(true);
    requestRender();
    return { mergedGroups: created.length, mergedCount, created };
  }

  async function toggleCloseShape(id) {
    const s = state.shapes.find((q) => q.id === id);
    if (!s || s.locked) return;
    pushUndo();
    s.closed = !s.closed;
    await recomputeShapeIntegral(s);
    updateIntegralPanel();
    notifyDomain();
    notifyState(true);
    requestRender();
  }

  async function reverseShape(id) {
    const s = state.shapes.find((q) => q.id === id);
    if (!s || s.locked) return;
    pushUndo();
    s.rawPts.reverse();
    await recomputeShapeIntegral(s);
    updateIntegralPanel();
    notifyState(true);
    requestRender();
  }

  function moveElementLayer(kind, id, act) {
    syncLayerOrder();
    const key = `${kind}:${id}`;
    const idx = state.layerOrder.indexOf(key);
    if (idx < 0) return;
    const last = state.layerOrder.length - 1;
    let to = idx;
    if (act === "back") to = 0;
    else if (act === "backward") to = Math.max(0, idx - 1);
    else if (act === "forward") to = Math.min(last, idx + 1);
    else if (act === "front") to = last;
    if (to !== idx) reorderElement(idx, to);
  }

  function dropEigenvectorPreview(matInfo, matSym = "M") {
    if (!matInfo || !matInfo.eigen || !matInfo.eigen.real || !matInfo.eigen.vecs || matInfo.eigen.vecs.length === 0) return;
    pushUndo();
    matInfo.eigen.vecs.forEach((ev, idx) => {
      const sh = {
        id: state.nextShapeId++,
        kind: "vector",
        label: `e${idx + 1} (${matSym}, λ=${Number(ev.lambda.toFixed(2))})`,
        color: idx === 0 ? "#fde047" : "#fb923c",
        lineWidth: 3.0,
        opacity: 1.0,
        lineStyle: "solid",
        closed: false,
        locked: false,
        visible: true,
        rawPts: [{ x: 0, y: 0 }, { x: ev.x * 1.6, y: ev.y * 1.6 }],
      };
      state.shapes.push(sh);
    });
    syncLayerOrder();
    notifyDomain();
    notifyState(true);
    requestRender();
  }

  function addVectorElement(opts = {}) {
    pushUndo();
    const x0 = Number(opts.x0 ?? 0), y0 = Number(opts.y0 ?? 0);
    const vx = Number(opts.vx ?? 2), vy = Number(opts.vy ?? 1);
    const sh = {
      id: state.nextShapeId++,
      kind: "vector",
      label: opts.label || `u${state.shapes.filter((q) => q.kind === "vector").length + 1}`,
      color: opts.color || "#38bdf8",
      lineWidth: 2.8,
      opacity: 1.0,
      lineStyle: "solid",
      closed: false,
      locked: false,
      visible: true,
      anchorPointId: opts.anchorPointId ?? null,
      formula: opts.formula ? { ...opts.formula } : null,
      rawPts: [{ x: x0, y: y0 }, { x: x0 + vx, y: y0 + vy }],
    };
    state.shapes.push(sh);
    syncLayerOrder();
    selectShape(sh.id);
    notifyDomain();
    notifyState(true);
    requestRender();
    return sh;
  }

  /* =========================================================================
   * First-Class Image Elements (Im = F(Element) or M(Element)) on Same Plane!
   * Supports Anchored Vectors, Shapes, Points, & Chained Images (T2(T1(u)))!
   * ========================================================================= */
  let _imgEvalBusy = false;
  let _imgEvalQueued = false;

  function findVecFnCard(fnCardId) {
    const w = ws();
    if (!w || !w.state) return null;
    const fns = (w.state.cards || []).filter((c) => c.kind === "fn");
    if (fnCardId !== null && fnCardId !== undefined) {
      const hit = fns.find((c) => c.id === fnCardId);
      if (hit) return hit;
    }
    return fns.find((c) => c.vecKind === "field" || c.vecKind === "matrix") || fns[0] || null;
  }

  async function evalVecCardOnPoints(card, pts) {
    if (!card || !pts || !pts.length) return null;
    const w = ws();
    /* 1. Fast 0ms JS evaluation for Matrix cards at 60 FPS! */
    if (card.vecKind === "matrix" && w && w.evalLinearAlgebraState && window.CFVLinAlg) {
      const la = w.evalLinearAlgebraState();
      const mr = la.matrices.find((m) => m.id === card.id);
      if (mr && mr.info) {
        const M = mr.info;
        return pts.map((p) => ({ x: M.a * p.x + M.b * p.y, y: M.c * p.x + M.d * p.y }));
      }
      return null;
    }
    /* 2. Fast 0ms JS evaluation for single-expression vector formulas like "M * v", "rot(theta) * v", "M1 * M2 * v", "(x + k*y, y)" */
    if (window.CFVLinAlg && typeof window.CFVLinAlg.evalExpr === "function" && w && w.evalLinearAlgebraState) {
      const raw = String(card.code || "").trim();
      const lines = raw.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, "").trim()).filter(Boolean);
      const expr = lines.length === 1 ? lines[0].replace(/;\s*$/, "").trim() : "";
      const isSimpleExpr = expr && !/\b(fx|fy|phi|double|if|for|while|return)\b/.test(expr) && !/[;{}]/.test(expr);
      if (isSimpleExpr) {
        const la = w.evalLinearAlgebraState();
        const pm = w.getParamMap ? w.getParamMap() : {};
        const p0 = pts[0];
        const env0 = { ...la.env, x: p0.x, y: p0.y, v: window.CFVLinAlg.makeVec2(p0.x, p0.y), p: window.CFVLinAlg.makeVec2(p0.x, p0.y), r: window.CFVLinAlg.makeVec2(p0.x, p0.y) };
        const r0 = window.CFVLinAlg.evalExpr(expr, pm, env0);
        if (window.CFVLinAlg.isVec2(r0) && Number.isFinite(r0.x) && Number.isFinite(r0.y)) {
          const out = [{ x: r0.x, y: r0.y }];
          for (let i = 1; i < pts.length; i++) {
            const pi = pts[i];
            const envi = { ...la.env, x: pi.x, y: pi.y, v: window.CFVLinAlg.makeVec2(pi.x, pi.y), p: window.CFVLinAlg.makeVec2(pi.x, pi.y), r: window.CFVLinAlg.makeVec2(pi.x, pi.y) };
            const ri = window.CFVLinAlg.evalExpr(expr, pm, envi);
            out.push(window.CFVLinAlg.isVec2(ri) && Number.isFinite(ri.x) && Number.isFinite(ri.y) ? { x: ri.x, y: ri.y } : null);
          }
          return out;
        }
      }
    }
    /* 3. Native C11 /api/workspace/vector_eval_pts for ANY R^2 -> R^2 function (fx=...; fy=...; or nonlinear C11)! */
    if (!w || w.state.compiledKind !== "vector") return null;
    const flat = [];
    for (const p of pts) flat.push(p.x, p.y);
    const params = w.getParamValues ? w.getParamValues() : [];
    try {
      const res = await fetch("/api/workspace/vector_eval_pts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: card.slot ?? 0, points: flat, params }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !Array.isArray(data.out)) return null;
      const out = [];
      for (let i = 0; i + 1 < data.out.length; i += 2) {
        const ox = data.out[i], oy = data.out[i + 1];
        out.push(ox === null || oy === null ? null : { x: Number(ox), y: Number(oy) });
      }
      return out;
    } catch (_) {
      return null;
    }
  }

  function syncAnchoredVectors() {
    /* Keep any vector anchored to a moving Point glued to that Point's coordinates! */
    for (const s of state.shapes) {
      if (s.kind !== "vector" || s.imageOf || !s.anchorPointId || !s.rawPts || s.rawPts.length < 2) continue;
      const ap = state.points.find((p) => p.id === s.anchorPointId);
      if (!ap) continue;
      const vx = s.rawPts[1].x - s.rawPts[0].x;
      const vy = s.rawPts[1].y - s.rawPts[0].y;
      s.rawPts[0].x = ap.x;
      s.rawPts[0].y = ap.y;
      s.rawPts[1].x = ap.x + vx;
      s.rawPts[1].y = ap.y + vy;
    }
  }

  async function evalImageMappingOnPoints(imageOf, pts) {
    if (!imageOf || !pts || !pts.length) return null;
    const w = ws();
    /* 1. Try direct 0ms JS evaluation of custom imageOf.expr (e.g. "M * v", "rot(t) * v", "2 * M1 * v + u") */
    const rawExpr = String(imageOf.expr || "").trim();
    if (rawExpr && window.CFVLinAlg && window.CFVLinAlg.evalExpr && w && w.evalLinearAlgebraState) {
      const la = w.evalLinearAlgebraState();
      const pm = w.getParamMap ? w.getParamMap() : {};
      const p0 = pts[0];
      const env0 = { ...la.env, x: p0.x, y: p0.y, v: window.CFVLinAlg.makeVec2(p0.x, p0.y) };
      const r0 = window.CFVLinAlg.evalExpr(rawExpr, pm, env0);
      if (window.CFVLinAlg.isVec2(r0) && Number.isFinite(r0.x) && Number.isFinite(r0.y)) {
        const out = [{ x: r0.x, y: r0.y }];
        for (let i = 1; i < pts.length; i++) {
          const pi = pts[i];
          const envi = { ...la.env, x: pi.x, y: pi.y, v: window.CFVLinAlg.makeVec2(pi.x, pi.y) };
          const ri = window.CFVLinAlg.evalExpr(rawExpr, pm, envi);
          out.push(window.CFVLinAlg.isVec2(ri) && Number.isFinite(ri.x) && Number.isFinite(ri.y) ? { x: ri.x, y: ri.y } : null);
        }
        return out;
      }
    }
    /* 2. Fall back to resolving named card or fnCardId via evalVecCardOnPoints */
    const fc = (w && w.resolveFnCardByNameOrId)
      ? w.resolveFnCardByNameOrId(rawExpr, imageOf.fnCardId)
      : findVecFnCard(imageOf.fnCardId);
    if (!fc) return null;
    return evalVecCardOnPoints(fc, pts);
  }

  async function recomputeImageElementsOnce() {
    syncAnchoredVectors();
    const imgShapes = state.shapes.filter((s) => s && s.visible && s.imageOf);
    const imgPts = state.points.filter((p) => p && p.visible && p.imageOf);
    if (!imgShapes.length && !imgPts.length) return;

    for (let pass = 0; pass < 2; pass++) {
      for (const s of imgShapes) {
        const srcs = Array.isArray(s.imageOf.sources) && s.imageOf.sources.length > 0
          ? s.imageOf.sources
          : [{ kind: s.imageOf.sourceKind || "shape", id: s.imageOf.sourceId }];

        if (srcs.length > 1 || s.kind === "image") {
          const mappedItems = [];
          const allPts = [];
          for (const sr of srcs) {
            if (sr.kind === "point") {
              const pSrc = state.points.find((q) => q.id === sr.id);
              if (!pSrc) continue;
              const mp = await evalImageMappingOnPoints(s.imageOf, [{ x: pSrc.x, y: pSrc.y }]);
              if (mp && mp[0]) { mappedItems.push({ kind: "point", pt: mp[0] }); allPts.push(mp[0]); }
            } else {
              const sSrc = state.shapes.find((q) => q.id === sr.id);
              if (!sSrc || !sSrc.rawPts || sSrc.rawPts.length < 2) continue;
              if (sSrc.kind === "vector") {
                const p0 = sSrc.rawPts[0], p1 = sSrc.rawPts[sSrc.rawPts.length - 1];
                const mp = await evalImageMappingOnPoints(s.imageOf, [{ x: p1.x - p0.x, y: p1.y - p0.y }]);
                if (mp && mp[0]) {
                  const vpts = [{ x: p0.x, y: p0.y }, { x: p0.x + mp[0].x, y: p0.y + mp[0].y }];
                  mappedItems.push({ kind: "vector", pts: vpts });
                  allPts.push(vpts[0], vpts[1]);
                }
              } else {
                const mp = await evalImageMappingOnPoints(s.imageOf, sSrc.rawPts);
                if (mp) {
                  const clean = mp.filter((q) => q && Number.isFinite(q.x) && Number.isFinite(q.y));
                  if (clean.length >= 2) {
                    mappedItems.push({ kind: "path", pts: clean, closed: Boolean(sSrc.closed) });
                    allPts.push(...clean);
                  }
                }
              }
            }
          }
          s.kind = "image";
          s._mappedItems = mappedItems;
          if (allPts.length >= 2) s.rawPts = allPts.slice(0, 64);
          continue;
        }

        const src = state.shapes.find((q) => q.id === srcs[0].id);
        if (!src || !src.rawPts || src.rawPts.length < 2) continue;
        if (src.kind === "vector") {
          const p0 = src.rawPts[0], p1 = src.rawPts[src.rawPts.length - 1];
          const dx = p1.x - p0.x, dy = p1.y - p0.y;
          const mode = s.imageOf.anchorMode || "same_tail";
          if (mode === "same_tail") {
            const mapped = await evalImageMappingOnPoints(s.imageOf, [{ x: dx, y: dy }]);
            if (mapped && mapped[0]) {
              s.kind = "vector";
              s.rawPts = [{ x: p0.x, y: p0.y }, { x: p0.x + mapped[0].x, y: p0.y + mapped[0].y }];
            }
          } else if (mode === "mapped_tail") {
            const mapped = await evalImageMappingOnPoints(s.imageOf, [p0, p1]);
            if (mapped && mapped[0] && mapped[1]) {
              s.kind = "vector";
              s.rawPts = [mapped[0], mapped[1]];
            }
          } else {
            const mapped = await evalImageMappingOnPoints(s.imageOf, [{ x: dx, y: dy }]);
            if (mapped && mapped[0]) {
              s.kind = "vector";
              s.rawPts = [{ x: 0, y: 0 }, mapped[0]];
            }
          }
        } else {
          const mapped = await evalImageMappingOnPoints(s.imageOf, src.rawPts);
          if (mapped) {
            const clean = mapped.filter((q) => q && Number.isFinite(q.x) && Number.isFinite(q.y));
            if (clean.length >= 2) {
              s.rawPts = clean;
              s.closed = Boolean(src.closed);
            }
          }
        }
      }
      for (const p of imgPts) {
        const src = state.points.find((q) => q.id === p.imageOf.sourceId);
        if (!src) continue;
        const mapped = await evalImageMappingOnPoints(p.imageOf, [{ x: src.x, y: src.y }]);
        if (mapped && mapped[0] && Number.isFinite(mapped[0].x) && Number.isFinite(mapped[0].y)) {
          p.x = mapped[0].x;
          p.y = mapped[0].y;
        }
      }
      if (imgShapes.every((s) => !imgShapes.some((o) => o.id === s.imageOf.sourceId)) &&
          imgPts.every((p) => !imgPts.some((o) => o.id === p.imageOf.sourceId))) {
        break;
      }
    }
    requestRender();
    if (ws() && ws().syncShapeBadges) ws().syncShapeBadges();
  }

  async function createImageFromSources(sources, def = {}) {
    if (!Array.isArray(sources) || sources.length === 0) return null;
    if (sources.length === 1 && sources[0].kind === "point") {
      const pt = await createImageOfPoint(sources[0].id, def.fnCardId ?? null);
      if (pt && pt.imageOf) {
        pt.imageOf.sources = sources;
        pt.imageOf.expr = def.expr || "";
        await recomputeImageElementsOnce();
      }
      return pt;
    }
    if (sources.length === 1 && sources[0].kind === "shape") {
      const sh = await createImageOfShape(sources[0].id, def.fnCardId ?? null);
      if (sh && sh.imageOf) {
        sh.imageOf.sources = sources;
        sh.imageOf.expr = def.expr || "";
        await recomputeImageElementsOnce();
      }
      return sh;
    }
    pushUndo();
    const img = {
      id: state.nextShapeId++,
      kind: "image",
      label: `${def.labelPrefix || "T"}(${sources.length} elements)`,
      color: "#fbbf24",
      lineWidth: 2.5,
      opacity: 0.18,
      lineStyle: "solid",
      closed: false,
      locked: false,
      visible: true,
      imageOf: {
        sourceKind: "multi",
        sourceId: sources[0].id,
        sources: sources.map((s) => ({ ...s })),
        fnCardId: def.fnCardId ?? null,
        expr: def.expr || "M * v",
        anchorMode: "same_tail",
      },
      rawPts: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      _mappedItems: [],
    };
    state.shapes.push(img);
    syncLayerOrder();
    selectShape(img.id);
    await recomputeImageElementsOnce();
    notifyDomain();
    notifyState(true);
    requestRender();
    return img;
  }

  function scheduleImageRecompute() {
    if (_imgEvalBusy) { _imgEvalQueued = true; return; }
    _imgEvalBusy = true;
    (async () => {
      try {
        do {
          _imgEvalQueued = false;
          await recomputeImageElementsOnce();
        } while (_imgEvalQueued && state.active);
      } finally {
        _imgEvalBusy = false;
      }
    })();
  }

  async function createImageOfShape(sourceId, fnCardId = null) {
    const src = state.shapes.find((s) => s.id === sourceId);
    if (!src) return null;
    const fc = findVecFnCard(fnCardId);
    const fnName = fc ? (fc.title ? fc.title.split(" ")[0] : "T") : "T";
    pushUndo();
    const img = {
      id: state.nextShapeId++,
      kind: src.kind === "vector" ? "vector" : "path",
      label: `${fnName}(${src.label || "Shape"})`,
      color: "#fbbf24",
      lineWidth: Math.max(2.4, normLineWidth(src.lineWidth, 2.4)),
      opacity: src.kind === "vector" ? 1.0 : normOpacity(src.opacity, src.closed ? 0.16 : 1.0),
      lineStyle: "solid",
      closed: Boolean(src.closed),
      locked: false,
      visible: true,
      imageOf: {
        sourceKind: "shape",
        sourceId: src.id,
        fnCardId: fc ? fc.id : null,
        anchorMode: src.kind === "vector" ? "same_tail" : "mapped_tail",
      },
      rawPts: src.rawPts.map((p) => ({ x: p.x, y: p.y })),
    };
    state.shapes.push(img);
    syncLayerOrder();
    selectShape(img.id);
    await recomputeImageElementsOnce();
    notifyDomain();
    notifyState(true);
    requestRender();
    return img;
  }

  async function createImageOfPoint(sourceId, fnCardId = null) {
    const src = state.points.find((p) => p.id === sourceId);
    if (!src) return null;
    const fc = findVecFnCard(fnCardId);
    const fnName = fc ? (fc.title ? fc.title.split(" ")[0] : "T") : "T";
    pushUndo();
    const img = {
      id: state.nextPointId++,
      x: src.x,
      y: src.y,
      label: `${fnName}(${src.label || "P"})`,
      icon: "diamond",
      color: "#fbbf24",
      size: 6,
      opacity: 1.0,
      locked: false,
      visible: true,
      showLabel: true,
      imageOf: { sourceKind: "point", sourceId: src.id, fnCardId: fc ? fc.id : null },
    };
    state.points.push(img);
    syncLayerOrder();
    selectPoint(img.id);
    await recomputeImageElementsOnce();
    notifyDomain();
    notifyState(true);
    requestRender();
    return img;
  }

  function rebuildFormulaElements() {
    if (!window.CFVGeom || !window.CFVGeom.rebuildFormulaElementsInState) return;
    const pm = ws() && typeof ws().getParamMap === "function" ? ws().getParamMap() : {};
    window.CFVGeom.rebuildFormulaElementsInState(state, pm);
    syncAnchoredVectors();
    scheduleImageRecompute();
    requestRender();
  }

  async function rebuildShapeFromFormula(shape) {
    if (!shape || !shape.formula || !window.CFVGeom) return false;
    const pm = ws() && typeof ws().getParamMap === "function" ? ws().getParamMap() : {};
    const res = window.CFVGeom.evalShapeFormula(shape.formula, pm);
    if (!res || res.rawPts.length < 2) return false;
    shape.rawPts = res.rawPts;
    if (shape.formula.kind !== "parametric") shape.closed = res.closed;
    await recomputeShapeIntegral(shape);
    updateIntegralPanel();
    requestRender();
    return true;
  }

  bindEvents();

  window.CFVVector = {
    state,
    canvas,
    rebuildFormulaElements,
    rebuildShapeFromFormula,
    setActive(on) {
      state.active = Boolean(on);
      if (state.active) {
        ensureCanvasSize(); applySquareAspect(); syncToolbarUI();
        state.staticDirty = true;
        scheduleFetch(true, false);
        if (state.showParticles) startParticleLoop();
      } else {
        if (state.particleRaf) { cancelAnimationFrame(state.particleRaf); state.particleRaf = 0; }
        if (intPanel) intPanel.classList.add("hidden");
      }
    },
    onResize() {
      if (!state.active) return;
      ensureCanvasSize(); applySquareAspect(); state.staticDirty = true;
      scheduleFetch(false, true); requestRender();
    },
    resize() { this.onResize(); },
    onWorkspaceCompiled() { if (state.active) { syncToolbarUI(); state.staticDirty = true; scheduleFetch(true, false); scheduleImageRecompute(); } },
    onParamsChanged() { if (state.active) { scheduleFetch(true, true); scheduleImageRecompute(); } },
    onThemeChanged() {
      buildHeatmapCanvas();
      state.staticDirty = true;
      requestRender(true);
    },
    syncToolbarUI,
    requestRender,
    updateIntegralPanel,
    joinConnectedShapes,
    recomputeAllIntegrals,
    recomputeImageElements: recomputeImageElementsOnce,
    scheduleImageRecompute,
    addVectorElement,
    dropEigenvectorPreview,
    createImageOfShape,
    createImageOfPoint,
    createImageFromSources,
    getOrderedElements,
    reorderElement,
    moveElementLayer,
    toggleCloseShape,
    reverseShape,
    selectShape, deleteShape,
    selectPoint, deletePoint, addPoint,
    selectGuideLine, deleteGuideLine, addGuideLine,
    selectTextBox, deleteTextBox, addTextBox,
    loadExampleAndPreset,
    exportSnapshot,
    restoreSnapshot,
    undoAction, redoAction,
    setTool,
    resetBlank() { loadExampleAndPreset({ defaultView: { xmin: -5, xmax: 5, ymin: -3.6, ymax: 3.6 } }, {}); },
    getCanvas() { return canvas; },
  };
})();
