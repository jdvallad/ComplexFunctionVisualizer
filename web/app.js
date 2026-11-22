(() => {
  "use strict";

  const PALETTE = [
    "#38bdf8", /* Cyan */
    "#a78bfa", /* Violet */
    "#34d399", /* Emerald */
    "#fbbf24", /* Amber */
    "#fb7185", /* Rose */
    "#fb923c", /* Orange */
  ];

  const SNAP_PX = 16;
  const HANDLE_HIT_PX = 11;

  const initialDim =
    window.location.pathname === "/real" ||
    new URLSearchParams(window.location.search).get("dim") === "real"
      ? "real"
      : "complex";

  const initialMode =
    window.location.pathname === "/integral" ||
    new URLSearchParams(window.location.search).get("mode") === "integral"
      ? "integral"
      : "map";

  const state = {
    dim: initialDim,   /* "complex" | "real" */
    mode: initialMode, /* "map" | "integral" */
    functions: [],
    fnIndex: 0,
    tool: "freehand",
    colorIndex: 0,
    showMesh: true,
    showDomain: false,
    showLandmarks: true,
    playing: false,
    playPhase: 0,
    lastFrameTime: 0,

    inView: { cx: 0.5, cy: 14.0, scale: 36 },
    outView: { cx: 0.5, cy: 0.0, scale: 85 },

    /*
     * Shape structure:
     * { id, kind, label, color, closed, visible, rawPts,
     *   boundary, mesh, winding,
     *   integral: { inPts, cumPts, total, div2pii, arcLength, orientation, singular } }
     */
    shapes: [],
    nextShapeId: 1,

    /* Interactive drawing state */
    drawing: null,
    polyDraft: null,

    /* Selection, moving, and resizing */
    selectedShapeId: null,
    hoveredShapeId: null,
    hoveredHandle: null, /* { shapeId, handle } */
    dragShape: null,     /* { mode: 'move'|'resize', shape, handle, startWorld, origRawPts, ... } */

    /* Hover probe */
    probe: { active: false, z: null, w: null, pending: false, queuedZ: null },

    /* Domain coloring cache */
    domainImg: null,
    domainTimer: null,
    domainReqId: 0,

    /* Panning state */
    spaceHeld: false,
    pan: null,

    /* Analysis Lab Overlays (Zero Hunter, Taylor Series, Homotopy Morph, Dirichlet S_N) */
    lab: {
      foundZeros: [], /* [{ x, y, res }] */
      taylor: { enabled: false, picking: false, draggingZ0: false, x0: 2.0, y0: 0.0, degree: 8, radius: 1.0, coeffs: [] },
      morphT: 1.0,
      dirichlet: { enabled: false, n: 20, curves: new Map() }, /* shapeId -> outPts[] */
    },
  };

  /* DOM refs */
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

  const fnSelect = document.getElementById("fn-select");
  const realFnSelect = document.getElementById("real-fn-select");
  const fnFormula = document.getElementById("fn-formula");
  const readoutInLabel = document.getElementById("readout-in-label");
  const readoutOutLabel = document.getElementById("readout-out-label");
  const readoutExtraLabel = document.getElementById("readout-extra-label");
  const readoutZ = document.getElementById("readout-z");
  const readoutW = document.getElementById("readout-w");
  const readoutMag = document.getElementById("readout-mag");

  const complexModeSwitch = document.getElementById("complex-mode-switch");
  const complexToolbar = document.getElementById("complex-toolbar");
  const realToolbar = document.getElementById("real-toolbar");
  const complexPlanes = document.getElementById("complex-planes");
  const realPlaneContainer = document.getElementById("real-plane-container");
  const complexDock = document.getElementById("complex-dock");
  const realDock = document.getElementById("real-dock");
  const btnToggleSphere = document.getElementById("btn-toggle-sphere");

  const integralCard = document.getElementById("integral-card");
  const intDot = document.getElementById("int-dot");
  const intTitle = document.getElementById("int-title");
  const intOrient = document.getElementById("int-orient");
  const intSym = document.getElementById("int-sym");
  const intVal = document.getElementById("int-val");
  const intRes = document.getElementById("int-res");
  const intMag = document.getElementById("int-mag");
  const intLen = document.getElementById("int-len");
  const intSumRow = document.getElementById("int-sum-row");
  const intSumVal = document.getElementById("int-sum-val");

  const presetsList = document.getElementById("presets-list");
  const presetsLabel = document.getElementById("presets-label");
  const shapesList = document.getElementById("shapes-list");
  const shapeCount = document.getElementById("shape-count");
  const paletteEl = document.getElementById("palette");
  const btnPlay = document.getElementById("btn-play");
  const labelPlay = document.getElementById("label-play");
  const iconPlay = document.getElementById("icon-play");
  const inputHint = document.getElementById("input-hint");
  const btnMesh = document.getElementById("btn-toggle-mesh");

  /* -------------------------------------------------------------------------
   * Coordinate Transforms & Formatting
   * ------------------------------------------------------------------------- */

  function screenToWorld(view, canvas, sx, sy) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    return {
      x: view.cx + (sx - w * 0.5) / view.scale,
      y: view.cy - (sy - h * 0.5) / view.scale,
    };
  }

  function worldToScreen(view, canvas, wx, wy) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    return {
      x: (wx - view.cx) * view.scale + w * 0.5,
      y: -(wy - view.cy) * view.scale + h * 0.5,
    };
  }

  function fmtComplex(re, im, digits = 4) {
    if (!Number.isFinite(re) || !Number.isFinite(im)) {
      return "∞ (pole)";
    }
    const r = Math.abs(re) < 1e-8 ? 0 : re;
    const i = Math.abs(im) < 1e-8 ? 0 : im;
    const sign = i >= 0 ? "+" : "−";
    return `${r.toFixed(digits)} ${sign} ${Math.abs(i).toFixed(digits)}i`;
  }

  function fmtCompactComplex(re, im) {
    if (!Number.isFinite(re) || !Number.isFinite(im)) return "singular";
    const r = Math.abs(re) < 1e-5 ? 0 : re;
    const i = Math.abs(im) < 1e-5 ? 0 : im;
    if (r === 0 && i === 0) return "0";
    /* Recognize clean multiples of pi / 2pi*i */
    if (r === 0 && Math.abs(i / Math.PI - Math.round(i / Math.PI)) < 1e-3 && Math.abs(i) > 0.1) {
      const k = Math.round(i / Math.PI);
      if (k === 1) return "πi";
      if (k === -1) return "−πi";
      return `${k}πi`;
    }
    if (i === 0 && Math.abs(r / Math.PI - Math.round(r / Math.PI)) < 1e-3 && Math.abs(r) > 0.1) {
      const k = Math.round(r / Math.PI);
      if (k === 1) return "π";
      if (k === -1) return "−π";
      return `${k}π`;
    }
    if (i === 0) return r.toFixed(3);
    if (r === 0) return `${i.toFixed(3)}i`;
    return `${r.toFixed(2)}${i >= 0 ? "+" : "−"}${Math.abs(i).toFixed(2)}i`;
  }

  function niceStep(rawStep) {
    const exp = Math.floor(Math.log10(rawStep));
    const frac = rawStep / Math.pow(10, exp);
    let nice = 1;
    if (frac <= 1.2) nice = 1;
    else if (frac <= 2.5) nice = 2;
    else if (frac <= 5.5) nice = 5;
    else nice = 10;
    return nice * Math.pow(10, exp);
  }

  function fmtTick(v) {
    if (Math.abs(v) < 1e-10) return "0";
    if (Math.abs(v) >= 1000 || Math.abs(v) < 0.01) return v.toExponential(1);
    return Number(v.toFixed(4)).toString();
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function signedArea2(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a;
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

  /* -------------------------------------------------------------------------
   * API Calls to C Backend
   * ------------------------------------------------------------------------- */

  async function apiEval(pts) {
    const flat = [];
    for (const p of pts) flat.push(p.x, p.y);
    const res = await fetch("/api/eval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fn: state.fnIndex, points: flat }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const out = [];
    for (let i = 0; i < data.out.length; i += 2) {
      const u = data.out[i];
      const v = data.out[i + 1];
      out.push(u === null || v === null ? null : { x: u, y: v });
    }
    return out;
  }

  async function apiTrace(rawPts, closed, withMesh, qualityScale = 1.0) {
    const flat = [];
    for (const p of rawPts) flat.push(p.x, p.y);
    const inSpan = Math.max(canvasIn.clientWidth, canvasIn.clientHeight) / state.inView.scale;
    const outSpan = Math.max(canvasOut.clientWidth, canvasOut.clientHeight) / state.outView.scale;
    const res = await fetch("/api/trace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fn: state.fnIndex,
        closed,
        with_mesh: withMesh,
        points: flat,
        max_in_step: Math.max(0.015, (inSpan / 110) * qualityScale),
        max_out_step: Math.max(0.015, (outSpan / 95) * qualityScale),
        clip_radius: Math.max(80, outSpan * 12),
      }),
    });
    if (!res.ok) return null;
    return res.json();
  }

  async function apiIntegrate(rawPts, closed, qualityScale = 1.0) {
    const flat = [];
    for (const p of rawPts) flat.push(p.x, p.y);
    const inSpan = Math.max(canvasIn.clientWidth, canvasIn.clientHeight) / state.inView.scale;
    const res = await fetch("/api/integrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fn: state.fnIndex,
        closed,
        points: flat,
        max_in_step: Math.max(0.02, (inSpan / 90) * qualityScale),
      }),
    });
    if (!res.ok) return null;
    return res.json();
  }

  function unpackCurve(raw) {
    const inPts = [];
    const outPts = [];
    for (let i = 0; i < raw.in.length; i += 2) {
      inPts.push({ x: raw.in[i], y: raw.in[i + 1] });
      const u = raw.out[i];
      const v = raw.out[i + 1];
      outPts.push(u === null || v === null ? null : { x: u, y: v });
    }
    return { inPts, outPts };
  }

  function unpackIntegral(raw) {
    const inPts = [];
    const cumPts = [];
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

  /* -------------------------------------------------------------------------
   * Shape Construction & Computation
   * ------------------------------------------------------------------------- */

  function activeColor() {
    return PALETTE[state.colorIndex % PALETTE.length];
  }

  function advanceColor() {
    state.colorIndex = (state.colorIndex + 1) % PALETTE.length;
    renderPalette();
  }

  async function computeShapeData(shape, qualityScale = 1.0) {
    if (state.mode === "integral") {
      const data = await apiIntegrate(shape.rawPts, shape.closed, qualityScale);
      if (data && state.shapes.includes(shape)) {
        shape.integral = unpackIntegral(data);
        /* Keep boundary.inPts populated for consistent hit testing */
        shape.boundary = { inPts: shape.integral.inPts, outPts: shape.integral.cumPts };
      }
    } else {
      const data = await apiTrace(shape.rawPts, shape.closed, true, qualityScale);
      if (data && state.shapes.includes(shape)) {
        shape.boundary = unpackCurve(data.boundary);
        shape.mesh = (data.mesh || []).map(unpackCurve);
        shape.winding = data.winding;
      }
    }
  }

  async function commitShape({ kind, label, rawPts, closed, color, autoColor = true }) {
    if (!rawPts || rawPts.length < 2) return null;
    const chosenColor = color || activeColor();
    if (autoColor) advanceColor();

    const shape = {
      id: state.nextShapeId++,
      kind,
      label: label || (closed ? `Closed ${kind}` : "Path"),
      color: chosenColor,
      closed,
      visible: true,
      rawPts: rawPts.map((p) => ({ x: p.x, y: p.y })),
      boundary: null,
      mesh: [],
      winding: null,
      integral: null,
    };
    state.shapes.push(shape);
    state.selectedShapeId = shape.id;
    renderShapeChips();

    await computeShapeData(shape, 1.0);
    if (state.lab.dirichlet.enabled) {
      await fetchDirichletForShape(shape);
    }
    renderShapeChips();
    updateIntegralCard();
    requestRender();
    return shape;
  }

  async function fetchDirichletForShape(shape) {
    if (!shape || !shape.rawPts || shape.rawPts.length < 2) return;
    const flat = [];
    for (const p of shape.rawPts) flat.push(p.x, p.y);
    const inSpan = Math.max(canvasIn.clientWidth, canvasIn.clientHeight) / state.inView.scale;
    const res = await fetch("/api/dirichlet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        n: state.lab.dirichlet.n,
        closed: shape.closed,
        points: flat,
        max_in_step: Math.max(0.025, inSpan / 85),
        max_out_step: 0.25,
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const c = unpackCurve(data.boundary);
    state.lab.dirichlet.curves.set(shape.id, c.outPts);
  }

  async function refreshDirichletOverlays() {
    if (!state.lab.dirichlet.enabled) {
      state.lab.dirichlet.curves.clear();
      requestRender();
      return;
    }
    await Promise.all(state.shapes.map((s) => fetchDirichletForShape(s)));
    requestRender();
  }

  function evalTaylorPoly(x, y) {
    const t = state.lab.taylor;
    if (!t.enabled || !t.coeffs || t.coeffs.length < 2) return null;
    const dx = x - t.x0;
    const dy = y - t.y0;
    /* Horner's method from highest degree down */
    const deg = Math.min(t.degree, Math.floor(t.coeffs.length / 2) - 1);
    let re = t.coeffs[2 * deg];
    let im = t.coeffs[2 * deg + 1];
    for (let k = deg - 1; k >= 0; k--) {
      const nr = re * dx - im * dy + t.coeffs[2 * k];
      const ni = re * dy + im * dx + t.coeffs[2 * k + 1];
      re = nr;
      im = ni;
      if (!Number.isFinite(re) || !Number.isFinite(im) || Math.hypot(re, im) > 1e5) {
        return null;
      }
    }
    return Math.hypot(re, im) < 120 ? { x: re, y: im } : null;
  }

  function morphPoint(inPt, outPt) {
    if (!outPt) return null;
    const t = state.lab.morphT;
    if (t >= 0.999 || !inPt) return outPt;
    return {
      x: inPt.x * (1 - t) + outPt.x * t,
      y: inPt.y * (1 - t) + outPt.y * t,
    };
  }

  function getMorphedOutPts(shape) {
    if (!shape.boundary) return null;
    if (state.lab.morphT >= 0.999) return shape.boundary.outPts;
    const inP = shape.boundary.inPts;
    const outP = shape.boundary.outPts;
    const res = [];
    for (let i = 0; i < outP.length; i++) {
      res.push(morphPoint(inP[i], outP[i]));
    }
    return res;
  }

  async function recomputeAllShapes() {
    await Promise.all(state.shapes.map((s) => computeShapeData(s, 1.0)));
    renderShapeChips();
    updateIntegralCard();
    requestRender();
  }

  function makeCirclePoints(cx, cy, r, segments = 72, ccw = true) {
    const pts = [];
    const dir = ccw ? 1 : -1;
    for (let i = 0; i < segments; i++) {
      const a = dir * (i / segments) * Math.PI * 2;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function makeRectPoints(x0, y0, x1, y1, ccw = true) {
    const xmin = Math.min(x0, x1);
    const xmax = Math.max(x0, x1);
    const ymin = Math.min(y0, y1);
    const ymax = Math.max(y0, y1);
    if (ccw) {
      return [
        { x: xmin, y: ymin },
        { x: xmax, y: ymin },
        { x: xmax, y: ymax },
        { x: xmin, y: ymax },
      ];
    }
    return [
      { x: xmin, y: ymin },
      { x: xmin, y: ymax },
      { x: xmax, y: ymax },
      { x: xmax, y: ymin },
    ];
  }

  function makeLinePoints(x0, y0, x1, y1, steps = 40) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
    }
    return pts;
  }

  function makeArcPoints(cx, cy, r, a0, a1, steps = 64) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps);
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function makeWavyPath(x0, y0, x1, y1, amp, steps = 64) {
    const pts = [];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const w = Math.sin(t * Math.PI) * Math.sin(t * Math.PI * 3) * amp;
      pts.push({ x: x0 + dx * t + nx * w, y: y0 + dy * t + ny * w });
    }
    return pts;
  }

  /* -------------------------------------------------------------------------
   * Presets: Both Complex Map Mode & Contour Integral Mode
   * ------------------------------------------------------------------------- */

  function selectFunctionById(id) {
    const idx = state.functions.findIndex((f) => f.id === id);
    if (idx >= 0 && idx !== state.fnIndex) {
      state.fnIndex = idx;
      fnSelect.value = String(idx);
      updateFunctionMeta();
      if (state.showDomain) scheduleDomainUpdate();
    }
  }

  function getIntegralPresetsForFunction(fn) {
    if (!fn) return [];
    if (fn.id === "zeta") {
      return [
        {
          name: "Residue at Pole s = 1 (∮ = 2πi)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.5, 0.0, 3.0);
            setView(state.outView, canvasOut, 0.0, 3.2, 5.2);
            await commitShape({
              kind: "circle",
              label: "Loop around pole s=1",
              rawPts: makeCirclePoints(1.0, 0.0, 0.55, 72, true),
              closed: true,
              color: "#38bdf8",
              autoColor: false,
            });
            autoFitOutput();
          },
        },
        {
          name: "Pole vs Holomorphic (2πi vs 0)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.5, 0.5, 3.4);
            await commitShape({
              kind: "circle",
              label: "Pole s=1 (∮ = 2πi)",
              rawPts: makeCirclePoints(1.0, 0.0, 0.55, 72, true),
              closed: true,
              color: "#fb7185",
              autoColor: false,
            });
            await commitShape({
              kind: "circle",
              label: "Holomorphic (∮ = 0)",
              rawPts: makeCirclePoints(-1.2, 0.8, 0.65, 72, true),
              closed: true,
              color: "#34d399",
              autoColor: false,
            });
            autoFitOutput();
          },
        },
        {
          name: "Zero Counter Box (switch to ζ'/ζ)",
          run: async () => {
            selectFunctionById("zeta_log_deriv");
            clearShapes();
            setView(state.inView, canvasIn, 0.5, 19.0, 12.5);
            await commitShape({
              kind: "rect",
              label: "Box enclosing 3 Riemann zeros",
              rawPts: makeRectPoints(-0.6, 10.0, 1.6, 27.0, true),
              closed: true,
              color: "#34d399",
              autoColor: false,
            });
            autoFitOutput();
          },
        },
      ];
    }

    if (fn.id === "xi") {
      return [
        {
          name: "Entire Function (∮ around s=1 is 0!)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.5, 0.0, 3.0);
            await commitShape({
              kind: "circle",
              label: "Loop around s=1 (pole removed!)",
              rawPts: makeCirclePoints(1.0, 0.0, 0.8, 72, true),
              closed: true,
              color: "#34d399",
              autoColor: false,
            });
            autoFitOutput();
          },
        },
        {
          name: "Path Independence Across s=1",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.5, 0.0, 3.0);
            await commitShape({
              kind: "line",
              label: "Straight (0 → 2)",
              rawPts: makeLinePoints(0.0, 0.0, 2.0, 0.0, 48),
              closed: false,
              color: "#38bdf8",
              autoColor: false,
            });
            await commitShape({
              kind: "freehand",
              label: "Upper arc (0 → 2)",
              rawPts: makeArcPoints(1.0, 0.0, 1.0, Math.PI, 0, 64),
              closed: false,
              color: "#fbbf24",
              autoColor: false,
            });
            autoFitOutput();
          },
        },
      ];
    }

    if (fn.id === "zeta_log_deriv") {
      return [
        {
          name: "Count 3 Riemann Zeros (÷2πi = +3)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.5, 19.0, 12.5);
            await commitShape({
              kind: "rect",
              label: "Critical Strip Box (3 zeros)",
              rawPts: makeRectPoints(-0.6, 10.0, 1.6, 27.0, true),
              closed: true,
              color: "#34d399",
              autoColor: false,
            });
            autoFitOutput();
          },
        },
        {
          name: "Count Pole s = 1 (÷2πi = -1)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.5, 0.0, 3.0);
            await commitShape({
              kind: "circle",
              label: "Loop around pole s=1",
              rawPts: makeCirclePoints(1.0, 0.0, 0.5, 72, true),
              closed: true,
              color: "#fb7185",
              autoColor: false,
            });
            autoFitOutput();
          },
        },
        {
          name: "Trivial Zero s = -2 (÷2πi = +1)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, -2.0, 0.0, 3.0);
            await commitShape({
              kind: "circle",
              label: "Loop around trivial zero -2",
              rawPts: makeCirclePoints(-2.0, 0.0, 0.55, 72, true),
              closed: true,
              color: "#fbbf24",
              autoColor: false,
            });
            autoFitOutput();
          },
        },
      ];
    }

    if (fn.id === "two_poles") {
      return [
        {
          name: "Residue at +i (∮ = +π)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.0, 0.0, 2.8);
            await commitShape({
              kind: "circle",
              label: "Loop around +i",
              rawPts: makeCirclePoints(0.0, 1.0, 0.55, 72, true),
              closed: true,
              color: "#38bdf8",
              autoColor: false,
            });
            autoFitOutput();
          },
        },
        {
          name: "Both Poles Cancel (∮ = 0)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.0, 0.0, 3.0);
            await commitShape({
              kind: "circle",
              label: "Loop enclosing +i and -i",
              rawPts: makeCirclePoints(0.0, 0.0, 1.85, 84, true),
              closed: true,
              color: "#a78bfa",
              autoColor: false,
            });
            autoFitOutput();
          },
        },
        {
          name: "Upper vs Lower Arc (Δ = π)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.0, 0.8, 3.0);
            await commitShape({
              kind: "freehand",
              label: "Upper arc (above +i)",
              rawPts: makeArcPoints(0.0, 1.0, 1.4, Math.PI, 0, 64),
              closed: false,
              color: "#38bdf8",
              autoColor: false,
            });
            await commitShape({
              kind: "freehand",
              label: "Lower arc (below +i)",
              rawPts: makeArcPoints(0.0, 1.0, 1.4, Math.PI, Math.PI * 2, 64),
              closed: false,
              color: "#fbbf24",
              autoColor: false,
            });
            autoFitOutput();
          },
        },
      ];
    }

    if (fn.id === "inv_z") {
      return [
        {
          name: "Unit Circle (∮ = 2πi)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.0, 0.0, 2.5);
            await commitShape({
              kind: "circle",
              label: "Unit circle |z|=1",
              rawPts: makeCirclePoints(0.0, 0.0, 1.0, 72, true),
              closed: true,
              color: "#38bdf8",
              autoColor: false,
            });
            autoFitOutput();
          },
        },
        {
          name: "Double Winding (∮ = 4πi)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.0, 0.0, 2.5);
            const spiral = [];
            for (let i = 0; i <= 144; i++) {
              const t = i / 144;
              const a = t * Math.PI * 4;
              const r = 0.85 + 0.35 * Math.sin(t * Math.PI);
              spiral.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
            }
            await commitShape({
              kind: "freehand",
              label: "2x loop around 0",
              rawPts: spiral,
              closed: true,
              color: "#a78bfa",
              autoColor: false,
            });
            autoFitOutput();
          },
        },
        {
          name: "Upper vs Lower Semicircle (±πi)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.0, 0.0, 2.5);
            await commitShape({
              kind: "freehand",
              label: "Upper arc (-1 → +1)",
              rawPts: makeArcPoints(0.0, 0.0, 1.2, Math.PI, 0, 64),
              closed: false,
              color: "#38bdf8",
              autoColor: false,
            });
            await commitShape({
              kind: "freehand",
              label: "Lower arc (-1 → +1)",
              rawPts: makeArcPoints(0.0, 0.0, 1.2, Math.PI, Math.PI * 2, 64),
              closed: false,
              color: "#fb7185",
              autoColor: false,
            });
            autoFitOutput();
          },
        },
      ];
    }

    if (fn.id === "gamma") {
      return [
        {
          name: "Residue Ladder (0, -1, -2)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, -1.0, 0.0, 2.6);
            await commitShape({
              kind: "circle",
              label: "z = 0 (Res +1)",
              rawPts: makeCirclePoints(0.0, 0.0, 0.32, 64, true),
              closed: true,
              color: "#38bdf8",
              autoColor: false,
            });
            await commitShape({
              kind: "circle",
              label: "z = -1 (Res -1)",
              rawPts: makeCirclePoints(-1.0, 0.0, 0.32, 64, true),
              closed: true,
              color: "#fb7185",
              autoColor: false,
            });
            await commitShape({
              kind: "circle",
              label: "z = -2 (Res +1/2)",
              rawPts: makeCirclePoints(-2.0, 0.0, 0.32, 64, true),
              closed: true,
              color: "#34d399",
              autoColor: false,
            });
            autoFitOutput();
          },
        },
      ];
    }

    if (fn.id === "exp_inv") {
      return [
        {
          name: "Essential Singularity (a₋₁ = 1 → 2πi)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.0, 0.0, 2.5);
            await commitShape({
              kind: "circle",
              label: "Loop around z=0",
              rawPts: makeCirclePoints(0.0, 0.0, 1.0, 84, true),
              closed: true,
              color: "#fbbf24",
              autoColor: false,
            });
            autoFitOutput();
          },
        },
      ];
    }

    return [
      {
        name: "Path Independence (2 Paths → Same I)",
        run: async () => {
          clearShapes();
          resetViews();
          await commitShape({
            kind: "line",
            label: "Straight path (-1 → 1+i)",
            rawPts: makeLinePoints(-1.0, -0.5, 1.2, 1.0, 48),
            closed: false,
            color: "#38bdf8",
            autoColor: false,
          });
          await commitShape({
            kind: "freehand",
            label: "Wavy path (-1 → 1+i)",
            rawPts: makeWavyPath(-1.0, -0.5, 1.2, 1.0, 0.85, 72),
            closed: false,
            color: "#fbbf24",
            autoColor: false,
          });
          autoFitOutput();
        },
      },
      {
        name: "Cauchy's Theorem (Closed Loop → 0)",
        run: async () => {
          clearShapes();
          resetViews();
          await commitShape({
            kind: "rect",
            label: "Closed box",
            rawPts: makeRectPoints(-0.8, -0.6, 1.1, 0.9, true),
            closed: true,
            color: "#34d399",
            autoColor: false,
          });
          autoFitOutput();
        },
      },
    ];
  }

  function getMapPresetsForFunction(fn) {
    if (!fn) return [];
    if (fn.id === "zeta") {
      return [
        {
          name: "Critical Line (t: 0→35)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.5, 17.0, 20.0);
            setView(state.outView, canvasOut, 0.6, 0.0, 4.0);
            await commitShape({
              kind: "line",
              label: "Re(s)=1/2, t∈[0,35]",
              rawPts: makeLinePoints(0.5, 0.0, 0.5, 35.0, 260),
              closed: false,
              color: "#38bdf8",
              autoColor: false,
            });
            state.colorIndex = 1;
            renderPalette();
          },
        },
        {
          name: "Loop: 1st Zero (½+14.13i)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.5, 14.135, 3.0);
            setView(state.outView, canvasOut, 0.0, 0.0, 2.2);
            await commitShape({
              kind: "circle",
              label: "Disk around 1st zero",
              rawPts: makeCirclePoints(0.5, 14.13472514, 0.65, 80),
              closed: true,
              color: "#34d399",
              autoColor: false,
            });
            state.colorIndex = 0;
            renderPalette();
          },
        },
        {
          name: "Loop: Pole (s = 1)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.5, 0.0, 3.2);
            setView(state.outView, canvasOut, 0.5, 0.0, 3.8);
            await commitShape({
              kind: "circle",
              label: "Disk around pole s=1",
              rawPts: makeCirclePoints(1.0, 0.0, 0.45, 72),
              closed: true,
              color: "#fb7185",
              autoColor: false,
            });
            state.colorIndex = 0;
            renderPalette();
          },
        },
        {
          name: "Analytic Continuation Bridge",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.0, 0.0, 4.5);
            setView(state.outView, canvasOut, 0.2, 0.0, 3.0);
            await commitShape({
              kind: "rect",
              label: "Box Re∈[-2.4, 2.4]",
              rawPts: makeRectPoints(-2.4, 0.5, 2.4, 2.5),
              closed: true,
              color: "#a78bfa",
              autoColor: false,
            });
            await commitShape({
              kind: "circle",
              label: "Trivial zero s = -2",
              rawPts: makeCirclePoints(-2.0, 0.0, 0.55, 64),
              closed: true,
              color: "#fbbf24",
              autoColor: false,
            });
            state.colorIndex = 0;
            renderPalette();
          },
        },
        {
          name: "Critical Strip (σ=0.25, 0.5, 0.75)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.5, 14.0, 16.0);
            setView(state.outView, canvasOut, 0.6, 0.0, 5.5);
            await commitShape({
              kind: "line",
              label: "σ = 0.25",
              rawPts: makeLinePoints(0.25, 0.5, 0.25, 28.0, 200),
              closed: false,
              color: "#fb7185",
              autoColor: false,
            });
            await commitShape({
              kind: "line",
              label: "σ = 0.50 (Critical)",
              rawPts: makeLinePoints(0.5, 0.5, 0.5, 28.0, 200),
              closed: false,
              color: "#38bdf8",
              autoColor: false,
            });
            await commitShape({
              kind: "line",
              label: "σ = 0.75",
              rawPts: makeLinePoints(0.75, 0.5, 0.75, 28.0, 200),
              closed: false,
              color: "#34d399",
              autoColor: false,
            });
          },
        },
      ];
    }

    if (fn.id === "xi") {
      return [
        {
          name: "Critical Line (Maps to Real Axis!)",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.5, 0.0, 16.0);
            setView(state.outView, canvasOut, 0.25, 0.0, 0.6);
            await commitShape({
              kind: "line",
              label: "Re(s)=1/2, t∈[-16,16]",
              rawPts: makeLinePoints(0.5, -16.0, 0.5, 16.0, 220),
              closed: false,
              color: "#38bdf8",
              autoColor: false,
            });
          },
        },
        {
          name: "Symmetry: s vs 1 − s",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.5, 0.0, 4.0);
            setView(state.outView, canvasOut, 0.5, 0.0, 1.8);
            await commitShape({
              kind: "circle",
              label: "Disk at s = 1.8 + 0.8i",
              rawPts: makeCirclePoints(1.8, 0.8, 0.6, 72),
              closed: true,
              color: "#38bdf8",
              autoColor: false,
            });
            await commitShape({
              kind: "circle",
              label: "Reflected 1 - s = -0.8 - 0.8i",
              rawPts: makeCirclePoints(-0.8, -0.8, 0.6, 72),
              closed: true,
              color: "#fbbf24",
              autoColor: false,
            });
          },
        },
        {
          name: "Around Removable Pole s = 1",
          run: async () => {
            clearShapes();
            setView(state.inView, canvasIn, 0.5, 0.0, 3.0);
            setView(state.outView, canvasOut, 0.5, 0.0, 0.6);
            await commitShape({
              kind: "circle",
              label: "Smooth disk around s=1 (xi(1)=1/2)",
              rawPts: makeCirclePoints(1.0, 0.0, 0.7, 72),
              closed: true,
              color: "#34d399",
              autoColor: false,
            });
          },
        },
      ];
    }

    if (fn.id === "joukowsky") {
      return [
        {
          name: "Airfoil Circle",
          run: async () => {
            clearShapes();
            resetViews();
            await commitShape({
              kind: "circle",
              label: "Joukowsky Airfoil",
              rawPts: makeCirclePoints(-0.14, 0.22, 1.16, 96),
              closed: true,
              color: "#38bdf8",
              autoColor: false,
            });
            autoFitOutput();
          },
        },
        {
          name: "Concentric Rings",
          run: async () => {
            clearShapes();
            resetViews();
            await commitShape({
              kind: "circle",
              label: "r = 1.4",
              rawPts: makeCirclePoints(0, 0, 1.4, 72),
              closed: true,
              color: "#38bdf8",
              autoColor: false,
            });
            await commitShape({
              kind: "circle",
              label: "r = 2.0",
              rawPts: makeCirclePoints(0, 0, 2.0, 72),
              closed: true,
              color: "#a78bfa",
              autoColor: false,
            });
          },
        },
      ];
    }

    if (fn.id === "gamma") {
      return [
        {
          name: "Loop Around Pole z = -1",
          run: async () => {
            clearShapes();
            resetViews();
            await commitShape({
              kind: "circle",
              label: "Pole z = -1",
              rawPts: makeCirclePoints(-1.0, 0.0, 0.4, 72),
              closed: true,
              color: "#fb7185",
              autoColor: false,
            });
          },
        },
        {
          name: "Conformal Patch",
          run: async () => {
            clearShapes();
            resetViews();
            await commitShape({
              kind: "rect",
              label: "Re∈[0.5, 2.5], Im∈[-1, 1]",
              rawPts: makeRectPoints(0.5, -1.0, 2.5, 1.0),
              closed: true,
              color: "#38bdf8",
              autoColor: false,
            });
          },
        },
      ];
    }

    return [
      {
        name: "Unit Disk",
        run: async () => {
          clearShapes();
          resetViews();
          await commitShape({
            kind: "circle",
            label: "Unit Disk |z|=1",
            rawPts: makeCirclePoints(0, 0, 1.0, 72),
            closed: true,
            color: "#38bdf8",
            autoColor: false,
          });
        },
      },
      {
        name: "Square Patch",
        run: async () => {
          clearShapes();
          resetViews();
          await commitShape({
            kind: "rect",
            label: "Square [0.3, 1.8]²",
            rawPts: makeRectPoints(0.3, 0.3, 1.8, 1.8),
            closed: true,
            color: "#a78bfa",
            autoColor: false,
          });
        },
      },
      {
        name: "Off-Center Disk",
        run: async () => {
          clearShapes();
          resetViews();
          await commitShape({
            kind: "circle",
            label: "Disk c=0.5+0.4i",
            rawPts: makeCirclePoints(0.5, 0.4, 0.9, 72),
            closed: true,
            color: "#34d399",
            autoColor: false,
          });
        },
      },
    ];
  }

  /* -------------------------------------------------------------------------
   * Viewport Helpers
   * ------------------------------------------------------------------------- */

  function setView(view, canvas, cx, cy, radius) {
    const dim = Math.min(canvas.clientWidth || 500, canvas.clientHeight || 500);
    view.cx = cx;
    view.cy = cy;
    view.scale = (dim * 0.46) / Math.max(radius, 1e-4);
    if (view === state.inView && state.showDomain) {
      scheduleDomainUpdate();
    }
    requestRender();
  }

  function resetViews() {
    const fn = state.functions[state.fnIndex];
    if (!fn) return;
    setView(state.inView, canvasIn, fn.in_view.cx, fn.in_view.cy, fn.in_view.r);
    if (state.mode === "integral") {
      setView(state.outView, canvasOut, 0.0, 0.0, 7.5);
    } else {
      setView(state.outView, canvasOut, fn.out_view.cx, fn.out_view.cy, fn.out_view.r);
    }
  }

  function zoomAt(view, canvas, sx, sy, factor) {
    const before = screenToWorld(view, canvas, sx, sy);
    view.scale = Math.min(1e6, Math.max(0.5, view.scale * factor));
    const after = screenToWorld(view, canvas, sx, sy);
    view.cx += before.x - after.x;
    view.cy += before.y - after.y;
    if (view === state.inView && state.showDomain) {
      scheduleDomainUpdate();
    }
    requestRender();
  }

  function autoFitOutput() {
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    let count = 0;

    if (state.mode === "integral") {
      /* Always include origin 0 + 0i so the cumulative trajectory & vector are framed */
      xmin = 0;
      xmax = 0;
      ymin = 0;
      ymax = 0;
      count = 1;
      for (const s of state.shapes) {
        if (!s.visible || !s.integral) continue;
        for (const p of s.integral.cumPts) {
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.hypot(p.x, p.y) > 200) continue;
          xmin = Math.min(xmin, p.x);
          xmax = Math.max(xmax, p.x);
          ymin = Math.min(ymin, p.y);
          ymax = Math.max(ymax, p.y);
          count++;
        }
      }
    } else {
      for (const s of state.shapes) {
        if (!s.visible || !s.boundary) continue;
        for (const p of s.boundary.outPts) {
          if (!p) continue;
          if (Math.hypot(p.x, p.y) > 40) continue;
          xmin = Math.min(xmin, p.x);
          xmax = Math.max(xmax, p.x);
          ymin = Math.min(ymin, p.y);
          ymax = Math.max(ymax, p.y);
          count++;
        }
      }
    }

    if (count < 2) {
      resetViews();
      return;
    }
    const cx = 0.5 * (xmin + xmax);
    const cy = 0.5 * (ymin + ymax);
    const halfW = Math.max(0.5, 0.58 * (xmax - xmin));
    const halfH = Math.max(0.5, 0.58 * (ymax - ymin));
    const sx = (canvasOut.clientWidth * 0.42) / halfW;
    /* Leave breathing room for the bottom integral readout card in Integral mode */
    const availH = state.mode === "integral" ? canvasOut.clientHeight * 0.34 : canvasOut.clientHeight * 0.42;
    const sy = availH / halfH;
    state.outView.cx = cx;
    state.outView.cy = state.mode === "integral" ? cy - halfH * 0.22 : cy;
    state.outView.scale = Math.min(sx, sy);
    requestRender();
  }

  /* -------------------------------------------------------------------------
   * Domain Coloring Backdrop
   * ------------------------------------------------------------------------- */

  function scheduleDomainUpdate() {
    if (!state.showDomain) return;
    if (state.domainTimer) clearTimeout(state.domainTimer);
    state.domainTimer = setTimeout(fetchDomainImage, 90);
  }

  async function fetchDomainImage() {
    if (!state.showDomain) return;
    const reqId = ++state.domainReqId;
    const w = canvasIn.clientWidth;
    const h = canvasIn.clientHeight;
    if (w < 20 || h < 20) return;

    const texW = Math.min(280, Math.max(96, Math.round(w * 0.36)));
    const texH = Math.min(280, Math.max(96, Math.round(h * 0.36)));
    const halfW = (w * 0.5) / state.inView.scale;
    const halfH = (h * 0.5) / state.inView.scale;
    const cx = state.inView.cx;
    const cy = state.inView.cy;
    const fnIndex = state.fnIndex;

    const res = await fetch("/api/domain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fn: fnIndex,
        cx,
        cy,
        half_w: halfW,
        half_h: halfH,
        width: texW,
        height: texH,
      }),
    });
    if (!res.ok || reqId !== state.domainReqId) return;
    const buf = await res.arrayBuffer();
    if (reqId !== state.domainReqId) return;

    const off = document.createElement("canvas");
    off.width = texW;
    off.height = texH;
    const octx = off.getContext("2d");
    const imgData = new ImageData(new Uint8ClampedArray(buf), texW, texH);
    octx.putImageData(imgData, 0, 0);

    state.domainImg = { canvas: off, cx, cy, halfW, halfH, fnIndex };
    requestRender();
  }

  /* -------------------------------------------------------------------------
   * Resize Handles Geometry
   * ------------------------------------------------------------------------- */

  function getResizeHandles(shape) {
    if (!shape || !shape.visible || !shape.rawPts || shape.rawPts.length < 2) return [];

    if (shape.kind === "circle") {
      const bb = bboxOf(shape.rawPts);
      const r = 0.25 * (bb.xmax - bb.xmin + (bb.ymax - bb.ymin));
      return [
        { id: "e", x: bb.cx + r, y: bb.cy, cursor: "ew-resize", shapeKind: "circle" },
        { id: "w", x: bb.cx - r, y: bb.cy, cursor: "ew-resize", shapeKind: "circle" },
        { id: "n", x: bb.cx, y: bb.cy + r, cursor: "ns-resize", shapeKind: "circle" },
        { id: "s", x: bb.cx, y: bb.cy - r, cursor: "ns-resize", shapeKind: "circle" },
      ];
    }

    if (shape.kind === "rect") {
      const bb = bboxOf(shape.rawPts);
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
      const first = shape.rawPts[0];
      const last = shape.rawPts[shape.rawPts.length - 1];
      return [
        { id: "start", x: first.x, y: first.y, cursor: "move", shapeKind: "line" },
        { id: "end", x: last.x, y: last.y, cursor: "move", shapeKind: "line" },
      ];
    }

    if (shape.kind === "polygon" && shape.rawPts.length <= 16) {
      return shape.rawPts.map((p, idx) => ({
        id: `v${idx}`,
        vertexIndex: idx,
        x: p.x,
        y: p.y,
        cursor: "move",
        shapeKind: "polygon",
      }));
    }

    /* Freehand / dense curves: 4 corner bounding-box scale handles */
    const bb = bboxOf(shape.rawPts);
    if (bb.xmax - bb.xmin < 1e-6 && bb.ymax - bb.ymin < 1e-6) return [];
    return [
      { id: "nw", x: bb.xmin, y: bb.ymax, cursor: "nwse-resize", shapeKind: "scale" },
      { id: "ne", x: bb.xmax, y: bb.ymax, cursor: "nesw-resize", shapeKind: "scale" },
      { id: "se", x: bb.xmax, y: bb.ymin, cursor: "nwse-resize", shapeKind: "scale" },
      { id: "sw", x: bb.xmin, y: bb.ymin, cursor: "nesw-resize", shapeKind: "scale" },
    ];
  }

  function hitTestResizeHandle(sx, sy) {
    if (state.selectedShapeId === null) return null;
    const shape = state.shapes.find((s) => s.id === state.selectedShapeId);
    if (!shape || !shape.visible) return null;

    const handles = getResizeHandles(shape);
    for (const h of handles) {
      const sp = worldToScreen(state.inView, canvasIn, h.x, h.y);
      if (Math.hypot(sx - sp.x, sy - sp.y) <= HANDLE_HIT_PX) {
        return { shape, handle: h };
      }
    }
    return null;
  }

  function applyResizeToShape(drag, z) {
    const s = drag.shape;
    const h = drag.handle;

    if (h.shapeKind === "circle") {
      const cx = drag.origBox.cx;
      const cy = drag.origBox.cy;
      const newR = Math.max(0.02, Math.hypot(z.x - cx, z.y - cy));
      s.rawPts = makeCirclePoints(cx, cy, newR, drag.origRawPts.length, drag.origCcw);
    } else if (h.shapeKind === "rect") {
      let { xmin, xmax, ymin, ymax } = drag.origBox;
      if (h.id.includes("w")) xmin = z.x;
      if (h.id.includes("e")) xmax = z.x;
      if (h.id.includes("s")) ymin = z.y;
      if (h.id.includes("n")) ymax = z.y;
      if (Math.abs(xmax - xmin) < 0.02) xmax = xmin + 0.02;
      if (Math.abs(ymax - ymin) < 0.02) ymax = ymin + 0.02;
      s.rawPts = makeRectPoints(xmin, ymin, xmax, ymax, drag.origCcw);
    } else if (h.shapeKind === "line") {
      const p0 = h.id === "start" ? z : drag.origRawPts[0];
      const p1 = h.id === "end" ? z : drag.origRawPts[drag.origRawPts.length - 1];
      s.rawPts = makeLinePoints(p0.x, p0.y, p1.x, p1.y, Math.max(40, drag.origRawPts.length - 1));
    } else if (h.shapeKind === "polygon") {
      const next = drag.origRawPts.map((p) => ({ x: p.x, y: p.y }));
      next[h.vertexIndex] = { x: z.x, y: z.y };
      s.rawPts = next;
    } else if (h.shapeKind === "scale") {
      const b = drag.origBox;
      const anchorX = h.id.includes("w") ? b.xmax : b.xmin;
      const anchorY = h.id.includes("s") ? b.ymax : b.ymin;
      const origW = h.id.includes("w") ? b.xmin - anchorX : b.xmax - anchorX;
      const origH = h.id.includes("s") ? b.ymin - anchorY : b.ymax - anchorY;
      const scaleX = Math.abs(origW) > 1e-6 ? (z.x - anchorX) / origW : 1;
      const scaleY = Math.abs(origH) > 1e-6 ? (z.y - anchorY) / origH : 1;
      const clampedX = Math.abs(scaleX) < 0.05 ? (scaleX < 0 ? -0.05 : 0.05) : scaleX;
      const clampedY = Math.abs(scaleY) < 0.05 ? (scaleY < 0 ? -0.05 : 0.05) : scaleY;
      s.rawPts = drag.origRawPts.map((p) => ({
        x: anchorX + (p.x - anchorX) * clampedX,
        y: anchorY + (p.y - anchorY) * clampedY,
      }));
    }

    /* Update input preview geometry synchronously for zero-latency resize */
    if (!s.boundary) {
      s.boundary = { inPts: s.rawPts, outPts: [] };
    } else {
      s.boundary.inPts = s.rawPts.map((p) => ({ x: p.x, y: p.y }));
    }
    if (s.integral) {
      s.integral.inPts = s.rawPts.map((p) => ({ x: p.x, y: p.y }));
    }
    /* Clear stale mesh during active resize until backend refreshes */
    if (s.mesh && s.mesh.length > 0 && drag.mode === "resize") {
      s.mesh = [];
    }
  }

  /* -------------------------------------------------------------------------
   * Canvas Sizing & Rendering
   * ------------------------------------------------------------------------- */

  let renderQueued = false;
  function requestRender() {
    if (!renderQueued) {
      renderQueued = true;
      requestAnimationFrame(renderFrame);
    }
  }

  function resizeCanvases() {
    const dpr = window.devicePixelRatio || 1;
    for (const canvas of [canvasIn, canvasOut]) {
      const rect = canvas.getBoundingClientRect();
      const targetW = Math.max(1, Math.round(rect.width * dpr));
      const targetH = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
    }
    if (state.showDomain) scheduleDomainUpdate();
    requestRender();
  }

  function drawGrid(ctx, canvas, view, isInput) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const halfW = (w * 0.5) / view.scale;
    const halfH = (h * 0.5) / view.scale;
    const xmin = view.cx - halfW;
    const xmax = view.cx + halfW;
    const ymin = view.cy - halfH;
    const ymax = view.cy + halfH;

    ctx.fillStyle = "#0a0e17";
    ctx.fillRect(0, 0, w, h);

    if (isInput && state.showDomain && state.domainImg && state.domainImg.fnIndex === state.fnIndex) {
      const d = state.domainImg;
      const tl = worldToScreen(view, canvas, d.cx - d.halfW, d.cy + d.halfH);
      const br = worldToScreen(view, canvas, d.cx + d.halfW, d.cy - d.halfH);
      ctx.save();
      ctx.globalAlpha = 0.62;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(d.canvas, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.restore();
    }

    const step = niceStep(78 / view.scale);
    const minor = step / 5;

    if (minor * view.scale >= 12) {
      ctx.strokeStyle = "rgba(148, 163, 184, 0.045)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.floor(xmin / minor) * minor; x <= xmax; x += minor) {
        const sx = Math.round(worldToScreen(view, canvas, x, 0).x) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
      }
      for (let y = Math.floor(ymin / minor) * minor; y <= ymax; y += minor) {
        const sy = Math.round(worldToScreen(view, canvas, 0, y).y) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(148, 163, 184, 0.11)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(xmin / step) * step; x <= xmax; x += step) {
      const sx = Math.round(worldToScreen(view, canvas, x, 0).x) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    for (let y = Math.floor(ymin / step) * step; y <= ymax; y += step) {
      const sy = Math.round(worldToScreen(view, canvas, 0, y).y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();

    /* Special Critical Line Re(s) = 1/2 guide for Zeta, Xi, & Zeta' / Zeta */
    const fn = state.functions[state.fnIndex];
    if (isInput && state.showLandmarks && fn && (fn.id === "zeta" || fn.id === "xi" || fn.id === "zeta_log_deriv")) {
      const critX = worldToScreen(view, canvas, 0.5, 0).x;
      if (critX >= -2 && critX <= w + 2) {
        ctx.save();
        ctx.strokeStyle = "rgba(251, 191, 36, 0.32)";
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(critX, 0);
        ctx.lineTo(critX, h);
        ctx.stroke();
        ctx.fillStyle = "rgba(251, 191, 36, 0.72)";
        ctx.font = '10.5px "JetBrains Mono", monospace';
        ctx.fillText("Re(s) = 1/2", critX + 6, h - 38);
        ctx.restore();
      }
    }

    /* Helpful 2*pi*i markers on the Integral plane imaginary axis */
    if (!isInput && state.mode === "integral") {
      ctx.save();
      ctx.font = '10px "JetBrains Mono", monospace';
      for (const mult of [-4, -3, -2, -1, 1, 2, 3, 4]) {
        const yv = mult * 2 * Math.PI;
        if (yv < ymin || yv > ymax) continue;
        const sp = worldToScreen(view, canvas, 0, yv);
        if (sp.x > -20 && sp.x < w + 20) {
          ctx.strokeStyle = "rgba(52, 211, 153, 0.25)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sp.x - 6, sp.y);
          ctx.lineTo(sp.x + 6, sp.y);
          ctx.stroke();
          ctx.fillStyle = "rgba(52, 211, 153, 0.65)";
          ctx.fillText(`${mult * 2}πi`, sp.x + 9, sp.y + 3);
        }
      }
      ctx.restore();
    }

    /* Axes */
    const origin = worldToScreen(view, canvas, 0, 0);
    ctx.strokeStyle = "rgba(203, 213, 225, 0.34)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    if (origin.y >= 0 && origin.y <= h) {
      ctx.moveTo(0, origin.y);
      ctx.lineTo(w, origin.y);
    }
    if (origin.x >= 0 && origin.x <= w) {
      ctx.moveTo(origin.x, 0);
      ctx.lineTo(origin.x, h);
    }
    ctx.stroke();

    /* Origin highlight ring on right plane */
    if (!isInput && origin.x >= -20 && origin.x <= w + 20 && origin.y >= -20 && origin.y <= h + 20) {
      ctx.save();
      ctx.strokeStyle = "rgba(52, 211, 153, 0.45)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(52, 211, 153, 0.9)";
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* Tick labels */
    ctx.fillStyle = "rgba(148, 163, 184, 0.65)";
    ctx.font = '10.5px "JetBrains Mono", monospace';
    const axisLabelY = Math.min(h - 14, Math.max(38, origin.y + 14));
    const axisLabelX = Math.min(w - 42, Math.max(10, origin.x + 6));

    for (let x = Math.floor(xmin / step) * step; x <= xmax; x += step) {
      if (Math.abs(x) < step * 0.25) continue;
      const sx = worldToScreen(view, canvas, x, 0).x;
      if (sx > 28 && sx < w - 28) {
        ctx.fillText(fmtTick(x), sx - 10, axisLabelY);
      }
    }
    for (let y = Math.floor(ymin / step) * step; y <= ymax; y += step) {
      if (Math.abs(y) < step * 0.25) continue;
      const sy = worldToScreen(view, canvas, 0, y).y;
      if (sy > 42 && sy < h - 20) {
        ctx.fillText(`${fmtTick(y)}i`, axisLabelX, sy + 3.5);
      }
    }

    ctx.fillStyle = "rgba(148, 163, 184, 0.5)";
    ctx.font = '600 11px "Inter", sans-serif';
    const reLabel = isInput ? "Re(z)" : state.mode === "integral" ? "Re(I)" : "Re(w)";
    const imLabel = isInput ? "Im(z)" : state.mode === "integral" ? "Im(I)" : "Im(w)";
    ctx.fillText(reLabel, w - 42, Math.min(h - 10, Math.max(46, origin.y - 6)));
    ctx.fillText(imLabel, Math.min(w - 46, Math.max(12, origin.x + 8)), 52);
  }

  function drawLandmarks(ctx, canvas, view) {
    const fn = state.functions[state.fnIndex];
    if (!fn || !state.showLandmarks || !fn.landmarks) return;

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.save();
    ctx.font = '10.5px "JetBrains Mono", monospace';

    for (const lm of fn.landmarks) {
      const sp = worldToScreen(view, canvas, lm.x, lm.y);
      if (sp.x < -30 || sp.x > w + 30 || sp.y < -30 || sp.y > h + 30) continue;

      if (lm.kind === "pole") {
        ctx.strokeStyle = "#fb7185";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sp.x - 5, sp.y - 5);
        ctx.lineTo(sp.x + 5, sp.y + 5);
        ctx.moveTo(sp.x + 5, sp.y - 5);
        ctx.lineTo(sp.x - 5, sp.y + 5);
        ctx.stroke();
        ctx.fillStyle = "rgba(251, 113, 133, 0.9)";
        ctx.fillText(lm.label, sp.x + 8, sp.y + 3);
      } else if (lm.kind === "zero") {
        ctx.strokeStyle = "#34d399";
        ctx.fillStyle = "#0a0e17";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "rgba(52, 211, 153, 0.85)";
        ctx.fillText(lm.label, sp.x + 8, sp.y + 3);
      } else {
        ctx.fillStyle = "#fbbf24";
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(lm.label, sp.x + 7, sp.y + 3);
      }
    }
    ctx.restore();
  }

  function traceSubpaths(ctx, canvas, view, pts, closed) {
    let segOpen = false;
    let firstValid = null;
    let validCount = 0;

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!p) {
        segOpen = false;
        continue;
      }
      const sp = worldToScreen(view, canvas, p.x, p.y);
      if (!segOpen) {
        ctx.moveTo(sp.x, sp.y);
        if (!firstValid) firstValid = sp;
        segOpen = true;
      } else {
        ctx.lineTo(sp.x, sp.y);
      }
      validCount++;
    }
    if (closed && validCount >= 3 && firstValid && pts.every((p) => p !== null)) {
      ctx.closePath();
    }
  }

  function drawArrowHead(ctx, ax, ay, bx, by, color, sz = 7.5) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return;
    const ux = dx / len;
    const uy = dy / len;
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

  function drawDirectionalArrow(ctx, canvas, view, pts, color, frac = 0.55) {
    const valid = pts.filter((p) => p !== null);
    if (valid.length < 4) return;
    const mid = Math.max(1, Math.min(valid.length - 1, Math.floor(valid.length * frac)));
    const a = worldToScreen(view, canvas, valid[mid - 1].x, valid[mid - 1].y);
    const b = worldToScreen(view, canvas, valid[mid].x, valid[mid].y);
    drawArrowHead(ctx, a.x, a.y, b.x, b.y, color, 7);
  }

  function drawResizeHandles(ctx, canvas, view, shape) {
    const handles = getResizeHandles(shape);
    if (handles.length === 0) return;

    ctx.save();
    /* Subtle bounding box outline for freehand scale handles */
    if (handles[0].shapeKind === "scale") {
      const bb = bboxOf(shape.rawPts);
      const tl = worldToScreen(view, canvas, bb.xmin, bb.ymax);
      const br = worldToScreen(view, canvas, bb.xmax, bb.ymin);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.setLineDash([]);
    }

    /* Center anchor dot for circles */
    if (handles[0].shapeKind === "circle") {
      const bb = bboxOf(shape.rawPts);
      const c = worldToScreen(view, canvas, bb.cx, bb.cy);
      ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
      ctx.beginPath();
      ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const h of handles) {
      const sp = worldToScreen(view, canvas, h.x, h.y);
      const isHovered =
        state.hoveredHandle &&
        state.hoveredHandle.shape.id === shape.id &&
        state.hoveredHandle.handle.id === h.id;
      const r = isHovered ? 6 : 4.8;

      ctx.fillStyle = isHovered ? "#ffffff" : "#0a0e17";
      ctx.strokeStyle = isHovered ? shape.color : "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (h.shapeKind === "rect" || h.shapeKind === "scale") {
        ctx.rect(sp.x - r, sp.y - r, r * 2, r * 2);
      } else {
        ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawShapeOnInputPlane(ctx, canvas, view, shape) {
    if (!shape.visible) return;
    const pts =
      shape.boundary && shape.boundary.inPts && shape.boundary.inPts.length >= 2
        ? shape.boundary.inPts
        : shape.rawPts;
    if (!pts || pts.length < 2) return;

    const isHighlighted =
      shape.id === state.hoveredShapeId ||
      shape.id === state.selectedShapeId ||
      (state.dragShape && state.dragShape.shape.id === shape.id);

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (shape.closed) {
      ctx.beginPath();
      traceSubpaths(ctx, canvas, view, pts, true);
      ctx.fillStyle = hexToRgba(shape.color, state.mode === "integral" ? 0.11 : 0.15);
      ctx.fill("nonzero");
    }

    if (state.mode === "map" && shape.closed && state.showMesh && shape.mesh && shape.mesh.length > 0) {
      ctx.strokeStyle = hexToRgba(shape.color, 0.25);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const line of shape.mesh) {
        traceSubpaths(ctx, canvas, view, line.inPts, false);
      }
      ctx.stroke();
    }

    ctx.beginPath();
    traceSubpaths(ctx, canvas, view, pts, shape.closed);
    ctx.strokeStyle = hexToRgba(shape.color, isHighlighted ? 0.52 : 0.28);
    ctx.lineWidth = isHighlighted ? 9.0 : shape.closed ? 6.5 : 5.5;
    ctx.stroke();

    ctx.beginPath();
    traceSubpaths(ctx, canvas, view, pts, shape.closed);
    ctx.strokeStyle = isHighlighted ? "#ffffff" : shape.color;
    ctx.lineWidth = isHighlighted ? 2.8 : shape.closed ? 2.4 : 2.1;
    ctx.stroke();

    if (isHighlighted) {
      ctx.beginPath();
      traceSubpaths(ctx, canvas, view, pts, shape.closed);
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    /* Draw orientation arrows (extra visible in Integral mode since orientation flips sign!) */
    drawDirectionalArrow(ctx, canvas, view, pts, shape.color, 0.25);
    if (state.mode === "integral" || shape.closed) {
      drawDirectionalArrow(ctx, canvas, view, pts, shape.color, 0.72);
    }

    if (!shape.closed) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (first) {
        const sp = worldToScreen(view, canvas, first.x, first.y);
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (last) {
        const sp = worldToScreen(view, canvas, last.x, last.y);
        ctx.fillStyle = shape.color;
        ctx.strokeStyle = "#0a0e17";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    if (state.playing && pts.length > 1) {
      const idx = Math.floor(state.playPhase * (pts.length - 1)) % pts.length;
      const p = pts[idx];
      if (p) {
        const sp = worldToScreen(view, canvas, p.x, p.y);
        const grad = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 14);
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(0.35, hexToRgba(shape.color, 0.9));
        grad.addColorStop(1, hexToRgba(shape.color, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 14, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();

    /* Show interactive resize handles when selected */
    if (shape.id === state.selectedShapeId) {
      drawResizeHandles(ctx, canvas, view, shape);
    }
  }

  function drawShapeOnMapOutput(ctx, canvas, view, shape) {
    if (!shape.visible || !shape.boundary) return;
    const pts = getMorphedOutPts(shape);
    if (!pts || pts.length < 2) return;

    const allValid = pts.every((p) => p !== null);
    const isHighlighted =
      shape.id === state.hoveredShapeId ||
      shape.id === state.selectedShapeId ||
      (state.dragShape && state.dragShape.shape.id === shape.id);

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (shape.closed && allValid) {
      ctx.beginPath();
      traceSubpaths(ctx, canvas, view, pts, true);
      ctx.fillStyle = hexToRgba(shape.color, 0.19);
      ctx.fill("nonzero");
    }

    if (shape.closed && state.showMesh && shape.mesh && shape.mesh.length > 0) {
      ctx.strokeStyle = hexToRgba(shape.color, 0.3);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const line of shape.mesh) {
        const mpts =
          state.lab.morphT >= 0.999
            ? line.outPts
            : line.outPts.map((op, i) => morphPoint(line.inPts[i], op));
        traceSubpaths(ctx, canvas, view, mpts, false);
      }
      ctx.stroke();
    }

    ctx.beginPath();
    traceSubpaths(ctx, canvas, view, pts, shape.closed);
    ctx.strokeStyle = hexToRgba(shape.color, isHighlighted ? 0.52 : 0.28);
    ctx.lineWidth = isHighlighted ? 9.0 : shape.closed ? 6.5 : 5.5;
    ctx.stroke();

    ctx.beginPath();
    traceSubpaths(ctx, canvas, view, pts, shape.closed);
    ctx.strokeStyle = isHighlighted ? "#ffffff" : shape.color;
    ctx.lineWidth = isHighlighted ? 2.8 : shape.closed ? 2.4 : 2.1;
    ctx.stroke();

    if (isHighlighted) {
      ctx.beginPath();
      traceSubpaths(ctx, canvas, view, pts, shape.closed);
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    drawDirectionalArrow(ctx, canvas, view, pts, shape.color, 0.55);

    if (state.playing && pts.length > 1) {
      const idx = Math.floor(state.playPhase * (pts.length - 1)) % pts.length;
      const p = pts[idx];
      if (p) {
        const sp = worldToScreen(view, canvas, p.x, p.y);
        const grad = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 14);
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(0.35, hexToRgba(shape.color, 0.9));
        grad.addColorStop(1, hexToRgba(shape.color, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 14, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawShapeOnIntegralOutput(ctx, canvas, view, shape) {
    if (!shape.visible || !shape.integral) return;
    const integ = shape.integral;
    const pts = integ.cumPts;
    if (!pts || pts.length < 2) return;

    const isHighlighted =
      shape.id === state.hoveredShapeId ||
      shape.id === state.selectedShapeId ||
      (state.dragShape && state.dragShape.shape.id === shape.id);

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    /* 1. Cumulative partial integral path I(t) from 0 to I(1) */
    ctx.beginPath();
    traceSubpaths(ctx, canvas, view, pts, false);
    ctx.strokeStyle = hexToRgba(shape.color, isHighlighted ? 0.36 : 0.18);
    ctx.lineWidth = isHighlighted ? 7 : 5;
    ctx.stroke();

    ctx.beginPath();
    traceSubpaths(ctx, canvas, view, pts, false);
    ctx.strokeStyle = hexToRgba(shape.color, isHighlighted ? 0.95 : 0.72);
    ctx.lineWidth = isHighlighted ? 2.4 : 1.9;
    ctx.stroke();

    drawDirectionalArrow(ctx, canvas, view, pts, shape.color, 0.5);

    /* 2. Resultant vector arrow from origin 0 to final integral value I(1) */
    const oSp = worldToScreen(view, canvas, 0, 0);
    const endSp = worldToScreen(view, canvas, integ.total.x, integ.total.y);
    const vecLen = Math.hypot(endSp.x - oSp.x, endSp.y - oSp.y);

    if (vecLen > 8) {
      ctx.save();
      ctx.strokeStyle = hexToRgba(shape.color, isHighlighted ? 0.9 : 0.65);
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = isHighlighted ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(oSp.x, oSp.y);
      ctx.lineTo(endSp.x, endSp.y);
      ctx.stroke();
      ctx.setLineDash([]);
      drawArrowHead(ctx, oSp.x, oSp.y, endSp.x, endSp.y, shape.color, 8.5);
      ctx.restore();
    }

    /* 3. Illuminated endpoint diamond at final integral value I(1) */
    const dSz = isHighlighted ? 8 : 6.5;
    const glow = ctx.createRadialGradient(endSp.x, endSp.y, 0, endSp.x, endSp.y, 20);
    glow.addColorStop(0, hexToRgba(shape.color, 0.6));
    glow.addColorStop(1, hexToRgba(shape.color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(endSp.x, endSp.y, 20, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(endSp.x, endSp.y - dSz);
    ctx.lineTo(endSp.x + dSz, endSp.y);
    ctx.lineTo(endSp.x, endSp.y + dSz);
    ctx.lineTo(endSp.x - dSz, endSp.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    /* 4. Crisp floating value tag next to I(1) */
    const tag = fmtCompactComplex(integ.total.x, integ.total.y);
    ctx.font = '600 11px "JetBrains Mono", monospace';
    const tw = ctx.measureText(tag).width;
    const lx = endSp.x + 12;
    const ly = endSp.y - 10;
    ctx.fillStyle = "rgba(10, 14, 23, 0.86)";
    ctx.strokeStyle = hexToRgba(shape.color, 0.55);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(lx - 5, ly - 11, tw + 10, 18, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(tag, lx, ly + 1);

    /* 5. Animated comet tracing cumulative integral I(t) */
    if (state.playing && pts.length > 1) {
      const idx = Math.floor(state.playPhase * (pts.length - 1)) % pts.length;
      const p = pts[idx];
      if (p) {
        const sp = worldToScreen(view, canvas, p.x, p.y);
        const grad = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 15);
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(0.35, hexToRgba(shape.color, 0.95));
        grad.addColorStop(1, hexToRgba(shape.color, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 15, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function drawDraft(ctx, canvas, view, isInput) {
    const d = state.drawing;
    if (d && d.rawPts.length >= 1) {
      if (isInput) {
        const pts = d.rawPts;
        if (pts.length >= 2) {
          ctx.save();
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          if (d.closed || d.snapActive) {
            ctx.beginPath();
            traceSubpaths(ctx, canvas, view, pts, true);
            ctx.fillStyle = hexToRgba(d.color, 0.16);
            ctx.fill("nonzero");
          }
          ctx.beginPath();
          traceSubpaths(ctx, canvas, view, pts, d.closed || d.snapActive);
          ctx.strokeStyle = d.color;
          ctx.lineWidth = 2.3;
          ctx.stroke();
          ctx.restore();
        }
        if (d.kind === "freehand" && d.rawPts.length >= 6) {
          const startSp = worldToScreen(view, canvas, d.rawPts[0].x, d.rawPts[0].y);
          ctx.save();
          ctx.strokeStyle = d.snapActive ? "#34d399" : "rgba(255,255,255,0.4)";
          ctx.fillStyle = d.snapActive ? "rgba(52, 211, 153, 0.22)" : "transparent";
          ctx.lineWidth = d.snapActive ? 2.2 : 1.2;
          ctx.beginPath();
          ctx.arc(startSp.x, startSp.y, d.snapActive ? SNAP_PX * 0.75 : 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          if (d.snapActive) {
            ctx.fillStyle = "#34d399";
            ctx.font = '600 11px "Inter", sans-serif';
            ctx.fillText("Release to close", startSp.x + 16, startSp.y + 4);
          }
          ctx.restore();
        }
      } else if (state.mode === "map" && d.liveOut && d.liveOut.length >= 2) {
        ctx.save();
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        if (d.closed || d.snapActive) {
          ctx.beginPath();
          traceSubpaths(ctx, canvas, view, d.liveOut, true);
          ctx.fillStyle = hexToRgba(d.color, 0.16);
          ctx.fill("nonzero");
        }
        ctx.beginPath();
        traceSubpaths(ctx, canvas, view, d.liveOut, d.closed || d.snapActive);
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 2.3;
        ctx.stroke();
        ctx.restore();
      } else if (state.mode === "integral" && d.liveIntegral) {
        drawShapeOnIntegralOutput(ctx, canvas, view, {
          id: -1,
          visible: true,
          color: d.color,
          closed: d.closed || d.snapActive,
          integral: d.liveIntegral,
        });
      }
    }

    const poly = state.polyDraft;
    if (poly && poly.rawPts.length >= 1) {
      if (isInput) {
        const pts = poly.hoverPt ? [...poly.rawPts, poly.hoverPt] : poly.rawPts;
        if (pts.length >= 2) {
          ctx.save();
          ctx.beginPath();
          traceSubpaths(ctx, canvas, view, pts, false);
          ctx.strokeStyle = poly.color;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.stroke();
          ctx.restore();
        }
        ctx.save();
        for (let i = 0; i < poly.rawPts.length; i++) {
          const sp = worldToScreen(view, canvas, poly.rawPts[i].x, poly.rawPts[i].y);
          ctx.fillStyle = i === 0 && poly.snapActive ? "#34d399" : poly.color;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, i === 0 && poly.snapActive ? 7 : 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else if (state.mode === "map" && poly.liveOut && poly.liveOut.length >= 2) {
        ctx.save();
        ctx.beginPath();
        traceSubpaths(ctx, canvas, view, poly.liveOut, false);
        ctx.strokeStyle = poly.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawProbe(ctx, canvas, view, isInput) {
    if (!state.probe.active) return;
    if (!isInput && state.mode === "integral") return;
    const pt = isInput ? state.probe.z : state.probe.w;
    if (!pt) return;
    const sp = worldToScreen(view, canvas, pt.x, pt.y);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (sp.x < -20 || sp.x > w + 20 || sp.y < -20 || sp.y > h + 20) return;

    const color = isInput ? "#38bdf8" : "#a78bfa";
    ctx.save();
    ctx.strokeStyle = hexToRgba(color, 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sp.x - 14, sp.y);
    ctx.lineTo(sp.x + 14, sp.y);
    ctx.moveTo(sp.x, sp.y - 14);
    ctx.lineTo(sp.x, sp.y + 14);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawLabInputOverlays(ctx, canvas, view) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    /* 1. Dirichlet Re(s) = 1 Convergence Wall */
    if (state.lab.dirichlet.enabled) {
      const wx = worldToScreen(view, canvas, 1.0, 0).x;
      if (wx >= -2 && wx <= w + 2) {
        ctx.save();
        ctx.fillStyle = "rgba(251, 113, 133, 0.06)";
        ctx.fillRect(0, 0, Math.max(0, wx), h);
        ctx.strokeStyle = "rgba(251, 113, 133, 0.7)";
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(wx, 0);
        ctx.lineTo(wx, h);
        ctx.stroke();
        ctx.fillStyle = "#fda4af";
        ctx.font = '600 10.5px "JetBrains Mono", monospace';
        ctx.fillText("Re(s) = 1 (Dirichlet Wall)", wx + 6, 62);
        ctx.restore();
      }
    }

    /* 2. Taylor Disk of Convergence |z - z0| < R & Draggable Center Pin z0 */
    const tay = state.lab.taylor;
    if (tay.enabled) {
      const cSp = worldToScreen(view, canvas, tay.x0, tay.y0);
      const radPx = tay.radius * view.scale;
      ctx.save();
      if (radPx > 2 && radPx < 6000) {
        ctx.fillStyle = "rgba(251, 191, 36, 0.07)";
        ctx.strokeStyle = "rgba(251, 191, 36, 0.65)";
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cSp.x, cSp.y, radPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = "#fbbf24";
      ctx.strokeStyle = "#0a0e17";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cSp.x, cSp.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fde047";
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.fillText(`z₀ (R=${tay.radius >= 99 ? "∞" : tay.radius.toFixed(2)})`, cSp.x + 10, cSp.y - 6);
      ctx.restore();
    }

    /* 3. Zero Hunter Discovered Zeros */
    if (state.lab.foundZeros.length > 0) {
      ctx.save();
      ctx.font = '600 10.5px "JetBrains Mono", monospace';
      state.lab.foundZeros.forEach((z, idx) => {
        const sp = worldToScreen(view, canvas, z.x, z.y);
        if (sp.x < -20 || sp.x > w + 20 || sp.y < -20 || sp.y > h + 20) return;
        ctx.strokeStyle = "#fde047";
        ctx.fillStyle = "rgba(253, 224, 71, 0.2)";
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 7.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fde047";
        ctx.fillText(`Z${idx + 1}`, sp.x + 10, sp.y - 4);
      });
      ctx.restore();
    }
  }

  function drawLabOutputOverlays(ctx, canvas, view) {
    if (state.mode !== "map") return;

    /* 1. Taylor Polynomial Image T_N(z) (dashed gold) */
    if (state.lab.taylor.enabled && state.lab.taylor.coeffs.length >= 2) {
      ctx.save();
      ctx.strokeStyle = "#fde047";
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 2;
      for (const s of state.shapes) {
        if (!s.visible || !s.boundary) continue;
        const tPts = s.boundary.inPts.map((p) => evalTaylorPoly(p.x, p.y));
        ctx.beginPath();
        traceSubpaths(ctx, canvas, view, tPts, s.closed);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* 2. Dirichlet Partial Sum S_N(s) (fiery coral) */
    if (state.lab.dirichlet.enabled) {
      ctx.save();
      ctx.strokeStyle = "#fb7185";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 4]);
      for (const s of state.shapes) {
        if (!s.visible) continue;
        const dPts = state.lab.dirichlet.curves.get(s.id);
        if (!dPts || dPts.length < 2) continue;
        ctx.beginPath();
        traceSubpaths(ctx, canvas, view, dPts, s.closed);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function renderFrame(ts) {
    renderQueued = false;
    if (state.dim !== "complex") return;
    const dpr = window.devicePixelRatio || 1;

    if (state.playing) {
      if (state.lastFrameTime > 0) {
        const dt = Math.min(0.05, (ts - state.lastFrameTime) / 1000);
        state.playPhase = (state.playPhase + dt * 0.22) % 1.0;
      }
      state.lastFrameTime = ts;
    } else {
      state.lastFrameTime = 0;
    }

    /* Input plane */
    ctxIn.save();
    ctxIn.scale(dpr, dpr);
    drawGrid(ctxIn, canvasIn, state.inView, true);
    drawLandmarks(ctxIn, canvasIn, state.inView);
    drawLabInputOverlays(ctxIn, canvasIn, state.inView);
    for (const s of state.shapes) drawShapeOnInputPlane(ctxIn, canvasIn, state.inView, s);
    drawDraft(ctxIn, canvasIn, state.inView, true);
    drawProbe(ctxIn, canvasIn, state.inView, true);
    ctxIn.restore();

    /* Output plane (2D plane OR 3D Riemann Sphere) */
    ctxOut.save();
    ctxOut.scale(dpr, dpr);
    if (window.RiemannSphere && window.RiemannSphere.state.enabled) {
      window.RiemannSphere.render(ctxOut, canvasOut, state.shapes, {
        getPts: (s) =>
          state.mode === "integral"
            ? s.integral
              ? s.integral.cumPts
              : null
            : getMorphedOutPts(s),
        selectedShapeId: state.selectedShapeId,
        hoveredShapeId: state.hoveredShapeId,
        playPhase: state.playPhase,
        playing: state.playing,
        probe: state.mode === "map" ? state.probe : null,
      });
    } else {
      drawGrid(ctxOut, canvasOut, state.outView, false);
      if (state.mode === "integral") {
        for (const s of state.shapes) drawShapeOnIntegralOutput(ctxOut, canvasOut, state.outView, s);
      } else {
        for (const s of state.shapes) drawShapeOnMapOutput(ctxOut, canvasOut, state.outView, s);
        drawLabOutputOverlays(ctxOut, canvasOut, state.outView);
      }
      drawDraft(ctxOut, canvasOut, state.outView, false);
      drawProbe(ctxOut, canvasOut, state.outView, false);
    }
    ctxOut.restore();

    if (state.playing) {
      requestRender();
    }
  }

  /* -------------------------------------------------------------------------
   * Integral Readout Card
   * ------------------------------------------------------------------------- */

  function updateIntegralCard() {
    if (state.mode !== "integral") {
      integralCard.classList.add("hidden");
      return;
    }
    integralCard.classList.remove("hidden");

    const draftInteg = state.drawing && state.drawing.liveIntegral;
    const visible = state.shapes.filter((s) => s.visible && s.integral);

    let activeShape = null;
    if (state.selectedShapeId !== null) {
      activeShape = visible.find((s) => s.id === state.selectedShapeId) || null;
    }
    if (!activeShape && visible.length > 0) {
      activeShape = visible[visible.length - 1];
    }

    if (draftInteg) {
      intDot.style.background = state.drawing.color;
      intTitle.textContent = "Tracing Contour…";
      const closed = state.drawing.closed || state.drawing.snapActive;
      intSym.innerHTML = closed ? "&oint;<sub>&gamma;</sub> f(z) dz =" : "&int;<sub>&gamma;</sub> f(z) dz =";
      intOrient.textContent = closed
        ? draftInteg.orientation >= 0
          ? "CCW ↺"
          : "CW ↻"
        : "Open";
      intVal.textContent = draftInteg.singular
        ? "Singular (contour hits pole)"
        : fmtComplex(draftInteg.total.x, draftInteg.total.y, 5);
      intRes.textContent = draftInteg.singular
        ? "—"
        : fmtComplex(draftInteg.div2pii.x, draftInteg.div2pii.y, 5);
      intMag.textContent = Math.hypot(draftInteg.total.x, draftInteg.total.y).toFixed(5);
      intLen.textContent = draftInteg.arcLength.toFixed(3);
      intSumRow.classList.add("hidden");
      return;
    }

    if (!activeShape) {
      intDot.style.background = "#64748b";
      intTitle.textContent = "Draw a contour on the left plane";
      intOrient.textContent = "—";
      intSym.innerHTML = "&int;<sub>&gamma;</sub> f(z) dz =";
      intVal.textContent = "—";
      intRes.textContent = "—";
      intMag.textContent = "—";
      intLen.textContent = "—";
      intSumRow.classList.add("hidden");
      return;
    }

    const ig = activeShape.integral;
    intDot.style.background = activeShape.color;
    intTitle.textContent = activeShape.label;
    intSym.innerHTML = activeShape.closed
      ? "&oint;<sub>&gamma;</sub> f(z) dz ="
      : "&int;<sub>&gamma;</sub> f(z) dz =";
    intOrient.textContent = activeShape.closed
      ? ig.orientation > 0
        ? "CCW ↺"
        : ig.orientation < 0
        ? "CW ↻"
        : "Closed"
      : "Open";

    if (ig.singular) {
      intVal.textContent = "Pole on contour";
      intRes.textContent = "undefined";
      intRes.className = "int-metric-val warn";
    } else {
      intVal.textContent = fmtComplex(ig.total.x, ig.total.y, 6);
      intRes.textContent = fmtComplex(ig.div2pii.x, ig.div2pii.y, 6);
      intRes.className = "int-metric-val highlight";
    }
    intMag.textContent = Math.hypot(ig.total.x, ig.total.y).toFixed(5);
    intLen.textContent = ig.arcLength.toFixed(3);

    if (visible.length > 1) {
      let sumRe = 0;
      let sumIm = 0;
      for (const s of visible) {
        sumRe += s.integral.total.x;
        sumIm += s.integral.total.y;
      }
      intSumRow.classList.remove("hidden");
      intSumVal.textContent = fmtComplex(sumRe, sumIm, 5);
    } else {
      intSumRow.classList.add("hidden");
    }
  }

  /* -------------------------------------------------------------------------
   * Live Probe & Live Draft Evaluation
   * ------------------------------------------------------------------------- */

  async function updateProbe(z) {
    state.probe.active = true;
    state.probe.z = z;
    readoutZ.textContent = fmtComplex(z.x, z.y, 4);
    requestRender();

    if (state.probe.pending) {
      state.probe.queuedZ = z;
      return;
    }
    state.probe.pending = true;
    try {
      let cur = z;
      while (cur) {
        state.probe.queuedZ = null;
        const out = await apiEval([cur]);
        if (out && out.length === 1) {
          const w = out[0];
          state.probe.w = w;
          if (w) {
            readoutW.textContent = fmtComplex(w.x, w.y, 4);
            readoutMag.textContent = Math.hypot(w.x, w.y).toFixed(4);
          } else {
            readoutW.textContent = "∞ (pole)";
            readoutMag.textContent = "∞";
          }
          requestRender();
        }
        cur = state.probe.queuedZ;
      }
    } finally {
      state.probe.pending = false;
    }
  }

  let liveEvalBusy = false;
  let liveEvalQueued = false;

  async function refreshLiveDraftOutput() {
    if (liveEvalBusy) {
      liveEvalQueued = true;
      return;
    }
    liveEvalBusy = true;
    try {
      do {
        liveEvalQueued = false;
        const d = state.drawing;
        if (d && d.rawPts.length >= 2) {
          if (state.mode === "integral") {
            const raw = await apiIntegrate(d.rawPts, d.closed || d.snapActive, 1.4);
            if (raw && state.drawing === d) {
              d.liveIntegral = unpackIntegral(raw);
              updateIntegralCard();
              requestRender();
            }
          } else {
            const out = await apiEval(d.rawPts);
            if (out && state.drawing === d) {
              d.liveOut = out;
              requestRender();
            }
          }
        } else if (state.polyDraft && state.polyDraft.rawPts.length >= 1 && state.mode === "map") {
          const poly = state.polyDraft;
          const verts = poly.hoverPt ? [...poly.rawPts, poly.hoverPt] : poly.rawPts;
          if (verts.length >= 2) {
            const dense = [];
            for (let i = 0; i < verts.length - 1; i++) {
              dense.push(...makeLinePoints(verts[i].x, verts[i].y, verts[i + 1].x, verts[i + 1].y, 20));
            }
            const out = await apiEval(dense);
            if (out && state.polyDraft === poly) {
              poly.liveOut = out;
              requestRender();
            }
          }
        }
      } while (liveEvalQueued);
    } finally {
      liveEvalBusy = false;
    }
  }

  /* -------------------------------------------------------------------------
   * Shape Hit-Testing, Live Drag Translation & Live Resize
   * ------------------------------------------------------------------------- */

  function distToSegmentSq(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 1e-9) {
      t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    }
    const ex = px - (ax + t * dx);
    const ey = py - (ay + t * dy);
    return ex * ex + ey * ey;
  }

  function pointInPolygon(wx, wy, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y;
      const xj = pts[j].x, yj = pts[j].y;
      const intersect =
        yi > wy !== yj > wy && wx < ((xj - xi) * (wy - yi)) / (yj - yi + 1e-30) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function hitTestShape(sx, sy) {
    const thresholdSq = 12 * 12;
    const wpt = screenToWorld(state.inView, canvasIn, sx, sy);

    for (let i = state.shapes.length - 1; i >= 0; i--) {
      const s = state.shapes[i];
      if (!s.visible) continue;
      const pts = s.boundary && s.boundary.inPts.length >= 2 ? s.boundary.inPts : s.rawPts;
      if (!pts || pts.length < 2) continue;

      const segCount = s.closed ? pts.length : pts.length - 1;
      for (let k = 0; k < segCount; k++) {
        const a = worldToScreen(state.inView, canvasIn, pts[k].x, pts[k].y);
        const b = worldToScreen(state.inView, canvasIn, pts[(k + 1) % pts.length].x, pts[(k + 1) % pts.length].y);
        if (distToSegmentSq(sx, sy, a.x, a.y, b.x, b.y) <= thresholdSq) {
          return s;
        }
      }

      if (s.closed && s.rawPts.length >= 3 && pointInPolygon(wpt.x, wpt.y, s.rawPts)) {
        return s;
      }
    }
    return null;
  }

  function shiftPts(pts, dx, dy) {
    return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }

  function applyMoveShiftToShape(drag, dx, dy) {
    const s = drag.shape;
    const ddx = dx - drag.curDx;
    const ddy = dy - drag.curDy;
    drag.curDx = dx;
    drag.curDy = dy;

    s.rawPts = shiftPts(drag.origRawPts, dx, dy);
    if (s.boundary) {
      s.boundary.inPts = shiftPts(s.boundary.inPts, ddx, ddy);
    }
    if (s.integral) {
      s.integral.inPts = shiftPts(s.integral.inPts, ddx, ddy);
    }
    if (s.mesh && s.mesh.length > 0) {
      for (const line of s.mesh) {
        line.inPts = shiftPts(line.inPts, ddx, ddy);
      }
    }
  }

  async function flushTransformUpdate(drag) {
    if (drag.busy) {
      drag.dirty = true;
      return;
    }
    drag.busy = true;
    try {
      do {
        drag.dirty = false;
        const reqDx = drag.curDx;
        const reqDy = drag.curDy;
        const snapshotPts = drag.shape.rawPts.map((p) => ({ x: p.x, y: p.y }));

        if (state.mode === "integral") {
          const raw = await apiIntegrate(snapshotPts, drag.shape.closed, 1.35);
          if (raw && state.dragShape === drag && state.shapes.includes(drag.shape)) {
            const ig = unpackIntegral(raw);
            if (drag.mode === "move") {
              const deltaX = drag.curDx - reqDx;
              const deltaY = drag.curDy - reqDy;
              if (Math.abs(deltaX) > 1e-12 || Math.abs(deltaY) > 1e-12) {
                ig.inPts = shiftPts(ig.inPts, deltaX, deltaY);
              }
            }
            drag.shape.integral = ig;
            drag.shape.boundary = { inPts: ig.inPts, outPts: ig.cumPts };
            renderShapeChips();
            updateIntegralCard();
            requestRender();
          }
        } else {
          const data = await apiTrace(snapshotPts, drag.shape.closed, state.showMesh, 1.35);
          if (data && state.dragShape === drag && state.shapes.includes(drag.shape)) {
            const boundary = unpackCurve(data.boundary);
            const mesh = (data.mesh || []).map(unpackCurve);
            if (drag.mode === "move") {
              const deltaX = drag.curDx - reqDx;
              const deltaY = drag.curDy - reqDy;
              if (Math.abs(deltaX) > 1e-12 || Math.abs(deltaY) > 1e-12) {
                boundary.inPts = shiftPts(boundary.inPts, deltaX, deltaY);
                for (const line of mesh) {
                  line.inPts = shiftPts(line.inPts, deltaX, deltaY);
                }
              }
            }
            drag.shape.boundary = boundary;
            drag.shape.mesh = mesh;
            drag.shape.winding = data.winding;
            renderShapeChips();
            requestRender();
          }
        }
      } while (drag.dirty && state.dragShape === drag);
    } finally {
      drag.busy = false;
    }
  }

  /* -------------------------------------------------------------------------
   * Input & Output Canvas Pointer Events
   * ------------------------------------------------------------------------- */

  function localPos(canvas, ev) {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  canvasIn.addEventListener("contextmenu", (e) => e.preventDefault());
  canvasOut.addEventListener("contextmenu", (e) => e.preventDefault());

  canvasIn.addEventListener("pointerdown", (e) => {
    canvasIn.setPointerCapture(e.pointerId);
    const pos = localPos(canvasIn, e);

    if (e.button === 1 || e.button === 2 || state.spaceHeld || state.tool === "pan") {
      state.pan = {
        which: "in",
        startX: pos.x,
        startY: pos.y,
        origCx: state.inView.cx,
        origCy: state.inView.cy,
      };
      inCard.classList.add("panning");
      return;
    }

    const z = screenToWorld(state.inView, canvasIn, pos.x, pos.y);

    /* 0. Taylor z0 click-to-place or drag center pin */
    if (state.lab.taylor.enabled) {
      if (state.lab.taylor.picking) {
        state.lab.taylor.picking = false;
        if (window.LabController) window.LabController.setTaylorCenter(z.x, z.y);
        return;
      }
      const cSp = worldToScreen(state.inView, canvasIn, state.lab.taylor.x0, state.lab.taylor.y0);
      if (Math.hypot(pos.x - cSp.x, pos.y - cSp.y) <= 13) {
        state.lab.taylor.draggingZ0 = true;
        return;
      }
    }

    /* 1. Check resize handles on selected shape (works in Move mode or Alt+click, OR anytime clicking directly on an active handle!) */
    if (state.tool === "move" || e.altKey || state.selectedShapeId !== null) {
      const hHit = hitTestResizeHandle(pos.x, pos.y);
      if (hHit && (state.tool === "move" || e.altKey)) {
        state.dragShape = {
          mode: "resize",
          shape: hHit.shape,
          handle: hHit.handle,
          startWorld: z,
          origRawPts: hHit.shape.rawPts.map((p) => ({ x: p.x, y: p.y })),
          origBox: bboxOf(hHit.shape.rawPts),
          origCcw: signedArea2(hHit.shape.rawPts) >= 0,
          curDx: 0,
          curDy: 0,
          busy: false,
          dirty: false,
        };
        canvasIn.style.cursor = hHit.handle.cursor;
        requestRender();
        return;
      }
    }

    /* 2. Move / Select tool OR Alt+drag from any tool */
    if (state.tool === "move" || e.altKey) {
      const hit = hitTestShape(pos.x, pos.y);
      state.selectedShapeId = hit ? hit.id : null;
      renderShapeChips();
      updateIntegralCard();
      if (hit) {
        state.dragShape = {
          mode: "move",
          shape: hit,
          handle: null,
          startWorld: z,
          origRawPts: hit.rawPts.map((p) => ({ x: p.x, y: p.y })),
          curDx: 0,
          curDy: 0,
          busy: false,
          dirty: false,
        };
        inCard.classList.add("dragging-shape");
      }
      requestRender();
      return;
    }

    if (state.tool === "polygon") {
      if (!state.polyDraft) {
        state.polyDraft = {
          rawPts: [z],
          liveOut: [],
          color: activeColor(),
          hoverPt: z,
          snapActive: false,
        };
      } else {
        const firstSp = worldToScreen(
          state.inView,
          canvasIn,
          state.polyDraft.rawPts[0].x,
          state.polyDraft.rawPts[0].y
        );
        if (state.polyDraft.rawPts.length >= 3 && Math.hypot(pos.x - firstSp.x, pos.y - firstSp.y) <= SNAP_PX) {
          finishPolygon(true);
          return;
        }
        state.polyDraft.rawPts.push(z);
        refreshLiveDraftOutput();
      }
      requestRender();
      return;
    }

    if (state.tool === "freehand") {
      state.drawing = {
        kind: "freehand",
        rawPts: [z],
        liveOut: [],
        liveIntegral: null,
        closed: false,
        color: activeColor(),
        snapActive: false,
        anchor: z,
      };
    } else if (state.tool === "line") {
      state.drawing = {
        kind: "line",
        rawPts: [z, z],
        liveOut: [],
        liveIntegral: null,
        closed: false,
        color: activeColor(),
        snapActive: false,
        anchor: z,
      };
    } else if (state.tool === "circle") {
      state.drawing = {
        kind: "circle",
        rawPts: makeCirclePoints(z.x, z.y, 1e-4, 72, true),
        liveOut: [],
        liveIntegral: null,
        closed: true,
        color: activeColor(),
        snapActive: false,
        anchor: z,
      };
    } else if (state.tool === "rect") {
      state.drawing = {
        kind: "rect",
        rawPts: makeRectPoints(z.x, z.y, z.x, z.y, true),
        liveOut: [],
        liveIntegral: null,
        closed: true,
        color: activeColor(),
        snapActive: false,
        anchor: z,
      };
    }
    requestRender();
  });

  canvasIn.addEventListener("pointermove", (e) => {
    const pos = localPos(canvasIn, e);

    if (state.pan && state.pan.which === "in") {
      state.inView.cx = state.pan.origCx - (pos.x - state.pan.startX) / state.inView.scale;
      state.inView.cy = state.pan.origCy + (pos.y - state.pan.startY) / state.inView.scale;
      if (state.showDomain) scheduleDomainUpdate();
      requestRender();
      return;
    }

    const z = screenToWorld(state.inView, canvasIn, pos.x, pos.y);
    updateProbe(z);

    if (state.lab.taylor.draggingZ0) {
      state.lab.taylor.x0 = z.x;
      state.lab.taylor.y0 = z.y;
      if (window.LabController) window.LabController.onTaylorDragMove(z.x, z.y);
      requestRender();
      return;
    }

    if (state.dragShape) {
      const drag = state.dragShape;
      if (drag.mode === "move") {
        applyMoveShiftToShape(drag, z.x - drag.startWorld.x, z.y - drag.startWorld.y);
      } else {
        applyResizeToShape(drag, z);
      }
      flushTransformUpdate(drag);
      requestRender();
      return;
    }

    if (state.tool === "move" || e.altKey) {
      const hHit = hitTestResizeHandle(pos.x, pos.y);
      if (hHit) {
        state.hoveredHandle = hHit;
        state.hoveredShapeId = hHit.shape.id;
        canvasIn.style.cursor = hHit.handle.cursor;
        inCard.classList.remove("move-hover");
        requestRender();
        return;
      }
      if (state.hoveredHandle) {
        state.hoveredHandle = null;
        canvasIn.style.cursor = "";
      }
      const hit = hitTestShape(pos.x, pos.y);
      const nextId = hit ? hit.id : null;
      if (state.hoveredShapeId !== nextId) {
        state.hoveredShapeId = nextId;
        inCard.classList.toggle("move-hover", nextId !== null);
        requestRender();
      }
      return;
    } else if (state.hoveredShapeId !== null || state.hoveredHandle !== null) {
      state.hoveredShapeId = null;
      state.hoveredHandle = null;
      canvasIn.style.cursor = "";
      inCard.classList.remove("move-hover");
    }

    if (state.polyDraft) {
      state.polyDraft.hoverPt = z;
      const firstSp = worldToScreen(
        state.inView,
        canvasIn,
        state.polyDraft.rawPts[0].x,
        state.polyDraft.rawPts[0].y
      );
      state.polyDraft.snapActive =
        state.polyDraft.rawPts.length >= 3 && Math.hypot(pos.x - firstSp.x, pos.y - firstSp.y) <= SNAP_PX;
      refreshLiveDraftOutput();
      requestRender();
      return;
    }

    const d = state.drawing;
    if (!d) return;

    if (d.kind === "freehand") {
      const last = d.rawPts[d.rawPts.length - 1];
      const lastSp = worldToScreen(state.inView, canvasIn, last.x, last.y);
      if (Math.hypot(pos.x - lastSp.x, pos.y - lastSp.y) >= 4) {
        d.rawPts.push(z);
      }
      if (d.rawPts.length >= 6) {
        const firstSp = worldToScreen(state.inView, canvasIn, d.rawPts[0].x, d.rawPts[0].y);
        d.snapActive = Math.hypot(pos.x - firstSp.x, pos.y - firstSp.y) <= SNAP_PX;
      }
    } else if (d.kind === "line") {
      d.rawPts = makeLinePoints(d.anchor.x, d.anchor.y, z.x, z.y, 48);
    } else if (d.kind === "circle") {
      const r = Math.hypot(z.x - d.anchor.x, z.y - d.anchor.y);
      d.rawPts = makeCirclePoints(d.anchor.x, d.anchor.y, Math.max(r, 1e-4), 72, true);
    } else if (d.kind === "rect") {
      d.rawPts = makeRectPoints(d.anchor.x, d.anchor.y, z.x, z.y, true);
    }

    refreshLiveDraftOutput();
    requestRender();
  });

  canvasIn.addEventListener("pointerup", async () => {
    if (state.lab.taylor.draggingZ0) {
      state.lab.taylor.draggingZ0 = false;
      if (window.LabController) {
        window.LabController.setTaylorCenter(state.lab.taylor.x0, state.lab.taylor.y0);
      }
      return;
    }
    if (state.pan && state.pan.which === "in") {
      state.pan = null;
      inCard.classList.remove("panning");
      return;
    }
    if (state.dragShape) {
      const drag = state.dragShape;
      state.dragShape = null;
      inCard.classList.remove("dragging-shape");
      canvasIn.style.cursor = "";
      await computeShapeData(drag.shape, 1.0);
      if (state.lab.dirichlet.enabled) await fetchDirichletForShape(drag.shape);
      renderShapeChips();
      updateIntegralCard();
      requestRender();
      return;
    }
    const d = state.drawing;
    if (!d) return;
    state.drawing = null;

    const closed = d.closed || d.snapActive;
    if (d.rawPts.length >= 2) {
      let label = "Freehand Path";
      if (d.kind === "freehand" && closed) label = "Closed Loop";
      else if (d.kind === "line") label = "Line Segment";
      else if (d.kind === "circle") label = "Circle";
      else if (d.kind === "rect") label = "Rectangle";
      await commitShape({
        kind: d.kind,
        label,
        rawPts: d.rawPts,
        closed,
        color: d.color,
        autoColor: true,
      });
    }
    updateIntegralCard();
    requestRender();
  });

  canvasIn.addEventListener("dblclick", () => {
    if (state.polyDraft && state.polyDraft.rawPts.length >= 3) {
      finishPolygon(true);
    }
  });

  canvasIn.addEventListener("pointerleave", () => {
    state.probe.active = false;
    if (!state.dragShape && (state.hoveredShapeId !== null || state.hoveredHandle !== null)) {
      state.hoveredShapeId = null;
      state.hoveredHandle = null;
      canvasIn.style.cursor = "";
      inCard.classList.remove("move-hover");
    }
    requestRender();
  });

  canvasIn.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const pos = localPos(canvasIn, e);
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomAt(state.inView, canvasIn, pos.x, pos.y, factor);
    },
    { passive: false }
  );

  /* Output canvas pan & zoom (or 3D Riemann Sphere orbit) */
  canvasOut.addEventListener("pointerdown", (e) => {
    canvasOut.setPointerCapture(e.pointerId);
    const pos = localPos(canvasOut, e);
    if (window.RiemannSphere && window.RiemannSphere.state.enabled) {
      window.RiemannSphere.onPointerDown(pos.x, pos.y);
      outCard.classList.add("panning");
      return;
    }
    state.pan = {
      which: "out",
      startX: pos.x,
      startY: pos.y,
      origCx: state.outView.cx,
      origCy: state.outView.cy,
    };
    outCard.classList.add("panning");
  });

  canvasOut.addEventListener("pointermove", (e) => {
    const pos = localPos(canvasOut, e);
    if (window.RiemannSphere && window.RiemannSphere.state.enabled) {
      if (window.RiemannSphere.onPointerMove(pos.x, pos.y)) {
        requestRender();
      }
      return;
    }
    if (!state.pan || state.pan.which !== "out") return;
    state.outView.cx = state.pan.origCx - (pos.x - state.pan.startX) / state.outView.scale;
    state.outView.cy = state.pan.origCy + (pos.y - state.pan.startY) / state.outView.scale;
    requestRender();
  });

  canvasOut.addEventListener("pointerup", () => {
    if (window.RiemannSphere && window.RiemannSphere.state.enabled) {
      window.RiemannSphere.onPointerUp();
      outCard.classList.remove("panning");
      return;
    }
    if (state.pan && state.pan.which === "out") {
      state.pan = null;
      outCard.classList.remove("panning");
    }
  });

  canvasOut.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (window.RiemannSphere && window.RiemannSphere.state.enabled) {
        window.RiemannSphere.onWheel(e.deltaY);
        requestRender();
        return;
      }
      const pos = localPos(canvasOut, e);
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomAt(state.outView, canvasOut, pos.x, pos.y, factor);
    },
    { passive: false }
  );

  async function finishPolygon(closed) {
    const poly = state.polyDraft;
    if (!poly) return;
    state.polyDraft = null;
    if (poly.rawPts.length >= 2) {
      await commitShape({
        kind: "polygon",
        label: closed ? `Polygon (${poly.rawPts.length}v)` : "Polyline",
        rawPts: poly.rawPts,
        closed: closed && poly.rawPts.length >= 3,
        color: poly.color,
        autoColor: true,
      });
    }
    requestRender();
  }

  /* -------------------------------------------------------------------------
   * Dimension Toggle (Complex C <-> 2D Real R), Mode Switching & UI Rendering
   * ------------------------------------------------------------------------- */

  async function setDimension(dim) {
    state.dim = dim;
    document.querySelectorAll(".dim-btn").forEach((b) => {
      const active = b.dataset.dim === dim;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", String(active));
    });

    const isReal = dim === "real";
    complexModeSwitch.classList.toggle("hidden", isReal);
    fnSelect.classList.toggle("hidden", isReal);
    realFnSelect.classList.toggle("hidden", !isReal);
    complexToolbar.classList.toggle("hidden", isReal);
    realToolbar.classList.toggle("hidden", !isReal);
    complexPlanes.classList.toggle("hidden", isReal);
    realPlaneContainer.classList.toggle("hidden", !isReal);
    complexDock.classList.toggle("hidden", isReal);
    realDock.classList.toggle("hidden", !isReal);

    readoutInLabel.textContent = isReal ? "x" : "z";
    readoutOutLabel.textContent = isReal ? "y" : "f(z)";
    readoutExtraLabel.textContent = isReal ? "err" : "|f|";
    readoutZ.textContent = "—";
    readoutW.textContent = "—";
    readoutMag.textContent = "—";

    if (isReal) {
      if (window.location.pathname !== "/real") {
        window.history.replaceState(null, "", "/real");
      }
      if (window.Real2DController) {
        await window.Real2DController.activate();
      }
      if (window.LabController) window.LabController.onDimensionChange("real");
    } else {
      if (window.Real2DController) {
        window.Real2DController.deactivate();
      }
      const targetPath = state.mode === "integral" ? "/integral" : "/";
      if (window.location.pathname !== targetPath) {
        window.history.replaceState(null, "", targetPath);
      }
      resizeCanvases();
      updateFunctionMeta();
      if (window.LabController) window.LabController.onDimensionChange("complex");
      requestRender();
    }
  }

  async function setMode(mode, loadDefaultShowcase = false) {
    state.mode = mode;
    document.querySelectorAll(".mode-btn").forEach((b) => {
      const active = b.dataset.mode === mode;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", String(active));
    });

    if (mode === "integral") {
      inputTag.textContent = "CONTOUR PLANE";
      inputSub.textContent = "γ(t) ⊂ ℂ";
      outputTag.textContent = "INTEGRAL PLANE";
      outputTag.classList.add("integral-tag");
      btnMesh.classList.add("hidden");
      presetsLabel.textContent = "Integral Examples";
      if (window.location.pathname !== "/integral") {
        window.history.replaceState(null, "", "/integral");
      }
    } else {
      inputTag.textContent = "INPUT PLANE";
      inputSub.textContent = "z = x + iy";
      outputTag.textContent = "OUTPUT PLANE";
      outputTag.classList.remove("integral-tag");
      btnMesh.classList.remove("hidden");
      presetsLabel.textContent = "Presets";
      if (window.location.pathname !== "/") {
        window.history.replaceState(null, "", "/");
      }
    }

    updateFunctionMeta();

    if (loadDefaultShowcase || state.shapes.length === 0) {
      const presets =
        mode === "integral"
          ? getIntegralPresetsForFunction(state.functions[state.fnIndex])
          : getMapPresetsForFunction(state.functions[state.fnIndex]);
      if (presets.length > 0) {
        await presets[0].run();
      }
    } else {
      await recomputeAllShapes();
      autoFitOutput();
    }
    updateIntegralCard();
    requestRender();
  }

  function renderPalette() {
    paletteEl.innerHTML = "";
    PALETTE.forEach((hex, idx) => {
      const b = document.createElement("button");
      b.className = "swatch" + (idx === state.colorIndex ? " active" : "");
      b.style.background = hex;
      b.style.color = hex;
      b.title = `Select color ${hex}`;
      b.addEventListener("click", () => {
        state.colorIndex = idx;
        renderPalette();
      });
      paletteEl.appendChild(b);
    });
  }

  function renderPresets() {
    const fn = state.functions[state.fnIndex];
    const presets =
      state.mode === "integral" ? getIntegralPresetsForFunction(fn) : getMapPresetsForFunction(fn);
    presetsList.innerHTML = "";
    for (const p of presets) {
      const btn = document.createElement("button");
      btn.className = "preset-btn";
      btn.textContent = p.name;
      btn.addEventListener("click", () => p.run());
      presetsList.appendChild(btn);
    }
  }

  function renderShapeChips() {
    shapeCount.textContent = String(state.shapes.length);
    if (state.shapes.length === 0) {
      shapesList.innerHTML = '<span class="empty-note">Draw on the input plane or click a preset.</span>';
      return;
    }
    shapesList.innerHTML = "";
    for (const s of state.shapes) {
      const chip = document.createElement("div");
      chip.className =
        "shape-chip" +
        (s.visible ? "" : " dimmed") +
        (s.id === state.selectedShapeId ? " selected" : "");
      chip.addEventListener("click", (ev) => {
        if (ev.target.closest("button")) return;
        state.selectedShapeId = state.selectedShapeId === s.id ? null : s.id;
        renderShapeChips();
        updateIntegralCard();
        requestRender();
      });

      const dot = document.createElement("span");
      dot.className = "chip-dot";
      dot.style.background = s.color;
      chip.appendChild(dot);

      const text = document.createElement("span");
      text.textContent = s.label;
      chip.appendChild(text);

      if (state.mode === "integral" && s.integral) {
        const badge = document.createElement("span");
        const valStr = s.integral.singular
          ? "pole!"
          : fmtCompactComplex(s.integral.total.x, s.integral.total.y);
        const mag = Math.hypot(s.integral.total.x, s.integral.total.y);
        badge.className =
          "chip-winding" + (s.integral.singular ? " neg" : mag > 1e-4 ? " pos" : "");
        badge.title = "Contour integral value";
        badge.textContent = `I=${valStr}`;
        chip.appendChild(badge);
      } else if (s.closed && s.winding !== null && s.winding !== undefined) {
        const wBadge = document.createElement("span");
        wBadge.className = "chip-winding" + (s.winding > 0 ? " pos" : s.winding < 0 ? " neg" : "");
        wBadge.title = "Winding number of f(z) around w = 0 (Zeros − Poles enclosed)";
        wBadge.textContent = `W(0)=${s.winding > 0 ? "+" : ""}${s.winding}`;
        chip.appendChild(wBadge);
      }

      const eye = document.createElement("button");
      eye.className = "chip-action";
      eye.title = s.visible ? "Hide" : "Show";
      eye.textContent = s.visible ? "◉" : "○";
      eye.addEventListener("click", () => {
        s.visible = !s.visible;
        renderShapeChips();
        updateIntegralCard();
        requestRender();
      });
      chip.appendChild(eye);

      const del = document.createElement("button");
      del.className = "chip-action";
      del.title = "Delete";
      del.textContent = "×";
      del.addEventListener("click", () => {
        state.shapes = state.shapes.filter((x) => x.id !== s.id);
        if (state.selectedShapeId === s.id) state.selectedShapeId = null;
        renderShapeChips();
        updateIntegralCard();
        requestRender();
      });
      chip.appendChild(del);

      shapesList.appendChild(chip);
    }
  }

  function setTool(tool) {
    state.tool = tool;
    state.polyDraft = null;
    if (tool !== "move") {
      state.hoveredShapeId = null;
      state.hoveredHandle = null;
      canvasIn.style.cursor = "";
      inCard.classList.remove("move-hover");
    }
    document.querySelectorAll(".tool-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tool === tool);
    });
    inCard.classList.toggle("pan-mode", tool === "pan");
    inCard.classList.toggle("move-mode", tool === "move");

    const hints = {
      move: "Drag any line/shape to move · Drag handles on selected shape to resize · Delete removes selected · Alt+drag works from any tool",
      freehand: "Drag to trace · Bring end near start to snap closed · Press V or Alt+drag to move & resize · Right-drag/scroll to pan/zoom",
      line: "Click & drag a line segment · Press V to drag endpoints or move · Right-drag/scroll to pan/zoom",
      circle: "Click center & drag radius · Press V to move or resize radius live",
      rect: "Click & drag a rectangle · Press V to drag corners/edges or move live",
      polygon: "Click vertices · Click start or double-click to close · Press V to drag individual vertices",
      pan: "Drag to pan the input plane · Scroll to zoom",
    };
    inputHint.textContent = hints[tool] || "";
    requestRender();
  }

  function clearShapes() {
    state.shapes = [];
    state.drawing = null;
    state.polyDraft = null;
    state.dragShape = null;
    state.selectedShapeId = null;
    state.hoveredShapeId = null;
    state.hoveredHandle = null;
    renderShapeChips();
    updateIntegralCard();
    requestRender();
  }

  function updateFunctionMeta() {
    const fn =
      state.fnIndex === -1
        ? {
            id: "live_c",
            name: "Live C Function",
            formula: "user_fn(z)",
            description: "Hot-compiled native C function via clang + dlopen().",
          }
        : state.functions[state.fnIndex];
    if (!fn) return;
    fnFormula.textContent = `f(z) = ${fn.formula}`;
    outputSub.textContent =
      state.mode === "integral" ? `I(t) = ∫ ${fn.formula} dz` : `w = ${fn.formula}`;
    renderPresets();
    if (window.LabController) window.LabController.onComplexFunctionChange();
  }

  /* Wire dimension, mode & toolbar controls */
  document.querySelectorAll(".dim-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.dim !== state.dim) {
        setDimension(btn.dataset.dim);
      }
    });
  });

  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.mode !== state.mode) {
        setMode(btn.dataset.mode, true);
      }
    });
  });

  document.querySelectorAll(".tool-btn").forEach((btn) => {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  });

  fnSelect.addEventListener("change", async () => {
    state.fnIndex = Number(fnSelect.value);
    updateFunctionMeta();
    if (state.fnIndex >= 0) resetViews();
    if (state.showDomain) scheduleDomainUpdate();
    if (state.shapes.length > 0) {
      await recomputeAllShapes();
      if (state.mode === "integral") autoFitOutput();
    }
  });

  btnToggleSphere.addEventListener("click", () => {
    if (!window.RiemannSphere) return;
    const next = !window.RiemannSphere.state.enabled;
    window.RiemannSphere.state.enabled = next;
    btnToggleSphere.classList.toggle("active", next);
    btnToggleSphere.textContent = next ? "2D Plane" : "3D Sphere";
    outputTag.textContent = next
      ? "RIEMANN SPHERE"
      : state.mode === "integral"
      ? "INTEGRAL PLANE"
      : "OUTPUT PLANE";
    requestRender();
  });

  document.getElementById("btn-close-last").addEventListener("click", async () => {
    let target = state.shapes.find((s) => s.id === state.selectedShapeId && !s.closed && s.rawPts.length >= 3);
    if (!target) {
      target = [...state.shapes].reverse().find((s) => !s.closed && s.rawPts.length >= 3);
    }
    if (!target) return;
    target.closed = true;
    target.label = target.label.replace("Path", "Closed Shape");
    await computeShapeData(target, 1.0);
    renderShapeChips();
    updateIntegralCard();
    requestRender();
  });

  document.getElementById("btn-reverse").addEventListener("click", async () => {
    let target = state.shapes.find((s) => s.id === state.selectedShapeId);
    if (!target && state.shapes.length > 0) {
      target = state.shapes[state.shapes.length - 1];
    }
    if (!target) return;
    target.rawPts.reverse();
    await computeShapeData(target, 1.0);
    renderShapeChips();
    updateIntegralCard();
    requestRender();
  });

  btnMesh.addEventListener("click", () => {
    state.showMesh = !state.showMesh;
    btnMesh.classList.toggle("active", state.showMesh);
    requestRender();
  });

  const btnDomain = document.getElementById("btn-toggle-domain");
  btnDomain.addEventListener("click", () => {
    state.showDomain = !state.showDomain;
    btnDomain.classList.toggle("active", state.showDomain);
    if (state.showDomain) fetchDomainImage();
    else requestRender();
  });

  const btnLandmarks = document.getElementById("btn-toggle-landmarks");
  btnLandmarks.addEventListener("click", () => {
    state.showLandmarks = !state.showLandmarks;
    btnLandmarks.classList.toggle("active", state.showLandmarks);
    requestRender();
  });

  btnPlay.addEventListener("click", () => {
    state.playing = !state.playing;
    btnPlay.classList.toggle("playing", state.playing);
    labelPlay.textContent = state.playing ? "Pause" : "Trace";
    iconPlay.innerHTML = state.playing
      ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
      : '<polygon points="6,4 20,12 6,20"/>';
    if (state.playing) requestRender();
  });

  document.getElementById("btn-undo").addEventListener("click", () => {
    if (state.polyDraft) {
      state.polyDraft = null;
    } else {
      const removed = state.shapes.pop();
      if (removed && removed.id === state.selectedShapeId) state.selectedShapeId = null;
    }
    renderShapeChips();
    updateIntegralCard();
    requestRender();
  });

  document.getElementById("btn-clear").addEventListener("click", clearShapes);

  /* Plane zoom/reset HUD buttons */
  document.getElementById("in-zoom-in").addEventListener("click", () => {
    zoomAt(state.inView, canvasIn, canvasIn.clientWidth * 0.5, canvasIn.clientHeight * 0.5, 1.35);
  });
  document.getElementById("in-zoom-out").addEventListener("click", () => {
    zoomAt(state.inView, canvasIn, canvasIn.clientWidth * 0.5, canvasIn.clientHeight * 0.5, 1 / 1.35);
  });
  document.getElementById("in-reset").addEventListener("click", () => {
    const fn = state.functions[state.fnIndex];
    if (fn) setView(state.inView, canvasIn, fn.in_view.cx, fn.in_view.cy, fn.in_view.r);
  });

  document.getElementById("out-autofit").addEventListener("click", autoFitOutput);
  document.getElementById("out-zoom-in").addEventListener("click", () => {
    zoomAt(state.outView, canvasOut, canvasOut.clientWidth * 0.5, canvasOut.clientHeight * 0.5, 1.35);
  });
  document.getElementById("out-zoom-out").addEventListener("click", () => {
    zoomAt(state.outView, canvasOut, canvasOut.clientWidth * 0.5, canvasOut.clientHeight * 0.5, 1 / 1.35);
  });
  document.getElementById("out-reset").addEventListener("click", () => {
    if (window.RiemannSphere && window.RiemannSphere.state.enabled) {
      window.RiemannSphere.reset();
      requestRender();
      return;
    }
    const fn = state.functions[state.fnIndex];
    if (state.mode === "integral") {
      setView(state.outView, canvasOut, 0.0, 0.0, 7.5);
    } else if (fn) {
      setView(state.outView, canvasOut, fn.out_view.cx, fn.out_view.cy, fn.out_view.r);
    }
  });

  /* Keyboard shortcuts */
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "SELECT" || e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (e.code === "Space") {
      state.spaceHeld = true;
      inCard.classList.add("pan-mode");
    } else if (e.key === "v" || e.key === "V" || e.key === "0") setTool("move");
    else if (e.key === "1") setTool("freehand");
    else if (e.key === "2") setTool("line");
    else if (e.key === "3") setTool("circle");
    else if (e.key === "4") setTool("rect");
    else if (e.key === "5") setTool("polygon");
    else if (e.key === "p" || e.key === "P") btnPlay.click();
    else if ((e.key === "Delete" || e.key === "Backspace") && state.selectedShapeId !== null) {
      e.preventDefault();
      state.shapes = state.shapes.filter((x) => x.id !== state.selectedShapeId);
      state.selectedShapeId = null;
      state.hoveredShapeId = null;
      state.hoveredHandle = null;
      renderShapeChips();
      updateIntegralCard();
      requestRender();
    } else if (e.key === "Escape") {
      state.polyDraft = null;
      state.selectedShapeId = null;
      state.lab.taylor.picking = false;
      if (window.LabController) window.LabController.closeDrawers();
      renderShapeChips();
      updateIntegralCard();
      requestRender();
    } else if (e.key === "Enter" && state.polyDraft) {
      finishPolygon(true);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      const removed = state.shapes.pop();
      if (removed && removed.id === state.selectedShapeId) state.selectedShapeId = null;
      renderShapeChips();
      updateIntegralCard();
      requestRender();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
      state.spaceHeld = false;
      inCard.classList.toggle("pan-mode", state.tool === "pan");
    }
  });

  window.addEventListener("resize", resizeCanvases);

  /* -------------------------------------------------------------------------
   * Bootstrap
   * ------------------------------------------------------------------------- */

  async function init() {
    renderPalette();
    resizeCanvases();

    const res = await fetch("/api/functions");
    const data = await res.json();
    state.functions = data.functions || [];

    fnSelect.innerHTML = "";
    state.functions.forEach((f, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = `${f.name}  (${f.formula})`;
      fnSelect.appendChild(opt);
    });

    state.fnIndex = 0;

    if (state.dim === "real") {
      updateFunctionMeta();
      resetViews();
      await setDimension("real");
    } else if (state.mode === "integral") {
      await setMode("integral", true);
    } else {
      updateFunctionMeta();
      resetViews();

      /* Initial Map showcase: Critical Line + Closed Disk around 1st Zero */
      const fn = state.functions[0];
      if (fn && fn.id === "zeta") {
        setView(state.inView, canvasIn, 0.5, 14.5, 15.0);
        setView(state.outView, canvasOut, 0.6, 0.0, 3.8);
        await commitShape({
          kind: "line",
          label: "Critical Line (t: 0→32)",
          rawPts: makeLinePoints(0.5, 0.0, 0.5, 32.0, 240),
          closed: false,
          color: "#38bdf8",
          autoColor: false,
        });
        await commitShape({
          kind: "circle",
          label: "Disk: 1st Zero (½+14.13i)",
          rawPts: makeCirclePoints(0.5, 14.13472514, 0.65, 72),
          closed: true,
          color: "#34d399",
          autoColor: false,
        });
        state.selectedShapeId = null;
        state.colorIndex = 1;
        renderPalette();
        renderShapeChips();
      }
    }
  }

  /* Expose clean coordinator API for lab.js */
  window.ComplexApp = {
    state,
    canvasIn,
    canvasOut,
    requestRender,
    resizeCanvases,
    recomputeAllShapes,
    refreshDirichletOverlays,
    setDimension,
    setMode,
    clearShapes,
    commitShape,
    makeCirclePoints,
    makeRectPoints,
    makeLinePoints,
    autoFitOutput,
    selectFunctionById,
    setInputView(cx, cy, r) {
      setView(state.inView, canvasIn, cx, cy, r);
    },
    setOutputView(cx, cy, r) {
      setView(state.outView, canvasOut, cx, cy, r);
    },
    async activateLiveCustomFn() {
      let opt = fnSelect.querySelector('option[value="-1"]');
      if (!opt) {
        opt = document.createElement("option");
        opt.value = "-1";
        opt.textContent = "★ Live C Function (user_fn)";
        fnSelect.insertBefore(opt, fnSelect.firstChild);
      }
      fnSelect.value = "-1";
      state.fnIndex = -1;
      updateFunctionMeta();
      if (state.showDomain) scheduleDomainUpdate();
      if (state.shapes.length > 0) {
        await recomputeAllShapes();
      }
      requestRender();
    },
  };

  init();
})();
