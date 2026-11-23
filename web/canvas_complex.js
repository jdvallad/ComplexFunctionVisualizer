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
    mode: "map", /* "map" | "integral" */
    tool: "freehand",
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
    showLandmarks: true,
    showCriticalLine: true,
    showDirichletWall: false,

    /* Desmos Domain Objects: Shapes (contours), Points & Landmark Lines (points & lines ignored for integrals!) */
    shapes: [],
    points: [],
    lines: [],
    nextShapeId: 1,
    nextPointId: 1,
    nextLineId: 1,
    selectedShapeId: null,
    selectedPointId: null,
    selectedLineId: null,
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
  const btnTracePlay = document.getElementById("btn-trace-play");

  const integralPanel = document.getElementById("integral-panel");
  const integralPanelHdr = document.getElementById("integral-panel-hdr");
  const integralResizeHandle = document.getElementById("integral-resize-handle");
  const btnMinIntegral = document.getElementById("btn-min-integral");
  const integralMinSum = document.getElementById("integral-min-sum");
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
    exp: Math.exp, log: Math.log, sqrt: Math.sqrt,
    abs: Math.abs, fabs: Math.abs, pow: Math.pow,
    min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil,
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
    for (const s of state.shapes) {
      if (!s.formula) continue;
      const res = evalShapeFormula(s.formula, paramMap);
      if (res && res.rawPts.length >= 2) {
        s.rawPts = res.rawPts;
        if (s.formula.kind !== "parametric") s.closed = res.closed;
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
    for (let i = 0; i < raw.in.length; i += 2) {
      inPts.push({ x: raw.in[i], y: raw.in[i + 1] });
      cumPts.push({ x: raw.cum[i], y: raw.cum[i + 1] });
    }
    return {
      inPts,
      cumPts,
      total: { x: raw.total[0], y: raw.total[1] },
      div2pii: { x: raw.div_2pii[0], y: raw.div_2pii[1] },
      arcLength: raw.arc_length,
      orientation: raw.orientation,
      singular: Boolean(raw.singular),
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
        max_in_step: Math.max(0.015, (inSpan / 110) * qScale),
        max_out_step: Math.max(0.015, (outSpan / 95) * qScale),
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

  async function computeShape(shape, qScale = 1.0) {
    const targets = visibleComplexTargets();
    if (targets.length === 0) {
      shape.integral = null;
      shape.boundary = { inPts: shape.rawPts, outPts: [] };
      shape.mesh = [];
      shape.extraCurves = [];
      return;
    }

    if (state.mode === "integral") {
      const data = await apiIntegrate(shape.rawPts, shape.closed, primaryFnPayload(), qScale);
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
    const pData = await apiTrace(shape.rawPts, shape.closed, wantMesh, primary.target, qScale);
    if (pData && state.shapes.includes(shape)) {
      shape.boundary = unpackCurve(pData.boundary);
      shape.mesh = wantMesh ? (pData.mesh || []).map(unpackCurve) : [];
      shape.winding = pData.winding;
      shape.primaryColor = targets.length > 1 ? primary.color : null;
    }

    const extras = [];
    for (let i = 1; i < targets.length; i++) {
      const t = targets[i];
      const d = await apiTrace(shape.rawPts, shape.closed, false, t.target, qScale * 1.1);
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

  async function recomputeAllOnce(qScale = 1.0, lightweight = false) {
    if (!state.active) return;
    rebuildFormulaShapes();
    await Promise.all([
      ...state.shapes.map((s) => computeShape(s, qScale)),
      recomputePoints(),
    ]);
    updateIntegralPanel();
    if (lightweight && ws() && typeof ws().syncShapeBadges === "function") {
      ws().syncShapeBadges();
    } else {
      notifyDomain();
    }
    if (state.showDomain) scheduleDomain();
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

  function setView(view, canvas, cx, cy, r) {
    const dim = Math.min(canvas.clientWidth || 500, canvas.clientHeight || 500);
    view.cx = cx;
    view.cy = cy;
    const s = (dim * 0.45) / Math.max(r, 1e-4);
    view.scale = s;
    view.scaleX = s;
    view.scaleY = s;
    if (view === state.inView && state.showDomain) scheduleDomain();
    requestRender();
  }

  function zoomAt(view, canvas, sx, sy, factorX, factorY = factorX) {
    const b = screenToWorld(view, canvas, sx, sy);
    view.scaleX = Math.min(1e6, Math.max(0.5, (view.scaleX || view.scale) * factorX));
    view.scaleY = Math.min(1e6, Math.max(0.5, (view.scaleY || view.scale) * factorY));
    view.scale = Math.sqrt(view.scaleX * view.scaleY);
    const a = screenToWorld(view, canvas, sx, sy);
    view.cx += b.x - a.x;
    view.cy += b.y - a.y;
    if (view === state.inView && state.showDomain) scheduleDomain();
    requestRender();
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
    if (isIn && state.showDomain) scheduleDomain();
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
    if (state.showDomain && okIn) scheduleDomain();
    requestRender();
  }

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (state.active) resize();
    });
    ro.observe(inCard);
    ro.observe(outCard);
  }

  function scheduleDomain() {
    if (!state.showDomain || !state.active) return;
    if (state.domainTimer) clearTimeout(state.domainTimer);
    state.domainTimer = setTimeout(fetchDomain, 90);
  }

  async function fetchDomain() {
    if (!state.showDomain || !state.active) return;
    const tgt = primaryFnPayload();
    if (!tgt) {
      state.domainImg = null;
      requestRender();
      return;
    }
    const reqId = ++state.domainReqId;
    const w = canvasIn.clientWidth, h = canvasIn.clientHeight;
    if (w < 20 || h < 20) return;
    const tw = Math.min(260, Math.max(96, Math.round(w * 0.34)));
    const th = Math.min(260, Math.max(96, Math.round(h * 0.34)));
    const halfW = (w * 0.5) / state.inView.scale;
    const halfH = (h * 0.5) / state.inView.scale;
    const cx = state.inView.cx, cy = state.inView.cy;
    const res = await fetch("/api/domain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...tgt, cx, cy, half_w: halfW, half_h: halfH, width: tw, height: th }),
    });
    if (!res.ok || reqId !== state.domainReqId) return;
    const buf = await res.arrayBuffer();
    if (reqId !== state.domainReqId) return;
    const off = document.createElement("canvas");
    off.width = tw; off.height = th;
    off.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(buf), tw, th), 0, 0);
    state.domainImg = { canvas: off, cx, cy, halfW, halfH };
    requestRender();
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
    if (shape.kind === "line") {
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
    for (let i = state.points.length - 1; i >= 0; i--) {
      const p = state.points[i];
      if (!p.visible) continue;
      const sp = worldToScreen(state.inView, canvasIn, p.x, p.y);
      const rad = Math.max(10, (p.size || 5) + 6);
      if (Math.hypot(sx - sp.x, sy - sp.y) <= rad) return p;
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
    const wpt = screenToWorld(state.inView, canvasIn, sx, sy);
    for (let i = state.shapes.length - 1; i >= 0; i--) {
      const s = state.shapes[i];
      if (!s.visible) continue;
      const pts = s.boundary && s.boundary.inPts.length >= 2 ? s.boundary.inPts : s.rawPts;
      const segs = s.closed ? pts.length : pts.length - 1;
      for (let k = 0; k < segs; k++) {
        const a = worldToScreen(state.inView, canvasIn, pts[k].x, pts[k].y);
        const b = worldToScreen(state.inView, canvasIn, pts[(k + 1) % pts.length].x, pts[(k + 1) % pts.length].y);
        if (distSegSq(sx, sy, a.x, a.y, b.x, b.y) <= 144) return s;
      }
      if (s.closed && s.rawPts.length >= 3 && ptInPoly(wpt.x, wpt.y, s.rawPts)) return s;
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
  function requestRender() {
    if (!state.active) return;
    if (!renderQueued) {
      renderQueued = true;
      requestAnimationFrame(renderFrame);
    }
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

    ctx.fillStyle = "#0a0e17";
    ctx.fillRect(0, 0, w, h);

    if (isInput && state.showDomain && state.domainImg) {
      const d = state.domainImg;
      const tl = worldToScreen(view, canvas, d.cx - d.halfW, d.cy + d.halfH);
      const br = worldToScreen(view, canvas, d.cx + d.halfW, d.cy - d.halfH);
      ctx.save();
      ctx.globalAlpha = 0.62;
      ctx.drawImage(d.canvas, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.restore();
    }

    const stepX = niceStep(78 / scX);
    const stepY = niceStep(78 / scY);
    ctx.strokeStyle = "rgba(148, 163, 184, 0.11)";
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

    /* Landmark Lines (Desmos-editable, strictly ignored in Integral mode!) */
    if (isInput && state.showLandmarks && state.lines.length > 0) {
      ctx.save();
      ctx.font = '600 10.5px "JetBrains Mono", monospace';
      for (const ln of state.lines) {
        if (!ln.visible) continue;
        const hi = ln.id === state.selectedLineId || ln.id === state.hoveredLineId;
        const lw = (Number(ln.lineWidth) || 1.5) + (hi ? 0.8 : 0);
        const col = ln.color || "#fbbf24";
        ctx.strokeStyle = hi ? "#ffffff" : hexToRgba(col, 0.78);
        ctx.lineWidth = lw;
        applyLineStyle(ctx, ln.lineStyle || "dashed");

        if (ln.orientation === "horizontal") {
          const sy = worldToScreen(view, canvas, 0, ln.value).y;
          if (sy >= -6 && sy <= h + 6) {
            ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
            if (ln.showLabel !== false && ln.label) {
              ctx.setLineDash([]);
              ctx.fillStyle = col;
              ctx.fillText(ln.label, 12, Math.max(54, sy - 6));
            }
          }
        } else {
          const sx = worldToScreen(view, canvas, ln.value, 0).x;
          if (sx >= -6 && sx <= w + 6) {
            ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
            if (ln.showLabel !== false && ln.label) {
              ctx.setLineDash([]);
              ctx.fillStyle = col;
              ctx.fillText(ln.label, sx + 6, 58);
            }
          }
        }
      }
      ctx.restore();
    }

    const origin = worldToScreen(view, canvas, 0, 0);
    ctx.strokeStyle = "rgba(203, 213, 225, 0.35)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    if (origin.y >= 0 && origin.y <= h) { ctx.moveTo(0, origin.y); ctx.lineTo(w, origin.y); }
    if (origin.x >= 0 && origin.x <= w) { ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, h); }
    ctx.stroke();

    if (!isInput && origin.x >= -20 && origin.x <= w + 20 && origin.y >= -20 && origin.y <= h + 20) {
      ctx.save();
      ctx.strokeStyle = "rgba(52, 211, 153, 0.45)";
      ctx.beginPath(); ctx.arc(origin.x, origin.y, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#34d399";
      ctx.beginPath(); ctx.arc(origin.x, origin.y, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = "rgba(148, 163, 184, 0.65)";
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

  function drawDomainPointsIn(ctx) {
    const w = canvasIn.clientWidth, h = canvasIn.clientHeight;
    ctx.save();
    ctx.font = '10.5px "JetBrains Mono", monospace';
    for (const p of state.points) {
      if (!p.visible) continue;
      const sp = worldToScreen(state.inView, canvasIn, p.x, p.y);
      if (sp.x < -36 || sp.x > w + 36 || sp.y < -36 || sp.y > h + 36) continue;
      const sel = isPointSelected(p.id) || p.id === state.hoveredPointId;
      drawPointIcon(ctx, sp.x, sp.y, p.icon || "dot", p.color || "#34d399", p.size || 5, sel);
      if (p.showLabel !== false && p.label) {
        ctx.fillStyle = p.color || "#e2e8f0";
        ctx.fillText(p.label, sp.x + (p.size || 5) + 6, sp.y + 3);
      }
    }
    ctx.restore();
  }

  function drawDomainPointsOut(ctx) {
    if (state.mode !== "map") return; /* Points are ignored in Integral mode! */
    const w = canvasOut.clientWidth, h = canvasOut.clientHeight;
    ctx.save();
    ctx.font = '10.5px "JetBrains Mono", monospace';
    for (const p of state.points) {
      /* Locked Landmarks stay strictly on the Input Plane (never clutter the Output Graph!) */
      if (!p.visible || p.locked || !p.outPt) continue;
      const sp = worldToScreen(state.outView, canvasOut, p.outPt.x, p.outPt.y);
      if (sp.x < -36 || sp.x > w + 36 || sp.y < -36 || sp.y > h + 36) continue;
      const sel = isPointSelected(p.id) || p.id === state.hoveredPointId;
      drawPointIcon(ctx, sp.x, sp.y, p.icon || "dot", p.color || "#34d399", p.size || 5, sel);
      if (p.showLabel !== false && p.label) {
        ctx.fillStyle = hexToRgba(p.color || "#e2e8f0", 0.95);
        ctx.fillText(p.label, sp.x + (p.size || 5) + 6, sp.y + 3);
      }
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
    const pts = s.boundary && s.boundary.inPts.length >= 2 ? s.boundary.inPts : s.rawPts;
    const hi = isShapeSelected(s.id) || s.id === state.hoveredShapeId;
    const lw = Number(s.lineWidth) || 2.2;

    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    if (s.closed) {
      ctx.beginPath(); tracePts(ctx, canvasIn, state.inView, pts, true);
      ctx.fillStyle = hexToRgba(s.color, state.mode === "integral" ? 0.11 : 0.15);
      ctx.fill("nonzero");
    }
    if (state.mode === "map" && s.closed && state.showMesh && s.mesh) {
      ctx.strokeStyle = hexToRgba(s.color, 0.24); ctx.lineWidth = 1;
      ctx.beginPath();
      for (const m of s.mesh) tracePts(ctx, canvasIn, state.inView, m.inPts, false);
      ctx.stroke();
    }

    applyLineStyle(ctx, s.lineStyle || "solid");
    ctx.beginPath(); tracePts(ctx, canvasIn, state.inView, pts, s.closed);
    ctx.strokeStyle = hexToRgba(s.color, hi ? 0.48 : 0.26); ctx.lineWidth = lw + (hi ? 6 : 4); ctx.stroke();
    ctx.beginPath(); tracePts(ctx, canvasIn, state.inView, pts, s.closed);
    ctx.strokeStyle = hi ? "#ffffff" : s.color; ctx.lineWidth = hi ? lw + 0.6 : lw; ctx.stroke();
    ctx.setLineDash([]);

    drawDirArrow(ctx, canvasIn, state.inView, pts, s.color, 0.28);
    if (state.mode === "integral" || s.closed) drawDirArrow(ctx, canvasIn, state.inView, pts, s.color, 0.72);

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

    /* Draw individual resize handles ONLY for a single selected unlocked shape (multi-select draws group handles) */
    if (s.id === state.selectedShapeId && !s.locked && getSelectedMovableItems().total < 2) {
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
    const pts = s.boundary.outPts;
    if (!pts || pts.length < 2) return;
    const col = s.primaryColor || s.color;
    const hi = isShapeSelected(s.id) || s.id === state.hoveredShapeId;
    const lw = Number(s.lineWidth) || 2.2;

    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (s.closed && pts.every((p) => p !== null)) {
      if (shouldShadeExterior(s, pts)) {
        drawExteriorShade(ctx, pts, col, 0.16);
      } else {
        ctx.beginPath(); tracePts(ctx, canvasOut, state.outView, pts, true);
        ctx.fillStyle = hexToRgba(col, 0.19); ctx.fill("nonzero");
      }
    }
    if (s.closed && state.showMesh && s.mesh) {
      ctx.strokeStyle = hexToRgba(col, 0.28); ctx.lineWidth = 1;
      ctx.beginPath();
      for (const m of s.mesh) tracePts(ctx, canvasOut, state.outView, m.outPts, false);
      ctx.stroke();
    }

    applyLineStyle(ctx, s.lineStyle || "solid");
    ctx.beginPath(); tracePts(ctx, canvasOut, state.outView, pts, s.closed);
    ctx.strokeStyle = hexToRgba(col, hi ? 0.48 : 0.26); ctx.lineWidth = lw + (hi ? 6 : 4); ctx.stroke();
    ctx.beginPath(); tracePts(ctx, canvasOut, state.outView, pts, s.closed);
    ctx.strokeStyle = hi ? "#ffffff" : col; ctx.lineWidth = hi ? lw + 0.6 : lw; ctx.stroke();
    ctx.setLineDash([]);

    for (const ex of s.extraCurves || []) {
      ctx.save();
      applyLineStyle(ctx, ex.lineStyle || "solid");
      ctx.beginPath(); tracePts(ctx, canvasOut, state.outView, ex.curve.outPts, s.closed);
      ctx.strokeStyle = ex.color; ctx.lineWidth = Number(ex.lineWidth) || 2.0; ctx.stroke();
      ctx.restore();
    }

    if (state.taylor.enabled && state.taylor.coeffs.length >= 2) {
      const tPts = s.boundary.inPts.map((p) => evalTaylor(p.x, p.y));
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
    const ig = s.integral;
    const pts = ig.cumPts;
    if (!pts || pts.length < 2) return;
    const hi = isShapeSelected(s.id) || s.id === state.hoveredShapeId;
    const lw = Number(s.lineWidth) || 2.0;

    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    applyLineStyle(ctx, s.lineStyle || "solid");
    ctx.beginPath(); tracePts(ctx, canvasOut, state.outView, pts, false);
    ctx.strokeStyle = hexToRgba(s.color, hi ? 0.98 : 0.78); ctx.lineWidth = hi ? lw + 0.6 : lw; ctx.stroke();
    ctx.setLineDash([]);
    drawDirArrow(ctx, canvasOut, state.outView, pts, s.color, 0.5);

    const oSp = worldToScreen(state.outView, canvasOut, 0, 0);
    const eSp = worldToScreen(state.outView, canvasOut, ig.total.x, ig.total.y);
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
    ctx.fillStyle = "rgba(10,14,23,0.9)"; ctx.strokeStyle = hexToRgba(s.color, 0.6); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(eSp.x + 8, eSp.y - 20, tw + 10, 18, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#ffffff"; ctx.fillText(tag, eSp.x + 13, eSp.y - 8);

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
    const okIn = ensureCanvasSize(canvasIn);
    const okOut = ensureCanvasSize(canvasOut);
    if (!okIn && !okOut) return;
    const dpr = window.devicePixelRatio || 1;
    if (state.playing) {
      if (state.lastFrameTs > 0) state.playPhase = (state.playPhase + Math.min(0.05, (ts - state.lastFrameTs) / 1000) * 0.22) % 1.0;
      state.lastFrameTs = ts;
    } else state.lastFrameTs = 0;

    if (okIn) {
    ctxIn.save();
    ctxIn.scale(dpr, dpr);
    drawGrid(ctxIn, canvasIn, state.inView, true);
    drawInputOverlays(ctxIn);
    for (const s of state.shapes) drawShapeIn(ctxIn, s);
    drawDomainPointsIn(ctxIn);

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
    if (state.probe.active && state.probe.z) {
      const sp = worldToScreen(state.inView, canvasIn, state.probe.z.x, state.probe.z.y);
      ctxIn.fillStyle = "#fff"; ctxIn.strokeStyle = "#38bdf8"; ctxIn.lineWidth = 2;
      ctxIn.beginPath(); ctxIn.arc(sp.x, sp.y, 4, 0, Math.PI * 2); ctxIn.fill(); ctxIn.stroke();
    }
    ctxIn.restore();
    }

    if (okOut) {
    ctxOut.save();
    ctxOut.scale(dpr, dpr);
    if (window.RiemannSphere && window.RiemannSphere.state.enabled) {
      window.RiemannSphere.render(ctxOut, canvasOut, state.shapes, {
        mode: state.mode,
        showMesh: state.showMesh,
        getPts: (s) => (state.mode === "integral" ? (s.integral ? s.integral.cumPts : null) : s.boundary ? s.boundary.outPts : null),
        selectedShapeId: state.selectedShapeId,
        hoveredShapeId: state.hoveredShapeId,
        playPhase: state.playPhase,
        playing: state.playing,
        probe: state.mode === "map" ? state.probe : null,
        points: state.points,
      });
    } else {
      drawGrid(ctxOut, canvasOut, state.outView, false);
      if (state.mode === "integral") {
        for (const s of state.shapes) drawShapeIntegralOut(ctxOut, s);
      } else {
        for (const s of state.shapes) drawShapeMapOut(ctxOut, s);
        drawDomainPointsOut(ctxOut);
        if (state.drawing && state.drawing.liveOut && state.drawing.liveOut.length >= 2) {
          ctxOut.save(); ctxOut.strokeStyle = state.drawing.color; ctxOut.lineWidth = 2.1;
          ctxOut.beginPath(); tracePts(ctxOut, canvasOut, state.outView, state.drawing.liveOut, state.drawing.closed || state.drawing.snapActive);
          ctxOut.stroke(); ctxOut.restore();
        }
      }
      if (state.mode === "map" && state.probe.active && state.probe.w) {
        const sp = worldToScreen(state.outView, canvasOut, state.probe.w.x, state.probe.w.y);
        ctxOut.fillStyle = "#fff"; ctxOut.strokeStyle = "#a78bfa"; ctxOut.lineWidth = 2;
        ctxOut.beginPath(); ctxOut.arc(sp.x, sp.y, 4, 0, Math.PI * 2); ctxOut.fill(); ctxOut.stroke();
      }
    }
    ctxOut.restore();
    }

    if (state.playing) requestRender();
  }

  /* -------------------------------------------------------------------------
   * Multi-Contour Integral Results Panel (One Row Per Contour, Points Ignored!)
   * ------------------------------------------------------------------------- */

  function updateIntegralPanel() {
    if (!integralPanel) return;
    if (state.mode !== "integral") {
      integralPanel.classList.add("hidden");
      return;
    }
    integralPanel.classList.remove("hidden");
    integralRows.innerHTML = "";

    /* Strictly filter shapes/contours only — points are NEVER included! */
    const vis = state.shapes.filter((s) => s.visible && s.integral);
    if (vis.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "font-size:11.5px;color:#64748b;padding:4px 2px;";
      empty.textContent = "Draw or add a contour (open or closed) on the left plane.";
      integralRows.appendChild(empty);
      integralSumRow.classList.add("hidden");
      return;
    }

    let sumRe = 0, sumIm = 0, validCount = 0;
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
      orient.className = "integral-row-orient";
      orient.textContent = s.closed ? (ig.orientation > 0 ? "CCW ↺" : "CW ↻") : "Open path";
      top.appendChild(orient);
      row.appendChild(top);

      const vals = document.createElement("div");
      vals.className = "integral-row-vals";
      const sym = s.closed ? "∮" : "∫";
      const main = document.createElement("span");
      main.className = "integral-row-main";
      main.textContent = ig.singular ? `${sym} = Pole on contour` : `${sym} = ${fmtComplex(ig.total.x, ig.total.y, 5)}`;
      vals.appendChild(main);

      const right = document.createElement("span");
      right.className = "integral-row-res";
      if (ig.singular) {
        right.style.color = "#fb7185";
        right.textContent = "singular";
      } else if (s.closed) {
        right.textContent = `÷2πi = ${fmtCompact(ig.div2pii.x, ig.div2pii.y)}`;
      } else {
        right.style.color = "#94a3b8";
        right.textContent = `|I|=${Math.hypot(ig.total.x, ig.total.y).toFixed(3)} · L=${ig.arcLength.toFixed(2)}`;
      }
      vals.appendChild(right);
      row.appendChild(vals);

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
      }
    }

    if (vis.length > 1 && validCount > 0) {
      integralSumRow.classList.remove("hidden");
      integralSumVal.textContent = fmtComplex(sumRe, sumIm, 5);
    } else {
      integralSumRow.classList.add("hidden");
    }
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
      if (e.target && e.target.closest && e.target.closest("#btn-min-integral")) return;
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

  canvasIn.addEventListener("pointerdown", (e) => {
    canvasIn.setPointerCapture(e.pointerId);
    const pos = localPos(canvasIn, e);
    if (e.button === 1 || e.button === 2 || state.spaceHeld || state.tool === "pan") {
      state.pan = { which: "in", startX: pos.x, startY: pos.y, origCx: state.inView.cx, origCy: state.inView.cy };
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
    const snapStart = (state.tool === "line" || state.tool === "freehand" || state.tool === "polygon")
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
      color: col, snapActive: false, anchor: zStart,
    };
    if (state.tool === "freehand") state.drawing.rawPts = [zStart];
    requestRender();
  });

  canvasIn.addEventListener("pointermove", (e) => {
    const pos = localPos(canvasIn, e);
    if (state.pan && state.pan.which === "in") {
      state.inView.cx = state.pan.origCx - (pos.x - state.pan.startX) / (state.inView.scaleX || state.inView.scale);
      state.inView.cy = state.pan.origCy + (pos.y - state.pan.startY) / (state.inView.scaleY || state.inView.scale);
      if (state.showDomain) scheduleDomain();
      requestRender();
      return;
    }
    const z = screenToWorld(state.inView, canvasIn, pos.x, pos.y);
    updateProbe(z);

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
          s.rawPts = makeCircle(drag.origBox.cx, drag.origBox.cy, Math.max(0.02, Math.hypot(z.x - drag.origBox.cx, z.y - drag.origBox.cy)), drag.origRawPts.length, drag.origCcw);
        } else if (h.shapeKind === "rect") {
          let { xmin, xmax, ymin, ymax } = drag.origBox;
          if (h.id.includes("w")) xmin = z.x;
          if (h.id.includes("e")) xmax = z.x;
          if (h.id.includes("s")) ymin = z.y;
          if (h.id.includes("n")) ymax = z.y;
          s.rawPts = makeRect(xmin, ymin, xmax, ymax, drag.origCcw);
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
          const sx = (z.x - ax) / ((h.id.includes("w") ? b.xmin - ax : b.xmax - ax) || 1);
          const sy = (z.y - ay) / ((h.id.includes("s") ? b.ymin - ay : b.ymax - ay) || 1);
          s.rawPts = drag.origRawPts.map((p) => ({ x: ax + (p.x - ax) * sx, y: ay + (p.y - ay) * sy }));
        }
        if (s.boundary) s.boundary.inPts = s.rawPts.map((p) => ({ ...p }));
      }
      flushDrag(drag);
      requestRender();
      return;
    }

    if (state.tool === "move" || e.altKey) {
      if (hitRotateHandle(pos.x, pos.y)) { canvasIn.style.cursor = "grab"; return; }
      const ghHit = hitGroupHandle(pos.x, pos.y);
      if (ghHit) { canvasIn.style.cursor = ghHit.handle.cursor; return; }
      const hHit = hitResizeHandle(pos.x, pos.y);
      if (hHit) { canvasIn.style.cursor = hHit.handle.cursor; return; }
      canvasIn.style.cursor = "";
      const pHit = hitPoint(pos.x, pos.y);
      const sHit = pHit ? null : hitShape(pos.x, pos.y);
      const npid = pHit ? pHit.id : null;
      const nsid = sHit ? sHit.id : null;
      if (state.hoveredPointId !== npid || state.hoveredShapeId !== nsid) {
        state.hoveredPointId = npid;
        state.hoveredShapeId = nsid;
        const canDrag = (pHit && !pHit.locked) || (sHit && !sHit.locked) || hitGroupBox(pos.x, pos.y);
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
    } else if (d.kind === "line") {
      const sn = findSnapTarget(pos.x, pos.y);
      state.snapHint = sn;
      const tz = sn ? { x: sn.x, y: sn.y } : z;
      d.rawPts = makeLine(d.anchor.x, d.anchor.y, tz.x, tz.y, 48);
    }
    else if (d.kind === "circle") d.rawPts = makeCircle(d.anchor.x, d.anchor.y, Math.max(1e-4, Math.hypot(z.x - d.anchor.x, z.y - d.anchor.y)));
    else if (d.kind === "rect") d.rawPts = makeRect(d.anchor.x, d.anchor.y, z.x, z.y);
    refreshLiveDraft();
    requestRender();
  });

  canvasIn.addEventListener("pointerup", async () => {
    state.snapHint = null;
    if (state.taylor.draggingZ0) { state.taylor.draggingZ0 = false; fetchTaylor(); return; }
    if (state.pan && state.pan.which === "in") { state.pan = null; inCard.classList.remove("panning"); notifyState(false, false); return; }
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
    if (d.rawPts.length >= 2) {
      pushUndoSnapshot();
      const closed = d.closed || d.snapActive;
      state.colorIdx = (state.colorIdx + 1) % PALETTE.length;
      const shape = {
        id: state.nextShapeId++,
        kind: d.kind,
        label: closed ? (d.kind === "freehand" ? "Closed Loop" : d.kind[0].toUpperCase() + d.kind.slice(1)) : "Open Path",
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
  canvasIn.addEventListener("pointerleave", () => { state.probe.active = false; state.snapHint = null; requestRender(); });
  canvasIn.addEventListener("wheel", (e) => {
    e.preventDefault();
    const pos = localPos(canvasIn, e);
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    if (state.inSquare) {
      zoomAt(state.inView, canvasIn, pos.x, pos.y, f, f);
    } else {
      zoomAt(state.inView, canvasIn, pos.x, pos.y, e.altKey ? 1 : f, e.shiftKey ? 1 : f);
    }
    notifyState(false, false);
  }, { passive: false });

  /* Output canvas pan / zoom / 3D sphere orbit */
  canvasOut.addEventListener("pointerdown", (e) => {
    canvasOut.setPointerCapture(e.pointerId);
    const pos = localPos(canvasOut, e);
    if (window.RiemannSphere && window.RiemannSphere.state.enabled) {
      window.RiemannSphere.onPointerDown(pos.x, pos.y);
      outCard.classList.add("panning"); return;
    }
    state.pan = { which: "out", startX: pos.x, startY: pos.y, origCx: state.outView.cx, origCy: state.outView.cy };
    outCard.classList.add("panning");
  });
  canvasOut.addEventListener("pointermove", (e) => {
    const pos = localPos(canvasOut, e);
    if (window.RiemannSphere && window.RiemannSphere.state.enabled) {
      if (window.RiemannSphere.onPointerMove(pos.x, pos.y)) requestRender();
      return;
    }
    if (!state.pan || state.pan.which !== "out") return;
    state.outView.cx = state.pan.origCx - (pos.x - state.pan.startX) / (state.outView.scaleX || state.outView.scale);
    state.outView.cy = state.pan.origCy + (pos.y - state.pan.startY) / (state.outView.scaleY || state.outView.scale);
    requestRender();
  });
  canvasOut.addEventListener("pointerup", () => {
    if (window.RiemannSphere && window.RiemannSphere.state.enabled) { window.RiemannSphere.onPointerUp(); outCard.classList.remove("panning"); return; }
    state.pan = null; outCard.classList.remove("panning"); notifyState(false, false);
  });
  canvasOut.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (window.RiemannSphere && window.RiemannSphere.state.enabled) { window.RiemannSphere.onWheel(e.deltaY); requestRender(); return; }
    const pos = localPos(canvasOut, e);
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    if (state.outSquare) {
      zoomAt(state.outView, canvasOut, pos.x, pos.y, f, f);
    } else {
      zoomAt(state.outView, canvasOut, pos.x, pos.y, e.altKey ? 1 : f, e.shiftKey ? 1 : f);
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

  btnToggleSphere.addEventListener("click", () => {
    if (!window.RiemannSphere) return;
    const on = !window.RiemannSphere.state.enabled;
    window.RiemannSphere.state.enabled = on;
    btnToggleSphere.classList.toggle("active", on);
    btnToggleSphere.textContent = on ? "2D Plane" : "3D Sphere";
    outputTag.textContent = on ? "RIEMANN SPHERE" : state.mode === "integral" ? "INTEGRAL PLANE" : "OUTPUT PLANE";
    ensureCanvasSize(canvasOut);
    requestRender();
  });

  const btnInSquare = document.getElementById("in-square");
  if (btnInSquare) btnInSquare.addEventListener("click", () => setSquareAspect("in", !state.inSquare));
  const btnOutSquare = document.getElementById("out-square");
  if (btnOutSquare) btnOutSquare.addEventListener("click", () => setSquareAspect("out", !state.outSquare));

  document.getElementById("in-zoom-in").addEventListener("click", () => zoomAt(state.inView, canvasIn, canvasIn.clientWidth * 0.5, canvasIn.clientHeight * 0.5, 1.35));
  document.getElementById("in-zoom-out").addEventListener("click", () => zoomAt(state.inView, canvasIn, canvasIn.clientWidth * 0.5, canvasIn.clientHeight * 0.5, 1 / 1.35));
  document.getElementById("in-reset").addEventListener("click", () => setView(state.inView, canvasIn, state.defaultInView.cx, state.defaultInView.cy, state.defaultInView.r));
  document.getElementById("out-autofit").addEventListener("click", () => {
    if (window.RiemannSphere && window.RiemannSphere.state.enabled) {
      window.RiemannSphere.focusOnShapes(state.shapes, (s) =>
        state.mode === "integral" ? (s.integral ? s.integral.cumPts : null) : s.boundary ? s.boundary.outPts : null
      );
      requestRender();
      return;
    }
    autoFitOutput();
  });
  document.getElementById("out-zoom-in").addEventListener("click", () => {
    if (window.RiemannSphere && window.RiemannSphere.state.enabled) {
      window.RiemannSphere.zoomBy(1.22);
      requestRender();
      return;
    }
    zoomAt(state.outView, canvasOut, canvasOut.clientWidth * 0.5, canvasOut.clientHeight * 0.5, 1.35);
  });
  document.getElementById("out-zoom-out").addEventListener("click", () => {
    if (window.RiemannSphere && window.RiemannSphere.state.enabled) {
      window.RiemannSphere.zoomBy(1 / 1.22);
      requestRender();
      return;
    }
    zoomAt(state.outView, canvasOut, canvasOut.clientWidth * 0.5, canvasOut.clientHeight * 0.5, 1 / 1.35);
  });
  document.getElementById("out-reset").addEventListener("click", () => {
    if (window.RiemannSphere && window.RiemannSphere.state.enabled) { window.RiemannSphere.reset(); requestRender(); return; }
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
    return {
      iv: [r4(state.inView.cx), r4(state.inView.cy), r4(viewRadius(state.inView, canvasIn))],
      ov: [r4(state.outView.cx), r4(state.outView.cy), r4(viewRadius(state.outView, canvasOut))],
      isq: state.inSquare ? 1 : 0,
      osq: state.outSquare ? 1 : 0,
      sph: sp && sp.enabled ? 1 : 0,
      spv: sp ? [r4(sp.yaw), r4(sp.pitch), r4(sp.zoom)] : [-0.58, 0.22, 1.0],
      sh: state.shapes.map((s) => {
        const pts = downsamplePts(s.rawPts, 84);
        const flat = [];
        for (const pt of pts) flat.push(r4(pt.x), r4(pt.y));
        const rec = {
          k: s.kind,
          l: s.label || "",
          c: s.color || "#38bdf8",
          w: Number(s.lineWidth) || 2.2,
          st: s.lineStyle || "solid",
          lk: s.locked ? 1 : 0,
          cl: s.closed ? 1 : 0,
          v: s.visible !== false ? 1 : 0,
          p: flat,
        };
        if (s.formula) rec.f = { ...s.formula };
        return rec;
      }),
      pt: state.points.map((p) => ({
        x: r4(p.x),
        y: r4(p.y),
        l: p.label || "",
        i: p.icon || "dot",
        c: p.color || "#34d399",
        s: Number(p.size) || 5,
        lk: p.locked ? 1 : 0,
        v: p.visible !== false ? 1 : 0,
        sl: p.showLabel !== false ? 1 : 0,
      })),
      ln: state.lines.map((ln) => ({
        o: ln.orientation === "horizontal" ? "h" : "v",
        val: r4(ln.value),
        l: ln.label || "",
        c: ln.color || "#fbbf24",
        w: Number(ln.lineWidth) || 1.5,
        st: ln.lineStyle || "dashed",
        lk: ln.locked ? 1 : 0,
        v: ln.visible !== false ? 1 : 0,
        sl: ln.showLabel !== false ? 1 : 0,
      })),
    };
  }

  async function restoreSnapshot(snap) {
    if (!snap) return;
    state.foundZeros = [];
    ensureCanvasSize(canvasIn);
    ensureCanvasSize(canvasOut);
    setSquareAspect("in", snap.isq !== undefined ? Boolean(snap.isq) : true);
    setSquareAspect("out", snap.osq !== undefined ? Boolean(snap.osq) : true);
    if (window.RiemannSphere) {
      const on = Boolean(snap.sph);
      window.RiemannSphere.state.enabled = on;
      if (Array.isArray(snap.spv) && snap.spv.length >= 3) {
        window.RiemannSphere.state.yaw = Number(snap.spv[0]) || 0;
        window.RiemannSphere.state.pitch = Number(snap.spv[1]) || 0;
        window.RiemannSphere.state.zoom = Math.max(0.45, Number(snap.spv[2]) || 1.0);
      }
      if (btnToggleSphere) {
        btnToggleSphere.classList.toggle("active", on);
        btnToggleSphere.textContent = on ? "2D Plane" : "3D Sphere";
      }
      if (outputTag) {
        outputTag.textContent = on ? "RIEMANN SPHERE" : state.mode === "integral" ? "INTEGRAL PLANE" : "OUTPUT PLANE";
      }
    }
    if (Array.isArray(snap.iv) && snap.iv.length >= 3) {
      state.defaultInView = { cx: Number(snap.iv[0]), cy: Number(snap.iv[1]), r: Math.max(0.01, Number(snap.iv[2])) };
      setView(state.inView, canvasIn, state.defaultInView.cx, state.defaultInView.cy, state.defaultInView.r);
    }
    if (Array.isArray(snap.ov) && snap.ov.length >= 3) {
      state.defaultOutView = { cx: Number(snap.ov[0]), cy: Number(snap.ov[1]), r: Math.max(0.01, Number(snap.ov[2])) };
      setView(state.outView, canvasOut, state.defaultOutView.cx, state.defaultOutView.cy, state.defaultOutView.r);
    }
    state.points = (snap.pt || []).map((p) => ({
      id: state.nextPointId++,
      kind: "point",
      x: Number(p.x) || 0,
      y: Number(p.y) || 0,
      label: p.l || "",
      icon: p.i || "dot",
      color: p.c || "#34d399",
      size: Number(p.s) || 5,
      locked: Boolean(p.lk),
      visible: p.v !== 0,
      showLabel: p.sl !== 0,
      outPt: null,
    }));
    state.lines = (snap.ln || []).map((ln) => ({
      id: state.nextLineId++,
      kind: "guide_line",
      orientation: ln.o === "h" ? "horizontal" : "vertical",
      value: Number(ln.val) || 0,
      label: ln.l || "",
      color: ln.c || "#fbbf24",
      lineWidth: Number(ln.w) || 1.5,
      lineStyle: ln.st || "dashed",
      locked: Boolean(ln.lk),
      visible: ln.v !== 0,
      showLabel: ln.sl !== 0,
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
        lineWidth: Number(sh.w) || 2.2,
        lineStyle: sh.st || "solid",
        locked: Boolean(sh.lk),
        closed: Boolean(sh.cl),
        visible: sh.v !== 0,
        formula: sh.f ? { ...sh.f } : null,
        rawPts,
        boundary: null,
        mesh: [],
        extraCurves: [],
      };
    });
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
    recomputePoints,
    computeShape,
    updateIntegralPanel,
    fetchDomain,
    fetchTaylor,
    huntZeros,
    addQuickShape,
    addPoint,
    addGuideLine,
    addBundleShapes,
    deleteShape,
    deletePoint,
    deleteGuideLine,
    selectShape,
    selectPoint,
    selectGuideLine,
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
      let changed = false;
      if (vals.in_cx !== undefined || vals.in_cy !== undefined || vals.in_r !== undefined) {
        const cx = vals.in_cx !== undefined && Number.isFinite(vals.in_cx) ? vals.in_cx : state.inView.cx;
        const cy = vals.in_cy !== undefined && Number.isFinite(vals.in_cy) ? vals.in_cy : state.inView.cy;
        const r = vals.in_r !== undefined && Number.isFinite(vals.in_r) ? Math.max(0.05, vals.in_r) : viewRadius(state.inView, canvasIn);
        setView(state.inView, canvasIn, cx, cy, r);
        changed = true;
      }
      if (vals.out_cx !== undefined || vals.out_cy !== undefined || vals.out_r !== undefined) {
        const cx = vals.out_cx !== undefined && Number.isFinite(vals.out_cx) ? vals.out_cx : state.outView.cx;
        const cy = vals.out_cy !== undefined && Number.isFinite(vals.out_cy) ? vals.out_cy : state.outView.cy;
        const r = vals.out_r !== undefined && Number.isFinite(vals.out_r) ? Math.max(0.05, vals.out_r) : viewRadius(state.outView, canvasOut);
        setView(state.outView, canvasOut, cx, cy, r);
        changed = true;
      }
      return changed;
    },
    setViewBounds(inV, outV) {
      if (inV) { state.defaultInView = { ...inV }; setView(state.inView, canvasIn, inV.cx, inV.cy, inV.r); }
      if (outV) { state.defaultOutView = { ...outV }; setView(state.outView, canvasOut, outV.cx, outV.cy, outV.r); }
    },
    setMode(mode) {
      state.mode = mode;
      inputTag.textContent = mode === "integral" ? "CONTOUR PLANE" : "INPUT PLANE";
      inputSub.textContent = mode === "integral" ? "γ(t) ⊂ ℂ" : "z = x + iy";
      outputTag.textContent = mode === "integral" ? "INTEGRAL PLANE" : "OUTPUT PLANE";
      outputTag.classList.toggle("integral-tag", mode === "integral");
      outputSub.textContent = mode === "integral" ? "I(t) = ∫ f(z) dz" : "w = f(z)";
      updateIntegralPanel();
      requestRender();
    },
    async loadExampleAndPreset(ex, preset) {
      const pr = preset || (ex.presets && ex.presets[0]) || {};
      state.showCriticalLine = Boolean(ex.showCriticalLine);
      state.showDirichletWall = Boolean(ex.showDirichletWall);
      state.foundZeros = [];
      state.undoStack = [];

      if (window.RiemannSphere) {
        const on = Boolean(pr.enableSphere);
        window.RiemannSphere.state.enabled = on;
        if (on) window.RiemannSphere.reset();
        if (pr.sphereView) {
          if (Number.isFinite(pr.sphereView.yaw)) window.RiemannSphere.state.yaw = pr.sphereView.yaw;
          if (Number.isFinite(pr.sphereView.pitch)) window.RiemannSphere.state.pitch = pr.sphereView.pitch;
          if (Number.isFinite(pr.sphereView.zoom)) window.RiemannSphere.state.zoom = pr.sphereView.zoom;
        }
        btnToggleSphere.classList.toggle("active", on);
        btnToggleSphere.textContent = on ? "2D Plane" : "3D Sphere";
        outputTag.textContent = on ? "RIEMANN SPHERE" : state.mode === "integral" ? "INTEGRAL PLANE" : "OUTPUT PLANE";
      }

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
        x: pt.x,
        y: pt.y,
        label: pt.label || "",
        icon: pt.icon || "ring",
        color: pt.color || "#34d399",
        size: pt.size || 5,
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
        label: ln.label || "",
        color: ln.color || "#fbbf24",
        lineWidth: Number(ln.lineWidth) || 1.5,
        lineStyle: ln.lineStyle || "dashed",
        locked: ln.locked !== undefined ? Boolean(ln.locked) : true,
        visible: ln.visible !== undefined ? Boolean(ln.visible) : true,
        showLabel: ln.showLabel !== undefined ? Boolean(ln.showLabel) : true,
      }));

      state.shapes = (pr.shapes || []).map((sh) => ({
        id: state.nextShapeId++,
        kind: sh.kind || (sh.formula && sh.formula.kind) || "circle",
        label: sh.label,
        color: sh.color || "#38bdf8",
        lineWidth: sh.lineWidth || 2.2,
        lineStyle: sh.lineStyle || "solid",
        locked: Boolean(sh.locked),
        closed: Boolean(sh.closed),
        visible: sh.visible !== undefined ? Boolean(sh.visible) : true,
        formula: sh.formula ? { ...sh.formula } : null,
        rawPts: Array.isArray(sh.rawPts) ? sh.rawPts.map((p) => ({ ...p })) : [],
        boundary: null,
        mesh: [],
        extraCurves: [],
      }));
      clearSelection();
      await recomputeAll(1.0);
    },
    clearToBlank() {
      state.shapes = [];
      state.points = [];
      state.lines = [];
      state.foundZeros = [];
      state.undoStack = [];
      clearSelection();
      state.domainImg = null;
      if (window.RiemannSphere) {
        window.RiemannSphere.state.enabled = false;
        window.RiemannSphere.reset();
        if (btnToggleSphere) {
          btnToggleSphere.classList.remove("active");
          btnToggleSphere.textContent = "3D Sphere";
        }
        if (outputTag) {
          outputTag.textContent = state.mode === "integral" ? "INTEGRAL PLANE" : "OUTPUT PLANE";
        }
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
