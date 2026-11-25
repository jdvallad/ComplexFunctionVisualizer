(() => {
  "use strict";

  /*
   * Complex Map & Contour Integral Dual-Plane Canvas Engine
   * Supports:
   *  - Compiled multi-card C11 workspaces + public read-only builtin fallback
   *  - Domain Shapes/Contours with per-shape color, thickness, lineStyle & lock
   *  - Desmos Landmark Points (icon, color, size, label, lock) mapped in Map mode
   *    and strictly ignored in Contour Integral mode
   *  - Multi-Contour Integral Results Panel (one row per visible contour + total sum)
   */

  const PALETTE = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#fb923c"];
  const SNAP_PX = 16;
  const HANDLE_HIT_PX = 11;

  const state = {
    active: true,
    mode: "map", /* "map" | "integral" (synced with contourMode toggle inside Complex mode) */
    contourMode: false,
    tool: "move",
    colorIdx: 0,

    inView: { cx: 0.0, cy: 0.0, scale: 65, scaleX: 65, scaleY: 65 },
    outView: { cx: 0.0, cy: 0.0, scale: 65, scaleX: 65, scaleY: 65 },
    defaultInView: { cx: 0.0, cy: 0.0, r: 4.0 },
    defaultOutView: { cx: 0.0, cy: 0.0, r: 4.0 },
    inSquare: true,
    outSquare: true,
    inSavedRatio: 1.0,
    outSavedRatio: 1.0,
    integralMinimized: false,

    showMesh: true,
    showDomain: false,
    showOutDomain: false,
    outDomainMapping: "stereo",
    domainScheme: "classic",
    domainOpacity: 0.72,
    showLandmarks: true,
    showCriticalLine: true,
    showDirichletWall: false,

    /* Input & Output space projections: "planar" | "polar" | "mercator" | "stereographic" | "poincare" | "sphere" | "cylinder" */
    inProjection: "planar",
    projection: "planar",

    /* Unified Element Layering Order (back -> front): [{ kind: "shape"|"guide_line"|"point", id }] */
    layerOrder: [],

    /* Desmos Domain Objects: Shapes (contours), Points, Landmark Lines & Text Boxes */
    shapes: [],
    points: [],
    lines: [],
    texts: [],
    nextShapeId: 1,
    nextPointId: 1,
    nextLineId: 1,
    nextTextId: 1,
    selectedShapeId: null,
    selectedPointId: null,
    selectedLineId: null,
    selectedTextId: null,
    selectedShapeIds: new Set(),
    selectedPointIds: new Set(),
    hoveredShapeId: null,
    hoveredPointId: null,
    hoveredLineId: null,
    drawing: null,
    polyDraft: null,
    dragShape: null,
    dragGroup: null,
    dragRotate: null,
    marquee: null,
    undoStack: [],
    dragPoint: null,
    dragLine: null,
    snapHint: null,
    pan: null,
    spaceHeld: false,

    /* Animation */
    playing: false,
    playPhase: 0,
    lastFrameTs: 0,

    /* Live hover probe */
    probe: { active: false, z: null, w: null, pending: false, queuedZ: null },

    /* Domain coloring */
    domainImg: null,
    domainTimer: null,
    domainReqId: 0,

    /* Tools overlays: Zero Hunter + Taylor Disk */
    foundZeros: [],
    taylor: { enabled: false, draggingZ0: false, x0: 2.0, y0: 0.0, degree: 8, radius: 1.0, coeffs: [] },
  };

  const canvasIn = document.getElementById("canvas-in");
  const canvasOut = document.getElementById("canvas-out");
  const ctxIn = canvasIn.getContext("2d");
  const ctxOut = canvasOut.getContext("2d");
  const inCard = document.getElementById("input-plane-card");
  const outCard = document.getElementById("output-plane-card");
  const inputTag = document.getElementById("input-tag");
  const inputSub = document.getElementById("input-sub");
  const outputTag = document.getElementById("output-tag");
  const outputSub = document.getElementById("output-sub");
  const btnToggleSphere = document.getElementById("btn-toggle-sphere");
  const inProjSelect = document.getElementById("in-projection-select");
  const outProjSelect = document.getElementById("out-projection-select");
  const btnTracePlay = document.getElementById("btn-trace-play");

  function isLightTheme() {
    return typeof document !== "undefined" && document.documentElement.dataset.theme === "light";
  }

  function normLineWidth(v, fallback = 2.2) {
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
    for (const s of state.shapes) valid.set(`shape:${s.id}`, { kind: "shape", id: s.id, item: s });
    for (const l of state.lines) valid.set(`guide_line:${l.id}`, { kind: "guide_line", id: l.id, item: l });
    for (const p of state.points) valid.set(`point:${p.id}`, { kind: "point", id: p.id, item: p });
    for (const t of state.texts) valid.set(`text:${t.id}`, { kind: "text", id: t.id, item: t });

    const next = [];
    const seen = new Set();
    for (const entry of state.layerOrder || []) {
      const k = `${entry.kind}:${entry.id}`;
      if (valid.has(k) && !seen.has(k)) {
        seen.add(k);
        next.push({ kind: entry.kind, id: entry.id });
      }
    }
    for (const [k, rec] of valid.entries()) {
      if (!seen.has(k)) {
        seen.add(k);
        next.push({ kind: rec.kind, id: rec.id });
      }
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

  function activeParamsMap() {
    return ws() && typeof ws().getParamMap === "function" ? ws().getParamMap() : {};
  }

  function projectInPt(pt) {
    if (!pt || !window.CFVProjections || state.inProjection === "planar" || state.inProjection === "polar" || state.inProjection === "sphere" || state.inProjection === "cylinder") return pt;
    return window.CFVProjections.projectPoint(state.inProjection, pt);
  }

  function projectInPts(pts) {
    if (!pts || !window.CFVProjections || state.inProjection === "planar" || state.inProjection === "polar" || state.inProjection === "sphere" || state.inProjection === "cylinder") return pts;
    return window.CFVProjections.projectPoints(state.inProjection, pts);
  }

  function screenToInComplexExact(sx, sy) {
    if ((state.inProjection === "sphere" || state.inProjection === "cylinder") && window.RiemannSphereIn) {
      return window.RiemannSphereIn.screenToComplex(sx, sy, canvasIn, state.inProjection);
    }
    const raw = screenToWorld(state.inView, canvasIn, sx, sy);
    if (state.inProjection === "stereographic" || state.inProjection === "poincare") {
      if (raw.x * raw.x + raw.y * raw.y >= 0.999) return null;
      return window.CFVProjections ? window.CFVProjections.inverseProjectPoint(state.inProjection, raw) : raw;
    }
    if (state.inProjection === "mercator") {
      if (Math.abs(raw.x) > Math.PI || Math.abs(raw.y) > 2.65) return null;
      return window.CFVProjections ? window.CFVProjections.inverseProjectPoint("mercator", raw) : raw;
    }
    return raw;
  }

  function screenToInComplex(sx, sy) {
    return screenToInComplexExact(sx, sy) || { x: 0, y: 0 };
  }

  function projectOutPt(pt) {
    if (!pt || !window.CFVProjections || state.projection === "planar" || state.projection === "polar" || state.projection === "sphere" || state.projection === "cylinder") return pt;
    return window.CFVProjections.projectPoint(state.projection, pt);
  }

  function projectOutPts(pts) {
    if (!pts || !window.CFVProjections || state.projection === "planar" || state.projection === "polar" || state.projection === "sphere" || state.projection === "cylinder") return pts;
    return window.CFVProjections.projectPoints(state.projection, pts);
  }

  function screenToOutComplexExact(sx, sy) {
    if ((state.projection === "sphere" || state.projection === "cylinder") && window.RiemannSphere) {
      return window.RiemannSphere.screenToComplex(sx, sy, canvasOut, state.projection);
    }
    const raw = screenToWorld(state.outView, canvasOut, sx, sy);
    if (state.projection === "stereographic" || state.projection === "poincare") {
      if (raw.x * raw.x + raw.y * raw.y >= 0.999) return null;
      return window.CFVProjections ? window.CFVProjections.inverseProjectPoint(state.projection, raw) : raw;
    }
    if (state.projection === "mercator") {
      if (Math.abs(raw.x) > Math.PI || Math.abs(raw.y) > 2.65) return null;
      return window.CFVProjections ? window.CFVProjections.inverseProjectPoint("mercator", raw) : raw;
    }
    return raw;
  }

  function setInProjection(mode, opts = {}) {
    const valid = new Set(["planar", "polar", "mercator", "stereographic", "poincare", "sphere"]);
    const next = valid.has(mode) ? mode : "planar";
    const prev = state.inProjection;
    state.inProjection = next;
    const is3D = next === "sphere";
    if (window.RiemannSphereIn) {
      window.RiemannSphereIn.state.enabled = is3D;
      if (is3D && !opts.keepSphereView && prev !== next) window.RiemannSphereIn.reset();
    }
    if (inProjSelect && inProjSelect.value !== next) inProjSelect.value = next;
    if (inputTag) {
      inputTag.textContent =
        next === "sphere" ? "INPUT · RIEMANN SPHERE" :
        next === "stereographic" ? "INPUT · STEREO DISK" :
        next === "poincare" ? "INPUT · POINCARÉ DISK" :
        next === "mercator" ? "INPUT · MERCATOR" :
        next === "polar" ? "INPUT · POLAR ℂ" :
        state.mode === "integral" ? "CONTOUR PLANE" : "INPUT PLANE";
    }
    if (inputSub && window.CFVProjections) {
      inputSub.textContent =
        next === "planar" ? (state.mode === "integral" ? "γ(t) ⊂ ℂ" : "z = x + iy") : window.CFVProjections.getSubtitle(next);
    }
    if (!opts.keepInView && prev !== next) {
      if (next === "stereographic" || next === "poincare") {
        setSquareAspect("in", true);
        setView(state.inView, canvasIn, 0, 0, 1.32);
      } else if (next === "mercator") {
        setSquareAspect("in", true);
        setView(state.inView, canvasIn, 0, 0, 3.35);
      }
    }
    ensureCanvasSize(canvasIn);
    requestRender("in");
    if (!opts.silent) notifyState(true, true);
  }

  function setProjection(mode, opts = {}) {
    const valid = new Set(["planar", "polar", "mercator", "stereographic", "poincare", "sphere"]);
    const next = valid.has(mode) ? mode : "planar";
    const prev = state.projection;
    state.projection = next;
    const is3D = next === "sphere";
    if (window.RiemannSphere) {
      window.RiemannSphere.state.enabled = is3D;
      if (is3D && !opts.keepSphereView && prev !== next) window.RiemannSphere.reset();
    }
    if (outProjSelect && outProjSelect.value !== next) outProjSelect.value = next;
    if (btnToggleSphere) {
      btnToggleSphere.classList.toggle("active", next === "sphere");
      btnToggleSphere.textContent = next === "sphere" ? "2D Plane" : "Riemann Sphere";
    }
    if (outputTag) {
      outputTag.textContent =
        next === "sphere" ? "RIEMANN SPHERE" :
        next === "stereographic" ? "STEREOGRAPHIC DISK" :
        next === "poincare" ? "POINCARÉ DISK" :
        next === "mercator" ? "MERCATOR MAP" :
        next === "polar" ? "POLAR ℂ" :
        state.mode === "integral" ? "INTEGRAL PLANE" : "OUTPUT PLANE";
    }
    if (outputSub && window.CFVProjections) {
      outputSub.textContent =
        next === "planar"
          ? (state.mode === "integral" ? "I(t) = ∫ f(z) dz" : "w = f(z)")
          : window.CFVProjections.getSubtitle(next);
    }
    if (!opts.keepOutView && prev !== next) {
      if (next === "stereographic" || next === "poincare") {
        setSquareAspect("out", true);
        setView(state.outView, canvasOut, 0, 0, 1.32);
      } else if (next === "mercator") {
        setSquareAspect("out", true);
        setView(state.outView, canvasOut, 0, 0, 3.35);
      }
    }
    ensureCanvasSize(canvasOut);
    requestRender("out");
    if (!opts.silent) notifyState(true, true);
  }

  const integralPanel = document.getElementById("integral-panel");
  const integralPanelHdr = document.getElementById("integral-panel-hdr");
  const integralResizeHandle = document.getElementById("integral-resize-handle");
  const btnMinIntegral = document.getElementById("btn-min-integral");
  const btnCloseIntegral = document.getElementById("btn-close-integral");
  const btnIntegralAddCircle = document.getElementById("btn-integral-add-circle");
  const btnToggleContour = document.getElementById("btn-toggle-contour");
  const optContourMode = document.getElementById("opt-contour-mode");
  const integralMinSum = document.getElementById("integral-min-sum");
  const integralSummaryBar = document.getElementById("integral-summary-bar");
  const integralSumLabel = document.getElementById("integral-sum-label");
  const integralSumRes = document.getElementById("integral-sum-res");
  const integralResCell = document.getElementById("integral-res-cell");
  const integralRows = document.getElementById("integral-rows");
  const integralSumRow = document.getElementById("integral-sum-row");
  const integralSumVal = document.getElementById("integral-sum-val");
  const selectionBanner = document.getElementById("selection-banner");
  const selBannerText = document.getElementById("sel-banner-text");
  const btnSelJoin = document.getElementById("btn-sel-join");
  const btnSelDel = document.getElementById("btn-sel-del");
  const btnSelClear = document.getElementById("btn-sel-clear");

  const readoutIn = document.getElementById("readout-in");
  const readoutOut = document.getElementById("readout-out");

  function ws() {
    return window.CFVWorkspace;
  }

  function notifyDomain() {
    if (ws() && typeof ws().renderDomainCards === "function") {
      ws().renderDomainCards();
    }
  }

  function notifyState(immediate = false, markDirty = true) {
    if (ws() && typeof ws().notifyStateChanged === "function") {
      ws().notifyStateChanged(immediate, markDirty);
    }
  }

  function primaryFnPayload() {
    return ws() ? ws().getPrimaryComplexTarget() : null;
  }

  function visibleComplexTargets() {
    return ws()
      ? ws().getVisibleComplexTargets()
      : [{ target: { fn: 0 }, color: "#38bdf8", lineWidth: 2.2, lineStyle: "solid", cardId: 0 }];
  }

  function screenToWorld(view, canvas, sx, sy) {
    const scX = view.scaleX || view.scale;
    const scY = view.scaleY || view.scale;
    return {
      x: view.cx + (sx - canvas.clientWidth * 0.5) / scX,
      y: view.cy - (sy - canvas.clientHeight * 0.5) / scY,
    };
  }

  function worldToScreen(view, canvas, wx, wy) {
    const scX = view.scaleX || view.scale;
    const scY = view.scaleY || view.scale;
    return {
      x: (wx - view.cx) * scX + canvas.clientWidth * 0.5,
      y: -(wy - view.cy) * scY + canvas.clientHeight * 0.5,
    };
  }

  function fmtComplex(re, im, d = 4) {
    if (!Number.isFinite(re) || !Number.isFinite(im)) return "∞ (pole)";
    const r = Math.abs(re) < 1e-8 ? 0 : re;
    const i = Math.abs(im) < 1e-8 ? 0 : im;
    return `${r.toFixed(d)} ${i >= 0 ? "+" : "−"} ${Math.abs(i).toFixed(d)}i`;
  }

  function fmtCompact(re, im) {
    if (!Number.isFinite(re) || !Number.isFinite(im)) return "pole";
    const r = Math.abs(re) < 1e-5 ? 0 : re;
    const i = Math.abs(im) < 1e-5 ? 0 : im;
    if (r === 0 && i === 0) return "0";
    if (r === 0 && Math.abs(i / Math.PI - Math.round(i / Math.PI)) < 1e-3 && Math.abs(i) > 0.1) {
      const k = Math.round(i / Math.PI);
      return k === 1 ? "πi" : k === -1 ? "−πi" : `${k}πi`;
    }
    if (i === 0 && Math.abs(r / Math.PI - Math.round(r / Math.PI)) < 1e-3 && Math.abs(r) > 0.1) {
      const k = Math.round(r / Math.PI);
      return k === 1 ? "π" : k === -1 ? "−π" : `${k}π`;
    }
    if (i === 0) return r.toFixed(3);
    if (r === 0) return `${i.toFixed(3)}i`;
    return `${r.toFixed(2)}${i >= 0 ? "+" : "−"}${Math.abs(i).toFixed(2)}i`;
  }

  function hexToRgba(hex, a) {
    if (!hex || hex[0] !== "#" || hex.length < 7) return `rgba(56,189,248,${a})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function applyLineStyle(ctx, lineStyle) {
    if (lineStyle === "dashed") ctx.setLineDash([7, 5]);
    else if (lineStyle === "dotted") ctx.setLineDash([2, 4]);
    else ctx.setLineDash([]);
  }

  function drawPointIcon(ctx, sx, sy, icon, color, size, selected) {
    const r = Math.max(2.5, Number(size) || 5);
    ctx.save();
    if (selected) {
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.8, r * 0.36);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (icon === "cross") {
      ctx.beginPath();
      ctx.moveTo(sx - r, sy - r);
      ctx.lineTo(sx + r, sy + r);
      ctx.moveTo(sx + r, sy - r);
      ctx.lineTo(sx - r, sy + r);
      ctx.stroke();
    } else if (icon === "ring") {
      ctx.fillStyle = "#0a0e17";
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (icon === "diamond") {
      ctx.beginPath();
      ctx.moveTo(sx, sy - r * 1.25);
      ctx.lineTo(sx + r * 1.1, sy);
      ctx.lineTo(sx, sy + r * 1.25);
      ctx.lineTo(sx - r * 1.1, sy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#0a0e17";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else if (icon === "star") {
      const spikes = 5;
      const outer = r * 1.35;
      const inner = r * 0.58;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const rad = i % 2 === 0 ? outer : inner;
        const a = (i * Math.PI) / spikes - Math.PI / 2;
        const px = sx + Math.cos(a) * rad;
        const py = sy + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      /* dot */
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#0a0e17";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    ctx.restore();
  }

  function niceStep(raw) {
    const exp = Math.floor(Math.log10(raw));
    const f = raw / Math.pow(10, exp);
    const n = f <= 1.2 ? 1 : f <= 2.5 ? 2 : f <= 5.5 ? 5 : 10;
    return n * Math.pow(10, exp);
  }

  function fmtTick(v) {
    if (Math.abs(v) < 1e-10) return "0";
    if (Math.abs(v) >= 1000 || Math.abs(v) < 0.01) return v.toExponential(1);
    return Number(v.toFixed(4)).toString();
  }

  function bboxOf(pts) {
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const p of pts) {
      if (p.x < xmin) xmin = p.x;
      if (p.x > xmax) xmax = p.x;
      if (p.y < ymin) ymin = p.y;
      if (p.y > ymax) ymax = p.y;
    }
    return { xmin, xmax, ymin, ymax, cx: 0.5 * (xmin + xmax), cy: 0.5 * (ymin + ymax) };
  }

  function signedArea2(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      if (!p || !q) continue;
      a += p.x * q.y - q.x * p.y;
    }
    return a;
  }

  function makeCircle(cx, cy, r, n = 72, ccw = true) {
    const pts = [], d = ccw ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const a = d * (i / n) * Math.PI * 2;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function makeRect(x0, y0, x1, y1, ccw = true) {
    const xlo = Math.min(x0, x1), xhi = Math.max(x0, x1), ylo = Math.min(y0, y1), yhi = Math.max(y0, y1);
    return ccw
      ? [{ x: xlo, y: ylo }, { x: xhi, y: ylo }, { x: xhi, y: yhi }, { x: xlo, y: yhi }]
      : [{ x: xlo, y: ylo }, { x: xlo, y: yhi }, { x: xhi, y: yhi }, { x: xhi, y: ylo }];
  }

  function makeLine(x0, y0, x1, y1, steps = 48) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
    }
    return pts;
  }

  function makeArc(cx, cy, r, a0, a1, n = 80) {
    const pts = [];
    const steps = Math.max(12, n);
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps);
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  /* -------------------------------------------------------------------------
   * Variable-Driven Domain Shape Formulas (Slider Expressions: R, r, eps, pi…)
   * ------------------------------------------------------------------------- */

  const MATH_ENV = {
    pi: Math.PI, PI: Math.PI, M_PI: Math.PI,
    e: Math.E, E: Math.E, M_E: Math.E,
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    exp: Math.exp, log: Math.log, log2: Math.log2, log10: Math.log10,
    sqrt: Math.sqrt, cbrt: Math.cbrt, hypot: Math.hypot,
    abs: Math.abs, fabs: Math.abs, pow: Math.pow,
    min: Math.min, max: Math.max, fmin: Math.min, fmax: Math.max,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc, sign: Math.sign,
  };
  const exprFnCache = new Map();

  function evalParamExpr(expr, paramMap, uVal = 0) {
    if (typeof expr === "number") return expr;
    const raw = String(expr ?? "").trim();
    if (!raw) return NaN;
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(raw)) return parseFloat(raw);
    const scope = Object.assign({}, MATH_ENV, { t: uVal }, paramMap || {}, { u: uVal });
    const argNames = Object.keys(scope).sort();
    const cacheKey = raw + "|" + argNames.join(",");
    let fn = exprFnCache.get(cacheKey);
    if (!fn) {
      /* Allow only safe math identifiers, numbers, and arithmetic operators */
      const allowed = new Set(argNames);
      const stripped = raw.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (id) => (allowed.has(id) ? id : "__INVALID__"));
      if (stripped.includes("__INVALID__") || /[^a-zA-Z0-9_+\-*/().,\s?:<>!=&|]/.test(stripped)) {
        return NaN;
      }
      try {
        fn = new Function(...argNames, `"use strict"; return Number(${stripped});`);
        if (exprFnCache.size > 256) exprFnCache.clear();
        exprFnCache.set(cacheKey, fn);
      } catch (_) {
        return NaN;
      }
    }
    try {
      const vals = argNames.map((k) => scope[k]);
      const res = fn(...vals);
      return Number.isFinite(res) ? res : NaN;
    } catch (_) {
      return NaN;
    }
  }

  function evalShapeFormula(formula, paramMap) {
    if (!formula || typeof formula !== "object") return null;
    const k = formula.kind;
    if (k === "circle") {
      const cx = evalParamExpr(formula.cx ?? "0", paramMap);
      const cy = evalParamExpr(formula.cy ?? "0", paramMap);
      const r = evalParamExpr(formula.r ?? "1", paramMap);
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r)) return null;
      return { rawPts: makeCircle(cx, cy, Math.max(1e-3, Math.abs(r)), 72, r >= 0), closed: true };
    }
    if (k === "arc") {
      const cx = evalParamExpr(formula.cx ?? "0", paramMap);
      const cy = evalParamExpr(formula.cy ?? "0", paramMap);
      const r = evalParamExpr(formula.r ?? "1", paramMap);
      const a0 = evalParamExpr(formula.a0 ?? "0", paramMap);
      const a1 = evalParamExpr(formula.a1 ?? "pi", paramMap);
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) || !Number.isFinite(a0) || !Number.isFinite(a1)) return null;
      return { rawPts: makeArc(cx, cy, Math.max(1e-3, Math.abs(r)), a0, a1, 84), closed: false };
    }
    if (k === "line") {
      const x0 = evalParamExpr(formula.x0 ?? "-1", paramMap);
      const y0 = evalParamExpr(formula.y0 ?? "0", paramMap);
      const x1 = evalParamExpr(formula.x1 ?? "1", paramMap);
      const y1 = evalParamExpr(formula.y1 ?? "0", paramMap);
      if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return null;
      return { rawPts: makeLine(x0, y0, x1, y1, 56), closed: false };
    }
    if (k === "rect") {
      const x0 = evalParamExpr(formula.x0 ?? "-1", paramMap);
      const y0 = evalParamExpr(formula.y0 ?? "-1", paramMap);
      const x1 = evalParamExpr(formula.x1 ?? "1", paramMap);
      const y1 = evalParamExpr(formula.y1 ?? "1", paramMap);
      if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return null;
      return { rawPts: makeRect(x0, y0, x1, y1, true), closed: true };
    }
    if (k === "parametric") {
      const u0 = evalParamExpr(formula.u0 ?? "0", paramMap);
      const u1 = evalParamExpr(formula.u1 ?? "2*pi", paramMap);
      if (!Number.isFinite(u0) || !Number.isFinite(u1)) return null;
      const steps = 96;
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const u = u0 + (u1 - u0) * (i / steps);
        const px = evalParamExpr(formula.xExpr ?? "cos(u)", paramMap, u);
        const py = evalParamExpr(formula.yExpr ?? "sin(u)", paramMap, u);
        if (Number.isFinite(px) && Number.isFinite(py)) pts.push({ x: px, y: py });
      }
      if (pts.length < 2) return null;
      return { rawPts: pts, closed: Boolean(formula.closed) };
    }
    return null;
  }

  function rebuildFormulaShapes() {
    const paramMap = ws() && typeof ws().getParamMap === "function" ? ws().getParamMap() : {};
    /* Locked elements with variable formulas STILL move dynamically when sliders/vars change! */
    for (const s of state.shapes) {
      if (!s.formula) continue;
      const res = evalShapeFormula(s.formula, paramMap);
      if (res && res.rawPts.length >= 2) {
        s.rawPts = res.rawPts;
        if (s.formula.kind !== "parametric") s.closed = res.closed;
      }
    }
    for (const p of state.points) {
      if (p.xExpr && String(p.xExpr).trim()) {
        const vx = evalParamExpr(p.xExpr, paramMap);
        if (Number.isFinite(vx)) p.x = vx;
      }
      if (p.yExpr && String(p.yExpr).trim()) {
        const vy = evalParamExpr(p.yExpr, paramMap);
        if (Number.isFinite(vy)) p.y = vy;
      }
    }
    for (const ln of state.lines) {
      if (ln.valExpr && String(ln.valExpr).trim()) {
        const vv = evalParamExpr(ln.valExpr, paramMap);
        if (Number.isFinite(vv)) ln.value = vv;
      }
    }
    for (const tb of state.texts) {
      if (tb.xExpr && String(tb.xExpr).trim()) {
        const vx = evalParamExpr(tb.xExpr, paramMap);
        if (Number.isFinite(vx)) tb.x = vx;
      }
      if (tb.yExpr && String(tb.yExpr).trim()) {
        const vy = evalParamExpr(tb.yExpr, paramMap);
        if (Number.isFinite(vy)) tb.y = vy;
      }
    }
  }

  async function rebuildShapeFromFormula(shape) {
    if (!shape || !shape.formula) return false;
    const paramMap = ws() && typeof ws().getParamMap === "function" ? ws().getParamMap() : {};
    const res = evalShapeFormula(shape.formula, paramMap);
    if (!res || res.rawPts.length < 2) return false;
    shape.rawPts = res.rawPts;
    if (shape.formula.kind !== "parametric") shape.closed = res.closed;
    await computeShape(shape, 1.0);
    updateIntegralPanel();
    if (ws() && typeof ws().syncShapeBadges === "function") ws().syncShapeBadges();
    requestRender();
    return true;
  }

  function createDefaultFormulaForShape(s) {
    if (!s || !s.rawPts || s.rawPts.length < 2) return { kind: "circle", cx: "0", cy: "0", r: "1" };
    const bb = bboxOf(s.rawPts);
    const f2 = (n) => String(Number(n.toFixed(3)));
    if (s.kind === "circle") {
      const r = 0.25 * (bb.xmax - bb.xmin + (bb.ymax - bb.ymin));
      return { kind: "circle", cx: f2(bb.cx), cy: f2(bb.cy), r: f2(Math.max(0.1, r)) };
    }
    if (s.kind === "rect") {
      return { kind: "rect", x0: f2(bb.xmin), y0: f2(bb.ymin), x1: f2(bb.xmax), y1: f2(bb.ymax) };
    }
    if (s.kind === "line") {
      const p0 = s.rawPts[0], p1 = s.rawPts[s.rawPts.length - 1];
      return { kind: "line", x0: f2(p0.x), y0: f2(p0.y), x1: f2(p1.x), y1: f2(p1.y) };
    }
    if (s.kind === "arc") {
      const r = Math.max(0.2, 0.5 * Math.max(bb.xmax - bb.xmin, bb.ymax - bb.ymin));
      return { kind: "arc", cx: f2(bb.cx), cy: f2(bb.cy), r: f2(r), a0: "0", a1: "pi" };
    }
    return { kind: "parametric", xExpr: `${f2(bb.cx)} + cos(u)`, yExpr: `${f2(bb.cy)} + sin(u)`, u0: "0", u1: "2*pi", closed: Boolean(s.closed) };
  }

  /* Magnetic Endpoint & Landmark Point Snapping */
  function findSnapTarget(sx, sy, excludeShapeId = null) {
    let best = null;
    let bestDist = SNAP_PX;
    for (const s of state.shapes) {
      if (!s.visible || s.closed || s.id === excludeShapeId || !s.rawPts || s.rawPts.length < 2) continue;
      for (const ep of [s.rawPts[0], s.rawPts[s.rawPts.length - 1]]) {
        const sp = worldToScreen(state.inView, canvasIn, ep.x, ep.y);
        const d = Math.hypot(sx - sp.x, sy - sp.y);
        if (d <= bestDist) {
          bestDist = d;
          best = { x: ep.x, y: ep.y, kind: "endpoint", shapeId: s.id };
        }
      }
    }
    for (const p of state.points) {
      if (!p.visible) continue;
      const sp = worldToScreen(state.inView, canvasIn, p.x, p.y);
      const d = Math.hypot(sx - sp.x, sy - sp.y);
      if (d <= bestDist) {
        bestDist = d;
        best = { x: p.x, y: p.y, kind: "point", pointId: p.id };
      }
    }
    return best;
  }

  /* -------------------------------------------------------------------------
   * Backend Calls
   * ------------------------------------------------------------------------- */

  async function apiEval(pts, targetOverride) {
    if (!pts || pts.length === 0) return [];
    const tgt = targetOverride || primaryFnPayload();
    if (!tgt) return [];
    const flat = [];
    for (const p of pts) flat.push(p.x, p.y);
    const res = await fetch("/api/eval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...tgt, points: flat }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const out = [];
    for (let i = 0; i < data.out.length; i += 2) {
      out.push(data.out[i] === null || data.out[i + 1] === null ? null : { x: data.out[i], y: data.out[i + 1] });
    }
    return out;
  }

  function unpackCurve(raw) {
    const inPts = [], outPts = [];
    for (let i = 0; i < raw.in.length; i += 2) {
      inPts.push({ x: raw.in[i], y: raw.in[i + 1] });
      outPts.push(raw.out[i] === null || raw.out[i + 1] === null ? null : { x: raw.out[i], y: raw.out[i + 1] });
    }
    return { inPts, outPts };
  }

  function unpackIntegral(raw) {
    const inPts = [], cumPts = [];
    const rIn = (raw && Array.isArray(raw.in)) ? raw.in : [];
    const rCum = (raw && Array.isArray(raw.cum)) ? raw.cum : [];
    const len = Math.min(rIn.length, rCum.length);
    for (let i = 0; i + 1 < len; i += 2) {
      inPts.push({ x: rIn[i], y: rIn[i + 1] });
      cumPts.push({ x: rCum[i], y: rCum[i + 1] });
    }
    const tot = (raw && Array.isArray(raw.total)) ? raw.total : [0, 0];
    const d2p = (raw && Array.isArray(raw.div_2pii)) ? raw.div_2pii : [0, 0];
    return {
      inPts,
      cumPts,
      total: { x: tot[0] || 0, y: tot[1] || 0 },
      div2pii: { x: d2p[0] || 0, y: d2p[1] || 0 },
      arcLength: Number(raw && raw.arc_length) || 0,
      orientation: Number(raw && raw.orientation) || 1,
      singular: Boolean(raw && raw.singular),
    };
  }

  async function apiTrace(rawPts, closed, withMesh, target, qScale = 1.0) {
    const tgt = target || primaryFnPayload();
    if (!tgt) return null;
    const flat = [];
    for (const p of rawPts) flat.push(p.x, p.y);
    const inSpan = Math.max(canvasIn.clientWidth || 400, canvasIn.clientHeight || 400) / state.inView.scale;
    const outSpan = Math.max(canvasOut.clientWidth || 400, canvasOut.clientHeight || 400) / state.outView.scale;

    if (tgt.dirichlet) {
      const res = await fetch("/api/dirichlet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          n: tgt.n || 20,
          closed,
          points: flat,
          max_in_step: Math.max(0.02, (inSpan / 95) * qScale),
          max_out_step: Math.max(0.02, (outSpan / 85) * qScale),
        }),
      });
      return res.ok ? res.json() : null;
    }

    const res = await fetch("/api/trace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...tgt,
        closed,
        with_mesh: withMesh,
        points: flat,
        max_in_step: Math.max(0.012, (inSpan / 130) * qScale),
        max_out_step: Math.max(0.012, (outSpan / 115) * qScale),
        clip_radius: Math.max(80, outSpan * 12),
      }),
    });
    return res.ok ? res.json() : null;
  }

  async function apiIntegrate(rawPts, closed, target, qScale = 1.0) {
    const tgt = target || primaryFnPayload();
    if (!tgt) return null;
    const flat = [];
    for (const p of rawPts) flat.push(p.x, p.y);
    const inSpan = Math.max(canvasIn.clientWidth || 400, canvasIn.clientHeight || 400) / state.inView.scale;
    const res = await fetch("/api/integrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...tgt,
        closed,
        points: flat,
        max_in_step: Math.max(0.02, (inSpan / 90) * qScale),
      }),
    });
    return res.ok ? res.json() : null;
  }

  function expandLinearShapePts(shape) {
    if (!shape || !shape.rawPts || shape.rawPts.length < 2) return shape ? shape.rawPts : [];
    if (shape.kind !== "ray" && shape.kind !== "infline") return shape.rawPts;
    const a = shape.rawPts[0];
    const b = shape.rawPts[shape.rawPts.length - 1];
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) { dx = 1; dy = 0; }
    else { dx /= len; dy /= len; }
    const span = Math.max(4.0, ((canvasIn.clientWidth || 600) / Math.max(1e-6, state.inView.scale)) * 1.2);
    const maxExt = span * 18.0;
    const pts = [];
    if (shape.kind === "ray") {
      const N = 96;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const dist = maxExt * (0.12 * u + 0.88 * u * u * u);
        pts.push({ x: a.x + dx * dist, y: a.y + dy * dist });
      }
    } else {
      const N = 128;
      for (let i = 0; i <= N; i++) {
        const u = -1.0 + (2.0 * i) / N;
        const dist = maxExt * (0.12 * u + 0.88 * u * u * u);
        pts.push({ x: a.x + dx * dist, y: a.y + dy * dist });
      }
    }
    return pts;
  }

  async function computeShape(shape, qScale = 1.0) {
    const evalPts = expandLinearShapePts(shape);
    const targets = visibleComplexTargets();
    if (targets.length === 0) {
      shape.integral = null;
      shape.boundary = { inPts: evalPts, outPts: [] };
      shape.mesh = [];
      shape.extraCurves = [];
      return;
    }

    if (state.mode === "integral") {
      const data = await apiIntegrate(evalPts, shape.closed, primaryFnPayload(), qScale);
      if (data && state.shapes.includes(shape)) {
        shape.integral = unpackIntegral(data);
        shape.boundary = { inPts: shape.integral.inPts, outPts: shape.integral.cumPts };
        shape.extraCurves = [];
      }
      return;
    }

    const primary = targets[0];
    /* Keep interior conformal mesh updated even while sliders scrub/play or shapes drag so
     * grid lines never freeze/detach and interior/exterior shading never tests stale points! */
    const wantMesh = Boolean(state.showMesh && shape.closed && state.shapes.length <= 16);
    const pData = await apiTrace(evalPts, shape.closed, wantMesh, primary.target, qScale);
    if (pData && state.shapes.includes(shape)) {
      shape.boundary = unpackCurve(pData.boundary);
      shape.mesh = wantMesh ? (pData.mesh || []).map(unpackCurve) : [];
      shape.winding = pData.winding;
      shape.primaryColor = targets.length > 1 ? primary.color : null;
    }

    const extras = [];
    for (let i = 1; i < targets.length; i++) {
      const t = targets[i];
      const d = await apiTrace(evalPts, shape.closed, false, t.target, qScale * 1.1);
      if (d && d.boundary) {
        extras.push({
          curve: unpackCurve(d.boundary),
          color: t.color,
          lineWidth: t.lineWidth || 2.0,
          lineStyle: t.lineStyle || "solid",
        });
      }
    }
    if (state.shapes.includes(shape)) {
      shape.extraCurves = extras;
    }
  }

  async function recomputePoints() {
    if (!state.active) return;
    if (state.mode !== "map" || visibleComplexTargets().length === 0) {
      for (const p of state.points) p.outPt = null;
      requestRender();
      return;
    }
    const vis = state.points.filter((p) => p.visible);
    if (vis.length === 0) {
      requestRender();
      return;
    }
    const out = await apiEval(vis.map((p) => ({ x: p.x, y: p.y })));
    if (out && out.length === vis.length) {
      vis.forEach((p, i) => {
        p.outPt = out[i];
      });
    }
    requestRender();
  }

  function isInputEditable() {
    return state.inProjection === "planar" || state.inProjection === "polar";
  }

  async function recomputeAllOnce(qScale = 1.0, lightweight = false) {
    if (!state.active) return;
    rebuildFormulaShapes();
    const hasDom = Boolean(state.showDomain || state.showOutDomain);
    /* Fire domain coloring IMMEDIATELY in parallel instead of waiting behind shape/point roundtrips! */
    if (hasDom) scheduleDomain(Boolean(lightweight));
    const outHidden = Boolean(ws() && ws().state && ws().state.outputHidden);
    const skipShapesForInSphere = Boolean(outHidden && state.inProjection === "sphere");
    const fastDomainOnly = Boolean((lightweight && hasDom && state.shapes.length === 0) || skipShapesForInSphere);
    if (!fastDomainOnly) {
      await Promise.all([
        ...state.shapes.map((s) => computeShape(s, qScale)),
        recomputePoints(),
      ]);
      updateIntegralPanel();
    }
    if (lightweight && ws() && typeof ws().syncShapeBadges === "function") {
      ws().syncShapeBadges();
    } else if (!fastDomainOnly) {
      notifyDomain();
    }
    if (state.taylor.enabled && !lightweight) fetchTaylor();
    requestRender();
  }

  async function recomputeAll(qScale = 1.0, lightweight = false) {
    if (!state.active) return;
    if (state.fetchBusy) {
      state.fetchQueued = true;
      state.queuedQScale = qScale;
      state.queuedLightweight = Boolean(lightweight);
      return;
    }
    state.fetchBusy = true;
    try {
      let curScale = qScale;
      let curLight = Boolean(lightweight);
      do {
        state.fetchQueued = false;
        await recomputeAllOnce(curScale, curLight);
        curScale = state.queuedQScale || 1.0;
        curLight = Boolean(state.queuedLightweight);
      } while (state.fetchQueued && state.active);
    } finally {
      state.fetchBusy = false;
    }
  }

  /* -------------------------------------------------------------------------
   * View, Resize & Domain Coloring
   * ------------------------------------------------------------------------- */

  function setView(view, canvas, cx, cy, r, skipSideEffects = false) {
    const dim = Math.min(canvas.clientWidth || 500, canvas.clientHeight || 500);
    view.cx = cx;
    view.cy = cy;
    const s = (dim * 0.45) / Math.max(r, 1e-13);
    view.scale = s;
    view.scaleX = s;
    view.scaleY = s;
    if (!skipSideEffects) {
      if (view === state.inView && (state.showDomain || state.showOutDomain)) scheduleDomain();
      requestRender(view === state.inView ? "in" : "out");
    }
  }

  function zoomAt(view, canvas, sx, sy, factorX, factorY = factorX) {
    const b = screenToWorld(view, canvas, sx, sy);
    view.scaleX = Math.min(1e13, Math.max(0.5, (view.scaleX || view.scale) * factorX));
    view.scaleY = Math.min(1e13, Math.max(0.5, (view.scaleY || view.scale) * factorY));
    view.scale = Math.sqrt(view.scaleX * view.scaleY);
    const a = screenToWorld(view, canvas, sx, sy);
    view.cx += b.x - a.x;
    view.cy += b.y - a.y;
    if (view === state.inView && (state.showDomain || state.showOutDomain)) scheduleDomain(true);
    requestRender(view === state.inView ? "in" : "out");
  }

  function autoFitOutput() {
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, cnt = 0;
    if (state.mode === "integral") {
      xmin = xmax = ymin = ymax = 0;
      cnt = 1;
      for (const s of state.shapes) {
        if (!s.visible || !s.integral) continue;
        for (const p of s.integral.cumPts) {
          if (!Number.isFinite(p.x) || Math.hypot(p.x, p.y) > 200) continue;
          xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x);
          ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y);
          cnt++;
        }
      }
    } else {
      for (const s of state.shapes) {
        if (!s.visible || !s.boundary) continue;
        for (const p of s.boundary.outPts) {
          if (!p || Math.hypot(p.x, p.y) > 40) continue;
          xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x);
          ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y);
          cnt++;
        }
      }
    }
    if (cnt < 2) {
      setView(state.outView, canvasOut, state.defaultOutView.cx, state.defaultOutView.cy, state.defaultOutView.r);
      return;
    }
    const cx = 0.5 * (xmin + xmax), cy = 0.5 * (ymin + ymax);
    const hw = Math.max(0.45, 0.58 * (xmax - xmin)), hh = Math.max(0.45, 0.58 * (ymax - ymin));
    const sx = (canvasOut.clientWidth * 0.42) / hw;
    const sy = (canvasOut.clientHeight * (state.mode === "integral" ? 0.34 : 0.42)) / hh;
    state.outView.cx = cx;
    state.outView.cy = state.mode === "integral" ? cy - hh * 0.25 : cy;
    if (state.outSquare) {
      const s = Math.min(sx, sy);
      state.outView.scale = state.outView.scaleX = state.outView.scaleY = s;
    } else {
      state.outView.scaleX = sx;
      state.outView.scaleY = sy;
      state.outView.scale = Math.sqrt(sx * sy);
    }
    requestRender();
  }

  function ensureCanvasSize(c) {
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w < 2 || h < 2) return false;
    const tw = Math.round(w * dpr);
    const th = Math.round(h * dpr);
    if (c.width !== tw || c.height !== th) {
      c.width = tw;
      c.height = th;
    }
    return true;
  }

  /* Full-viewport 1:1 equal-axes toggle:
   * - ON: locks scaleX === scaleY (geometric 1:1 grid cells) while still filling 100% of the pane.
   * - OFF: unlocks independent X/Y stretch (Shift+scroll = X, Alt+scroll = Y, non-uniform Fit) & restores saved ratio. */
  function setSquareAspect(which, enabled) {
    const on = Boolean(enabled);
    const isIn = which === "in";
    const view = isIn ? state.inView : state.outView;
    const btn = document.getElementById(isIn ? "in-square" : "out-square");
    if (isIn) state.inSquare = on;
    else state.outSquare = on;
    if (btn) btn.classList.toggle("active", on);

    const scX = view.scaleX || view.scale;
    const scY = view.scaleY || view.scale;
    if (on) {
      const ratio = scX > 1e-9 ? scY / scX : 1.0;
      if (isIn) state.inSavedRatio = ratio;
      else state.outSavedRatio = ratio;
      const s = Math.sqrt(scX * scY);
      view.scale = view.scaleX = view.scaleY = s;
    } else {
      const ratio = isIn ? state.inSavedRatio : state.outSavedRatio;
      if (Number.isFinite(ratio) && Math.abs(ratio - 1.0) > 1e-4) {
        const s = view.scale || Math.sqrt(scX * scY);
        view.scaleX = s / Math.sqrt(ratio);
        view.scaleY = s * Math.sqrt(ratio);
      }
    }
    if (isIn && (state.showDomain || state.showOutDomain)) scheduleDomain();
    requestRender();
  }

  function resize() {
    if (!state.active) return;
    const had0In = canvasIn.width <= 300 && canvasIn.height <= 150;
    const had0Out = canvasOut.width <= 300 && canvasOut.height <= 150;
    const okIn = ensureCanvasSize(canvasIn);
    const okOut = ensureCanvasSize(canvasOut);
    if (had0In && okIn) {
      setView(state.inView, canvasIn, state.defaultInView.cx, state.defaultInView.cy, state.defaultInView.r);
    }
    if (had0Out && okOut) {
      setView(state.outView, canvasOut, state.defaultOutView.cx, state.defaultOutView.cy, state.defaultOutView.r);
    }
    if ((state.showDomain || state.showOutDomain) && (okIn || okOut)) scheduleDomain();
    requestRender();
  }

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (state.active) resize();
    });
    ro.observe(inCard);
    ro.observe(outCard);
  }

  function scheduleDomain(isAnimating = false) {
    if ((!state.showDomain && !state.showOutDomain) || !state.active) return;
    if (isAnimating) {
      /* Smooth pipelined preview: fire immediately if idle, else queue latest viewport (ZERO debounce starvation!) */
      if (!state.domainInFlight) {
        fetchDomain(true);
      } else {
        state.domainPendingMode = state.domainPendingMode === "full" ? "full" : "fast";
      }
      /* Schedule crisp native-res settle pass shortly after zooming/animation pauses */
      if (state.domainSettleTimer) clearTimeout(state.domainSettleTimer);
      state.domainSettleTimer = setTimeout(() => {
        state.domainSettleTimer = null;
        if ((!state.showDomain && !state.showOutDomain) || !state.active) return;
        const playing = ws() && typeof ws().isAnySliderPlaying === "function" && ws().isAnySliderPlaying();
        if (!playing) {
          if (!state.domainInFlight) fetchDomain(false);
          else state.domainPendingMode = "full";
        }
      }, 110);
      return;
    }
    if (state.domainTimer) clearTimeout(state.domainTimer);
    if (state.domainSettleTimer) { clearTimeout(state.domainSettleTimer); state.domainSettleTimer = null; }
    state.domainTimer = setTimeout(() => {
      state.domainTimer = null;
      if (!state.domainInFlight) fetchDomain(false);
      else state.domainPendingMode = "full";
    }, 35);
  }

  async function fetchDomain(fastPreview = false) {
    if ((!state.showDomain && !state.showOutDomain) || !state.active) return;
    const tgt = primaryFnPayload();
    if (!tgt) {
      state.domainImg = null;
      requestRender();
      return;
    }
    const reqId = ++state.domainReqId;
    const inW = canvasIn.clientWidth, inH = canvasIn.clientHeight;
    const useMercGlobal = (
      state.showOutDomain ||
      (state.showDomain && state.inProjection === "sphere")
    ) && state.outDomainMapping === "mercator" && (
      !state.showDomain || state.inProjection === "sphere" || inW < 20 || inH < 20
    );
    const w = inW >= 20 ? inW : (canvasOut.clientWidth >= 20 ? canvasOut.clientWidth : 640);
    const h = inH >= 20 ? inH : (canvasOut.clientHeight >= 20 ? canvasOut.clientHeight : 480);
    const dpr = Math.min(2.0, window.devicePixelRatio || 1);
    const physW = useMercGlobal ? 720 : Math.max(64, Math.round(w * dpr));
    const physH = useMercGlobal ? 540 : Math.max(64, Math.round(h * dpr));
    const isFractal = state.domainScheme === "smooth_escape" || state.domainScheme === "inferno" || state.domainScheme === "ocean";
    /* High-clarity adaptive FPS preview + 100% native device-pixel settle! */
    if (!Number.isFinite(state.domainFastBudget)) {
      state.domainFastBudget = isFractal ? 380000 : 260000;
    }
    const maxPixels = fastPreview
      ? Math.max(120000, Math.min(720000, Math.round(state.domainFastBudget)))
      : (isFractal ? 2800000 : 1500000);
    const maxEdge = fastPreview ? (isFractal ? 1400 : 1080) : (isFractal ? 2200 : 1600);
    const pixelScale = Math.sqrt(maxPixels / Math.max(1, physW * physH));
    const edgeScale = maxEdge / Math.max(physW, physH);
    const scale = Math.min(1.0, pixelScale, edgeScale);
    const tw = Math.min(2400, Math.max(64, Math.round(physW * scale)));
    const th = Math.min(2400, Math.max(64, Math.round(physH * scale)));
    const scX = state.inView.scaleX || state.inView.scale;
    const scY = state.inView.scaleY || state.inView.scale;
    const halfW = useMercGlobal ? Math.PI : (w * 0.5) / scX;
    const halfH = useMercGlobal ? 2.65 : (h * 0.5) / scY;
    const cx = useMercGlobal ? 0.0 : state.inView.cx;
    const cy = useMercGlobal ? 0.0 : state.inView.cy;
    const paramKey = JSON.stringify(tgt) + "|" + (state.domainScheme || "classic") + (useMercGlobal ? "|merc" : "");
    state.domainInFlight = true;
    state.domainPendingMode = null;
    const tFetchStart = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const res = await fetch("/api/domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...tgt,
          cx,
          cy,
          half_w: halfW,
          half_h: halfH,
          width: tw,
          height: th,
          scheme: state.domainScheme || "classic",
        }),
      });
      if (!res.ok) return;
      if (reqId < (state.domainLastAppliedId || 0)) return;
      if (!fastPreview && reqId !== state.domainReqId) return;
      const buf = await res.arrayBuffer();
      if (fastPreview) {
        const dtMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - tFetchStart;
        if (dtMs > 34) state.domainFastBudget = Math.max(120000, state.domainFastBudget * 0.78);
        else if (dtMs < 18) state.domainFastBudget = Math.min(720000, state.domainFastBudget * 1.24);
      }
      if (reqId < (state.domainLastAppliedId || 0)) return;
      if (!fastPreview && reqId !== state.domainReqId) return;
      /* Never let a lower-res fastPreview overwrite an already-settled full-res tile for the EXACT same viewport AND parameters! */
      const cur = state.domainImg;
      if (fastPreview && cur && !cur.fast &&
          cur.paramKey === paramKey &&
          Math.abs(cur.cx - cx) < halfW * 1e-6 &&
          Math.abs(cur.cy - cy) < halfH * 1e-6 &&
          Math.abs(cur.halfW - halfW) < halfW * 1e-6 &&
          Math.abs(cur.halfH - halfH) < halfH * 1e-6) {
        return;
      }
      state.domainLastAppliedId = reqId;
      const pixels = new Uint8ClampedArray(buf);
      const off = state._domainOffCanvas || (state._domainOffCanvas = document.createElement("canvas"));
      if (off.width !== tw || off.height !== th) { off.width = tw; off.height = th; }
      off.getContext("2d").putImageData(new ImageData(pixels, tw, th), 0, 0);
      state.domainImg = { canvas: off, pixels, cx, cy, halfW, halfH, paramKey, fast: Boolean(fastPreview), tw, th };
      requestRender(state.showOutDomain ? "both" : "in");
    } finally {
      state.domainInFlight = false;
      const nextMode = state.domainPendingMode;
      state.domainPendingMode = null;
      if (nextMode && (state.showDomain || state.showOutDomain) && state.active) {
        fetchDomain(nextMode !== "full");
      }
    }
  }

  /* -------------------------------------------------------------------------
   * Taylor Series & Zero Hunter
   * ------------------------------------------------------------------------- */

  async function fetchTaylor() {
    if (!state.taylor.enabled || !state.active) return;
    const tgt = primaryFnPayload();
    if (!tgt) {
      state.taylor.coeffs = [];
      requestRender();
      return;
    }
    const res = await fetch("/api/taylor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...tgt,
        x0: state.taylor.x0,
        y0: state.taylor.y0,
        degree: state.taylor.degree,
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const radEl = document.getElementById("taylor-radius");
    if (!data.valid) {
      state.taylor.coeffs = [];
      if (radEl) radEl.textContent = "Pole at z₀";
    } else {
      state.taylor.radius = data.radius;
      state.taylor.coeffs = data.coeffs || [];
      if (radEl) radEl.textContent = data.radius >= 99 ? "∞ (entire)" : data.radius.toFixed(5);
    }
    requestRender();
  }

  function evalTaylor(x, y) {
    const t = state.taylor;
    if (!t.enabled || !t.coeffs || t.coeffs.length < 2) return null;
    const dx = x - t.x0, dy = y - t.y0;
    const deg = Math.min(t.degree, Math.floor(t.coeffs.length / 2) - 1);
    let re = t.coeffs[2 * deg], im = t.coeffs[2 * deg + 1];
    for (let k = deg - 1; k >= 0; k--) {
      const nr = re * dx - im * dy + t.coeffs[2 * k];
      const ni = re * dy + im * dx + t.coeffs[2 * k + 1];
      re = nr; im = ni;
      if (!Number.isFinite(re) || Math.hypot(re, im) > 1e5) return null;
    }
    return Math.hypot(re, im) < 120 ? { x: re, y: im } : null;
  }

  async function huntZeros(insideShape) {
    const tgt = primaryFnPayload();
    if (!tgt) return [];
    const payload = { ...tgt };
    if (insideShape) {
      const target =
        state.shapes.find((s) => s.id === state.selectedShapeId && s.closed) ||
        [...state.shapes].reverse().find((s) => s.closed);
      if (!target) return [];
      const flat = [];
      for (const p of target.rawPts) flat.push(p.x, p.y);
      payload.points = flat;
    } else {
      const hw = (canvasIn.clientWidth * 0.5) / state.inView.scale;
      const hh = (canvasIn.clientHeight * 0.5) / state.inView.scale;
      payload.xmin = state.inView.cx - hw;
      payload.xmax = state.inView.cx + hw;
      payload.ymin = state.inView.cy - hh;
      payload.ymax = state.inView.cy + hh;
    }
    const res = await fetch("/api/find_zeros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return [];
    const data = await res.json();
    state.foundZeros = data.zeros || [];
    requestRender();
    return state.foundZeros;
  }

  /* -------------------------------------------------------------------------
   * Resize Handles & Hit-Testing (Respects `locked`!)
   * ------------------------------------------------------------------------- */

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
      return { cx: bb.cx, cy: bb.cy, ux: 1, uy: 0, vx: 0, vy: 1, w: Math.max(0.02, bb.xmax - bb.xmin), h: Math.max(0.02, bb.ymax - bb.ymin) };
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

  function isShapeSelected(id) {
    return state.selectedShapeIds.has(id) || state.selectedShapeId === id;
  }

  function isPointSelected(id) {
    return state.selectedPointIds.has(id) || state.selectedPointId === id;
  }

  let bannerToastTimer = null;
  let bannerToastMsg = "";

  function showSelectionToast(msg, ms = 2600) {
    bannerToastMsg = msg;
    if (bannerToastTimer) clearTimeout(bannerToastTimer);
    updateSelectionBanner();
    bannerToastTimer = setTimeout(() => {
      bannerToastMsg = "";
      bannerToastTimer = null;
      updateSelectionBanner();
    }, ms);
  }

  function syncPrimarySelection() {
    const sArr = [...state.selectedShapeIds].filter((id) => state.shapes.some((s) => s.id === id));
    state.selectedShapeIds = new Set(sArr);
    state.selectedShapeId = sArr.length > 0 ? sArr[sArr.length - 1] : null;

    const pArr = [...state.selectedPointIds].filter((id) => state.points.some((p) => p.id === id));
    state.selectedPointIds = new Set(pArr);
    state.selectedPointId = pArr.length > 0 ? pArr[pArr.length - 1] : null;

    updateSelectionBanner();
  }

  function clearSelection() {
    state.selectedShapeIds.clear();
    state.selectedPointIds.clear();
    state.selectedShapeId = null;
    state.selectedPointId = null;
    state.selectedLineId = null;
    updateSelectionBanner();
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
    /* Give degenerate 1D collinear selections a tiny non-zero padding so handles don't overlap */
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
      const sp = worldToScreen(state.inView, canvasIn, h.x, h.y);
      if (Math.hypot(sx - sp.x, sy - sp.y) <= HANDLE_HIT_PX + 1) return { box: bb, handle: h };
    }
    return null;
  }

  function hitGroupBox(sx, sy) {
    const bb = getGroupBox();
    if (!bb) return false;
    const tl = worldToScreen(state.inView, canvasIn, bb.xmin, bb.ymax);
    const br = worldToScreen(state.inView, canvasIn, bb.xmax, bb.ymin);
    const pad = 6;
    return sx >= Math.min(tl.x, br.x) - pad && sx <= Math.max(tl.x, br.x) + pad &&
           sy >= Math.min(tl.y, br.y) - pad && sy <= Math.max(tl.y, br.y) + pad;
  }

  /* -------------------------------------------------------------------------
   * Snapshot Undo History Stack (Join, Move, Resize, Rotate, Draw, Delete, Clear)
   * ------------------------------------------------------------------------- */

  function cloneUndoState() {
    return {
      shapes: state.shapes.map((s) => ({
        id: s.id, kind: s.kind, label: s.label, color: s.color,
        lineWidth: s.lineWidth, lineStyle: s.lineStyle, locked: s.locked,
        closed: s.closed, visible: s.visible,
        formula: s.formula ? { ...s.formula } : null,
        rawPts: (s.rawPts || []).map((p) => ({ x: p.x, y: p.y })),
        boundary: null, mesh: [], extraCurves: [],
      })),
      points: state.points.map((p) => ({ ...p, outPt: null })),
      lines: state.lines.map((l) => ({ ...l })),
    };
  }

  function pushUndoSnapshot() {
    state.undoStack.push(cloneUndoState());
    if (state.undoStack.length > 40) state.undoStack.shift();
  }

  async function undoLastAction() {
    if (state.undoStack.length === 0) {
      showSelectionToast("Nothing to undo");
      return false;
    }
    const snap = state.undoStack.pop();
    state.shapes = snap.shapes;
    state.points = snap.points;
    state.lines = snap.lines;
    clearSelection();
    await recomputeAll(1.0);
    notifyState(true);
    return true;
  }

  /* -------------------------------------------------------------------------
   * Selection Rotation Handle (Works for Single Shape AND Multi-Selection!)
   * ------------------------------------------------------------------------- */

  function getSelectionRotateInfo() {
    const items = getSelectedMovableItems();
    if (items.total === 0) return null;
    if (items.total === 1 && items.shapes.length === 0) return null; /* Single point cannot rotate */
    let bb = null;
    if (items.total >= 2) {
      bb = getGroupBox();
    } else {
      bb = bboxOf(items.shapes[0].rawPts);
    }
    if (!bb || !Number.isFinite(bb.xmin)) return null;
    const topMid = worldToScreen(state.inView, canvasIn, bb.cx, bb.ymax);
    return {
      bb,
      cx: bb.cx,
      cy: bb.cy,
      stemX: topMid.x,
      stemY: topMid.y,
      handleX: topMid.x,
      handleY: topMid.y - 26,
      items,
    };
  }

  function hitRotateHandle(sx, sy) {
    const info = getSelectionRotateInfo();
    if (!info) return null;
    if (Math.hypot(sx - info.handleX, sy - info.handleY) <= HANDLE_HIT_PX + 2) return info;
    return null;
  }

  async function flushRotateDrag(drag) {
    if (drag.busy) { drag.dirty = true; return; }
    drag.busy = true;
    try {
      do {
        drag.dirty = false;
        await Promise.all([
          ...drag.shapes.map((item) => computeShape(item.shape, 1.35)),
          drag.points.length > 0 && state.mode === "map" ? recomputePoints() : Promise.resolve(),
        ]);
        updateIntegralPanel();
        requestRender();
      } while (drag.dirty && state.dragRotate === drag);
    } finally {
      drag.busy = false;
    }
  }

  function updateSelectionBanner() {
    const selTotal = state.selectedShapeIds.size + state.selectedPointIds.size;
    const selOpenShapes = state.shapes.filter((s) => !s.closed && !s.locked && s.visible !== false && isShapeSelected(s.id));
    const allOpenShapes = state.shapes.filter((s) => !s.closed && !s.locked && s.visible !== false);
    const dockJoin = document.getElementById("btn-join-shapes");
    const sbJoin = document.getElementById("btn-sidebar-join");
    if (dockJoin) {
      dockJoin.classList.toggle("ready", selOpenShapes.length >= 2 || allOpenShapes.length >= 2);
      dockJoin.textContent = selOpenShapes.length >= 2 ? `Join (${selOpenShapes.length})` : "Join";
    }
    if (sbJoin) {
      sbJoin.textContent = selOpenShapes.length >= 2 ? `Join (${selOpenShapes.length})` : "Join";
    }
    if (!selectionBanner) return;
    if (bannerToastMsg) {
      selectionBanner.classList.remove("hidden");
      if (selBannerText) selBannerText.textContent = bannerToastMsg;
      if (btnSelJoin) btnSelJoin.classList.add("hidden");
      if (btnSelDel) btnSelDel.classList.add("hidden");
      return;
    }
    if (selTotal >= 2) {
      selectionBanner.classList.remove("hidden");
      const movable = getSelectedMovableItems().total;
      if (selBannerText) {
        selBannerText.textContent = movable >= 2
          ? `${selTotal} selected · Drag to move/resize`
          : `${selTotal} selected`;
      }
      if (btnSelJoin) {
        btnSelJoin.classList.toggle("hidden", selOpenShapes.length < 2);
        btnSelJoin.textContent = `Join (${selOpenShapes.length})`;
      }
      if (btnSelDel) btnSelDel.classList.toggle("hidden", movable === 0);
    } else {
      selectionBanner.classList.add("hidden");
    }
  }

  async function flushGroupDrag(drag) {
    if (drag.busy) { drag.dirty = true; return; }
    drag.busy = true;
    try {
      do {
        drag.dirty = false;
        await Promise.all([
          ...drag.shapes.map((item) => computeShape(item.shape, 1.35)),
          drag.points.length > 0 && state.mode === "map" ? recomputePoints() : Promise.resolve(),
        ]);
        updateIntegralPanel();
        requestRender();
      } while (drag.dirty && state.dragGroup === drag);
    } finally {
      drag.busy = false;
    }
  }

  function deleteSelectedItems() {
    const remShapeIds = new Set(
      state.shapes.filter((s) => !s.locked && isShapeSelected(s.id)).map((s) => s.id)
    );
    const remPointIds = new Set(
      state.points.filter((p) => !p.locked && isPointSelected(p.id)).map((p) => p.id)
    );
    const remLine = (remShapeIds.size === 0 && remPointIds.size === 0 && state.selectedLineId !== null)
      ? state.lines.find((x) => x.id === state.selectedLineId && !x.locked)
      : null;
    if (remShapeIds.size === 0 && remPointIds.size === 0 && !remLine) return false;
    pushUndoSnapshot();
    if (remShapeIds.size > 0) state.shapes = state.shapes.filter((s) => !remShapeIds.has(s.id));
    if (remPointIds.size > 0) state.points = state.points.filter((p) => !remPointIds.has(p.id));
    if (remLine) state.lines = state.lines.filter((x) => x.id !== remLine.id);
    clearSelection();
    updateIntegralPanel();
    notifyDomain();
    notifyState(true);
    requestRender();
    return true;
  }

  function hitResizeHandle(sx, sy) {
    if (getSelectedMovableItems().total >= 2) return null;
    const s = state.shapes.find((x) => x.id === state.selectedShapeId);
    if (!s || !s.visible || s.locked) return null;
    for (const h of getResizeHandles(s)) {
      const sp = worldToScreen(state.inView, canvasIn, h.x, h.y);
      if (Math.hypot(sx - sp.x, sy - sp.y) <= HANDLE_HIT_PX) return { shape: s, handle: h };
    }
    return null;
  }

  function hitPoint(sx, sy) {
    const inIs3D = state.inProjection === "sphere" && window.RiemannSphereIn;
    for (let i = state.points.length - 1; i >= 0; i--) {
      const p = state.points[i];
      if (!p.visible) continue;
      const rad = Math.max(10, (p.size || 5) + 6);
      if (inIs3D) {
        const c = window.RiemannSphereIn.projectToCanvas(p.x, p.y, canvasIn);
        if (!c || c.depth < -0.04) continue;
        if (Math.hypot(sx - c.sx, sy - c.sy) <= rad) return p;
      } else {
        const pp = projectInPt(p);
        if (!pp || !Number.isFinite(pp.x) || !Number.isFinite(pp.y)) continue;
        const sp = worldToScreen(state.inView, canvasIn, pp.x, pp.y);
        if (Math.hypot(sx - sp.x, sy - sp.y) <= rad) return p;
      }
    }
    return null;
  }

  function hitGuideLine(sx, sy) {
    if (!state.showLandmarks) return null;
    for (let i = state.lines.length - 1; i >= 0; i--) {
      const ln = state.lines[i];
      if (!ln.visible) continue;
      if (ln.orientation === "horizontal") {
        const ly = worldToScreen(state.inView, canvasIn, 0, ln.value).y;
        if (Math.abs(sy - ly) <= 8) return ln;
      } else {
        const lx = worldToScreen(state.inView, canvasIn, ln.value, 0).x;
        if (Math.abs(sx - lx) <= 8) return ln;
      }
    }
    return null;
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

  /* Exact non-zero winding number (Dan Sunday's algorithm) matching Canvas2D fill("nonzero")!
   * Handles multi-sheeted holomorphic images (e.g. z^2, Julia iterations, Blaschke W=+3)
   * where even-odd ray-casting falsely classifies W=2 interior points as "outside". */
  function polyWindingNumber(wx, wy, pts) {
    let wn = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (!a || !b) continue;
      if (a.y <= wy) {
        if (b.y > wy && (b.x - a.x) * (wy - a.y) - (wx - a.x) * (b.y - a.y) > 0) wn++;
      } else {
        if (b.y <= wy && (b.x - a.x) * (wy - a.y) - (wx - a.x) * (b.y - a.y) < 0) wn--;
      }
    }
    return wn;
  }

  function hitShape(sx, sy) {
    const inIs3D = state.inProjection === "sphere" && window.RiemannSphereIn;
    const isCurved = inIs3D || state.inProjection === "stereographic" || state.inProjection === "poincare" || state.inProjection === "mercator";
    const zExact = isCurved ? screenToInComplexExact(sx, sy) : screenToWorld(state.inView, canvasIn, sx, sy);
    if (isCurved && !zExact) return null;
    for (let i = state.shapes.length - 1; i >= 0; i--) {
      const s = state.shapes[i];
      if (!s.visible) continue;
      if (isCurved && (s.isOcean || /^global ocean\b/i.test(s.label || ""))) continue;
      const rawInPts = (s.kind === "ray" || s.kind === "infline")
        ? expandLinearShapePts(s)
        : (s.boundary && s.boundary.inPts.length >= 2 ? s.boundary.inPts : s.rawPts);
      if (!rawInPts || rawInPts.length < 2) continue;
      if (inIs3D) {
        const segs = s.closed ? rawInPts.length : rawInPts.length - 1;
        for (let k = 0; k < segs; k++) {
          const pa = rawInPts[k], pb = rawInPts[(k + 1) % rawInPts.length];
          if (!pa || !pb) continue;
          const ca = window.RiemannSphereIn.projectToCanvas(pa.x, pa.y, canvasIn);
          const cb = window.RiemannSphereIn.projectToCanvas(pb.x, pb.y, canvasIn);
          if (!ca || !cb || ca.depth < -0.04 || cb.depth < -0.04) continue;
          if (distSegSq(sx, sy, ca.sx, ca.sy, cb.sx, cb.sy) <= 100) return s;
        }
        if (s.closed && s.rawPts.length >= 3 && zExact && ptInPoly(zExact.x, zExact.y, s.rawPts)) return s;
      } else {
        const pts = projectInPts(rawInPts);
        if (!pts || pts.length < 2) continue;
        const segs = s.closed ? pts.length : pts.length - 1;
        for (let k = 0; k < segs; k++) {
          const pa = pts[k], pb = pts[(k + 1) % pts.length];
          if (!pa || !pb) continue;
          const a = worldToScreen(state.inView, canvasIn, pa.x, pa.y);
          const b = worldToScreen(state.inView, canvasIn, pb.x, pb.y);
          if (distSegSq(sx, sy, a.x, a.y, b.x, b.y) <= 144) return s;
        }
        if (s.closed && s.rawPts.length >= 3 && zExact && ptInPoly(zExact.x, zExact.y, s.rawPts)) return s;
      }
    }
    return null;
  }

  function shiftPts(pts, dx, dy) {
    return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }

  async function flushDrag(drag) {
    if (drag.busy) { drag.dirty = true; return; }
    drag.busy = true;
    try {
      do {
        drag.dirty = false;
        const reqDx = drag.curDx, reqDy = drag.curDy;
        const s = drag.shape;
        await computeShape(s, 1.35);
        if (state.dragShape === drag && drag.mode === "move" && s.boundary) {
          const rx = drag.curDx - reqDx, ry = drag.curDy - reqDy;
          if (Math.abs(rx) > 1e-12 || Math.abs(ry) > 1e-12) {
            s.boundary.inPts = shiftPts(s.boundary.inPts, rx, ry);
            if (s.integral) s.integral.inPts = shiftPts(s.integral.inPts, rx, ry);
            for (const m of s.mesh || []) m.inPts = shiftPts(m.inPts, rx, ry);
          }
        }
        updateIntegralPanel();
        if (ws() && typeof ws().syncShapeBadges === "function") ws().syncShapeBadges();
        requestRender();
      } while (drag.dirty && state.dragShape === drag);
    } finally {
      drag.busy = false;
    }
  }

  let ptDragBusy = false, ptDragDirty = false;
  async function flushPointDrag() {
    if (ptDragBusy) { ptDragDirty = true; return; }
    ptDragBusy = true;
    try {
      do {
        ptDragDirty = false;
        await recomputePoints();
      } while (ptDragDirty);
    } finally {
      ptDragBusy = false;
    }
  }

  /* -------------------------------------------------------------------------
   * Rendering
   * ------------------------------------------------------------------------- */

  let renderQueued = false;
  let dirtyIn = true;
  let dirtyOut = true;
  function requestRender(which = "both") {
    if (!state.active) return;
    if (which === "in") dirtyIn = true;
    else if (which === "out") dirtyOut = true;
    else { dirtyIn = true; dirtyOut = true; }
    if (!renderQueued) {
      renderQueued = true;
      requestAnimationFrame(renderFrame);
    }
  }

  function themeCol(col, opts) {
    return (window.CFVTheme && window.CFVTheme.adaptColor) ? window.CFVTheme.adaptColor(col, opts) : (col || "#38bdf8");
  }

  function themeRgba(col, a, opts) {
    return (window.CFVTheme && window.CFVTheme.adaptRgba) ? window.CFVTheme.adaptRgba(col, a, opts) : hexToRgba(col, a);
  }

  function tracePts(ctx, canvas, view, pts, closed) {
    let open = false, validCnt = 0;
    for (const p of pts) {
      if (!p) { open = false; continue; }
      const sp = worldToScreen(view, canvas, p.x, p.y);
      if (!open) { ctx.moveTo(sp.x, sp.y); open = true; }
      else ctx.lineTo(sp.x, sp.y);
      validCnt++;
    }
    if (closed && validCnt >= 3 && pts.every((p) => p !== null)) ctx.closePath();
  }

  function drawArrow(ctx, ax, ay, bx, by, color, sz = 7) {
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (len < 1e-3) return;
    const ux = dx / len, uy = dy / len;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(bx + ux * 2, by + uy * 2);
    ctx.lineTo(bx - ux * sz - uy * sz * 0.55, by - uy * sz + ux * sz * 0.55);
    ctx.lineTo(bx - ux * sz + uy * sz * 0.55, by - uy * sz - ux * sz * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawDirArrow(ctx, canvas, view, pts, color, frac = 0.5) {
    const v = pts.filter((p) => p !== null);
    if (v.length < 4) return;
    const m = Math.max(1, Math.min(v.length - 1, Math.floor(v.length * frac)));
    const a = worldToScreen(view, canvas, v[m - 1].x, v[m - 1].y);
    const b = worldToScreen(view, canvas, v[m].x, v[m].y);
    drawArrow(ctx, a.x, a.y, b.x, b.y, color, 7);
  }

  function drawGrid(ctx, canvas, view, isInput) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const scX = view.scaleX || view.scale, scY = view.scaleY || view.scale;
    const hw = (w * 0.5) / scX, hh = (h * 0.5) / scY;
    const xmin = view.cx - hw, xmax = view.cx + hw, ymin = view.cy - hh, ymax = view.cy + hh;
    const light = isLightTheme();

    /* Specialized coordinate backdrops (Polar, Mercator, Stereographic & Poincaré Disks) on Input OR Output! */
    const activeProj = isInput ? state.inProjection : state.projection;
    if (window.CFVProjections && (activeProj === "polar" || activeProj === "mercator" || activeProj === "stereographic" || activeProj === "poincare")) {
      window.CFVProjections.drawProjectionOverlay(ctx, canvas, view, worldToScreen, activeProj, light);
      if (activeProj === "stereographic" || activeProj === "poincare") {
        const origin = worldToScreen(view, canvas, 0, 0);
        if (origin.x >= -20 && origin.x <= w + 20 && origin.y >= -20 && origin.y <= h + 20) {
          ctx.save();
          ctx.strokeStyle = light ? "rgba(5, 150, 105, 0.52)" : "rgba(52, 211, 153, 0.45)";
          ctx.beginPath(); ctx.arc(origin.x, origin.y, 7, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = light ? "#059669" : "#34d399";
          ctx.beginPath(); ctx.arc(origin.x, origin.y, 2.2, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
      return;
    }

    ctx.fillStyle = light ? "#f5f7fb" : "#0a0e17";
    ctx.fillRect(0, 0, w, h);

    if (isInput && state.showDomain && state.domainImg) {
      const d = state.domainImg;
      const tl = worldToScreen(view, canvas, d.cx - d.halfW, d.cy + d.halfH);
      const br = worldToScreen(view, canvas, d.cx + d.halfW, d.cy - d.halfH);
      ctx.save();
      ctx.globalAlpha = normOpacity(state.domainOpacity, 0.72);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(d.canvas, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.restore();
    }

    const stepX = niceStep(78 / scX);
    const stepY = niceStep(78 / scY);
    ctx.strokeStyle = light ? "rgba(15, 23, 42, 0.09)" : "rgba(148, 163, 184, 0.11)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(xmin / stepX) * stepX; x <= xmax; x += stepX) {
      const sx = Math.round(worldToScreen(view, canvas, x, 0).x) + 0.5;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, h);
    }
    for (let y = Math.floor(ymin / stepY) * stepY; y <= ymax; y += stepY) {
      const sy = Math.round(worldToScreen(view, canvas, 0, y).y) + 0.5;
      ctx.moveTo(0, sy); ctx.lineTo(w, sy);
    }
    ctx.stroke();

    const origin = worldToScreen(view, canvas, 0, 0);
    ctx.strokeStyle = light ? "rgba(15, 23, 42, 0.34)" : "rgba(203, 213, 225, 0.35)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    if (origin.y >= 0 && origin.y <= h) { ctx.moveTo(0, origin.y); ctx.lineTo(w, origin.y); }
    if (origin.x >= 0 && origin.x <= w) { ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, h); }
    ctx.stroke();

    if (!isInput && origin.x >= -20 && origin.x <= w + 20 && origin.y >= -20 && origin.y <= h + 20) {
      ctx.save();
      ctx.strokeStyle = light ? "rgba(5, 150, 105, 0.52)" : "rgba(52, 211, 153, 0.45)";
      ctx.beginPath(); ctx.arc(origin.x, origin.y, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = light ? "#059669" : "#34d399";
      ctx.beginPath(); ctx.arc(origin.x, origin.y, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = light ? "rgba(51, 65, 85, 0.78)" : "rgba(148, 163, 184, 0.65)";
    ctx.font = '10px "JetBrains Mono", monospace';
    const ly = Math.min(h - 14, Math.max(40, origin.y + 14));
    const lx = Math.min(w - 40, Math.max(8, origin.x + 6));
    for (let x = Math.floor(xmin / stepX) * stepX; x <= xmax; x += stepX) {
      if (Math.abs(x) < stepX * 0.25) continue;
      const sx = worldToScreen(view, canvas, x, 0).x;
      if (sx > 24 && sx < w - 24) ctx.fillText(fmtTick(x), sx - 9, ly);
    }
    for (let y = Math.floor(ymin / stepY) * stepY; y <= ymax; y += stepY) {
      if (Math.abs(y) < stepY * 0.25) continue;
      const sy = worldToScreen(view, canvas, 0, y).y;
      if (sy > 42 && sy < h - 20) ctx.fillText(`${fmtTick(y)}i`, lx, sy + 3);
    }
  }

  function drawSingleGuideLineIn(ctx, ln) {
    if (!state.showLandmarks || !ln.visible) return;
    const op = normOpacity(ln.opacity, 1.0);
    if (op <= 0.001) return;
    const w = canvasIn.clientWidth, h = canvasIn.clientHeight;
    const hi = ln.id === state.selectedLineId || ln.id === state.hoveredLineId;
    const lw = normLineWidth(ln.lineWidth, 1.5);
    const col = themeCol(ln.color || "#fbbf24");
    const hiCol = isLightTheme() ? "#0f172a" : "#ffffff";

    ctx.save();
    ctx.globalAlpha = op;
    ctx.font = '600 10.5px "JetBrains Mono", monospace';
    ctx.strokeStyle = hi ? hiCol : themeRgba(col, 0.78);
    ctx.lineWidth = lw + (hi ? 0.8 : 0);
    applyLineStyle(ctx, ln.lineStyle || "dashed");

    if (ln.orientation === "horizontal") {
      const sy = worldToScreen(state.inView, canvasIn, 0, ln.value).y;
      if (sy >= -6 && sy <= h + 6) {
        if (lw > 0 || hi) {
          ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
        }
        if (ln.showLabel !== false && ln.label) {
          ctx.setLineDash([]);
          ctx.fillStyle = col;
          ctx.fillText(ln.label, 12, Math.max(54, sy - 6));
        }
      }
    } else {
      const sx = worldToScreen(state.inView, canvasIn, ln.value, 0).x;
      if (sx >= -6 && sx <= w + 6) {
        if (lw > 0 || hi) {
          ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
        }
        if (ln.showLabel !== false && ln.label) {
          ctx.setLineDash([]);
          ctx.fillStyle = col;
          ctx.fillText(ln.label, sx + 6, 58);
        }
      }
    }
    ctx.restore();
  }

  function drawSinglePointIn(ctx, p) {
    if (!p.visible) return;
    const op = normOpacity(p.opacity, 1.0);
    if (op <= 0.001) return;
    const w = canvasIn.clientWidth, h = canvasIn.clientHeight;
    const pp = projectInPt({ x: p.x, y: p.y });
    if (!pp) return;
    const sp = worldToScreen(state.inView, canvasIn, pp.x, pp.y);
    if (sp.x < -36 || sp.x > w + 36 || sp.y < -36 || sp.y > h + 36) return;
    ctx.save();
    ctx.globalAlpha = op;
    ctx.font = '10.5px "JetBrains Mono", monospace';
    const sel = isPointSelected(p.id) || p.id === state.hoveredPointId;
    const col = themeCol(p.color || "#34d399");
    drawPointIcon(ctx, sp.x, sp.y, p.icon || "dot", col, p.size || 5, sel);
    if (p.showLabel !== false && p.label) {
      ctx.fillStyle = col;
      ctx.fillText(p.label, sp.x + (p.size || 5) + 6, sp.y + 3);
    }
    ctx.restore();
  }

  function drawSinglePointOut(ctx, p) {
    if (state.mode !== "map" || !p.visible || p.locked || !p.outPt) return;
    const op = normOpacity(p.opacity, 1.0);
    if (op <= 0.001) return;
    const projPt = projectOutPt(p.outPt);
    if (!projPt || !Number.isFinite(projPt.x) || !Number.isFinite(projPt.y)) return;
    const w = canvasOut.clientWidth, h = canvasOut.clientHeight;
    const sp = worldToScreen(state.outView, canvasOut, projPt.x, projPt.y);
    if (sp.x < -36 || sp.x > w + 36 || sp.y < -36 || sp.y > h + 36) return;
    ctx.save();
    ctx.globalAlpha = op;
    ctx.font = '10.5px "JetBrains Mono", monospace';
    const sel = isPointSelected(p.id) || p.id === state.hoveredPointId;
    const col = themeCol(p.color || "#34d399");
    drawPointIcon(ctx, sp.x, sp.y, p.icon || "dot", col, p.size || 5, sel);
    if (p.showLabel !== false && p.label) {
      ctx.fillStyle = themeRgba(col, 0.95);
      ctx.fillText(p.label, sp.x + (p.size || 5) + 6, sp.y + 3);
    }
    ctx.restore();
  }

  function drawInputOverlays(ctx) {
    /* Taylor Convergence Disk */
    if (state.taylor.enabled) {
      const t = state.taylor;
      const c = worldToScreen(state.inView, canvasIn, t.x0, t.y0);
      const rp = t.radius * state.inView.scale;
      ctx.save();
      if (rp > 2 && rp < 6000) {
        ctx.fillStyle = "rgba(251,191,36,0.07)";
        ctx.strokeStyle = "rgba(251,191,36,0.65)";
        ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(c.x, c.y, rp, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = "#fbbf24"; ctx.strokeStyle = "#0a0e17"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(c.x, c.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fde047"; ctx.font = '600 10.5px "JetBrains Mono", monospace';
      ctx.fillText(`z₀ (R=${t.radius >= 99 ? "∞" : t.radius.toFixed(2)})`, c.x + 10, c.y - 5);
      ctx.restore();
    }

    /* Found Zeros pins */
    if (state.foundZeros.length > 0) {
      ctx.save();
      ctx.font = '600 10px "JetBrains Mono", monospace';
      state.foundZeros.forEach((z, idx) => {
        const sp = worldToScreen(state.inView, canvasIn, z.x, z.y);
        ctx.strokeStyle = "#fde047"; ctx.fillStyle = "rgba(253,224,71,0.2)"; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 2.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fde047";
        ctx.fillText(`Z${idx + 1}`, sp.x + 9, sp.y - 4);
      });
      ctx.restore();
    }
  }

  function drawShapeIn(ctx, s) {
    if (!s.visible) return;
    const defaultOp = s.closed ? 0.22 : 1.0;
    const op = normOpacity(s.opacity, defaultOp);
    if (op <= 0.001) return;
    const strokeAlpha = s.closed ? (op < 0.22 ? op / 0.22 : 1.0) : op;
    const rawInPts = (s.kind === "ray" || s.kind === "infline")
      ? expandLinearShapePts(s)
      : (s.boundary && s.boundary.inPts.length >= 2 ? s.boundary.inPts : s.rawPts);
    const pts = projectInPts(rawInPts);
    const hi = isShapeSelected(s.id) || s.id === state.hoveredShapeId;
    const lw = normLineWidth(s.lineWidth, 2.2);
    const hiCol = isLightTheme() ? "#0f172a" : "#ffffff";
    const fillCol = themeCol(s.color, { solidFill: s.closed && op >= 0.85 });
    const strokeCol = themeCol(s.color, { solidFill: false });

    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    if (s.closed) {
      ctx.beginPath(); tracePts(ctx, canvasIn, state.inView, pts, true);
      ctx.fillStyle = op >= 0.995 ? fillCol : themeRgba(s.color, op);
      ctx.fill("nonzero");
    }
    if (state.mode === "map" && s.closed && state.showMesh && s.mesh && op < 0.96) {
      ctx.strokeStyle = themeRgba(s.color, 0.24 * strokeAlpha); ctx.lineWidth = 1;
      ctx.beginPath();
      for (const m of s.mesh) tracePts(ctx, canvasIn, state.inView, m.inPts, false);
      ctx.stroke();
    }

    if (lw > 0 || hi) {
      ctx.save();
      ctx.globalAlpha = strokeAlpha;
      applyLineStyle(ctx, s.lineStyle || "solid");
      if (lw > 0 && op < 0.85) {
        ctx.beginPath(); tracePts(ctx, canvasIn, state.inView, pts, s.closed);
        ctx.strokeStyle = themeRgba(s.color, hi ? 0.48 : 0.26); ctx.lineWidth = lw + (hi ? 6 : 4); ctx.stroke();
      }
      ctx.beginPath(); tracePts(ctx, canvasIn, state.inView, pts, s.closed);
      ctx.strokeStyle = hi ? hiCol : strokeCol; ctx.lineWidth = lw > 0 ? (hi ? lw + 0.6 : lw) : 1.4; ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (lw > 0 && op < 0.85) {
      ctx.save();
      ctx.globalAlpha = strokeAlpha;
      if (s.kind === "ray" && s.rawPts && s.rawPts.length >= 2) {
        const aSp = worldToScreen(state.inView, canvasIn, s.rawPts[0].x, s.rawPts[0].y);
        ctx.fillStyle = hi ? hiCol : strokeCol;
        ctx.beginPath(); ctx.arc(aSp.x, aSp.y, 4.2, 0, Math.PI * 2); ctx.fill();
        drawDirArrow(ctx, canvasIn, state.inView, s.rawPts, strokeCol, 0.9);
      } else if (s.kind === "infline" && s.rawPts && s.rawPts.length >= 2) {
        drawDirArrow(ctx, canvasIn, state.inView, s.rawPts, strokeCol, 0.85);
        drawDirArrow(ctx, canvasIn, state.inView, [...s.rawPts].reverse(), strokeCol, 0.85);
      } else {
        drawDirArrow(ctx, canvasIn, state.inView, pts, strokeCol, 0.28);
        if (state.mode === "integral" || s.closed) drawDirArrow(ctx, canvasIn, state.inView, pts, strokeCol, 0.72);
      }
      ctx.restore();
    }

    if (state.playing && pts.length > 1) {
      const p = pts[Math.floor(state.playPhase * (pts.length - 1)) % pts.length];
      if (p) {
        const sp = worldToScreen(state.inView, canvasIn, p.x, p.y);
        const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 13);
        g.addColorStop(0, "#ffffff"); g.addColorStop(0.4, s.color); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sp.x, sp.y, 13, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();

    /* Draw individual resize handles ONLY in editable modes (Planar ℂ / Polar ℂ) for a single selected unlocked shape */
    if (isInputEditable() && s.id === state.selectedShapeId && !s.locked && getSelectedMovableItems().total < 2) {
      ctx.save();
      for (const h of getResizeHandles(s)) {
        const sp = worldToScreen(state.inView, canvasIn, h.x, h.y);
        ctx.fillStyle = "#0a0e17"; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
        ctx.beginPath();
        if (h.shapeKind === "rect" || h.shapeKind === "scale") ctx.rect(sp.x - 4.5, sp.y - 4.5, 9, 9);
        else ctx.arc(sp.x, sp.y, 4.8, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
  }

  let outShadeCanvas = null;

  /* Determine whether a closed domain's interior maps to the EXTERIOR of its output curve
   * (e.g. a loop around a pole like s = 1 on ζ(s), z = 0 on 1/z, or a Möbius face passing
   * over the pole reverses boundary orientation and sends interior points outside toward ∞).
   *
   * Topological invariant:
   *  1. Conformal maps preserve left-hand orientation along the boundary. If inArea * outArea >= 0,
   *     the boundary did NOT turn inside-out (e.g. z^2, Julia folds, Blaschke W=+3, Joukowsky
   *     airfoil |z - μ| = R), so its enclosed interior is ALWAYS shaded normally.
   *  2. Only when boundary orientation reverses (inArea * outArea < 0) do we check mapped interior
   *     mesh points with exact non-zero winding (matching Canvas2D fill("nonzero")) to distinguish
   *     bounded reflections like conj(z) (interior stays inside -> shade interior) from true pole
   *     inversions (interior escapes outside -> shade exterior). */
  function shouldShadeExterior(s, outPts) {
    if (!s || !s.closed || !outPts || outPts.length < 3) return false;
    const inPts = (s.boundary && s.boundary.inPts && s.boundary.inPts.length >= 3) ? s.boundary.inPts : s.rawPts;
    if (!inPts || inPts.length < 3) return false;
    const inArea = signedArea2(inPts);
    const outArea = signedArea2(outPts);
    if (Math.abs(inArea) <= 1e-9 || Math.abs(outArea) <= 1e-9) return false;
    if (inArea * outArea >= 0) return false;

    /* Orientation flipped (inArea * outArea < 0): distinguish pole inversion vs reflection (conj(z)) */
    if (Array.isArray(s.mesh) && s.mesh.length > 0) {
      let inside = 0, outside = 0;
      for (const m of s.mesh) {
        const mp = m && m.outPts;
        if (!mp || mp.length < 3) continue;
        for (let i = 1; i < mp.length - 1; i++) {
          const p = mp[i];
          if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
            outside++;
          } else if (polyWindingNumber(p.x, p.y, outPts) !== 0) {
            inside++;
          } else {
            outside++;
          }
        }
      }
      if (inside + outside >= 4) {
        return outside >= inside;
      }
    }
    return true;
  }

  function drawExteriorShade(ctx, pts, color, alpha) {
    const w = canvasOut.clientWidth, h = canvasOut.clientHeight;
    if (w < 2 || h < 2) return;
    if (!outShadeCanvas) outShadeCanvas = document.createElement("canvas");
    if (outShadeCanvas.width !== canvasOut.width || outShadeCanvas.height !== canvasOut.height) {
      outShadeCanvas.width = canvasOut.width;
      outShadeCanvas.height = canvasOut.height;
    }
    const sctx = outShadeCanvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    sctx.save();
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, outShadeCanvas.width, outShadeCanvas.height);
    sctx.scale(dpr, dpr);
    sctx.globalCompositeOperation = "source-over";
    sctx.fillStyle = hexToRgba(color, alpha);
    sctx.fillRect(0, 0, w, h);
    sctx.globalCompositeOperation = "destination-out";
    sctx.fillStyle = "#000000";
    sctx.beginPath();
    tracePts(sctx, canvasOut, state.outView, pts, true);
    sctx.fill("nonzero");
    sctx.restore();
    ctx.drawImage(outShadeCanvas, 0, 0, w, h);
  }

  function drawShapeMapOut(ctx, s) {
    if (!s.visible || !s.boundary) return;
    const defaultOp = s.closed ? 0.22 : 1.0;
    const op = normOpacity(s.opacity, defaultOp);
    if (op <= 0.001) return;
    const strokeAlpha = s.closed ? (op < 0.22 ? op / 0.22 : 1.0) : op;
    const rawOut = s.boundary.outPts;
    if (!rawOut || rawOut.length < 2) return;
    const pts = projectOutPts(rawOut);
    const rawCol = s.primaryColor || s.color;
    const fillCol = themeCol(rawCol, { solidFill: s.closed && op >= 0.85 });
    const col = themeCol(rawCol, { solidFill: false });
    const hi = isShapeSelected(s.id) || s.id === state.hoveredShapeId;
    const lw = normLineWidth(s.lineWidth, 2.2);
    const hiCol = isLightTheme() ? "#0f172a" : "#ffffff";

    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (s.closed && pts.every((p) => p !== null)) {
      if (state.projection === "planar" && shouldShadeExterior(s, pts)) {
        drawExteriorShade(ctx, pts, col, op);
      } else {
        ctx.beginPath(); tracePts(ctx, canvasOut, state.outView, pts, true);
        ctx.fillStyle = op >= 0.995 ? fillCol : themeRgba(rawCol, op);
        ctx.fill("nonzero");
      }
    }
    if (s.closed && state.showMesh && s.mesh && op < 0.96) {
      ctx.strokeStyle = themeRgba(rawCol, 0.28 * strokeAlpha); ctx.lineWidth = 1;
      ctx.beginPath();
      for (const m of s.mesh) tracePts(ctx, canvasOut, state.outView, projectOutPts(m.outPts), false);
      ctx.stroke();
    }

    if (lw > 0 || hi) {
      ctx.save();
      ctx.globalAlpha = strokeAlpha;
      applyLineStyle(ctx, s.lineStyle || "solid");
      if (lw > 0 && op < 0.85) {
        ctx.beginPath(); tracePts(ctx, canvasOut, state.outView, pts, s.closed);
        ctx.strokeStyle = themeRgba(rawCol, hi ? 0.48 : 0.26); ctx.lineWidth = lw + (hi ? 6 : 4); ctx.stroke();
      }
      ctx.beginPath(); tracePts(ctx, canvasOut, state.outView, pts, s.closed);
      ctx.strokeStyle = hi ? hiCol : col; ctx.lineWidth = lw > 0 ? (hi ? lw + 0.6 : lw) : 1.4; ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    for (const ex of s.extraCurves || []) {
      const exLw = normLineWidth(ex.lineWidth, 2.0);
      if (exLw <= 0) continue;
      ctx.save();
      applyLineStyle(ctx, ex.lineStyle || "solid");
      ctx.beginPath(); tracePts(ctx, canvasOut, state.outView, projectOutPts(ex.curve.outPts), s.closed);
      ctx.strokeStyle = ex.color; ctx.lineWidth = exLw; ctx.stroke();
      ctx.restore();
    }

    if (state.taylor.enabled && state.taylor.coeffs.length >= 2) {
      const tPts = projectOutPts(s.boundary.inPts.map((p) => evalTaylor(p.x, p.y)));
      ctx.save();
      ctx.setLineDash([5, 4]); ctx.strokeStyle = "#fde047"; ctx.lineWidth = 2;
      ctx.beginPath(); tracePts(ctx, canvasOut, state.outView, tPts, s.closed); ctx.stroke();
      ctx.restore();
    }

    if (state.playing && pts.length > 1) {
      const p = pts[Math.floor(state.playPhase * (pts.length - 1)) % pts.length];
      if (p) {
        const sp = worldToScreen(state.outView, canvasOut, p.x, p.y);
        const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 13);
        g.addColorStop(0, "#ffffff"); g.addColorStop(0.4, col); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sp.x, sp.y, 13, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawShapeIntegralOut(ctx, s) {
    if (!s.visible || !s.integral) return;
    const op = normOpacity(s.opacity, 1.0);
    if (op <= 0.001) return;
    const ig = s.integral;
    const rawPts = ig.cumPts;
    if (!rawPts || rawPts.length < 2) return;
    const pts = projectOutPts(rawPts);
    const hi = isShapeSelected(s.id) || s.id === state.hoveredShapeId;
    const lw = normLineWidth(s.lineWidth, 2.0);
    const light = isLightTheme();

    ctx.save();
    ctx.globalAlpha = op;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (lw > 0 || hi) {
      applyLineStyle(ctx, s.lineStyle || "solid");
      ctx.beginPath(); tracePts(ctx, canvasOut, state.outView, pts, false);
      ctx.strokeStyle = hexToRgba(s.color, hi ? 0.98 : 0.78); ctx.lineWidth = lw > 0 ? (hi ? lw + 0.6 : lw) : 1.4; ctx.stroke();
      ctx.setLineDash([]);
      drawDirArrow(ctx, canvasOut, state.outView, pts, s.color, 0.5);
    }

    const origP = projectOutPt({ x: 0, y: 0 }) || { x: 0, y: 0 };
    const endP = projectOutPt(ig.total) || ig.total;
    const oSp = worldToScreen(state.outView, canvasOut, origP.x, origP.y);
    const eSp = worldToScreen(state.outView, canvasOut, endP.x, endP.y);
    if (Math.hypot(eSp.x - oSp.x, eSp.y - oSp.y) > 8) {
      ctx.setLineDash([5, 4]); ctx.strokeStyle = hexToRgba(s.color, 0.72); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(oSp.x, oSp.y); ctx.lineTo(eSp.x, eSp.y); ctx.stroke();
      ctx.setLineDash([]);
      drawArrow(ctx, oSp.x, oSp.y, eSp.x, eSp.y, s.color, 8);
    }

    const dSz = hi ? 7.5 : 6;
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = s.color; ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(eSp.x, eSp.y - dSz); ctx.lineTo(eSp.x + dSz, eSp.y);
    ctx.lineTo(eSp.x, eSp.y + dSz); ctx.lineTo(eSp.x - dSz, eSp.y);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    const tag = fmtCompact(ig.total.x, ig.total.y);
    ctx.font = '600 11px "JetBrains Mono", monospace';
    const tw = ctx.measureText(tag).width;
    ctx.fillStyle = light ? "rgba(255,255,255,0.92)" : "rgba(10,14,23,0.9)"; ctx.strokeStyle = hexToRgba(s.color, 0.6); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(eSp.x + 8, eSp.y - 20, tw + 10, 18, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = light ? "#0f172a" : "#ffffff"; ctx.fillText(tag, eSp.x + 13, eSp.y - 8);

    if (state.playing && pts.length > 1) {
      const p = pts[Math.floor(state.playPhase * (pts.length - 1)) % pts.length];
      if (p) {
        const sp = worldToScreen(state.outView, canvasOut, p.x, p.y);
        const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 14);
        g.addColorStop(0, "#ffffff"); g.addColorStop(0.4, s.color); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sp.x, sp.y, 14, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function renderFrame(ts) {
    renderQueued = false;
    if (!state.active) return;
    const drawInNow = dirtyIn || state.playing;
    const drawOutNow = dirtyOut || state.playing;
    dirtyIn = false;
    dirtyOut = false;
    const okIn = drawInNow && ensureCanvasSize(canvasIn);
    const okOut = drawOutNow && ensureCanvasSize(canvasOut);
    if (!okIn && !okOut) return;
    const dpr = window.devicePixelRatio || 1;
    if (state.playing) {
      if (state.lastFrameTs > 0) state.playPhase = (state.playPhase + Math.min(0.05, (ts - state.lastFrameTs) / 1000) * 0.22) % 1.0;
      state.lastFrameTs = ts;
    } else state.lastFrameTs = 0;

    if (okIn) {
    ctxIn.save();
    ctxIn.scale(dpr, dpr);
    const inIs3D = state.inProjection === "sphere" && window.RiemannSphereIn;
    if (inIs3D) {
      const orderedEls = getOrderedElements();
      const orderedShapes = orderedEls.filter((e) => e.kind === "shape").map((e) => e.item);
      const orderedPoints = orderedEls.filter((e) => e.kind === "point").map((e) => ({ ...e.item, outPt: { x: e.item.x, y: e.item.y } }));
      const cfIn = state.showDomain && state.domainImg && state.domainImg.pixels
        ? {
            pixels: state.domainImg.pixels, tw: state.domainImg.tw, th: state.domainImg.th,
            cx: state.domainImg.cx, cy: state.domainImg.cy, halfW: state.domainImg.halfW, halfH: state.domainImg.halfH,
            opacity: normOpacity(state.domainOpacity, 0.9), mapping: state.outDomainMapping || "stereo",
          }
        : null;
      const isAnimNow = Boolean(ws() && typeof ws().isAnySliderPlaying === "function" && ws().isAnySliderPlaying());
      window.RiemannSphereIn.render(ctxIn, canvasIn, orderedShapes, {
        surface: "sphere",
        mode: state.mode,
        showMesh: state.showMesh,
        getPts: (s) => s.rawPts,
        selectedShapeId: state.selectedShapeId,
        hoveredShapeId: state.hoveredShapeId,
        playPhase: state.playPhase,
        playing: state.playing,
        isAnimating: isAnimNow,
        probe: state.probe && state.probe.active && state.probe.z ? { active: true, w: state.probe.z, color: "#38bdf8" } : null,
        points: orderedPoints,
        colorField: cfIn,
      });
    } else {
      drawGrid(ctxIn, canvasIn, state.inView, true);
      if (state.inProjection === "mercator") {
        for (const s of state.shapes) {
          if (s && s.visible && s.closed && (s.isOcean || /^global ocean\b/i.test(s.label || ""))) {
            const tl = worldToScreen(state.inView, canvasIn, -Math.PI, 2.65);
            const br = worldToScreen(state.inView, canvasIn, Math.PI, -2.65);
            ctxIn.fillStyle = s.color || "#0b4f8c";
            ctxIn.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
            break;
          }
        }
      }
      drawInputOverlays(ctxIn);
      /* Unified Element Layering Order (back -> front) */
      for (const el of getOrderedElements()) {
        if (el.kind === "shape") {
          if (state.inProjection !== "planar" && state.inProjection !== "polar" && (el.item.isOcean || /^global ocean\b/i.test(el.item.label || ""))) continue;
          drawShapeIn(ctxIn, el.item);
        } else if (el.kind === "guide_line") drawSingleGuideLineIn(ctxIn, el.item);
        else if (el.kind === "point") drawSinglePointIn(ctxIn, el.item);
      }
    }

    /* Selection, Resize, Rotate & Drawing Overlays ONLY in Editable Coordinate Modes (Planar ℂ / Polar ℂ) */
    const canEditIn = isInputEditable();
    if (canEditIn) {
    /* Multi-Selection Group Bounding Box & Resize Handles */
    const gBox = getGroupBox();
    if (gBox) {
      const tl = worldToScreen(state.inView, canvasIn, gBox.xmin, gBox.ymax);
      const br = worldToScreen(state.inView, canvasIn, gBox.xmax, gBox.ymin);
      const x0 = Math.min(tl.x, br.x), y0 = Math.min(tl.y, br.y);
      const bw = Math.abs(br.x - tl.x), bh = Math.abs(br.y - tl.y);
      ctxIn.save();
      ctxIn.fillStyle = "rgba(56, 189, 248, 0.06)";
      ctxIn.strokeStyle = "rgba(56, 189, 248, 0.85)";
      ctxIn.lineWidth = 1.4;
      ctxIn.setLineDash([5, 4]);
      ctxIn.fillRect(x0, y0, bw, bh);
      ctxIn.strokeRect(x0, y0, bw, bh);
      ctxIn.setLineDash([]);
      for (const h of getGroupHandles(gBox)) {
        const sp = worldToScreen(state.inView, canvasIn, h.x, h.y);
        ctxIn.fillStyle = "#0a0e17";
        ctxIn.strokeStyle = "#38bdf8";
        ctxIn.lineWidth = 2;
        ctxIn.beginPath();
        ctxIn.rect(sp.x - 4.5, sp.y - 4.5, 9, 9);
        ctxIn.fill();
        ctxIn.stroke();
      }
      ctxIn.restore();
    }

    /* Rotate Handle (Stem + Circular Grip above single shape or multi-selection!) */
    const rotInfo = getSelectionRotateInfo();
    if (rotInfo) {
      ctxIn.save();
      ctxIn.strokeStyle = "rgba(56, 189, 248, 0.85)";
      ctxIn.lineWidth = 1.6;
      ctxIn.beginPath();
      ctxIn.moveTo(rotInfo.stemX, rotInfo.stemY);
      ctxIn.lineTo(rotInfo.handleX, rotInfo.handleY);
      ctxIn.stroke();
      ctxIn.fillStyle = state.dragRotate ? "#38bdf8" : "#0a0e17";
      ctxIn.strokeStyle = "#38bdf8";
      ctxIn.lineWidth = 2;
      ctxIn.beginPath();
      ctxIn.arc(rotInfo.handleX, rotInfo.handleY, 6, 0, Math.PI * 2);
      ctxIn.fill();
      ctxIn.stroke();
      ctxIn.fillStyle = state.dragRotate ? "#061019" : "#38bdf8";
      ctxIn.beginPath();
      ctxIn.arc(rotInfo.handleX, rotInfo.handleY, 2, 0, Math.PI * 2);
      ctxIn.fill();
      if (state.dragRotate) {
        const deg = ((state.dragRotate.curAngle * 180) / Math.PI).toFixed(1);
        const lbl = `${Number(deg) >= 0 ? "+" : ""}${deg}°`;
        ctxIn.font = '600 10.5px "JetBrains Mono", monospace';
        const tw = ctxIn.measureText(lbl).width;
        ctxIn.fillStyle = "rgba(10, 14, 23, 0.92)";
        ctxIn.strokeStyle = "rgba(56, 189, 248, 0.65)";
        ctxIn.lineWidth = 1;
        ctxIn.beginPath();
        ctxIn.roundRect(rotInfo.handleX + 10, rotInfo.handleY - 10, tw + 10, 18, 4);
        ctxIn.fill();
        ctxIn.stroke();
        ctxIn.fillStyle = "#e0f2fe";
        ctxIn.fillText(lbl, rotInfo.handleX + 15, rotInfo.handleY + 2.5);
      }
      ctxIn.restore();
    }

    /* Marquee Drag-Box Selection Rectangle (Rose-red when Alt+Drag box-deselecting!) */
    if (state.marquee) {
      const m = state.marquee;
      const x0 = Math.min(m.x0, m.x1), y0 = Math.min(m.y0, m.y1);
      const mw = Math.abs(m.x1 - m.x0), mh = Math.abs(m.y1 - m.y0);
      ctxIn.save();
      ctxIn.fillStyle = m.subtractive ? "rgba(251, 113, 133, 0.14)" : "rgba(56, 189, 248, 0.14)";
      ctxIn.strokeStyle = m.subtractive ? "#fb7185" : "#38bdf8";
      ctxIn.lineWidth = 1.3;
      ctxIn.setLineDash([4, 3]);
      ctxIn.fillRect(x0, y0, mw, mh);
      ctxIn.strokeRect(x0, y0, mw, mh);
      ctxIn.restore();
    }

    if (state.drawing && state.drawing.rawPts.length >= 2) {
      const d = state.drawing;
      ctxIn.save();
      ctxIn.beginPath(); tracePts(ctxIn, canvasIn, state.inView, d.rawPts, d.closed || d.snapActive);
      ctxIn.strokeStyle = d.color; ctxIn.lineWidth = 2.2; ctxIn.stroke();
      if (d.kind === "freehand" && d.rawPts.length >= 6) {
        const st = worldToScreen(state.inView, canvasIn, d.rawPts[0].x, d.rawPts[0].y);
        ctxIn.strokeStyle = d.snapActive ? "#34d399" : "rgba(255,255,255,0.4)";
        ctxIn.beginPath(); ctxIn.arc(st.x, st.y, d.snapActive ? 11 : 5, 0, Math.PI * 2); ctxIn.stroke();
      }
      ctxIn.restore();
    }
    if (state.polyDraft && state.polyDraft.rawPts.length >= 1) {
      const p = state.polyDraft;
      const pts = p.hoverPt ? [...p.rawPts, p.hoverPt] : p.rawPts;
      ctxIn.save(); ctxIn.setLineDash([5, 4]); ctxIn.strokeStyle = p.color; ctxIn.lineWidth = 2;
      ctxIn.beginPath(); tracePts(ctxIn, canvasIn, state.inView, pts, false); ctxIn.stroke();
      ctxIn.restore();
    }
    if (state.snapHint) {
      const sp = worldToScreen(state.inView, canvasIn, state.snapHint.x, state.snapHint.y);
      ctxIn.save();
      ctxIn.strokeStyle = "#34d399";
      ctxIn.fillStyle = "rgba(52, 211, 153, 0.22)";
      ctxIn.lineWidth = 2;
      ctxIn.beginPath();
      ctxIn.arc(sp.x, sp.y, 9, 0, Math.PI * 2);
      ctxIn.fill();
      ctxIn.stroke();
      ctxIn.restore();
    }
    } /* end canEditIn */
    if (!canEditIn) {
      const wIn = canvasIn.clientWidth || 500;
      const hIn = canvasIn.clientHeight || 400;
      const pill = "Viewing Mode · Switch Input to Planar ℂ or Polar ℂ to edit elements";
      ctxIn.save();
      ctxIn.font = '500 10.5px Inter, system-ui, sans-serif';
      const tw = ctxIn.measureText(pill).width;
      const pw = tw + 18, ph = 22;
      const px = Math.max(10, Math.round((wIn - pw) * 0.5));
      const py = Math.max(46, hIn - ph - 10);
      ctxIn.fillStyle = isLightTheme() ? "rgba(255,255,255,0.88)" : "rgba(10,14,23,0.82)";
      ctxIn.strokeStyle = isLightTheme() ? "rgba(2,132,199,0.35)" : "rgba(56,189,248,0.35)";
      ctxIn.lineWidth = 1;
      ctxIn.beginPath(); ctxIn.roundRect(px, py, pw, ph, 11); ctxIn.fill(); ctxIn.stroke();
      ctxIn.fillStyle = isLightTheme() ? "#0369a1" : "#94a3b8";
      ctxIn.fillText(pill, px + 9, py + 14.5);
      ctxIn.restore();
    }
    if (!inIs3D && state.probe.active && state.probe.z) {
      const pz = projectInPt(state.probe.z);
      if (pz && Number.isFinite(pz.x) && Number.isFinite(pz.y)) {
        const sp = worldToScreen(state.inView, canvasIn, pz.x, pz.y);
        ctxIn.fillStyle = "#fff"; ctxIn.strokeStyle = "#38bdf8"; ctxIn.lineWidth = 2;
        ctxIn.beginPath(); ctxIn.arc(sp.x, sp.y, 4, 0, Math.PI * 2); ctxIn.fill(); ctxIn.stroke();
      }
    }
    if (window.CFVAnnotations && state.texts.length > 0) {
      window.CFVAnnotations.drawTextBoxes(ctxIn, canvasIn, state.texts, {
        plane: "in",
        isLight: isLightTheme(),
        selectedTextId: state.selectedTextId,
        hoveredTextId: state.hoveredTextId,
        worldToScreen: (wx, wy) => worldToScreen(state.inView, canvasIn, wx, wy),
      });
    } else {
      canvasIn._textLayouts = [];
    }
    ctxIn.restore();
    }

    if (okOut) {
    ctxOut.save();
    ctxOut.scale(dpr, dpr);
    if (window.RiemannSphere && (state.projection === "sphere" || state.projection === "cylinder")) {
      const orderedEls = getOrderedElements();
      const orderedShapes = orderedEls.filter((e) => e.kind === "shape").map((e) => e.item);
      const orderedPoints = orderedEls.filter((e) => e.kind === "point").map((e) => e.item);
      const cf = state.showOutDomain && state.domainImg && state.domainImg.pixels
        ? {
            pixels: state.domainImg.pixels,
            tw: state.domainImg.tw,
            th: state.domainImg.th,
            cx: state.domainImg.cx,
            cy: state.domainImg.cy,
            halfW: state.domainImg.halfW,
            halfH: state.domainImg.halfH,
            opacity: normOpacity(state.domainOpacity, 0.9),
            mapping: state.outDomainMapping || "stereo",
          }
        : null;
      const isAnimOut = Boolean(ws() && typeof ws().isAnySliderPlaying === "function" && ws().isAnySliderPlaying());
      window.RiemannSphere.render(ctxOut, canvasOut, orderedShapes, {
        surface: state.projection,
        mode: state.mode,
        showMesh: state.showMesh,
        getPts: (s) => (state.mode === "integral" ? (s.integral ? s.integral.cumPts : null) : s.boundary ? s.boundary.outPts : null),
        selectedShapeId: state.selectedShapeId,
        hoveredShapeId: state.hoveredShapeId,
        playPhase: state.playPhase,
        playing: state.playing,
        isAnimating: isAnimOut,
        probe: state.probe && state.probe.active && state.probe.w ? { active: true, w: state.probe.w, color: "#a78bfa" } : null,
        points: orderedPoints,
        colorField: cf,
      });
    } else {
      drawGrid(ctxOut, canvasOut, state.outView, false);
      const isDiskProj = state.projection === "stereographic" || state.projection === "poincare";
      const isMercProj = state.projection === "mercator";
      let diskOcean = null;
      if (isMercProj) {
        const tl = worldToScreen(state.outView, canvasOut, -Math.PI, 2.65);
        const br = worldToScreen(state.outView, canvasOut, Math.PI, -2.65);
        ctxOut.save();
        ctxOut.beginPath();
        ctxOut.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        ctxOut.clip();
        for (const s of state.shapes) {
          if (s && s.visible && s.closed && (s.isOcean || (s.label && /^global ocean\b/i.test(s.label)))) {
            diskOcean = s;
            const g = ctxOut.createLinearGradient(tl.x, tl.y, tl.x, br.y);
            g.addColorStop(0.0, "#073462");
            g.addColorStop(0.5, "#1169ad");
            g.addColorStop(1.0, "#073462");
            ctxOut.fillStyle = g;
            ctxOut.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
            break;
          }
        }
      }
      if (isDiskProj) {
        const o = worldToScreen(state.outView, canvasOut, 0, 0);
        const rx = (state.outView.scaleX || state.outView.scale) + 1.5;
        const ry = (state.outView.scaleY || state.outView.scale) + 1.5;
        ctxOut.save();
        ctxOut.beginPath();
        ctxOut.ellipse(o.x, o.y, rx, ry, 0, 0, Math.PI * 2);
        ctxOut.clip();
        /* Seamless full-disk Ocean fill (eliminates any rim gap on Stereographic & Poincaré Earth!) */
        for (const s of state.shapes) {
          if (s && s.visible && s.closed && (s.isOcean || (s.label && /^global ocean\b/i.test(s.label)))) {
            diskOcean = s;
            const op = normOpacity(s.opacity, 1.0);
            if (op > 0.001) {
              ctxOut.fillStyle = op >= 0.995 ? s.color : themeRgba(s.color, op);
              ctxOut.beginPath();
              ctxOut.ellipse(o.x, o.y, rx, ry, 0, 0, Math.PI * 2);
              ctxOut.fill();
            }
            break;
          }
        }
        /* Optional C11 Output Color Field mapped seamlessly onto the bounded Stereographic / Poincaré Disk! */
        if (state.showOutDomain && state.domainImg && state.domainImg.pixels) {
          const dom = state.domainImg;
          const sz = Math.max(120, Math.min(260, Math.round(Math.max(rx, ry) * 1.15)));
          const off = state._diskOutCanvas || (state._diskOutCanvas = document.createElement("canvas"));
          if (off.width !== sz || off.height !== sz) {
            off.width = sz; off.height = sz;
            state._diskOutImgData = off.getContext("2d").createImageData(sz, sz);
          }
          const outD = state._diskOutImgData.data;
          const src = dom.pixels, tw = dom.tw, th = dom.th;
          const invHW = 0.5 / Math.max(1e-12, dom.halfW), invHH = 0.5 / Math.max(1e-12, dom.halfH);
          const isMerc = state.outDomainMapping === "mercator";
          const isPoin = state.projection === "poincare";
          const aByte = Math.round(normOpacity(state.domainOpacity, 0.85) * 255);
          const invR = 2.0 / sz;
          let p = 0;
          for (let py = 0; py < sz; py++) {
            const dy = 1.0 - (py + 0.5) * invR;
            for (let px = 0; px < sz; px++) {
              const dx = (px + 0.5) * invR - 1.0;
              const r = Math.hypot(dx, dy);
              if (r >= 0.998) { outD[p + 3] = 0; p += 4; continue; }
              const wMag = isPoin ? (2.0 * r / Math.max(1e-4, 1.0 - r * r)) : Math.tan(r * Math.PI * 0.5);
              const invD = r > 1e-6 ? wMag / r : 0.0;
              const wx = dx * invD, wy = dy * invD;
              let u, v;
              if (isMerc) {
                u = Math.atan2(wx, wy);
                v = Math.log(Math.max(1e-4, Math.min(1e4, wMag)));
              } else {
                u = wx; v = wy;
              }
              const ix = Math.max(0, Math.min(tw - 1, Math.floor(((u - dom.cx) * invHW + 0.5) * tw)));
              const iy = Math.max(0, Math.min(th - 1, Math.floor((0.5 - (v - dom.cy) * invHH) * th)));
              const si = (iy * tw + ix) * 4;
              outD[p] = src[si]; outD[p + 1] = src[si + 1]; outD[p + 2] = src[si + 2];
              outD[p + 3] = Math.round((src[si + 3] * aByte) / 255);
              p += 4;
            }
          }
          off.getContext("2d").putImageData(state._diskOutImgData, 0, 0);
          ctxOut.drawImage(off, o.x - rx, o.y - ry, rx * 2, ry * 2);
        }
      } else if (state.showOutDomain && state.domainImg && state.domainImg.canvas) {
        const d = state.domainImg;
        const tl = worldToScreen(state.outView, canvasOut, d.cx - d.halfW, d.cy + d.halfH);
        const br = worldToScreen(state.outView, canvasOut, d.cx + d.halfW, d.cy - d.halfH);
        ctxOut.save();
        ctxOut.globalAlpha = normOpacity(state.domainOpacity, 0.72);
        ctxOut.drawImage(d.canvas, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        ctxOut.restore();
      }
      const orderedEls = getOrderedElements();
      if (state.mode === "integral") {
        for (const el of orderedEls) {
          if (el.kind === "shape") drawShapeIntegralOut(ctxOut, el.item);
        }
      } else {
        for (const el of orderedEls) {
          if (el.kind === "shape") {
            if (diskOcean && el.item === diskOcean) continue;
            drawShapeMapOut(ctxOut, el.item);
          } else if (el.kind === "point") {
            drawSinglePointOut(ctxOut, el.item);
          }
        }
        if (state.drawing && state.drawing.liveOut && state.drawing.liveOut.length >= 2) {
          ctxOut.save(); ctxOut.strokeStyle = state.drawing.color; ctxOut.lineWidth = 2.1;
          ctxOut.beginPath(); tracePts(ctxOut, canvasOut, state.outView, projectOutPts(state.drawing.liveOut), state.drawing.closed || state.drawing.snapActive);
          ctxOut.stroke(); ctxOut.restore();
        }
      }
      if (isDiskProj || isMercProj) ctxOut.restore();
      if (state.probe.active && state.probe.w) {
        const pw = projectOutPt(state.probe.w);
        if (pw && Number.isFinite(pw.x) && Number.isFinite(pw.y)) {
          const sp = worldToScreen(state.outView, canvasOut, pw.x, pw.y);
          ctxOut.fillStyle = "#fff"; ctxOut.strokeStyle = "#a78bfa"; ctxOut.lineWidth = 2;
          ctxOut.beginPath(); ctxOut.arc(sp.x, sp.y, 4, 0, Math.PI * 2); ctxOut.fill(); ctxOut.stroke();
        }
      }
    }
    if (window.CFVAnnotations && state.texts.length > 0) {
      window.CFVAnnotations.drawTextBoxes(ctxOut, canvasOut, state.texts, {
        plane: "out",
        isLight: isLightTheme(),
        selectedTextId: state.selectedTextId,
        hoveredTextId: state.hoveredTextId,
        bottomLeftOffset: state.contourMode ? 18 : 14,
        worldToScreen: (wx, wy) => worldToScreen(state.outView, canvasOut, wx, wy),
      });
    } else {
      canvasOut._textLayouts = [];
    }
    ctxOut.restore();
    }

    if (state.playing) requestRender();
  }

  /* -------------------------------------------------------------------------
   * Multi-Contour Integral Results Panel (One Row Per Contour, Points Ignored!)
   * ------------------------------------------------------------------------- */

  function fmtExactHint(re, im) {
    if (!Number.isFinite(re) || !Number.isFinite(im)) return "";
    if (Math.hypot(re, im) < 1e-4) return "≈ 0";
    const pi = Math.PI;
    if (Math.abs(re) < 1e-3) {
      const k2pi = im / (2 * pi);
      if (Math.abs(k2pi - Math.round(k2pi)) < 1e-3 && Math.round(k2pi) !== 0) {
        const n = Math.round(k2pi);
        return n === 1 ? "≈ 2πi" : n === -1 ? "≈ −2πi" : `≈ ${2 * n}πi`;
      }
      const kpi = im / pi;
      if (Math.abs(kpi - Math.round(kpi)) < 1e-3 && Math.round(kpi) !== 0) {
        const n = Math.round(kpi);
        return n === 1 ? "≈ πi" : n === -1 ? "≈ −πi" : `≈ ${n}πi`;
      }
    }
    if (Math.abs(im) < 1e-3) {
      const kpi = re / pi;
      if (Math.abs(kpi - Math.round(kpi)) < 1e-3 && Math.round(kpi) !== 0) {
        const n = Math.round(kpi);
        return n === 1 ? "≈ π" : n === -1 ? "≈ −π" : `≈ ${n}π`;
      }
    }
    return "";
  }

  function updateIntegralPanel() {
    if (!integralPanel) return;
    if (state.mode !== "integral") {
      integralPanel.classList.add("hidden");
      return;
    }
    integralPanel.classList.remove("hidden");
    integralRows.innerHTML = "";

    /* Strictly filter shapes/contours only — points & guide lines are NEVER included! */
    const vis = state.shapes.filter((s) => s.visible && s.integral);
    if (vis.length === 0) {
      const empty = document.createElement("div");
      empty.className = "integral-empty-box";
      empty.textContent = "Draw or place a path on the left plane using Tools & Elements to integrate f(z) dz.";
      integralRows.appendChild(empty);
      if (integralSummaryBar) integralSummaryBar.classList.add("hidden");
      if (integralSumRow) integralSumRow.classList.add("hidden");
      if (integralMinSum) integralMinSum.classList.add("hidden");
      return;
    }

    let sumRe = 0, sumIm = 0, validCount = 0;
    let closedSumRe = 0, closedSumIm = 0, closedCount = 0;
    for (const s of vis) {
      const ig = s.integral;
      const row = document.createElement("div");
      row.className = "integral-row-card" + (s.id === state.selectedShapeId ? " selected" : "");

      const top = document.createElement("div");
      top.className = "integral-row-top";

      const dot = document.createElement("span");
      dot.className = "integral-dot";
      dot.style.background = s.color;
      top.appendChild(dot);

      const title = document.createElement("span");
      title.textContent = s.label || "Contour";
      top.appendChild(title);

      const orient = document.createElement("span");
      orient.className = "integral-row-badge" + (s.closed ? (ig.orientation > 0 ? " ccw" : " cw") : "");
      orient.textContent = s.closed ? (ig.orientation > 0 ? "Closed ↺ CCW" : "Closed ↻ CW") : "Open γ";
      top.appendChild(orient);

      const revBtn = document.createElement("button");
      revBtn.className = "integral-row-rev";
      revBtn.textContent = "⇄";
      revBtn.title = "Reverse contour orientation (flips sign of integral)";
      revBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        reverseShape(s.id);
      });
      top.appendChild(revBtn);
      row.appendChild(top);

      const metrics = document.createElement("div");
      metrics.className = "integral-row-metrics";

      const mLeft = document.createElement("div");
      mLeft.className = "integral-row-metric";
      const sym = s.closed ? "∮" : "∫";
      const lblL = document.createElement("span");
      lblL.className = "integral-metric-lbl";
      lblL.textContent = `${sym} f(z) dz`;
      const main = document.createElement("span");
      main.className = "integral-row-main";
      main.textContent = ig.singular ? "Pole on contour" : fmtComplex(ig.total.x, ig.total.y, 4);
      mLeft.appendChild(lblL);
      mLeft.appendChild(main);
      if (!ig.singular) {
        const hint = fmtExactHint(ig.total.x, ig.total.y);
        if (hint) {
          const hEl = document.createElement("span");
          hEl.className = "integral-row-exact";
          hEl.textContent = hint;
          mLeft.appendChild(hEl);
        }
      }
      metrics.appendChild(mLeft);

      const mRight = document.createElement("div");
      mRight.className = "integral-row-metric";
      const lblR = document.createElement("span");
      lblR.className = "integral-metric-lbl";
      const right = document.createElement("span");
      right.className = "integral-row-res";
      if (ig.singular) {
        lblR.textContent = "Status";
        right.style.color = "#fb7185";
        right.textContent = "Singular";
      } else if (s.closed) {
        lblR.textContent = "Residue (÷ 2πi)";
        right.textContent = fmtCompact(ig.div2pii.x, ig.div2pii.y);
      } else {
        lblR.textContent = "Magnitude · Length";
        right.style.color = "var(--text-secondary)";
        right.textContent = `|I|=${Math.hypot(ig.total.x, ig.total.y).toFixed(3)} · L=${ig.arcLength.toFixed(2)}`;
      }
      mRight.appendChild(lblR);
      mRight.appendChild(right);
      metrics.appendChild(mRight);

      row.appendChild(metrics);

      row.addEventListener("click", () => {
        state.selectedShapeId = state.selectedShapeId === s.id ? null : s.id;
        state.selectedPointId = null;
        updateIntegralPanel();
        notifyDomain();
        requestRender();
      });

      integralRows.appendChild(row);
      if (!ig.singular) {
        sumRe += ig.total.x;
        sumIm += ig.total.y;
        validCount++;
        if (s.closed) {
          closedSumRe += ig.div2pii.x;
          closedSumIm += ig.div2pii.y;
          closedCount++;
        }
      }
    }

    if (integralSummaryBar) {
      if (validCount > 0) {
        integralSummaryBar.classList.remove("hidden");
        if (integralSumLabel) integralSumLabel.textContent = vis.length > 1 ? `Total Σ (${vis.length} contours)` : (vis[0].closed ? "∮ f(z) dz" : "∫ f(z) dz");
        const hint = fmtExactHint(sumRe, sumIm);
        if (integralSumVal) integralSumVal.textContent = fmtComplex(sumRe, sumIm, 4) + (hint ? ` (${hint})` : "");
        if (integralResCell && integralSumRes) {
          if (closedCount > 0) {
            integralResCell.classList.remove("hidden");
            integralSumRes.textContent = fmtCompact(closedSumRe, closedSumIm);
          } else {
            const divRe = sumIm / (2 * Math.PI), divIm = -sumRe / (2 * Math.PI);
            integralResCell.classList.remove("hidden");
            integralSumRes.textContent = fmtCompact(divRe, divIm);
          }
        }
      } else {
        integralSummaryBar.classList.add("hidden");
      }
    }
    if (integralSumRow) integralSumRow.classList.add("hidden");
    if (integralMinSum) {
      if (validCount > 0) {
        integralMinSum.textContent = vis.length > 1 ? `Σ = ${fmtCompact(sumRe, sumIm)}` : `∫ = ${fmtCompact(sumRe, sumIm)}`;
        integralMinSum.classList.toggle("hidden", !state.integralMinimized);
      } else {
        integralMinSum.classList.add("hidden");
      }
    }
  }

  /* Draggable, Resizable & Minimizable Contour Integrals Panel */
  let savedIntegralSize = null;
  if (btnMinIntegral && integralPanel) {
    btnMinIntegral.addEventListener("click", (ev) => {
      ev.stopPropagation();
      state.integralMinimized = !state.integralMinimized;
      if (state.integralMinimized) {
        savedIntegralSize = { w: integralPanel.style.width, h: integralPanel.style.height, mh: integralPanel.style.maxHeight };
        integralPanel.style.width = "";
        integralPanel.style.height = "";
      } else if (savedIntegralSize) {
        integralPanel.style.width = savedIntegralSize.w || "";
        integralPanel.style.height = savedIntegralSize.h || "";
        integralPanel.style.maxHeight = savedIntegralSize.mh || "";
      }
      integralPanel.classList.toggle("minimized", state.integralMinimized);
      btnMinIntegral.textContent = state.integralMinimized ? "+" : "−";
      if (integralMinSum) {
        const hasVal = integralMinSum.textContent && integralMinSum.textContent.trim().length > 0;
        integralMinSum.classList.toggle("hidden", !state.integralMinimized || !hasVal);
      }
    });
  }
  if (integralResizeHandle && integralPanel) {
    let ipRes = null;
    integralResizeHandle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const cardRect = outCard.getBoundingClientRect();
      const panelRect = integralPanel.getBoundingClientRect();
      const startLeft = panelRect.left - cardRect.left;
      const startTop = panelRect.top - cardRect.top;
      integralPanel.style.left = `${startLeft}px`;
      integralPanel.style.top = `${startTop}px`;
      integralPanel.style.bottom = "auto";
      integralPanel.style.right = "auto";
      ipRes = { startX: e.clientX, startY: e.clientY, startW: panelRect.width, startH: panelRect.height, startLeft, startTop };
      integralPanel.classList.add("dragging");
      if (integralResizeHandle.setPointerCapture) integralResizeHandle.setPointerCapture(e.pointerId);
    });
    integralResizeHandle.addEventListener("pointermove", (e) => {
      if (!ipRes) return;
      const maxW = Math.max(240, outCard.clientWidth - ipRes.startLeft - 8);
      const maxH = Math.max(110, outCard.clientHeight - ipRes.startTop - 8);
      const nw = Math.max(240, Math.min(maxW, ipRes.startW + (e.clientX - ipRes.startX)));
      const nh = Math.max(100, Math.min(maxH, ipRes.startH + (e.clientY - ipRes.startY)));
      integralPanel.style.width = `${Math.round(nw)}px`;
      integralPanel.style.height = `${Math.round(nh)}px`;
      integralPanel.style.maxHeight = "none";
    });
    const endIpRes = () => {
      if (!ipRes) return;
      ipRes = null;
      integralPanel.classList.remove("dragging");
    };
    integralResizeHandle.addEventListener("pointerup", endIpRes);
    integralResizeHandle.addEventListener("pointercancel", endIpRes);
  }
  if (integralPanelHdr && integralPanel) {
    let ipDrag = null;
    integralPanelHdr.addEventListener("pointerdown", (e) => {
      if (e.target && e.target.closest && e.target.closest("button")) return;
      e.preventDefault();
      e.stopPropagation();
      const cardRect = outCard.getBoundingClientRect();
      const panelRect = integralPanel.getBoundingClientRect();
      const startLeft = panelRect.left - cardRect.left;
      const startTop = panelRect.top - cardRect.top;
      integralPanel.style.left = `${startLeft}px`;
      integralPanel.style.top = `${startTop}px`;
      integralPanel.style.bottom = "auto";
      integralPanel.style.right = "auto";
      ipDrag = { startX: e.clientX, startY: e.clientY, startLeft, startTop };
      integralPanel.classList.add("dragging");
      if (integralPanelHdr.setPointerCapture) integralPanelHdr.setPointerCapture(e.pointerId);
    });
    integralPanelHdr.addEventListener("pointermove", (e) => {
      if (!ipDrag) return;
      const maxL = Math.max(8, outCard.clientWidth - integralPanel.offsetWidth - 8);
      const maxT = Math.max(46, outCard.clientHeight - integralPanel.offsetHeight - 8);
      const nl = Math.max(8, Math.min(maxL, ipDrag.startLeft + (e.clientX - ipDrag.startX)));
      const nt = Math.max(46, Math.min(maxT, ipDrag.startTop + (e.clientY - ipDrag.startY)));
      integralPanel.style.left = `${nl}px`;
      integralPanel.style.top = `${nt}px`;
    });
    const endIpDrag = () => {
      if (!ipDrag) return;
      ipDrag = null;
      integralPanel.classList.remove("dragging");
    };
    integralPanelHdr.addEventListener("pointerup", endIpDrag);
    integralPanelHdr.addEventListener("pointercancel", endIpDrag);
  }

  async function updateProbe(z) {
    state.probe.active = true;
    state.probe.z = z;
    readoutIn.textContent = fmtComplex(z.x, z.y, 4);
    if (visibleComplexTargets().length === 0) {
      state.probe.w = null;
      readoutOut.textContent = "—";
      requestRender();
      return;
    }
    requestRender();
    if (state.probe.pending) { state.probe.queuedZ = z; return; }
    state.probe.pending = true;
    try {
      let cur = z;
      while (cur) {
        state.probe.queuedZ = null;
        const out = await apiEval([cur]);
        if (out && out.length === 1) {
          state.probe.w = out[0];
          readoutOut.textContent = out[0] ? fmtComplex(out[0].x, out[0].y, 4) : "∞ (pole)";
          requestRender();
        }
        cur = state.probe.queuedZ;
      }
    } finally {
      state.probe.pending = false;
    }
  }

  let liveBusy = false, liveQueued = false;
  async function refreshLiveDraft() {
    if (liveBusy) { liveQueued = true; return; }
    liveBusy = true;
    try {
      do {
        liveQueued = false;
        const d = state.drawing;
        if (d && d.rawPts.length >= 2 && state.mode === "map") {
          const targets = visibleComplexTargets();
          if (targets.length === 0) {
            if (d.liveOut.length > 0) {
              d.liveOut = [];
              requestRender();
            }
            continue;
          }
          const closed = Boolean(d.closed || d.snapActive);
          const traced = await apiTrace(d.rawPts, closed, false, targets[0].target, 1.35);
          if (traced && traced.boundary && state.drawing === d) {
            d.liveOut = unpackCurve(traced.boundary).outPts;
            requestRender();
          }
        }
      } while (liveQueued);
    } finally { liveBusy = false; }
  }

  /* -------------------------------------------------------------------------
   * Pointer & Control Wiring
   * ------------------------------------------------------------------------- */

  function localPos(c, e) { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  canvasIn.addEventListener("contextmenu", (e) => e.preventDefault());
  canvasOut.addEventListener("contextmenu", (e) => e.preventDefault());

  /* Layer-aware hit-testing for right-click context menu (topmost visible element first) */
  function hitElementIn(sx, sy) {
    const inIs3D = state.inProjection === "sphere" && window.RiemannSphereIn;
    const isCurved = inIs3D || state.inProjection === "stereographic" || state.inProjection === "poincare" || state.inProjection === "mercator";
    const zExact = isCurved ? screenToInComplexExact(sx, sy) : screenToWorld(state.inView, canvasIn, sx, sy);
    if (isCurved && !zExact) return null;
    const els = getOrderedElements();
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (!el.item || !el.item.visible) continue;
      if (el.kind === "point") {
        const rad = Math.max(10, (el.item.size || 5) + 6);
        if (inIs3D) {
          const c = window.RiemannSphereIn.projectToCanvas(el.item.x, el.item.y, canvasIn);
          if (c && c.depth >= -0.04 && Math.hypot(sx - c.sx, sy - c.sy) <= rad) return el;
        } else {
          const pp = projectInPt(el.item);
          if (!pp) continue;
          const sp = worldToScreen(state.inView, canvasIn, pp.x, pp.y);
          if (Math.hypot(sx - sp.x, sy - sp.y) <= rad) return el;
        }
      } else if (el.kind === "guide_line") {
        if (!state.showLandmarks || isCurved) continue;
        if (el.item.orientation === "horizontal") {
          if (Math.abs(sy - worldToScreen(state.inView, canvasIn, 0, el.item.value).y) <= 8) return el;
        } else {
          if (Math.abs(sx - worldToScreen(state.inView, canvasIn, el.item.value, 0).x) <= 8) return el;
        }
      } else if (el.kind === "shape") {
        const s = el.item;
        if (isCurved && (s.isOcean || /^global ocean\b/i.test(s.label || ""))) continue;
        const rawInPts = (s.kind === "ray" || s.kind === "infline")
          ? expandLinearShapePts(s)
          : (s.boundary && s.boundary.inPts.length >= 2 ? s.boundary.inPts : s.rawPts);
        if (!rawInPts || rawInPts.length < 2) continue;
        let hit = false;
        if (inIs3D) {
          const segs = s.closed ? rawInPts.length : rawInPts.length - 1;
          for (let k = 0; k < segs; k++) {
            const pa = rawInPts[k], pb = rawInPts[(k + 1) % rawInPts.length];
            if (!pa || !pb) continue;
            const ca = window.RiemannSphereIn.projectToCanvas(pa.x, pa.y, canvasIn);
            const cb = window.RiemannSphereIn.projectToCanvas(pb.x, pb.y, canvasIn);
            if (!ca || !cb || ca.depth < -0.04 || cb.depth < -0.04) continue;
            if (distSegSq(sx, sy, ca.sx, ca.sy, cb.sx, cb.sy) <= 100) { hit = true; break; }
          }
          if (!hit && s.closed && s.rawPts.length >= 3 && zExact && ptInPoly(zExact.x, zExact.y, s.rawPts)) hit = true;
        } else {
          const pts = projectInPts(rawInPts);
          if (!pts || pts.length < 2) continue;
          const segs = s.closed ? pts.length : pts.length - 1;
          for (let k = 0; k < segs; k++) {
            const a = pts[k], b = pts[(k + 1) % pts.length];
            if (!a || !b) continue;
            const sa = worldToScreen(state.inView, canvasIn, a.x, a.y);
            const sb = worldToScreen(state.inView, canvasIn, b.x, b.y);
            if (distSegSq(sx, sy, sa.x, sa.y, sb.x, sb.y) <= 100) { hit = true; break; }
          }
          if (!hit && s.closed && s.rawPts.length >= 3 && zExact && ptInPoly(zExact.x, zExact.y, s.rawPts)) hit = true;
        }
        if (hit) return el;
      }
    }
    return null;
  }

  function hitElementOut(sx, sy) {
    const outIs3D = state.projection === "sphere" && window.RiemannSphere;
    const isCurved = outIs3D || state.projection === "stereographic" || state.projection === "poincare" || state.projection === "mercator";
    const wExact = isCurved ? screenToOutComplexExact(sx, sy) : screenToWorld(state.outView, canvasOut, sx, sy);
    if (isCurved && !wExact) return null;
    const els = getOrderedElements();
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (!el.item || !el.item.visible) continue;
      if (el.kind === "point") {
        if (state.mode !== "map" || el.item.locked || !el.item.outPt) continue;
        const rad = Math.max(10, (el.item.size || 5) + 6);
        if (outIs3D) {
          const c = window.RiemannSphere.projectToCanvas(el.item.outPt.x, el.item.outPt.y, canvasOut);
          if (c && c.depth >= -0.04 && Math.hypot(sx - c.sx, sy - c.sy) <= rad) return el;
        } else {
          const pp = projectOutPt(el.item.outPt);
          if (!pp || !Number.isFinite(pp.x) || !Number.isFinite(pp.y)) continue;
          const sp = worldToScreen(state.outView, canvasOut, pp.x, pp.y);
          if (Math.hypot(sx - sp.x, sy - sp.y) <= rad) return el;
        }
      } else if (el.kind === "shape") {
        const s = el.item;
        if (isCurved && (s.isOcean || /^global ocean\b/i.test(s.label || ""))) continue;
        const rawPts = state.mode === "integral" ? (s.integral ? s.integral.cumPts : null) : (s.boundary ? s.boundary.outPts : null);
        if (!rawPts || rawPts.length < 2) continue;
        const closed = state.mode === "map" && Boolean(s.closed);
        let hit = false;
        if (outIs3D) {
          const segs = closed ? rawPts.length : rawPts.length - 1;
          for (let k = 0; k < segs; k++) {
            const pa = rawPts[k], pb = rawPts[(k + 1) % rawPts.length];
            if (!pa || !pb) continue;
            const ca = window.RiemannSphere.projectToCanvas(pa.x, pa.y, canvasOut);
            const cb = window.RiemannSphere.projectToCanvas(pb.x, pb.y, canvasOut);
            if (!ca || !cb || ca.depth < -0.04 || cb.depth < -0.04) continue;
            if (distSegSq(sx, sy, ca.sx, ca.sy, cb.sx, cb.sy) <= 100) { hit = true; break; }
          }
          if (!hit && closed && rawPts.length >= 3 && wExact && rawPts.every((p) => p !== null) && polyWindingNumber(wExact.x, wExact.y, rawPts) !== 0) hit = true;
        } else {
          const pts = projectOutPts(rawPts);
          if (!pts || pts.length < 2) continue;
          const segs = closed ? pts.length : pts.length - 1;
          for (let k = 0; k < segs; k++) {
            const a = pts[k], b = pts[(k + 1) % pts.length];
            if (!a || !b) continue;
            const sa = worldToScreen(state.outView, canvasOut, a.x, a.y);
            const sb = worldToScreen(state.outView, canvasOut, b.x, b.y);
            if (distSegSq(sx, sy, sa.x, sa.y, sb.x, sb.y) <= 100) { hit = true; break; }
          }
          if (!hit && closed && rawPts.length >= 3 && wExact && rawPts.every((p) => p !== null) && polyWindingNumber(wExact.x, wExact.y, rawPts) !== 0) hit = true;
        }
        if (hit) return el;
      }
    }
    return null;
  }

  canvasIn.addEventListener("pointerdown", (e) => {
    canvasIn.setPointerCapture(e.pointerId);
    const pos = localPos(canvasIn, e);
    /* Hit-test text boxes on the Input plane so users can drag or resize any text box directly! */
    if (e.button === 0 && !state.spaceHeld && window.CFVAnnotations && state.texts.length > 0) {
      const tbHit = window.CFVAnnotations.hitTestTextBoxes(ctxIn, canvasIn, state.texts, pos.x, pos.y, { plane: "in" });
      if (tbHit) {
        selectTextBox(tbHit.tb.id);
        if (!tbHit.tb.locked) {
          pushUndoSnapshot();
          state.dragText = {
            plane: "in",
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
          canvasIn.style.cursor = tbHit.hit === "resize" ? "nwse-resize" : "grabbing";
        }
        requestRender("in");
        return;
      }
    }
    if (state.inProjection === "sphere" && window.RiemannSphereIn) {
      window.RiemannSphereIn.onPointerDown(pos.x, pos.y);
      inCard.classList.add("panning");
      return;
    }
    /* In Viewing-Only projections (Mercator, Stereographic, Poincaré), left-drag pans smoothly! */
    if (e.button === 1 || e.button === 2 || state.spaceHeld || state.tool === "pan" || !isInputEditable()) {
      state.pan = {
        which: "in",
        startX: pos.x,
        startY: pos.y,
        origCx: state.inView.cx,
        origCy: state.inView.cy,
        rightClick: e.button === 2,
        clientX: e.clientX,
        clientY: e.clientY,
      };
      inCard.classList.add("panning");
      return;
    }
    const z = screenToWorld(state.inView, canvasIn, pos.x, pos.y);

    if (state.taylor.enabled) {
      const cSp = worldToScreen(state.inView, canvasIn, state.taylor.x0, state.taylor.y0);
      if (Math.hypot(pos.x - cSp.x, pos.y - cSp.y) <= 13) { state.taylor.draggingZ0 = true; return; }
    }

    if (state.tool === "move" || e.altKey) {
      const multiMod = Boolean(e.ctrlKey || e.metaKey || e.shiftKey);

      /* 0. Rotate Handle on single unlocked shape or multi-selection */
      const rotHit = !multiMod ? hitRotateHandle(pos.x, pos.y) : null;
      if (rotHit) {
        pushUndoSnapshot();
        state.dragRotate = {
          cx: rotHit.cx,
          cy: rotHit.cy,
          startAngle: Math.atan2(z.y - rotHit.cy, z.x - rotHit.cx),
          curAngle: 0,
          shapes: rotHit.items.shapes.map((s) => ({ shape: s, origRawPts: s.rawPts.map((p) => ({ ...p })) })),
          points: rotHit.items.points.map((p) => ({ point: p, origX: p.x, origY: p.y })),
          busy: false,
          dirty: false,
        };
        canvasIn.style.cursor = "grabbing";
        inCard.classList.add("dragging-shape");
        return;
      }

      /* 1. Multi-selection Group Resize Handles */
      const ghHit = !multiMod ? hitGroupHandle(pos.x, pos.y) : null;
      if (ghHit) {
        pushUndoSnapshot();
        const items = getSelectedMovableItems();
        state.dragGroup = {
          mode: "resize",
          handle: ghHit.handle,
          startWorld: z,
          origBox: { ...ghHit.box },
          shapes: items.shapes.map((s) => ({ shape: s, origRawPts: s.rawPts.map((p) => ({ ...p })) })),
          points: items.points.map((p) => ({ point: p, origX: p.x, origY: p.y })),
          moved: false,
          narrowTo: null,
          busy: false,
          dirty: false,
        };
        canvasIn.style.cursor = ghHit.handle.cursor;
        inCard.classList.add("dragging-shape");
        return;
      }

      /* 2. Single-shape Resize Handles */
      const hHit = !multiMod ? hitResizeHandle(pos.x, pos.y) : null;
      if (hHit) {
        pushUndoSnapshot();
        state.dragShape = {
          mode: "resize", shape: hHit.shape, handle: hHit.handle, startWorld: z,
          origRawPts: hHit.shape.rawPts.map((p) => ({ ...p })), origBox: bboxOf(hHit.shape.rawPts),
          origCcw: signedArea2(hHit.shape.rawPts) >= 0, curDx: 0, curDy: 0, busy: false, dirty: false,
        };
        canvasIn.style.cursor = hHit.handle.cursor;
        return;
      }

      /* 3. Landmark Point Hit (don't let a locked landmark inside a multi-select box steal a group drag!) */
      const pHit = hitPoint(pos.x, pos.y);
      if (pHit && !(pHit.locked && !multiMod && hitGroupBox(pos.x, pos.y))) {
        if (multiMod) {
          selectPoint(pHit.id, { toggle: true });
          return;
        }
        if (isPointSelected(pHit.id) && getSelectedMovableItems().total >= 2 && !pHit.locked) {
          pushUndoSnapshot();
          const items = getSelectedMovableItems();
          state.dragGroup = {
            mode: "move", handle: null, startWorld: z, origBox: getGroupBox(),
            shapes: items.shapes.map((s) => ({ shape: s, origRawPts: s.rawPts.map((p) => ({ ...p })) })),
            points: items.points.map((p) => ({ point: p, origX: p.x, origY: p.y })),
            moved: false, narrowTo: { kind: "point", id: pHit.id }, busy: false, dirty: false,
          };
          inCard.classList.add("dragging-shape");
          return;
        }
        clearSelection();
        state.selectedPointIds.add(pHit.id);
        syncPrimarySelection();
        if (!pHit.locked) {
          pushUndoSnapshot();
          state.dragPoint = { point: pHit };
          inCard.classList.add("dragging-shape");
        }
        updateIntegralPanel();
        notifyDomain();
        requestRender();
        return;
      }

      /* 4. Shape Hit */
      const hit = hitShape(pos.x, pos.y);
      if (hit) {
        if (multiMod) {
          selectShape(hit.id, { toggle: true });
          return;
        }
        if (isShapeSelected(hit.id) && getSelectedMovableItems().total >= 2 && !hit.locked) {
          pushUndoSnapshot();
          const items = getSelectedMovableItems();
          state.dragGroup = {
            mode: "move", handle: null, startWorld: z, origBox: getGroupBox(),
            shapes: items.shapes.map((s) => ({ shape: s, origRawPts: s.rawPts.map((p) => ({ ...p })) })),
            points: items.points.map((p) => ({ point: p, origX: p.x, origY: p.y })),
            moved: false, narrowTo: { kind: "shape", id: hit.id }, busy: false, dirty: false,
          };
          inCard.classList.add("dragging-shape");
          return;
        }
        clearSelection();
        state.selectedShapeIds.add(hit.id);
        syncPrimarySelection();
        updateIntegralPanel();
        notifyDomain();
        if (!hit.locked) {
          pushUndoSnapshot();
          state.dragShape = {
            mode: "move", shape: hit, startWorld: z, origRawPts: hit.rawPts.map((p) => ({ ...p })),
            curDx: 0, curDy: 0, busy: false, dirty: false,
          };
          inCard.classList.add("dragging-shape");
        }
        requestRender();
        return;
      }

      /* 5. Drag inside existing multi-selection Group Bounding Box moves the whole group! */
      if (!multiMod && hitGroupBox(pos.x, pos.y)) {
        const items = getSelectedMovableItems();
        if (items.total >= 2) {
          pushUndoSnapshot();
          state.dragGroup = {
            mode: "move", handle: null, startWorld: z, origBox: getGroupBox(),
            shapes: items.shapes.map((s) => ({ shape: s, origRawPts: s.rawPts.map((p) => ({ ...p })) })),
            points: items.points.map((p) => ({ point: p, origX: p.x, origY: p.y })),
            moved: false, narrowTo: null, busy: false, dirty: false,
          };
          inCard.classList.add("dragging-shape");
          return;
        }
      }

      /* 6. Landmark Line Hit */
      const lHit = hitGuideLine(pos.x, pos.y);
      if (lHit) {
        clearSelection();
        state.selectedLineId = lHit.id;
        if (!lHit.locked) {
          pushUndoSnapshot();
          state.dragLine = { line: lHit };
          inCard.classList.add("dragging-shape");
        }
        updateIntegralPanel();
        notifyDomain();
        requestRender();
        return;
      }

      /* 7. Empty Canvas in Move Mode -> Start Marquee Drag-Box Selection (Alt+Drag = Box Deselect!) */
      const subtractive = Boolean(state.tool === "move" && e.altKey && !multiMod);
      state.marquee = {
        x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y,
        additive: multiMod,
        subtractive,
        prevShapes: new Set(state.selectedShapeIds),
        prevPoints: new Set(state.selectedPointIds),
      };
      if (!multiMod && !subtractive) clearSelection();
      updateIntegralPanel();
      notifyDomain();
      requestRender();
      return;
    }

    const col = PALETTE[state.colorIdx % PALETTE.length];

    /* Unified click-to-place tools: Point & Text drop directly where you click! */
    if (state.tool === "point") {
      addPoint({ x: Number(z.x.toFixed(4)), y: Number(z.y.toFixed(4)), label: `z${state.points.length + 1}`, color: col });
      return;
    }
    if (state.tool === "text") {
      const cw = canvasIn.clientWidth || 600, ch = canvasIn.clientHeight || 400;
      addTextBox({
        title: "Note",
        text: "Click to edit in sidebar, or drag & resize directly on the graph.",
        anchor: "free",
        plane: "in",
        nx: Number(Math.max(0.02, Math.min(0.82, pos.x / cw)).toFixed(4)),
        ny: Number(Math.max(0.06, Math.min(0.84, pos.y / ch)).toFixed(4)),
        x: Number(z.x.toFixed(3)),
        y: Number(z.y.toFixed(3)),
        color: col,
      });
      return;
    }

    const snapStart = (state.tool === "line" || state.tool === "seg" || state.tool === "ray" || state.tool === "infline" || state.tool === "freehand" || state.tool === "polygon")
      ? findSnapTarget(pos.x, pos.y)
      : null;
    const zStart = snapStart ? { x: snapStart.x, y: snapStart.y } : z;
    state.snapHint = snapStart;

    if (state.tool === "polygon") {
      if (!state.polyDraft) {
        state.polyDraft = { rawPts: [zStart], color: col, hoverPt: zStart };
      } else {
        const fsp = worldToScreen(state.inView, canvasIn, state.polyDraft.rawPts[0].x, state.polyDraft.rawPts[0].y);
        if (state.polyDraft.rawPts.length >= 3 && Math.hypot(pos.x - fsp.x, pos.y - fsp.y) <= SNAP_PX) {
          finishPoly(); return;
        }
        state.polyDraft.rawPts.push(zStart);
      }
      requestRender();
      return;
    }

    state.drawing = {
      kind: state.tool,
      rawPts: state.tool === "circle" ? makeCircle(z.x, z.y, 1e-4) : state.tool === "rect" ? makeRect(z.x, z.y, z.x, z.y) : [zStart, zStart],
      liveOut: [], closed: state.tool === "circle" || state.tool === "rect",
      color: col, snapActive: false, anchor: zStart, startPx: { x: pos.x, y: pos.y },
    };
    if (state.tool === "freehand") state.drawing.rawPts = [zStart];
    requestRender();
  });

  canvasIn.addEventListener("pointermove", (e) => {
    const pos = localPos(canvasIn, e);
    if (state.dragText && state.dragText.plane === "in") {
      const dt = state.dragText;
      const dx = pos.x - dt.startX;
      const dy = pos.y - dt.startY;
      if (Math.hypot(dx, dy) >= 2) dt.moved = true;
      const cw = canvasIn.clientWidth || 600, ch = canvasIn.clientHeight || 400;
      if (dt.mode === "resize") {
        dt.tb.width = Math.round(Math.max(150, Math.min(cw - 24, dt.origW + dx)));
        dt.tb.height = Math.round(Math.max(44, Math.min(ch - 24, dt.origH + dy)));
      } else if (dt.tb.anchor === "world") {
        const scX = state.inView.scaleX || state.inView.scale;
        const scY = state.inView.scaleY || state.inView.scale;
        dt.tb.x = Number((dt.origWorldX + dx / scX).toFixed(4));
        dt.tb.y = Number((dt.origWorldY - dy / scY).toFixed(4));
        dt.tb.xExpr = "";
        dt.tb.yExpr = "";
      } else {
        dt.tb.anchor = "free";
        dt.tb.nx = Number(Math.max(0.01, Math.min(0.95, (dt.origBx + dx) / cw)).toFixed(4));
        dt.tb.ny = Number(Math.max(0.01, Math.min(0.95, (dt.origBy + dy) / ch)).toFixed(4));
      }
      requestRender("in");
      return;
    }
    if (!state.pan && !state.drawing && !state.dragShape && !state.dragPoint && !state.dragLine && !state.dragGroup && !state.dragRotate && window.CFVAnnotations && state.texts.length > 0) {
      const th = window.CFVAnnotations.hitTestTextBoxes(ctxIn, canvasIn, state.texts, pos.x, pos.y, { plane: "in" });
      const nextHov = th ? th.tb.id : null;
      if (nextHov !== state.hoveredTextId) {
        state.hoveredTextId = nextHov;
        requestRender("in");
      }
      if (th && !th.tb.locked) {
        canvasIn.style.cursor = th.hit === "resize" ? "nwse-resize" : "grab";
      } else if (canvasIn.style.cursor === "nwse-resize" || canvasIn.style.cursor === "grab") {
        canvasIn.style.cursor = "";
      }
    }
    if ((state.inProjection === "sphere" || state.inProjection === "cylinder") && window.RiemannSphereIn && window.RiemannSphereIn.state.orbiting) {
      if (window.RiemannSphereIn.onPointerMove(pos.x, pos.y)) requestRender("in");
      return;
    }
    if (state.pan && state.pan.which === "in") {
      state.inView.cx = state.pan.origCx - (pos.x - state.pan.startX) / (state.inView.scaleX || state.inView.scale);
      state.inView.cy = state.pan.origCy + (pos.y - state.pan.startY) / (state.inView.scaleY || state.inView.scale);
      if (state.showDomain) scheduleDomain();
      requestRender();
      return;
    }
    const zProbe = screenToInComplexExact(pos.x, pos.y);
    if (zProbe) {
      updateProbe(zProbe);
    } else if (state.probe.active) {
      state.probe.active = false;
      state.probe.z = null;
      state.probe.w = null;
      if (readoutIn) readoutIn.textContent = "—";
      if (readoutOut) readoutOut.textContent = "—";
      requestRender();
    }
    const z = screenToWorld(state.inView, canvasIn, pos.x, pos.y);

    if (state.taylor.draggingZ0) {
      state.taylor.x0 = z.x; state.taylor.y0 = z.y;
      document.getElementById("taylor-x0").value = z.x.toFixed(2);
      document.getElementById("taylor-y0").value = z.y.toFixed(2);
      fetchTaylor();
      return;
    }

    if (state.dragRotate) {
      const drag = state.dragRotate;
      let ang = Math.atan2(z.y - drag.cy, z.x - drag.cx) - drag.startAngle;
      while (ang > Math.PI) ang -= Math.PI * 2;
      while (ang < -Math.PI) ang += Math.PI * 2;
      if (e.shiftKey) {
        const snap = Math.PI / 12; /* 15-degree snap with Shift */
        ang = Math.round(ang / snap) * snap;
      }
      drag.curAngle = ang;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (const item of drag.shapes) {
        item.shape.rawPts = item.origRawPts.map((p) => {
          const rx = p.x - drag.cx, ry = p.y - drag.cy;
          return { x: drag.cx + rx * ca - ry * sa, y: drag.cy + rx * sa + ry * ca };
        });
        if (item.shape.boundary) item.shape.boundary.inPts = item.shape.rawPts.map((p) => ({ ...p }));
      }
      for (const item of drag.points) {
        const rx = item.origX - drag.cx, ry = item.origY - drag.cy;
        item.point.x = Number((drag.cx + rx * ca - ry * sa).toFixed(4));
        item.point.y = Number((drag.cy + rx * sa + ry * ca).toFixed(4));
        if (ws() && typeof ws().syncPointCoords === "function") ws().syncPointCoords(item.point);
      }
      flushRotateDrag(drag);
      requestRender();
      return;
    }

    if (state.marquee) {
      const m = state.marquee;
      m.x1 = pos.x;
      m.y1 = pos.y;
      const sx0 = Math.min(m.x0, m.x1), sx1 = Math.max(m.x0, m.x1);
      const sy0 = Math.min(m.y0, m.y1), sy1 = Math.max(m.y0, m.y1);
      const nextShapes = (m.additive || m.subtractive) ? new Set(m.prevShapes) : new Set();
      const nextPoints = (m.additive || m.subtractive) ? new Set(m.prevPoints) : new Set();
      if (sx1 - sx0 >= 4 || sy1 - sy0 >= 4) {
        for (const s of state.shapes) {
          if (s.locked || s.visible === false || !s.rawPts || s.rawPts.length === 0) continue;
          const inside = s.rawPts.some((pt) => {
            const sp = worldToScreen(state.inView, canvasIn, pt.x, pt.y);
            return sp.x >= sx0 && sp.x <= sx1 && sp.y >= sy0 && sp.y <= sy1;
          });
          if (inside) {
            if (m.subtractive) nextShapes.delete(s.id);
            else nextShapes.add(s.id);
          }
        }
        for (const pt of state.points) {
          if (pt.locked || pt.visible === false) continue;
          const sp = worldToScreen(state.inView, canvasIn, pt.x, pt.y);
          if (sp.x >= sx0 && sp.x <= sx1 && sp.y >= sy0 && sp.y <= sy1) {
            if (m.subtractive) nextPoints.delete(pt.id);
            else nextPoints.add(pt.id);
          }
        }
      }
      state.selectedShapeIds = nextShapes;
      state.selectedPointIds = nextPoints;
      syncPrimarySelection();
      requestRender();
      return;
    }

    if (state.dragGroup) {
      const drag = state.dragGroup;
      const dx = z.x - drag.startWorld.x;
      const dy = z.y - drag.startWorld.y;
      if (Math.hypot(dx, dy) > 1e-4) drag.moved = true;

      if (drag.mode === "move") {
        for (const item of drag.shapes) {
          item.shape.rawPts = shiftPts(item.origRawPts, dx, dy);
          if (item.shape.boundary) item.shape.boundary.inPts = item.shape.rawPts.map((p) => ({ ...p }));
          item.shape.mesh = [];
        }
        for (const item of drag.points) {
          item.point.x = Number((item.origX + dx).toFixed(4));
          item.point.y = Number((item.origY + dy).toFixed(4));
          if (ws() && typeof ws().syncPointCoords === "function") ws().syncPointCoords(item.point);
        }
      } else {
        const b = drag.origBox;
        const h = drag.handle;
        const hasW = h.id.includes("w"), hasE = h.id.includes("e");
        const hasS = h.id.includes("s"), hasN = h.id.includes("n");
        const ax = hasW ? b.xmax : hasE ? b.xmin : b.cx;
        const ay = hasS ? b.ymax : hasN ? b.ymin : b.cy;
        const denomX = hasW ? (b.xmin - ax) : hasE ? (b.xmax - ax) : 1;
        const denomY = hasS ? (b.ymin - ay) : hasN ? (b.ymax - ay) : 1;
        let sx = (hasW || hasE) ? ((z.x - ax) / (Math.abs(denomX) > 1e-6 ? denomX : 1)) : 1;
        let sy = (hasS || hasN) ? ((z.y - ay) / (Math.abs(denomY) > 1e-6 ? denomY : 1)) : 1;
        if (Math.abs(sx) < 0.04) sx = sx < 0 ? -0.04 : 0.04;
        if (Math.abs(sy) < 0.04) sy = sy < 0 ? -0.04 : 0.04;
        /* Shift while dragging a corner handle locks uniform 1:1 proportional group scaling */
        if (e.shiftKey && (hasW || hasE) && (hasS || hasN)) {
          const u = Math.max(Math.abs(sx), Math.abs(sy));
          sx = Math.sign(sx || 1) * u;
          sy = Math.sign(sy || 1) * u;
        }
        for (const item of drag.shapes) {
          item.shape.rawPts = item.origRawPts.map((p) => ({
            x: ax + (p.x - ax) * sx,
            y: ay + (p.y - ay) * sy,
          }));
          if (item.shape.boundary) item.shape.boundary.inPts = item.shape.rawPts.map((p) => ({ ...p }));
          item.shape.mesh = [];
        }
        for (const item of drag.points) {
          item.point.x = Number((ax + (item.origX - ax) * sx).toFixed(4));
          item.point.y = Number((ay + (item.origY - ay) * sy).toFixed(4));
          if (ws() && typeof ws().syncPointCoords === "function") ws().syncPointCoords(item.point);
        }
      }
      flushGroupDrag(drag);
      requestRender();
      return;
    }

    if (state.dragPoint) {
      const pt = state.dragPoint.point;
      pt.x = Number(z.x.toFixed(4));
      pt.y = Number(z.y.toFixed(4));
      if (ws() && typeof ws().syncPointCoords === "function") ws().syncPointCoords(pt);
      if (state.mode === "map") flushPointDrag();
      requestRender();
      return;
    }

    if (state.dragLine) {
      const ln = state.dragLine.line;
      ln.value = Number((ln.orientation === "horizontal" ? z.y : z.x).toFixed(4));
      if (ws() && typeof ws().syncGuideLine === "function") ws().syncGuideLine(ln);
      requestRender();
      return;
    }

    if (state.dragShape) {
      const drag = state.dragShape, s = drag.shape;
      if (drag.mode === "move") {
        const dx = z.x - drag.startWorld.x, dy = z.y - drag.startWorld.y;
        const ddx = dx - drag.curDx, ddy = dy - drag.curDy;
        drag.curDx = dx; drag.curDy = dy;
        s.rawPts = shiftPts(drag.origRawPts, dx, dy);
        if (s.boundary) s.boundary.inPts = shiftPts(s.boundary.inPts, ddx, ddy);
        if (s.integral) s.integral.inPts = shiftPts(s.integral.inPts, ddx, ddy);
        for (const m of s.mesh || []) m.inPts = shiftPts(m.inPts, ddx, ddy);
      } else {
        const h = drag.handle;
        if (h.shapeKind === "circle") {
          const ob = drag.origBox;
          const origR = Math.max(1e-6, 0.25 * ((ob.xmax - ob.xmin) + (ob.ymax - ob.ymin)));
          const newR = Math.max(0.02, Math.hypot(z.x - ob.cx, z.y - ob.cy));
          const ratio = newR / origR;
          s.rawPts = drag.origRawPts.map((p) => ({
            x: ob.cx + (p.x - ob.cx) * ratio,
            y: ob.cy + (p.y - ob.cy) * ratio,
          }));
        } else if (h.shapeKind === "rect") {
          const rf = rectLocalFrame(drag.origRawPts);
          if (rf) {
            let uMin = -0.5 * rf.w, uMax = 0.5 * rf.w;
            let vMin = -0.5 * rf.h, vMax = 0.5 * rf.h;
            const dx = z.x - rf.cx, dy = z.y - rf.cy;
            const pu = dx * rf.ux + dy * rf.uy;
            const pv = dx * rf.vx + dy * rf.vy;
            if (h.id.includes("w")) uMin = Math.min(uMax - 0.02, pu);
            if (h.id.includes("e")) uMax = Math.max(uMin + 0.02, pu);
            if (h.id.includes("s")) vMin = Math.min(vMax - 0.02, pv);
            if (h.id.includes("n")) vMax = Math.max(vMin + 0.02, pv);
            const mk = (u, v) => ({ x: rf.cx + u * rf.ux + v * rf.vx, y: rf.cy + u * rf.uy + v * rf.vy });
            s.rawPts = [mk(uMin, vMin), mk(uMax, vMin), mk(uMax, vMax), mk(uMin, vMax)];
          } else {
            let { xmin, xmax, ymin, ymax } = drag.origBox;
            if (h.id.includes("w")) xmin = z.x;
            if (h.id.includes("e")) xmax = z.x;
            if (h.id.includes("s")) ymin = z.y;
            if (h.id.includes("n")) ymax = z.y;
            s.rawPts = makeRect(xmin, ymin, xmax, ymax, drag.origCcw);
          }
        } else if (h.shapeKind === "line") {
          const sn = findSnapTarget(pos.x, pos.y, s.id);
          state.snapHint = sn;
          const tz = sn ? { x: sn.x, y: sn.y } : z;
          const p0 = h.id === "start" ? tz : drag.origRawPts[0];
          const p1 = h.id === "end" ? tz : drag.origRawPts[drag.origRawPts.length - 1];
          s.rawPts = makeLine(p0.x, p0.y, p1.x, p1.y, Math.max(40, drag.origRawPts.length - 1));
        } else if (h.shapeKind === "polygon") {
          s.rawPts = drag.origRawPts.map((p, i) => (i === h.vertexIndex ? { x: z.x, y: z.y } : { ...p }));
        } else if (h.shapeKind === "scale") {
          const b = drag.origBox;
          const ax = h.id.includes("w") ? b.xmax : b.xmin, ay = h.id.includes("s") ? b.ymax : b.ymin;
          const denX = h.id.includes("w") ? (b.xmin - ax) : (b.xmax - ax);
          const denY = h.id.includes("s") ? (b.ymin - ay) : (b.ymax - ay);
          let sx = Math.abs(denX) > 1e-6 ? (z.x - ax) / denX : 1;
          let sy = Math.abs(denY) > 1e-6 ? (z.y - ay) / denY : 1;
          if (Math.abs(sx) < 0.04) sx = sx < 0 ? -0.04 : 0.04;
          if (Math.abs(sy) < 0.04) sy = sy < 0 ? -0.04 : 0.04;
          if (e.shiftKey) {
            const u = Math.max(Math.abs(sx), Math.abs(sy));
            sx = Math.sign(sx || 1) * u;
            sy = Math.sign(sy || 1) * u;
          }
          s.rawPts = drag.origRawPts.map((p) => ({ x: ax + (p.x - ax) * sx, y: ay + (p.y - ay) * sy }));
        }
        if (s.boundary) s.boundary.inPts = s.rawPts.map((p) => ({ ...p }));
      }
      flushDrag(drag);
      requestRender();
      return;
    }

    if (state.tool === "move" || e.altKey || !isInputEditable()) {
      const canEdit = isInputEditable();
      if (canEdit) {
        if (hitRotateHandle(pos.x, pos.y)) { canvasIn.style.cursor = "grab"; return; }
        const ghHit = hitGroupHandle(pos.x, pos.y);
        if (ghHit) { canvasIn.style.cursor = ghHit.handle.cursor; return; }
        const hHit = hitResizeHandle(pos.x, pos.y);
        if (hHit) { canvasIn.style.cursor = hHit.handle.cursor; return; }
      }
      canvasIn.style.cursor = "";
      const pHit = hitPoint(pos.x, pos.y);
      const sHit = pHit ? null : hitShape(pos.x, pos.y);
      const npid = pHit ? pHit.id : null;
      const nsid = sHit ? sHit.id : null;
      if (state.hoveredPointId !== npid || state.hoveredShapeId !== nsid) {
        state.hoveredPointId = npid;
        state.hoveredShapeId = nsid;
        const canDrag = canEdit && ((pHit && !pHit.locked) || (sHit && !sHit.locked) || hitGroupBox(pos.x, pos.y));
        inCard.classList.toggle("move-hover", Boolean(canDrag));
        requestRender();
      }
      return;
    }

    if (state.polyDraft) {
      const sn = findSnapTarget(pos.x, pos.y);
      state.snapHint = sn;
      state.polyDraft.hoverPt = sn ? { x: sn.x, y: sn.y } : z;
      requestRender(); return;
    }
    const d = state.drawing;
    if (!d) {
      if (state.tool === "line" || state.tool === "freehand" || state.tool === "polygon") {
        const sn = findSnapTarget(pos.x, pos.y);
        if (Boolean(sn) !== Boolean(state.snapHint) || (sn && state.snapHint && (sn.x !== state.snapHint.x || sn.y !== state.snapHint.y))) {
          state.snapHint = sn;
          requestRender();
        }
      } else if (state.snapHint) {
        state.snapHint = null;
        requestRender();
      }
      return;
    }
    if (d.kind === "freehand") {
      const sn = findSnapTarget(pos.x, pos.y);
      state.snapHint = sn;
      const tz = sn ? { x: sn.x, y: sn.y } : z;
      const last = d.rawPts[d.rawPts.length - 1];
      const lsp = worldToScreen(state.inView, canvasIn, last.x, last.y);
      if (Math.hypot(pos.x - lsp.x, pos.y - lsp.y) >= 4) d.rawPts.push(tz);
      if (d.rawPts.length >= 6) {
        const fsp = worldToScreen(state.inView, canvasIn, d.rawPts[0].x, d.rawPts[0].y);
        d.snapActive = Math.hypot(pos.x - fsp.x, pos.y - fsp.y) <= SNAP_PX;
      }
    } else if (d.kind === "line" || d.kind === "seg" || d.kind === "ray" || d.kind === "infline") {
      const sn = findSnapTarget(pos.x, pos.y);
      state.snapHint = sn;
      const tz = sn ? { x: sn.x, y: sn.y } : z;
      d.rawPts = makeLine(d.anchor.x, d.anchor.y, tz.x, tz.y, 48);
    } else if (d.kind === "arc") {
      const r = Math.max(1e-4, Math.hypot(z.x - d.anchor.x, z.y - d.anchor.y));
      const a0 = Math.atan2(z.y - d.anchor.y, z.x - d.anchor.x);
      d.rawPts = [];
      for (let i = 0; i <= 48; i++) {
        const ang = a0 + (i / 48) * Math.PI;
        d.rawPts.push({ x: d.anchor.x + r * Math.cos(ang), y: d.anchor.y + r * Math.sin(ang) });
      }
    }
    else if (d.kind === "circle") d.rawPts = makeCircle(d.anchor.x, d.anchor.y, Math.max(1e-4, Math.hypot(z.x - d.anchor.x, z.y - d.anchor.y)));
    else if (d.kind === "rect") d.rawPts = makeRect(d.anchor.x, d.anchor.y, z.x, z.y);
    refreshLiveDraft();
    requestRender();
  });

  canvasIn.addEventListener("pointerup", async (e) => {
    state.snapHint = null;
    if (state.dragText && state.dragText.plane === "in") {
      const moved = state.dragText.moved;
      state.dragText = null;
      canvasIn.style.cursor = "";
      if (moved) {
        notifyDomain();
        notifyState(true, true);
      }
      requestRender("in");
      return;
    }
    if ((state.inProjection === "sphere" || state.inProjection === "cylinder") && window.RiemannSphereIn && window.RiemannSphereIn.state.orbiting) {
      window.RiemannSphereIn.onPointerUp();
      inCard.classList.remove("panning");
      return;
    }
    if (state.taylor.draggingZ0) { state.taylor.draggingZ0 = false; fetchTaylor(); return; }
    if ((state.inProjection === "sphere" || state.inProjection === "cylinder") && window.RiemannSphereIn && window.RiemannSphereIn.state.orbiting) {
      if (window.RiemannSphereIn.onPointerMove(pos.x, pos.y)) requestRender("in");
      return;
    }
    if (state.pan && state.pan.which === "in") {
      const p = state.pan;
      state.pan = null;
      inCard.classList.remove("panning");
      const pos = localPos(canvasIn, e);
      if (p.rightClick && Math.hypot(pos.x - p.startX, pos.y - p.startY) < 5) {
        const tbHit = window.CFVAnnotations && state.texts.length > 0
          ? window.CFVAnnotations.hitTestTextBoxes(ctxIn, canvasIn, state.texts, pos.x, pos.y, { plane: "in" })
          : null;
        if (tbHit && ws() && typeof ws().openItemSettingsAt === "function") {
          selectTextBox(tbHit.tb.id);
          ws().openItemSettingsAt("text", tbHit.tb.id, e.clientX, e.clientY);
          return;
        }
        const hit = hitElementIn(pos.x, pos.y);
        if (hit && ws() && typeof ws().openItemSettingsAt === "function") {
          if (hit.kind === "shape") selectShape(hit.id);
          else if (hit.kind === "point") selectPoint(hit.id);
          else if (hit.kind === "guide_line") selectGuideLine(hit.id);
          ws().openItemSettingsAt(hit.kind, hit.id, e.clientX, e.clientY);
          return;
        }
      }
      notifyState(false, false);
      return;
    }
    if (state.dragRotate) {
      const drag = state.dragRotate;
      state.dragRotate = null;
      inCard.classList.remove("dragging-shape");
      canvasIn.style.cursor = "";
      for (const item of drag.shapes) {
        if (item.shape.formula) item.shape.formula = null;
      }
      await Promise.all([
        ...drag.shapes.map((item) => computeShape(item.shape, 1.0)),
        drag.points.length > 0 ? recomputePoints() : Promise.resolve(),
      ]);
      updateIntegralPanel();
      notifyDomain();
      notifyState(true);
      requestRender();
      return;
    }
    if (state.marquee) {
      state.marquee = null;
      syncPrimarySelection();
      updateIntegralPanel();
      notifyDomain();
      requestRender();
      return;
    }
    if (state.dragGroup) {
      const drag = state.dragGroup;
      state.dragGroup = null;
      inCard.classList.remove("dragging-shape");
      canvasIn.style.cursor = "";
      if (!drag.moved && drag.narrowTo) {
        if (state.undoStack.length > 0) state.undoStack.pop();
        if (drag.narrowTo.kind === "shape") selectShape(drag.narrowTo.id);
        else if (drag.narrowTo.kind === "point") selectPoint(drag.narrowTo.id);
        return;
      }
      for (const item of drag.shapes) {
        if (item.shape.formula) item.shape.formula = null;
      }
      await Promise.all([
        ...drag.shapes.map((item) => computeShape(item.shape, 1.0)),
        drag.points.length > 0 ? recomputePoints() : Promise.resolve(),
      ]);
      updateIntegralPanel();
      notifyDomain();
      notifyState(true);
      requestRender();
      return;
    }
    if (state.dragPoint) {
      state.dragPoint = null;
      inCard.classList.remove("dragging-shape");
      await recomputePoints();
      notifyDomain();
      notifyState(true);
      return;
    }
    if (state.dragLine) {
      state.dragLine = null;
      inCard.classList.remove("dragging-shape");
      notifyDomain();
      notifyState(true);
      return;
    }
    if (state.dragShape) {
      const s = state.dragShape.shape;
      state.dragShape = null;
      if (s.formula) s.formula = null; /* Manual canvas move/resize detaches formula */
      inCard.classList.remove("dragging-shape");
      canvasIn.style.cursor = "";
      await computeShape(s, 1.0);
      updateIntegralPanel();
      notifyDomain();
      notifyState(true);
      requestRender();
      return;
    }
    const d = state.drawing;
    if (!d) return;
    state.drawing = null;
    /* Click-to-place support: if user simply clicked without dragging on any shape tool, drop a cleanly sized element at click! */
    const endPos = localPos(canvasIn, e);
    const dragDistPx = d.startPx ? Math.hypot(endPos.x - d.startPx.x, endPos.y - d.startPx.y) : 99;
    if (dragDistPx < 5 && d.kind !== "freehand") {
      const rDef = Math.max(0.15, ((canvasIn.clientWidth || 600) * 0.14) / Math.max(1e-6, state.inView.scale));
      const ax = d.anchor.x, ay = d.anchor.y;
      if (d.kind === "circle") { d.rawPts = makeCircle(ax, ay, rDef); d.closed = true; }
      else if (d.kind === "rect") { d.rawPts = makeRect(ax - rDef, ay - rDef * 0.72, ax + rDef, ay + rDef * 0.72); d.closed = true; }
      else if (d.kind === "arc") {
        d.rawPts = [];
        for (let i = 0; i <= 48; i++) {
          const ang = (i / 48) * Math.PI;
          d.rawPts.push({ x: ax + rDef * Math.cos(ang), y: ay + rDef * Math.sin(ang) });
        }
        d.closed = false;
      } else if (d.kind === "seg" || d.kind === "line") {
        d.rawPts = makeLine(ax - rDef, ay, ax + rDef, ay, 48);
        d.closed = false;
      } else if (d.kind === "ray") {
        d.rawPts = makeLine(ax, ay, ax + rDef, ay, 24);
        d.closed = false;
      } else if (d.kind === "infline") {
        d.rawPts = makeLine(ax - rDef, ay, ax + rDef, ay, 24);
        d.closed = false;
      }
    }
    if (d.rawPts.length >= 2) {
      pushUndoSnapshot();
      const closed = (d.kind === "ray" || d.kind === "infline") ? false : (d.closed || d.snapActive);
      state.colorIdx = (state.colorIdx + 1) % PALETTE.length;
      const defaultLbl =
        d.kind === "infline" ? "Line" :
        d.kind === "ray" ? "Ray" :
        d.kind === "seg" || d.kind === "line" ? "Segment" :
        d.kind === "arc" ? "Arc" :
        closed ? (d.kind === "freehand" ? "Closed Loop" : d.kind[0].toUpperCase() + d.kind.slice(1)) : "Open Path";
      const shape = {
        id: state.nextShapeId++,
        kind: d.kind,
        label: defaultLbl,
        color: d.color,
        lineWidth: 2.2,
        lineStyle: "solid",
        locked: false,
        closed,
        visible: true,
        rawPts: d.rawPts,
        boundary: null,
        mesh: [],
        extraCurves: [],
      };
      state.shapes.push(shape);
      state.selectedShapeId = shape.id;
      state.selectedPointId = null;
      await computeShape(shape, 1.0);
      updateIntegralPanel();
      notifyDomain();
      notifyState(true);
      requestRender();
    }
  });

  async function finishPoly() {
    const p = state.polyDraft;
    if (!p) return;
    state.polyDraft = null;
    if (p.rawPts.length >= 3) {
      pushUndoSnapshot();
      state.colorIdx = (state.colorIdx + 1) % PALETTE.length;
      const s = {
        id: state.nextShapeId++,
        kind: "polygon",
        label: `Polygon (${p.rawPts.length}v)`,
        color: p.color,
        lineWidth: 2.2,
        lineStyle: "solid",
        locked: false,
        closed: true,
        visible: true,
        rawPts: p.rawPts,
        boundary: null,
        mesh: [],
        extraCurves: [],
      };
      state.shapes.push(s);
      state.selectedShapeId = s.id;
      state.selectedPointId = null;
      await computeShape(s, 1.0);
      updateIntegralPanel();
      notifyDomain();
      notifyState(true);
      requestRender();
    }
  }

  canvasIn.addEventListener("dblclick", () => { if (state.polyDraft) finishPoly(); });
  canvasIn.addEventListener("pointerleave", () => {
    state.probe.active = false;
    state.probe.z = null;
    state.probe.w = null;
    state.snapHint = null;
    state.hoveredShapeId = null;
    state.hoveredPointId = null;
    requestRender();
  });
  canvasIn.addEventListener("wheel", (e) => {
    e.preventDefault();
    if ((state.inProjection === "sphere" || state.inProjection === "cylinder") && window.RiemannSphereIn) {
      window.RiemannSphereIn.onWheel(e.deltaY);
      requestRender("in");
      return;
    }
    const pos = localPos(canvasIn, e);
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const scaleXOnly = e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
    const scaleYOnly = (e.ctrlKey || e.metaKey || e.altKey) && !e.shiftKey;
    if (scaleXOnly) {
      if (state.inSquare) { state.inSquare = false; const b = document.getElementById("in-square"); if (b) b.classList.remove("active"); }
      zoomAt(state.inView, canvasIn, pos.x, pos.y, f, 1);
    } else if (scaleYOnly) {
      if (state.inSquare) { state.inSquare = false; const b = document.getElementById("in-square"); if (b) b.classList.remove("active"); }
      zoomAt(state.inView, canvasIn, pos.x, pos.y, 1, f);
    } else {
      zoomAt(state.inView, canvasIn, pos.x, pos.y, f, f);
    }
    notifyState(false, false);
  }, { passive: false });

  /* Output canvas pan / zoom / 3D sphere orbit / text box drag-resize / right-click context menu */
  canvasOut.addEventListener("pointerdown", (e) => {
    canvasOut.setPointerCapture(e.pointerId);
    const pos = localPos(canvasOut, e);
    if (e.button === 0 && window.CFVAnnotations && state.texts.length > 0) {
      const tbHit = window.CFVAnnotations.hitTestTextBoxes(ctxOut, canvasOut, state.texts, pos.x, pos.y, { plane: "out" });
      if (tbHit) {
        selectTextBox(tbHit.tb.id);
        if (!tbHit.tb.locked) {
          pushUndoSnapshot();
          state.dragText = {
            plane: "out",
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
          canvasOut.style.cursor = tbHit.hit === "resize" ? "nwse-resize" : "grabbing";
        }
        requestRender("out");
        return;
      }
    }
    if (window.RiemannSphere && (state.projection === "sphere" || state.projection === "cylinder")) {
      window.RiemannSphere.onPointerDown(pos.x, pos.y);
      outCard.classList.add("panning"); return;
    }
    state.pan = {
      which: "out",
      startX: pos.x,
      startY: pos.y,
      origCx: state.outView.cx,
      origCy: state.outView.cy,
      rightClick: e.button === 2,
      clientX: e.clientX,
      clientY: e.clientY,
    };
    outCard.classList.add("panning");
  });
  canvasOut.addEventListener("pointermove", (e) => {
    const pos = localPos(canvasOut, e);
    if (state.dragText && state.dragText.plane === "out") {
      const dt = state.dragText;
      const dx = pos.x - dt.startX;
      const dy = pos.y - dt.startY;
      if (Math.hypot(dx, dy) >= 2) dt.moved = true;
      const cw = canvasOut.clientWidth || 600, ch = canvasOut.clientHeight || 400;
      if (dt.mode === "resize") {
        dt.tb.width = Math.round(Math.max(150, Math.min(cw - 24, dt.origW + dx)));
        dt.tb.height = Math.round(Math.max(44, Math.min(ch - 24, dt.origH + dy)));
      } else if (dt.tb.anchor === "world") {
        const scX = state.outView.scaleX || state.outView.scale;
        const scY = state.outView.scaleY || state.outView.scale;
        dt.tb.x = Number((dt.origWorldX + dx / scX).toFixed(4));
        dt.tb.y = Number((dt.origWorldY - dy / scY).toFixed(4));
        dt.tb.xExpr = "";
        dt.tb.yExpr = "";
      } else {
        dt.tb.anchor = "free";
        dt.tb.nx = Number(Math.max(0.01, Math.min(0.95, (dt.origBx + dx) / cw)).toFixed(4));
        dt.tb.ny = Number(Math.max(0.01, Math.min(0.95, (dt.origBy + dy) / ch)).toFixed(4));
      }
      requestRender("out");
      return;
    }
    if (!state.pan && window.CFVAnnotations && state.texts.length > 0) {
      const th = window.CFVAnnotations.hitTestTextBoxes(ctxOut, canvasOut, state.texts, pos.x, pos.y, { plane: "out" });
      const nextHov = th ? th.tb.id : null;
      if (nextHov !== state.hoveredTextId) {
        state.hoveredTextId = nextHov;
        requestRender("out");
      }
      if (th && !th.tb.locked) {
        canvasOut.style.cursor = th.hit === "resize" ? "nwse-resize" : "grab";
      } else if (canvasOut.style.cursor === "nwse-resize" || canvasOut.style.cursor === "grab") {
        canvasOut.style.cursor = "";
      }
    }
    if (window.RiemannSphere && (state.projection === "sphere" || state.projection === "cylinder") && window.RiemannSphere.state.orbiting) {
      if (window.RiemannSphere.onPointerMove(pos.x, pos.y)) requestRender("out");
      return;
    }
    if (state.pan && state.pan.which === "out") {
      state.outView.cx = state.pan.origCx - (pos.x - state.pan.startX) / (state.outView.scaleX || state.outView.scale);
      state.outView.cy = state.pan.origCy + (pos.y - state.pan.startY) / (state.outView.scaleY || state.outView.scale);
      requestRender("out");
      return;
    }
    /* Output pane live probe dot & exact element hover highlighting across ALL projections (Planar, Disks, Mercator, Riemann Sphere)! */
    const wProbe = screenToOutComplexExact(pos.x, pos.y);
    if (wProbe) {
      state.probe.active = true;
      state.probe.z = null;
      state.probe.w = wProbe;
      if (readoutIn) readoutIn.textContent = "—";
      if (readoutOut) readoutOut.textContent = fmtComplex(wProbe.x, wProbe.y, 4);
    } else if (state.probe.active) {
      state.probe.active = false;
      state.probe.z = null;
      state.probe.w = null;
      if (readoutIn) readoutIn.textContent = "—";
      if (readoutOut) readoutOut.textContent = "—";
    }
    const outHit = hitElementOut(pos.x, pos.y);
    const npid = outHit && outHit.kind === "point" ? outHit.id : null;
    const nsid = outHit && outHit.kind === "shape" ? outHit.id : null;
    const hovChanged = state.hoveredPointId !== npid || state.hoveredShapeId !== nsid;
    state.hoveredPointId = npid;
    state.hoveredShapeId = nsid;
    requestRender(hovChanged ? "both" : "out");
  });
  canvasOut.addEventListener("pointerleave", () => {
    const hadAny = state.probe.active || state.hoveredShapeId !== null || state.hoveredPointId !== null;
    state.probe.active = false;
    state.probe.z = null;
    state.probe.w = null;
    state.hoveredShapeId = null;
    state.hoveredPointId = null;
    if (hadAny) requestRender("both");
  });
  canvasOut.addEventListener("pointerup", (e) => {
    if (state.dragText && state.dragText.plane === "out") {
      const moved = state.dragText.moved;
      state.dragText = null;
      canvasOut.style.cursor = "";
      if (moved) {
        notifyDomain();
        notifyState(true, true);
      }
      requestRender("out");
      return;
    }
    if (window.RiemannSphere && (state.projection === "sphere" || state.projection === "cylinder")) { window.RiemannSphere.onPointerUp(); outCard.classList.remove("panning"); return; }
    const p = state.pan;
    state.pan = null; outCard.classList.remove("panning");
    if (p && p.which === "out" && p.rightClick) {
      const pos = localPos(canvasOut, e);
      if (Math.hypot(pos.x - p.startX, pos.y - p.startY) < 5) {
        const tbHit = window.CFVAnnotations && state.texts.length > 0
          ? window.CFVAnnotations.hitTestTextBoxes(ctxOut, canvasOut, state.texts, pos.x, pos.y, { plane: "out" })
          : null;
        if (tbHit && ws() && typeof ws().openItemSettingsAt === "function") {
          selectTextBox(tbHit.tb.id);
          ws().openItemSettingsAt("text", tbHit.tb.id, e.clientX, e.clientY);
          return;
        }
        const hit = hitElementOut(pos.x, pos.y);
        if (hit && ws() && typeof ws().openItemSettingsAt === "function") {
          if (hit.kind === "shape") selectShape(hit.id);
          else if (hit.kind === "point") selectPoint(hit.id);
          ws().openItemSettingsAt(hit.kind, hit.id, e.clientX, e.clientY);
          return;
        }
      }
    }
    notifyState(false, false);
  });
  canvasOut.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (window.RiemannSphere && (state.projection === "sphere" || state.projection === "cylinder")) { window.RiemannSphere.onWheel(e.deltaY); requestRender("out"); return; }
    const pos = localPos(canvasOut, e);
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const scaleXOnly = e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
    const scaleYOnly = (e.ctrlKey || e.metaKey || e.altKey) && !e.shiftKey;
    if (scaleXOnly) {
      if (state.outSquare) { state.outSquare = false; const b = document.getElementById("out-square"); if (b) b.classList.remove("active"); }
      zoomAt(state.outView, canvasOut, pos.x, pos.y, f, 1);
    } else if (scaleYOnly) {
      if (state.outSquare) { state.outSquare = false; const b = document.getElementById("out-square"); if (b) b.classList.remove("active"); }
      zoomAt(state.outView, canvasOut, pos.x, pos.y, 1, f);
    } else {
      zoomAt(state.outView, canvasOut, pos.x, pos.y, f, f);
    }
    notifyState(false, false);
  }, { passive: false });

  /* Dock controls */
  function setTool(t) {
    state.tool = t;
    state.polyDraft = null;
    document.querySelectorAll(".dock-tool[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
    inCard.classList.toggle("move-mode", t === "move");
    inCard.classList.toggle("pan-mode", t === "pan");
  }
  document.querySelectorAll(".dock-tool[data-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));

  async function toggleCloseShape(id) {
    const s = state.shapes.find((q) => q.id === id);
    if (!s || s.rawPts.length < 3) return;
    pushUndoSnapshot();
    s.closed = !s.closed;
    await computeShape(s, 1.0);
    updateIntegralPanel();
    notifyDomain();
    notifyState(true);
    requestRender();
  }

  async function reverseShape(id) {
    const s = state.shapes.find((q) => q.id === id);
    if (!s) return;
    pushUndoSnapshot();
    s.rawPts.reverse();
    await computeShape(s, 1.0);
    updateIntegralPanel();
    notifyDomain();
    notifyState(true);
    requestRender();
  }

  async function joinConnectedShapes() {
    const allOpen = state.shapes.filter(
      (s) => !s.closed && !s.locked && s.visible !== false && Array.isArray(s.rawPts) && s.rawPts.length >= 2
    );
    const selectedOpen = allOpen.filter((s) => isShapeSelected(s.id));
    const useSelectedMode = selectedOpen.length >= 2;
    const candidates = useSelectedMode ? selectedOpen : allOpen;
    if (candidates.length < 2) {
      showSelectionToast("Draw or select 2+ open paths (Ctrl/Shift+click) to join into a contour");
      return { mergedGroups: 0, mergedCount: 0, created: [] };
    }

    const tol = Math.max(0.06, 16 / Math.max(state.inView.scale || 40, 1e-3));
    const connectLimit = useSelectedMode ? Infinity : tol;
    const used = new Set();
    const removedIds = new Set();
    const created = [];
    let mergedCount = 0;

    const ordered = [...candidates].sort((a, b) =>
      a.id === state.selectedShapeId ? -1 : b.id === state.selectedShapeId ? 1 : 0
    );

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    for (const seed of ordered) {
      if (used.has(seed.id)) continue;
      used.add(seed.id);
      const group = [seed];
      let pts = seed.rawPts.map((p) => ({ x: p.x, y: p.y }));

      let extended = true;
      while (extended) {
        extended = false;
        const head = pts[0];
        const tail = pts[pts.length - 1];
        let best = null;
        let bestDist = connectLimit;

        for (const cand of candidates) {
          if (used.has(cand.id)) continue;
          const cFirst = cand.rawPts[0];
          const cLast = cand.rawPts[cand.rawPts.length - 1];

          const dTailFirst = dist(tail, cFirst);
          if (dTailFirst <= bestDist) {
            bestDist = dTailFirst;
            best = { cand, where: "tail", rev: false };
          }
          const dTailLast = dist(tail, cLast);
          if (dTailLast <= bestDist) {
            bestDist = dTailLast;
            best = { cand, where: "tail", rev: true };
          }
          const dHeadLast = dist(head, cLast);
          if (dHeadLast <= bestDist) {
            bestDist = dHeadLast;
            best = { cand, where: "head", rev: false };
          }
          const dHeadFirst = dist(head, cFirst);
          if (dHeadFirst <= bestDist) {
            bestDist = dHeadFirst;
            best = { cand, where: "head", rev: true };
          }
        }

        if (best) {
          used.add(best.cand.id);
          group.push(best.cand);
          const addPts = best.cand.rawPts.map((p) => ({ x: p.x, y: p.y }));
          if (best.rev) addPts.reverse();
          if (best.where === "tail") {
            if (dist(pts[pts.length - 1], addPts[0]) < 1e-4) addPts.shift();
            pts = pts.concat(addPts);
          } else {
            if (dist(addPts[addPts.length - 1], pts[0]) < 1e-4) addPts.pop();
            pts = addPts.concat(pts);
          }
          extended = true;
        }
      }

      if (group.length >= 2) {
        for (const g of group) removedIds.add(g.id);
        mergedCount += group.length;
        const closeTol = useSelectedMode ? Math.max(tol * 1.5, 0.18) : tol;
        let closed = false;
        if (pts.length >= 3 && dist(pts[0], pts[pts.length - 1]) <= closeTol) {
          closed = true;
          if (dist(pts[0], pts[pts.length - 1]) < 1e-4 && pts.length > 3) pts.pop();
        }
        const merged = {
          id: state.nextShapeId++,
          kind: "path",
          label: closed ? `Joined Loop (${group.length})` : `Joined Path (${group.length})`,
          color: seed.color,
          lineWidth: seed.lineWidth || 2.2,
          lineStyle: seed.lineStyle || "solid",
          locked: false,
          closed,
          visible: true,
          formula: null,
          rawPts: pts,
          boundary: null,
          mesh: [],
          extraCurves: [],
        };
        created.push(merged);
      }
    }

    if (created.length === 0) {
      showSelectionToast("Endpoints not touching — Ctrl/Shift+select 2+ open paths and click Join");
      return { mergedGroups: 0, mergedCount: 0, created: [] };
    }

    pushUndoSnapshot();
    state.shapes = state.shapes.filter((s) => !removedIds.has(s.id));
    for (const m of created) {
      state.shapes.push(m);
      await computeShape(m, 1.0);
    }
    clearSelection();
    state.selectedShapeIds.add(created[0].id);
    syncPrimarySelection();
    updateIntegralPanel();
    notifyDomain();
    notifyState(true);
    requestRender();
    return { mergedGroups: created.length, mergedCount, created };
  }

  document.getElementById("btn-close-shape").addEventListener("click", async () => {
    const s = state.shapes.find((q) => q.id === state.selectedShapeId && !q.closed && q.rawPts.length >= 3) ||
      [...state.shapes].reverse().find((q) => !q.closed && q.rawPts.length >= 3);
    if (s) await toggleCloseShape(s.id);
  });
  const btnJoinShapes = document.getElementById("btn-join-shapes");
  if (btnJoinShapes) {
    btnJoinShapes.addEventListener("click", () => joinConnectedShapes());
  }
  const btnSidebarJoin = document.getElementById("btn-sidebar-join");
  if (btnSidebarJoin) {
    btnSidebarJoin.addEventListener("click", (ev) => {
      ev.stopPropagation();
      joinConnectedShapes();
    });
  }
  if (btnSelJoin) btnSelJoin.addEventListener("click", () => joinConnectedShapes());
  if (btnSelDel) btnSelDel.addEventListener("click", () => deleteSelectedItems());
  if (btnSelClear) {
    btnSelClear.addEventListener("click", () => {
      bannerToastMsg = "";
      clearSelection();
      updateIntegralPanel();
      notifyDomain();
      requestRender();
    });
  }
  document.getElementById("btn-reverse-shape").addEventListener("click", async () => {
    const s = state.shapes.find((q) => q.id === state.selectedShapeId) || state.shapes[state.shapes.length - 1];
    if (s) await reverseShape(s.id);
  });
  btnTracePlay.addEventListener("click", () => {
    state.playing = !state.playing;
    btnTracePlay.classList.toggle("playing", state.playing);
    btnTracePlay.textContent = state.playing ? "❚❚" : "▶";
    if (state.playing) requestRender();
  });
  document.getElementById("btn-undo-shape").addEventListener("click", () => {
    undoLastAction();
  });
  document.getElementById("btn-clear-shapes").addEventListener("click", () => {
    if (state.shapes.some((s) => !s.locked)) pushUndoSnapshot();
    state.shapes = state.shapes.filter((s) => s.locked);
    clearSelection();
    updateIntegralPanel(); notifyDomain(); notifyState(true); requestRender();
  });

  if (btnToggleSphere) {
    btnToggleSphere.addEventListener("click", () => {
      setProjection(state.projection === "sphere" ? "planar" : "sphere");
    });
  }
  if (inProjSelect) {
    inProjSelect.addEventListener("change", () => {
      setInProjection(inProjSelect.value);
    });
  }
  if (outProjSelect) {
    outProjSelect.addEventListener("change", () => {
      setProjection(outProjSelect.value);
    });
  }

  const optOutDomain = document.getElementById("opt-out-domain");
  if (optOutDomain) {
    optOutDomain.addEventListener("change", () => {
      state.showOutDomain = optOutDomain.checked;
      if (state.showOutDomain) {
        if (!state.domainImg) fetchDomain();
        else requestRender("out");
      } else {
        requestRender("out");
      }
      notifyState(true, true);
    });
  }
  const optDomainScheme = document.getElementById("opt-domain-scheme");
  const optDomainOpacity = document.getElementById("opt-domain-opacity");
  const optDomainOpacityVal = document.getElementById("opt-domain-opacity-val");
  if (optDomainScheme) {
    optDomainScheme.addEventListener("change", () => {
      state.domainScheme = optDomainScheme.value || "classic";
      if (!state.showDomain) {
        state.showDomain = true;
        const cb = document.getElementById("opt-domain");
        if (cb) cb.checked = true;
      }
      fetchDomain();
      notifyState(true, true);
    });
  }
  if (optDomainOpacity) {
    optDomainOpacity.addEventListener("input", () => {
      state.domainOpacity = normOpacity(optDomainOpacity.value, 0.72);
      if (optDomainOpacityVal) optDomainOpacityVal.textContent = `${Math.round(state.domainOpacity * 100)}%`;
      requestRender();
      notifyState(false, true);
    });
  }

  const btnInSquare = document.getElementById("in-square");
  if (btnInSquare) btnInSquare.addEventListener("click", () => setSquareAspect("in", !state.inSquare));
  const btnOutSquare = document.getElementById("out-square");
  if (btnOutSquare) btnOutSquare.addEventListener("click", () => setSquareAspect("out", !state.outSquare));

  const scaleAxisIn = (fx, fy) => {
    if (state.inSquare) { state.inSquare = false; if (btnInSquare) btnInSquare.classList.remove("active"); }
    zoomAt(state.inView, canvasIn, canvasIn.clientWidth * 0.5, canvasIn.clientHeight * 0.5, fx, fy);
    notifyState(false, false);
  };
  const scaleAxisOut = (fx, fy) => {
    if (window.RiemannSphere && (state.projection === "sphere" || window.RiemannSphere.state.enabled)) return;
    if (state.outSquare) { state.outSquare = false; if (btnOutSquare) btnOutSquare.classList.remove("active"); }
    zoomAt(state.outView, canvasOut, canvasOut.clientWidth * 0.5, canvasOut.clientHeight * 0.5, fx, fy);
    notifyState(false, false);
  };
  const bindBtn = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
  bindBtn("in-zoom-x-in", () => scaleAxisIn(1.3, 1));
  bindBtn("in-zoom-x-out", () => scaleAxisIn(1 / 1.3, 1));
  bindBtn("in-zoom-y-in", () => scaleAxisIn(1, 1.3));
  bindBtn("in-zoom-y-out", () => scaleAxisIn(1, 1 / 1.3));
  bindBtn("out-zoom-x-in", () => scaleAxisOut(1.3, 1));
  bindBtn("out-zoom-x-out", () => scaleAxisOut(1 / 1.3, 1));
  bindBtn("out-zoom-y-in", () => scaleAxisOut(1, 1.3));
  bindBtn("out-zoom-y-out", () => scaleAxisOut(1, 1 / 1.3));

  document.getElementById("in-zoom-in").addEventListener("click", () => zoomAt(state.inView, canvasIn, canvasIn.clientWidth * 0.5, canvasIn.clientHeight * 0.5, 1.35));
  document.getElementById("in-zoom-out").addEventListener("click", () => zoomAt(state.inView, canvasIn, canvasIn.clientWidth * 0.5, canvasIn.clientHeight * 0.5, 1 / 1.35));
  document.getElementById("in-reset").addEventListener("click", () => setView(state.inView, canvasIn, state.defaultInView.cx, state.defaultInView.cy, state.defaultInView.r));
  document.getElementById("out-autofit").addEventListener("click", () => {
    if (window.RiemannSphere && (state.projection === "sphere" || state.projection === "cylinder")) {
      window.RiemannSphere.focusOnShapes(state.shapes, (s) =>
        state.mode === "integral" ? (s.integral ? s.integral.cumPts : null) : s.boundary ? s.boundary.outPts : null
      );
      requestRender();
      return;
    }
    if (state.projection === "stereographic" || state.projection === "poincare") {
      setSquareAspect("out", true);
      setView(state.outView, canvasOut, 0, 0, 1.32);
      return;
    }
    autoFitOutput();
  });
  document.getElementById("out-zoom-in").addEventListener("click", () => {
    if (window.RiemannSphere && (state.projection === "sphere" || state.projection === "cylinder")) {
      window.RiemannSphere.zoomBy(1.22);
      requestRender();
      return;
    }
    zoomAt(state.outView, canvasOut, canvasOut.clientWidth * 0.5, canvasOut.clientHeight * 0.5, 1.35);
  });
  document.getElementById("out-zoom-out").addEventListener("click", () => {
    if (window.RiemannSphere && (state.projection === "sphere" || state.projection === "cylinder")) {
      window.RiemannSphere.zoomBy(1 / 1.22);
      requestRender();
      return;
    }
    zoomAt(state.outView, canvasOut, canvasOut.clientWidth * 0.5, canvasOut.clientHeight * 0.5, 1 / 1.35);
  });
  document.getElementById("out-reset").addEventListener("click", () => {
    if (window.RiemannSphere && (state.projection === "sphere" || state.projection === "cylinder")) { window.RiemannSphere.reset(); requestRender(); return; }
    if (state.projection === "stereographic" || state.projection === "poincare") {
      setSquareAspect("out", true);
      setView(state.outView, canvasOut, 0, 0, 1.32);
      return;
    }
    setView(state.outView, canvasOut, state.defaultOutView.cx, state.defaultOutView.cy, state.defaultOutView.r);
  });

  window.addEventListener("keydown", (e) => {
    if (!state.active || e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      undoLastAction();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      state.selectedShapeIds.clear();
      state.selectedPointIds.clear();
      for (const s of state.shapes) if (!s.locked && s.visible !== false) state.selectedShapeIds.add(s.id);
      syncPrimarySelection();
      updateIntegralPanel();
      notifyDomain();
      requestRender();
      return;
    }
    if (e.key === "Escape") {
      clearSelection();
      updateIntegralPanel();
      notifyDomain();
      requestRender();
      return;
    }
    if (e.code === "Space") { state.spaceHeld = true; inCard.classList.add("pan-mode"); }
    else if (e.key === "v" || e.key === "V") setTool("move");
    else if (e.key === "1") setTool("freehand");
    else if (e.key === "2") setTool("line");
    else if (e.key === "3") setTool("circle");
    else if (e.key === "4") setTool("rect");
    else if (e.key === "5") setTool("polygon");
    else if (e.key === "p" || e.key === "P") btnTracePlay.click();
    else if (e.key === "Delete" || e.key === "Backspace") {
      if (deleteSelectedItems()) e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") { state.spaceHeld = false; inCard.classList.toggle("pan-mode", state.tool === "pan"); }
  });

  /* -------------------------------------------------------------------------
   * Programmatic Domain Object Helpers (Called by Desmos Sidebar)
   * ------------------------------------------------------------------------- */

  async function addQuickShape(kind) {
    pushUndoSnapshot();
    const cx = state.inView.cx, cy = state.inView.cy;
    const span = Math.min(canvasIn.clientWidth || 400, canvasIn.clientHeight || 400) / state.inView.scale;
    const r = Math.max(0.25, span * 0.2);
    const col = PALETTE[state.colorIdx++ % PALETTE.length];

    let rawPts, closed = true, label = "Circle", formula = null;
    if (kind === "rect") {
      rawPts = makeRect(cx - r, cy - r * 0.75, cx + r, cy + r * 0.75, true);
      label = `Rect (${state.shapes.length + 1})`;
    } else if (kind === "line") {
      rawPts = makeLine(cx - r * 1.2, cy, cx + r * 1.2, cy, 64);
      closed = false;
      label = `Line (${state.shapes.length + 1})`;
    } else if (kind === "arc") {
      const f2 = (n) => String(Number(n.toFixed(3)));
      formula = { kind: "arc", cx: f2(cx), cy: f2(cy), r: f2(r), a0: "0", a1: "pi" };
      rawPts = makeArc(cx, cy, r, 0, Math.PI, 84);
      closed = false;
      label = `Arc (${state.shapes.length + 1})`;
    } else {
      rawPts = makeCircle(cx, cy, r, 72, true);
      label = `Circle (${state.shapes.length + 1})`;
    }

    const shape = {
      id: state.nextShapeId++,
      kind,
      label,
      color: col,
      lineWidth: 2.2,
      lineStyle: "solid",
      locked: false,
      closed,
      visible: true,
      formula,
      rawPts,
      boundary: null,
      mesh: [],
      extraCurves: [],
    };
    state.shapes.push(shape);
    clearSelection();
    state.selectedShapeIds.add(shape.id);
    syncPrimarySelection();
    await computeShape(shape, 1.0);
    updateIntegralPanel();
    notifyDomain();
    notifyState(true);
    requestRender();
    return shape;
  }

  async function addPoint(opts = {}, silent = false) {
    if (!silent) pushUndoSnapshot();
    const col = opts.color || PALETTE[state.colorIdx++ % PALETTE.length];
    const p = {
      id: state.nextPointId++,
      kind: "point",
      x: opts.x !== undefined ? Number(opts.x) : Number(state.inView.cx.toFixed(3)),
      y: opts.y !== undefined ? Number(opts.y) : Number(state.inView.cy.toFixed(3)),
      label: opts.label || `P${state.points.length + 1}`,
      icon: opts.icon || "dot",
      color: col,
      size: opts.size || 5.5,
      locked: Boolean(opts.locked),
      visible: opts.visible !== undefined ? Boolean(opts.visible) : true,
      showLabel: opts.showLabel !== undefined ? Boolean(opts.showLabel) : true,
      outPt: null,
    };
    state.points.push(p);
    clearSelection();
    state.selectedPointIds.add(p.id);
    syncPrimarySelection();
    await recomputePoints();
    notifyDomain();
    if (!silent) notifyState(true);
    requestRender();
    return p;
  }

  function deleteShape(id) {
    if (state.shapes.some((s) => s.id === id)) pushUndoSnapshot();
    state.shapes = state.shapes.filter((s) => s.id !== id);
    state.selectedShapeIds.delete(id);
    syncPrimarySelection();
    updateIntegralPanel();
    notifyDomain();
    notifyState(true);
    requestRender();
  }

  function deletePoint(id) {
    if (state.points.some((p) => p.id === id)) pushUndoSnapshot();
    state.points = state.points.filter((p) => p.id !== id);
    state.selectedPointIds.delete(id);
    syncPrimarySelection();
    notifyDomain();
    notifyState(true);
    requestRender();
  }

  function addGuideLine(opts = {}, silent = false) {
    if (!silent) pushUndoSnapshot();
    const orient = opts.orientation === "horizontal" ? "horizontal" : "vertical";
    const defVal = orient === "horizontal" ? Number(state.inView.cy.toFixed(3)) : Number(state.inView.cx.toFixed(3));
    const val = opts.value !== undefined ? Number(opts.value) : defVal;
    const ln = {
      id: state.nextLineId++,
      kind: "guide_line",
      orientation: orient,
      value: val,
      label: opts.label || (orient === "horizontal" ? `Im = ${val}` : `Re = ${val}`),
      color: opts.color || "#fbbf24",
      lineWidth: Number(opts.lineWidth) || 1.6,
      lineStyle: opts.lineStyle || "dashed",
      locked: Boolean(opts.locked),
      visible: opts.visible !== undefined ? Boolean(opts.visible) : true,
      showLabel: opts.showLabel !== undefined ? Boolean(opts.showLabel) : true,
    };
    state.lines.push(ln);
    state.selectedLineId = ln.id;
    state.selectedShapeId = null;
    state.selectedPointId = null;
    notifyDomain();
    if (!silent) notifyState(true);
    requestRender();
    return ln;
  }

  function deleteGuideLine(id) {
    if (state.lines.some((l) => l.id === id)) pushUndoSnapshot();
    state.lines = state.lines.filter((l) => l.id !== id);
    if (state.selectedLineId === id) state.selectedLineId = null;
    notifyDomain();
    notifyState(true);
    requestRender();
  }

  function selectGuideLine(id) {
    clearSelection();
    state.selectedLineId = id;
    updateIntegralPanel();
    notifyDomain();
    requestRender();
  }

  function addTextBox(opts = {}, silent = false) {
    if (!silent) pushUndoSnapshot();
    const tb = {
      id: state.nextTextId++,
      kind: "text",
      title: opts.title !== undefined ? String(opts.title) : "Note",
      text: opts.text !== undefined ? String(opts.text) : "Explain the math or what to try here…",
      anchor: opts.anchor || "bottom-left",
      plane: opts.plane === "out" ? "out" : "in",
      x: opts.x !== undefined ? Number(opts.x) : Number(state.inView.cx.toFixed(3)),
      y: opts.y !== undefined ? Number(opts.y) : Number(state.inView.cy.toFixed(3)),
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
    if (state.texts.some((t) => t.id === id)) pushUndoSnapshot();
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

  function selectShape(id, opts = {}) {
    state.selectedLineId = null;
    if (opts.range && state.selectedShapeId !== null) {
      const a = state.shapes.findIndex((s) => s.id === state.selectedShapeId);
      const b = state.shapes.findIndex((s) => s.id === id);
      if (a !== -1 && b !== -1) {
        const lo = Math.min(a, b), hi = Math.max(a, b);
        for (let i = lo; i <= hi; i++) state.selectedShapeIds.add(state.shapes[i].id);
      } else {
        state.selectedShapeIds.add(id);
      }
    } else if (opts.toggle) {
      if (state.selectedShapeIds.has(id)) state.selectedShapeIds.delete(id);
      else state.selectedShapeIds.add(id);
    } else {
      state.selectedShapeIds.clear();
      state.selectedPointIds.clear();
      state.selectedShapeIds.add(id);
    }
    syncPrimarySelection();
    updateIntegralPanel();
    notifyDomain();
    requestRender();
  }

  function selectPoint(id, opts = {}) {
    state.selectedLineId = null;
    if (opts.toggle) {
      if (state.selectedPointIds.has(id)) state.selectedPointIds.delete(id);
      else state.selectedPointIds.add(id);
    } else {
      state.selectedShapeIds.clear();
      state.selectedPointIds.clear();
      state.selectedPointIds.add(id);
    }
    syncPrimarySelection();
    updateIntegralPanel();
    notifyDomain();
    requestRender();
  }

  function addBundleShapes(shapeSpecs, replace = false) {
    if (replace) state.shapes = [];
    const paramMap = ws() && typeof ws().getParamMap === "function" ? ws().getParamMap() : {};
    for (const sh of shapeSpecs || []) {
      let rawPts = [];
      let closed = sh.closed !== undefined ? Boolean(sh.closed) : true;
      const formula = sh.formula ? { ...sh.formula } : null;
      const kind = sh.kind || (formula && formula.kind) || "circle";
      if (formula) {
        const res = evalShapeFormula(formula, paramMap);
        if (res && res.rawPts.length >= 2) {
          rawPts = res.rawPts;
          if (formula.kind !== "parametric") closed = res.closed;
        }
      }
      if (rawPts.length < 2) {
        if (Array.isArray(sh.rawPts) && sh.rawPts.length >= 2) {
          rawPts = sh.rawPts.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
        } else if (kind === "rect") {
          rawPts = makeRect(Number(sh.x0 ?? -1), Number(sh.y0 ?? -1), Number(sh.x1 ?? 1), Number(sh.y1 ?? 1), true);
        } else if (kind === "line") {
          rawPts = makeLine(Number(sh.x0 ?? -1), Number(sh.y0 ?? 0), Number(sh.x1 ?? 1), Number(sh.y1 ?? 0), 80);
          closed = Boolean(sh.closed);
        } else if (kind === "arc") {
          rawPts = makeArc(Number(sh.cx ?? 0), Number(sh.cy ?? 0), Math.max(0.05, Number(sh.r ?? 1)), Number(sh.a0 ?? 0), Number(sh.a1 ?? Math.PI), 84);
          closed = Boolean(sh.closed);
        } else {
          rawPts = makeCircle(Number(sh.cx ?? 0), Number(sh.cy ?? 0), Math.max(0.05, Number(sh.r ?? 1)), 72, true);
        }
      }
      state.shapes.push({
        id: state.nextShapeId++,
        kind,
        label: sh.label || kind,
        color: sh.color || PALETTE[state.colorIdx++ % PALETTE.length],
        lineWidth: Number(sh.lineWidth) || 2.2,
        lineStyle: sh.lineStyle || "solid",
        locked: Boolean(sh.locked),
        closed,
        visible: sh.visible !== undefined ? Boolean(sh.visible) : true,
        formula,
        rawPts,
        boundary: null,
        mesh: [],
        extraCurves: [],
      });
    }
  }

  function r4(n) {
    return Math.round((Number(n) || 0) * 10000) / 10000;
  }

  function viewRadius(view, canvas) {
    const dim = Math.min(canvas.clientWidth || 500, canvas.clientHeight || 500);
    return (dim * 0.45) / Math.max(view.scale || 1, 1e-4);
  }

  function downsamplePts(pts, maxN = 84) {
    if (!pts || pts.length <= maxN) return pts || [];
    const out = [];
    const last = pts.length - 1;
    for (let i = 0; i < maxN; i++) {
      const idx = Math.round((i * last) / (maxN - 1));
      out.push(pts[idx]);
    }
    return out;
  }

  function exportSnapshot() {
    const sp = window.RiemannSphere && window.RiemannSphere.state;
    const ordered = getOrderedElements();
    const shapeIdxById = new Map(state.shapes.map((s, i) => [s.id, i]));
    const pointIdxById = new Map(state.points.map((p, i) => [p.id, i]));
    const lineIdxById = new Map(state.lines.map((l, i) => [l.id, i]));
    const textIdxById = new Map(state.texts.map((t, i) => [t.id, i]));
    const layerRefs = ordered.map((e) => {
      if (e.kind === "shape") return `s:${shapeIdxById.get(e.id)}`;
      if (e.kind === "point") return `p:${pointIdxById.get(e.id)}`;
      if (e.kind === "text") return `t:${textIdxById.get(e.id)}`;
      return `l:${lineIdxById.get(e.id)}`;
    });
    const r12 = (v) => (Number.isFinite(v) ? Number(Number(v).toPrecision(12)) : 0);
    return {
      iv: [r12(state.inView.cx), r12(state.inView.cy), r12(viewRadius(state.inView, canvasIn))],
      ov: [r12(state.outView.cx), r12(state.outView.cy), r12(viewRadius(state.outView, canvasOut))],
      isq: state.inSquare ? 1 : 0,
      osq: state.outSquare ? 1 : 0,
      cm: state.contourMode ? 1 : 0,
      msh: state.showMesh ? 1 : 0,
      lmk: state.showLandmarks ? 1 : 0,
      cln: state.showCriticalLine ? 1 : 0,
      dwa: state.showDirichletWall ? 1 : 0,
      sph: state.projection === "sphere" || (sp && sp.enabled) ? 1 : 0,
      ...(state.inProjection && state.inProjection !== "planar" ? { iproj: state.inProjection } : {}),
      proj: state.projection || "planar",
      spv: sp ? [r4(sp.yaw), r4(sp.pitch), r4(sp.zoom)] : [-0.58, 0.22, 1.0],
      dom: state.showDomain ? 1 : 0,
      ...(state.showOutDomain ? { odom: 1, ...(state.outDomainMapping && state.outDomainMapping !== "stereo" ? { odm: state.outDomainMapping } : {}) } : {}),
      dscm: state.domainScheme || "classic",
      dop: r4(normOpacity(state.domainOpacity, 0.72)),
      lo: layerRefs,
      sh: state.shapes.map((s) => {
        const pts = downsamplePts(s.rawPts, 84);
        const flat = [];
        for (const pt of pts) flat.push(r4(pt.x), r4(pt.y));
        const rec = {
          k: s.kind,
          l: s.label || "",
          c: s.color || "#38bdf8",
          w: normLineWidth(s.lineWidth, 2.2),
          op: r4(normOpacity(s.opacity, s.closed ? 0.22 : 1.0)),
          ...(s.isOcean ? { oc: 1 } : {}),
          st: s.lineStyle || "solid",
          lk: s.locked ? 1 : 0,
          cl: s.closed ? 1 : 0,
          v: s.visible !== false ? 1 : 0,
          ...(s.collapsed ? { col: 1 } : {}),
          ...(Number(s.cardHeight) > 0 ? { ch: Math.round(Number(s.cardHeight)) } : {}),
          p: flat,
        };
        if (s.formula) rec.f = { ...s.formula };
        return rec;
      }),
      pt: state.points.map((p) => ({
        x: r4(p.x),
        y: r4(p.y),
        ...(p.xExpr ? { xe: p.xExpr } : {}),
        ...(p.yExpr ? { ye: p.yExpr } : {}),
        l: p.label || "",
        i: p.icon || "dot",
        c: p.color || "#34d399",
        s: Number(p.size) || 5,
        op: r4(normOpacity(p.opacity, 1.0)),
        lk: p.locked ? 1 : 0,
        v: p.visible !== false ? 1 : 0,
        sl: p.showLabel !== false ? 1 : 0,
        ...(p.collapsed ? { col: 1 } : {}),
        ...(Number(p.cardHeight) > 0 ? { ch: Math.round(Number(p.cardHeight)) } : {}),
      })),
      ln: state.lines.map((ln) => ({
        o: ln.orientation === "horizontal" ? "h" : "v",
        val: r4(ln.value),
        ...(ln.valExpr ? { ve: ln.valExpr } : {}),
        l: ln.label || "",
        c: ln.color || "#fbbf24",
        w: normLineWidth(ln.lineWidth, 1.5),
        op: r4(normOpacity(ln.opacity, 1.0)),
        st: ln.lineStyle || "dashed",
        lk: ln.locked ? 1 : 0,
        v: ln.visible !== false ? 1 : 0,
        sl: ln.showLabel !== false ? 1 : 0,
        ...(ln.collapsed ? { col: 1 } : {}),
        ...(Number(ln.cardHeight) > 0 ? { ch: Math.round(Number(ln.cardHeight)) } : {}),
      })),
      tx: state.texts.map((tb) => ({
        t: tb.title || "",
        b: tb.text || "",
        a: tb.anchor || "bottom-left",
        pl: tb.plane === "out" ? "out" : "in",
        x: r4(tb.x || 0),
        y: r4(tb.y || 0),
        ...(Number.isFinite(Number(tb.nx)) ? { nx: r4(Number(tb.nx)) } : {}),
        ...(Number.isFinite(Number(tb.ny)) ? { ny: r4(Number(tb.ny)) } : {}),
        ...(tb.xExpr ? { xe: tb.xExpr } : {}),
        ...(tb.yExpr ? { ye: tb.yExpr } : {}),
        c: tb.color || "#38bdf8",
        w: Number(tb.width) || 305,
        ...(Number(tb.height) > 0 ? { h: Math.round(Number(tb.height)) } : {}),
        fs: Number(tb.fontSize) || 12,
        op: r4(normOpacity(tb.opacity, 0.94)),
        lk: tb.locked ? 1 : 0,
        v: tb.visible !== false ? 1 : 0,
        ...(tb.collapsed ? { col: 1 } : {}),
        ...(Number(tb.cardHeight) > 0 ? { ch: Math.round(Number(tb.cardHeight)) } : {}),
      })),
    };
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

  function syncDomainControlsUI() {
    const domCb = document.getElementById("opt-domain");
    if (domCb) domCb.checked = Boolean(state.showDomain);
    const outDomCb = document.getElementById("opt-out-domain");
    if (outDomCb) outDomCb.checked = Boolean(state.showOutDomain);
    if (optDomainScheme) optDomainScheme.value = state.domainScheme || "classic";
    if (optDomainOpacity) optDomainOpacity.value = String(normOpacity(state.domainOpacity, 0.72));
    if (optDomainOpacityVal) optDomainOpacityVal.textContent = `${Math.round(normOpacity(state.domainOpacity, 0.72) * 100)}%`;
  }

  function setContourMode(enabled, opts = {}) {
    const on = Boolean(enabled);
    const changed = state.contourMode !== on || state.mode !== (on ? "integral" : "map");
    state.contourMode = on;
    state.mode = on ? "integral" : "map";
    if (inputTag) inputTag.textContent = on ? "CONTOUR PLANE" : "INPUT PLANE";
    if (inputSub) inputSub.textContent = on ? "γ(t) ⊂ ℂ" : "z = x + iy";
    if (outputTag) {
      outputTag.textContent = on ? "INTEGRAL PLANE" : "OUTPUT PLANE";
      outputTag.classList.toggle("integral-tag", on);
    }
    if (outputSub) outputSub.textContent = on ? "I(t) = ∫ f(z) dz" : "w = f(z)";
    if (btnToggleContour) {
      btnToggleContour.classList.toggle("active", on);
      btnToggleContour.setAttribute("aria-pressed", String(on));
    }
    if (optContourMode) optContourMode.checked = on;
    const fnLbl = document.getElementById("fn-tab-label");
    if (fnLbl && ws() && ws().state && ws().state.mode !== "real") {
      fnLbl.textContent = on ? "Integrand f(z) & Aux" : "Function w = f(z) & Aux";
    }
    updateIntegralPanel();
    if (!opts.silent && changed) {
      recomputeAll(1.0);
      notifyDomain();
      notifyState(true, true);
    } else {
      requestRender();
    }
  }

  if (btnToggleContour) {
    btnToggleContour.addEventListener("click", () => setContourMode(!state.contourMode));
  }
  if (optContourMode) {
    optContourMode.addEventListener("change", () => setContourMode(optContourMode.checked));
  }
  if (btnCloseIntegral) {
    btnCloseIntegral.addEventListener("click", (ev) => {
      ev.stopPropagation();
      setContourMode(false);
    });
  }
  if (btnIntegralAddCircle) {
    btnIntegralAddCircle.addEventListener("click", (ev) => {
      ev.stopPropagation();
      addQuickShape("circle");
    });
  }

  async function restoreSnapshot(snap) {
    if (!snap) return;
    state.foundZeros = [];
    ensureCanvasSize(canvasIn);
    ensureCanvasSize(canvasOut);
    setSquareAspect("in", snap.isq !== undefined ? Boolean(snap.isq) : true);
    setSquareAspect("out", snap.osq !== undefined ? Boolean(snap.osq) : true);
    if (snap.cm !== undefined) setContourMode(Boolean(snap.cm), { silent: true });
    if (snap.msh !== undefined) {
      state.showMesh = Boolean(snap.msh);
      const mCb = document.getElementById("opt-mesh");
      if (mCb) mCb.checked = state.showMesh;
    }
    if (snap.lmk !== undefined) {
      state.showLandmarks = Boolean(snap.lmk);
      const lCb = document.getElementById("opt-landmarks");
      if (lCb) lCb.checked = state.showLandmarks;
    }
    if (snap.cln !== undefined) state.showCriticalLine = Boolean(snap.cln);
    if (snap.dwa !== undefined) state.showDirichletWall = Boolean(snap.dwa);
    const projMode = snap.proj || (snap.sph ? "sphere" : "planar");
    if (window.RiemannSphere && Array.isArray(snap.spv) && snap.spv.length >= 3) {
      window.RiemannSphere.state.yaw = Number(snap.spv[0]) || 0;
      window.RiemannSphere.state.pitch = Number(snap.spv[1]) || 0;
      window.RiemannSphere.state.zoom = Math.max(0.45, Number(snap.spv[2]) || 1.0);
    }
    setInProjection(snap.iproj || "planar", { keepInView: true, keepSphereView: true, silent: true });
    setProjection(projMode, { keepOutView: true, keepSphereView: true, silent: true });

    state.showDomain = Boolean(snap.dom);
    state.showOutDomain = Boolean(snap.odom);
    state.outDomainMapping = snap.odm || "stereo";
    state.domainScheme = snap.dscm || "classic";
    state.domainOpacity = normOpacity(snap.dop, state.domainScheme === "classic" ? 0.72 : 1.0);
    state.domainImg = null;
    syncDomainControlsUI();

    if (Array.isArray(snap.iv) && snap.iv.length >= 3) {
      state.defaultInView = { cx: Number(snap.iv[0]), cy: Number(snap.iv[1]), r: Math.max(1e-13, Number(snap.iv[2])) };
      setView(state.inView, canvasIn, state.defaultInView.cx, state.defaultInView.cy, state.defaultInView.r);
    }
    if (Array.isArray(snap.ov) && snap.ov.length >= 3) {
      state.defaultOutView = { cx: Number(snap.ov[0]), cy: Number(snap.ov[1]), r: Math.max(1e-13, Number(snap.ov[2])) };
      setView(state.outView, canvasOut, state.defaultOutView.cx, state.defaultOutView.cy, state.defaultOutView.r);
    }
    state.points = (snap.pt || []).map((p) => ({
      id: state.nextPointId++,
      kind: "point",
      x: Number(p.x) || 0,
      y: Number(p.y) || 0,
      xExpr: p.xe ? String(p.xe) : "",
      yExpr: p.ye ? String(p.ye) : "",
      label: p.l || "",
      icon: p.i || "dot",
      color: p.c || "#34d399",
      size: Number(p.s) || 5,
      opacity: normOpacity(p.op, 1.0),
      locked: Boolean(p.lk),
      visible: p.v !== 0,
      showLabel: p.sl !== 0,
      collapsed: Boolean(p.col),
      cardHeight: Number(p.ch) > 0 ? Number(p.ch) : 0,
      outPt: null,
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
      plane: tb.pl === "out" ? "out" : "in",
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
    state.shapes = (snap.sh || []).map((sh) => {
      const rawPts = [];
      const flat = Array.isArray(sh.p) ? sh.p : [];
      for (let i = 0; i + 1 < flat.length; i += 2) {
        rawPts.push({ x: Number(flat[i]), y: Number(flat[i + 1]) });
      }
      return {
        id: state.nextShapeId++,
        kind: sh.k || "freehand",
        label: sh.l || "Shape",
        color: sh.c || "#38bdf8",
        lineWidth: normLineWidth(sh.w, 2.2),
        opacity: normOpacity(sh.op, sh.cl ? 0.22 : 1.0),
        isOcean: Boolean(sh.oc),
        lineStyle: sh.st || "solid",
        locked: Boolean(sh.lk),
        closed: Boolean(sh.cl),
        visible: sh.v !== 0,
        collapsed: Boolean(sh.col),
        cardHeight: Number(sh.ch) > 0 ? Number(sh.ch) : 0,
        formula: sh.f ? { ...sh.f } : null,
        rawPts,
        boundary: null,
        mesh: [],
        extraCurves: [],
      };
    });
    applyLayerRefs(snap.lo);
    state.selectedShapeId = null;
    state.selectedPointId = null;
    state.selectedLineId = null;
    await recomputeAll(1.0);
  }

  window.CFVComplex = {
    state,
    canvasIn,
    canvasOut,
    resize,
    requestRender,
    recomputeAll,
    isFetchBusy: () => Boolean(state.fetchBusy),
    isDomainBusy: () => Boolean(state.domainInFlight),
    recomputePoints,
    computeShape,
    updateIntegralPanel,
    scheduleDomain,
    fetchDomain,
    fetchTaylor,
    huntZeros,
    addQuickShape,
    addPoint,
    addGuideLine,
    addTextBox,
    addBundleShapes,
    deleteShape,
    deletePoint,
    deleteGuideLine,
    deleteTextBox,
    selectShape,
    selectPoint,
    selectGuideLine,
    selectTextBox,
    toggleCloseShape,
    reverseShape,
    joinConnectedShapes,
    isShapeSelected,
    isPointSelected,
    clearSelection,
    deleteSelectedItems,
    getGroupBox,
    getSelectionRotateInfo,
    pushUndoSnapshot,
    undoLastAction,
    updateSelectionBanner,
    rebuildFormulaShapes,
    rebuildShapeFromFormula,
    createDefaultFormulaForShape,
    evalParamExpr,
    findSnapTarget,
    setSquareAspect,
    setProjection,
    getOrderedElements,
    reorderElement,
    moveElementLayer,
    shouldShadeExterior,
    exportSnapshot,
    restoreSnapshot,
    fmtCompact,
    drawPointIcon,
    getViewBounds() {
      return {
        in_cx: state.inView.cx,
        in_cy: state.inView.cy,
        in_r: viewRadius(state.inView, canvasIn),
        out_cx: state.outView.cx,
        out_cy: state.outView.cy,
        out_r: viewRadius(state.outView, canvasOut),
      };
    },
    setViewportValues(vals) {
      if (!vals) return false;
      let changedIn = false;
      let changedOut = false;
      if (vals.in_cx !== undefined || vals.in_cy !== undefined || vals.in_r !== undefined) {
        const cx = vals.in_cx !== undefined && Number.isFinite(vals.in_cx) ? vals.in_cx : state.inView.cx;
        const cy = vals.in_cy !== undefined && Number.isFinite(vals.in_cy) ? vals.in_cy : state.inView.cy;
        const r = vals.in_r !== undefined && Number.isFinite(vals.in_r) ? Math.max(1e-13, vals.in_r) : viewRadius(state.inView, canvasIn);
        setView(state.inView, canvasIn, cx, cy, r, true);
        changedIn = true;
      }
      if (vals.out_cx !== undefined || vals.out_cy !== undefined || vals.out_r !== undefined) {
        const cx = vals.out_cx !== undefined && Number.isFinite(vals.out_cx) ? vals.out_cx : state.outView.cx;
        const cy = vals.out_cy !== undefined && Number.isFinite(vals.out_cy) ? vals.out_cy : state.outView.cy;
        const r = vals.out_r !== undefined && Number.isFinite(vals.out_r) ? Math.max(1e-13, vals.out_r) : viewRadius(state.outView, canvasOut);
        setView(state.outView, canvasOut, cx, cy, r, true);
        changedOut = true;
      }
      if (changedIn && state.showDomain) scheduleDomain(true);
      if (changedIn && changedOut) requestRender("both");
      else if (changedIn) requestRender("in");
      else if (changedOut) requestRender("out");
      return changedIn || changedOut;
    },
    setViewBounds(inV, outV) {
      if (inV) { state.defaultInView = { ...inV }; setView(state.inView, canvasIn, inV.cx, inV.cy, inV.r); }
      if (outV) { state.defaultOutView = { ...outV }; setView(state.outView, canvasOut, outV.cx, outV.cy, outV.r); }
    },
    setContourMode,
    setMode(mode) {
      setContourMode(mode === "integral", { silent: true });
    },
    async loadExampleAndPreset(ex, preset) {
      const pr = preset || (ex.presets && ex.presets[0]) || {};
      const wantContour = pr.contourMode !== undefined
        ? Boolean(pr.contourMode)
        : (ex.contourMode !== undefined ? Boolean(ex.contourMode) : ex.mode === "integral");
      setContourMode(wantContour, { silent: true });
      state.showMesh = pr.showMesh !== undefined ? Boolean(pr.showMesh) : (ex.showMesh !== undefined ? Boolean(ex.showMesh) : true);
      const meshCb = document.getElementById("opt-mesh");
      if (meshCb) meshCb.checked = state.showMesh;
      state.showCriticalLine = Boolean(pr.showCriticalLine !== undefined ? pr.showCriticalLine : ex.showCriticalLine);
      state.showDirichletWall = Boolean(pr.showDirichletWall !== undefined ? pr.showDirichletWall : ex.showDirichletWall);
      state.foundZeros = [];
      state.undoStack = [];

      const projMode = pr.projection || ex.defaultProjection || (pr.enableSphere ? "sphere" : "planar");
      if (window.RiemannSphere) {
        if (projMode === "sphere") window.RiemannSphere.reset();
        if (pr.sphereView) {
          if (Number.isFinite(pr.sphereView.yaw)) window.RiemannSphere.state.yaw = pr.sphereView.yaw;
          if (Number.isFinite(pr.sphereView.pitch)) window.RiemannSphere.state.pitch = pr.sphereView.pitch;
          if (Number.isFinite(pr.sphereView.zoom)) window.RiemannSphere.state.zoom = pr.sphereView.zoom;
        }
      }
      const inProjMode = pr.inProjection || ex.defaultInProjection || "planar";
      if (window.RiemannSphereIn) {
        if (inProjMode === "sphere" || inProjMode === "cylinder") window.RiemannSphereIn.reset();
        if (pr.inSphereView || pr.sphereView) {
          const isv = pr.inSphereView || pr.sphereView;
          if (Number.isFinite(isv.yaw)) window.RiemannSphereIn.state.yaw = isv.yaw;
          if (Number.isFinite(isv.pitch)) window.RiemannSphereIn.state.pitch = isv.pitch;
          if (Number.isFinite(isv.zoom)) window.RiemannSphereIn.state.zoom = isv.zoom;
        }
      }
      setInProjection(inProjMode, { keepInView: true, keepSphereView: true, silent: true });
      setProjection(projMode, { keepOutView: true, keepSphereView: true, silent: true });

      state.showDomain = Boolean(pr.showDomain !== undefined ? pr.showDomain : ex.showDomain);
      state.showOutDomain = Boolean(pr.showOutDomain !== undefined ? pr.showOutDomain : ex.showOutDomain);
      state.outDomainMapping = pr.outDomainMapping || ex.outDomainMapping || "stereo";
      state.domainScheme = pr.domainScheme || ex.domainScheme || "classic";
      state.domainOpacity = normOpacity(
        pr.domainOpacity !== undefined ? pr.domainOpacity : ex.domainOpacity,
        state.domainScheme === "classic" ? 0.72 : 1.0
      );
      /* Always clear stale cached domain texture on preset switch so Black-Hole / Earth never inherit previous preset's field! */
      state.domainImg = null;
      syncDomainControlsUI();

      ensureCanvasSize(canvasIn);
      ensureCanvasSize(canvasOut);
      setSquareAspect("in", pr.inSquare !== undefined ? Boolean(pr.inSquare) : true);
      setSquareAspect("out", pr.outSquare !== undefined ? Boolean(pr.outSquare) : true);
      state.defaultInView = pr.inView || { cx: 0, cy: 0, r: 4 };
      state.defaultOutView = pr.outView || { cx: 0, cy: 0, r: 4 };
      setView(state.inView, canvasIn, state.defaultInView.cx, state.defaultInView.cy, state.defaultInView.r);
      setView(state.outView, canvasOut, state.defaultOutView.cx, state.defaultOutView.cy, state.defaultOutView.r);

      const srcPts = pr.points || ex.defaultPoints || [];
      state.points = srcPts.map((pt) => ({
        id: state.nextPointId++,
        kind: "point",
        x: Number(pt.x) || 0,
        y: Number(pt.y) || 0,
        xExpr: pt.xExpr ? String(pt.xExpr) : "",
        yExpr: pt.yExpr ? String(pt.yExpr) : "",
        label: pt.label || "",
        icon: pt.icon || "ring",
        color: pt.color || "#34d399",
        size: pt.size || 5,
        opacity: normOpacity(pt.opacity, 1.0),
        locked: pt.locked !== undefined ? Boolean(pt.locked) : true,
        visible: pt.visible !== undefined ? Boolean(pt.visible) : true,
        showLabel: pt.showLabel !== undefined ? Boolean(pt.showLabel) : true,
        outPt: null,
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
        lineWidth: normLineWidth(ln.lineWidth, 1.5),
        opacity: normOpacity(ln.opacity, 1.0),
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
        plane: tb.plane === "out" ? "out" : "in",
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

      state.shapes = (pr.shapes || []).map((sh) => ({
        id: state.nextShapeId++,
        kind: sh.kind || (sh.formula && sh.formula.kind) || "circle",
        label: sh.label,
        color: sh.color || "#38bdf8",
        lineWidth: normLineWidth(sh.lineWidth, 2.2),
        opacity: normOpacity(sh.opacity, sh.closed !== false ? 0.22 : 1.0),
        isOcean: Boolean(sh.isOcean),
        lineStyle: sh.lineStyle || "solid",
        locked: Boolean(sh.locked),
        closed: Boolean(sh.closed),
        visible: sh.visible !== undefined ? Boolean(sh.visible) : true,
        collapsed: Boolean(sh.collapsed),
        cardHeight: Number(sh.cardHeight) > 0 ? Number(sh.cardHeight) : 0,
        formula: sh.formula ? { ...sh.formula } : null,
        rawPts: Array.isArray(sh.rawPts) ? sh.rawPts.map((p) => ({ ...p })) : [],
        boundary: null,
        mesh: [],
        extraCurves: [],
      }));
      state.layerOrder = [];
      syncLayerOrder();
      clearSelection();
      await recomputeAll(1.0);
    },
    clearToBlank() {
      state.shapes = [];
      state.points = [];
      state.lines = [];
      state.texts = [];
      state.selectedTextId = null;
      state.layerOrder = [];
      state.foundZeros = [];
      state.undoStack = [];
      clearSelection();
      setContourMode(false, { silent: true });
      state.showMesh = true;
      const mCbBlank = document.getElementById("opt-mesh");
      if (mCbBlank) mCbBlank.checked = true;
      state.showDomain = false;
      state.showOutDomain = false;
      state.outDomainMapping = "stereo";
      state.domainScheme = "classic";
      state.domainOpacity = 0.72;
      state.domainImg = null;
      syncDomainControlsUI();
      setInProjection("planar", { keepInView: true, silent: true });
      setProjection("planar", { keepOutView: true, silent: true });
      if (window.RiemannSphereIn) {
        window.RiemannSphereIn.state.enabled = false;
        window.RiemannSphereIn.reset();
      }
      if (window.RiemannSphere) {
        window.RiemannSphere.state.enabled = false;
        window.RiemannSphere.reset();
      }
      ensureCanvasSize(canvasIn);
      ensureCanvasSize(canvasOut);
      setSquareAspect("in", true);
      setSquareAspect("out", true);
      state.defaultInView = { cx: 0, cy: 0, r: 4.0 };
      state.defaultOutView = { cx: 0, cy: 0, r: 4.0 };
      setView(state.inView, canvasIn, 0, 0, 4.0);
      setView(state.outView, canvasOut, 0, 0, 4.0);
      updateIntegralPanel();
      notifyDomain();
      requestRender();
    },
    centerInputOn(x, y, r = 2.5) {
      setView(state.inView, canvasIn, x, y, r);
    },
  };
})();
