(() => {
  "use strict";

  /*
   * Shared Geometry, Unified Formula-Shape Engine (fx), 2x2 Matrix & 2D Vector Linear Algebra Engine,
   * Selection, Transform, Snapping, Undo/Redo & Multi-Touch Pinch Module.
   * Used identically by Complex (canvas_complex.js), Real (canvas_real.js), and 2D Vector (canvas_vector.js).
   */

  function getShapeBounds(pts) {
    if (!pts || !pts.length) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, maxX, minY, maxY, cx: 0.5 * (minX + maxX), cy: 0.5 * (minY + maxY) };
  }

  function isRectShape(s) {
    return Boolean(s && s.kind === "rect" && s.pts && s.pts.length === 4);
  }

  function rectLocalFrame(pts) {
    if (!pts || pts.length < 4) return null;
    const p0 = pts[0], p1 = pts[1], p2 = pts[2], p3 = pts[3];
    const cx = 0.25 * (p0.x + p1.x + p2.x + p3.x);
    const cy = 0.25 * (p0.y + p1.y + p2.y + p3.y);
    const ex = p1.x - p0.x, ey = p1.y - p0.y;
    const eLen = Math.hypot(ex, ey);
    const ux = eLen > 1e-12 ? ex / eLen : 1;
    const uy = eLen > 1e-12 ? ey / eLen : 0;
    const fx = p3.x - p0.x, fy = p3.y - p0.y;
    const fLen = Math.hypot(fx, fy);
    let vx = -uy, vy = ux;
    if (fLen > 1e-12 && (fx * vx + fy * vy) < 0) {
      vx = -vx;
      vy = -vy;
    }
    const halfU = Math.max(1e-6, 0.5 * eLen);
    const halfV = Math.max(1e-6, 0.5 * fLen);
    return { cx, cy, ux, uy, vx, vy, halfU, halfV };
  }

  function distPtToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    if (l2 < 1e-12) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function pointInPolygon(x, y, pts) {
    if (!pts || pts.length < 3) return false;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y;
      const xj = pts[j].x, yj = pts[j].y;
      if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-30) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  function makeCirclePoints(cx, cy, r, n = 64, ccw = true) {
    const pts = [];
    const dir = ccw ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const a = dir * (2 * Math.PI * i) / n;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function makeArcPoints(cx, cy, r, startAngle = 0, endAngle = Math.PI, n = 64) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = startAngle + ((endAngle - startAngle) * i) / n;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function makeLinePoints(x0, y0, x1, y1, n = 48) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
    }
    return pts;
  }

  function makeRectPoints(x0, y0, x1, y1) {
    return [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
  }

  /* =========================================================================
   * Unified Math Expression Evaluator & Formula-Driven Geometry (fx)
   * Shared by Complex, Real, and Vector modes!
   * ========================================================================= */
  const MATH_ENV = {
    pi: Math.PI, PI: Math.PI, M_PI: Math.PI, tau: Math.PI * 2, e: Math.E, E: Math.E, M_E: Math.E,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    exp: Math.exp, log: Math.log, ln: Math.log, log10: Math.log10, sqrt: Math.sqrt, cbrt: Math.cbrt,
    pow: Math.pow, hypot: Math.hypot, abs: Math.abs, fabs: Math.abs,
    min: Math.min, max: Math.max, fmin: Math.min, fmax: Math.max,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc, sign: Math.sign,
  };
  const exprFnCache = new Map();

  function evalParamExpr(expr, paramMap, uVal = 0) {
    if (typeof expr === "number") return Number.isFinite(expr) ? expr : NaN;
    const raw = String(expr ?? "").trim();
    if (!raw) return NaN;
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(raw)) return parseFloat(raw);
    const scope = Object.assign({}, MATH_ENV, { t: uVal }, paramMap || {}, { u: uVal });
    const argNames = Object.keys(scope).sort();
    const cacheKey = raw + "|" + argNames.join(",");
    let fn = exprFnCache.get(cacheKey);
    if (!fn) {
      const allowed = new Set(argNames);
      const stripped = raw.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (id) => (allowed.has(id) ? id : "__INVALID__"));
      if (stripped.includes("__INVALID__") || /[^a-zA-Z0-9_+\-*/().,\s?:<>!=&|]/.test(stripped)) {
        return NaN;
      }
      try {
        fn = new Function(...argNames, `"use strict"; return Number(${stripped});`);
        if (exprFnCache.size > 320) exprFnCache.clear();
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
      return { rawPts: makeCirclePoints(cx, cy, Math.max(1e-3, Math.abs(r)), 72, r >= 0), closed: true };
    }
    if (k === "arc") {
      const cx = evalParamExpr(formula.cx ?? "0", paramMap);
      const cy = evalParamExpr(formula.cy ?? "0", paramMap);
      const r = evalParamExpr(formula.r ?? "1", paramMap);
      const a0 = evalParamExpr(formula.a0 ?? "0", paramMap);
      const a1 = evalParamExpr(formula.a1 ?? "pi", paramMap);
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) || !Number.isFinite(a0) || !Number.isFinite(a1)) return null;
      return { rawPts: makeArcPoints(cx, cy, Math.max(1e-3, Math.abs(r)), a0, a1, 84), closed: false };
    }
    if (k === "line" || k === "seg") {
      const x0 = evalParamExpr(formula.x0 ?? "-1", paramMap);
      const y0 = evalParamExpr(formula.y0 ?? "0", paramMap);
      const x1 = evalParamExpr(formula.x1 ?? "1", paramMap);
      const y1 = evalParamExpr(formula.y1 ?? "0", paramMap);
      if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return null;
      return { rawPts: makeLinePoints(x0, y0, x1, y1, 48), closed: false };
    }
    if (k === "vector") {
      const x0 = evalParamExpr(formula.x0 ?? "0", paramMap);
      const y0 = evalParamExpr(formula.y0 ?? "0", paramMap);
      const vx = evalParamExpr(formula.vx ?? "2", paramMap);
      const vy = evalParamExpr(formula.vy ?? "1", paramMap);
      if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(vx) || !Number.isFinite(vy)) return null;
      return { rawPts: [{ x: x0, y: y0 }, { x: x0 + vx, y: y0 + vy }], closed: false };
    }
    if (k === "rect") {
      const x0 = evalParamExpr(formula.x0 ?? "-1", paramMap);
      const y0 = evalParamExpr(formula.y0 ?? "-1", paramMap);
      const x1 = evalParamExpr(formula.x1 ?? "1", paramMap);
      const y1 = evalParamExpr(formula.y1 ?? "1", paramMap);
      if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return null;
      return { rawPts: makeRectPoints(x0, y0, x1, y1), closed: true };
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

  function createDefaultFormulaForShape(s) {
    if (!s || !s.rawPts || s.rawPts.length < 2) return { kind: "circle", cx: "0", cy: "0", r: "1" };
    const bb = getShapeBounds(s.rawPts);
    const f2 = (n) => String(Number(n.toFixed(3)));
    if (s.kind === "vector") {
      const p0 = s.rawPts[0], p1 = s.rawPts[s.rawPts.length - 1];
      return { kind: "vector", x0: f2(p0.x), y0: f2(p0.y), vx: f2(p1.x - p0.x), vy: f2(p1.y - p0.y) };
    }
    if (s.kind === "circle") {
      const r = 0.25 * ((bb.maxX - bb.minX) + (bb.maxY - bb.minY));
      return { kind: "circle", cx: f2(bb.cx), cy: f2(bb.cy), r: f2(Math.max(0.1, r)) };
    }
    if (s.kind === "rect") {
      return { kind: "rect", x0: f2(bb.minX), y0: f2(bb.minY), x1: f2(bb.maxX), y1: f2(bb.maxY) };
    }
    if (s.kind === "line" || s.kind === "seg" || s.kind === "ray" || s.kind === "infline") {
      const p0 = s.rawPts[0], p1 = s.rawPts[s.rawPts.length - 1];
      return { kind: "line", x0: f2(p0.x), y0: f2(p0.y), x1: f2(p1.x), y1: f2(p1.y) };
    }
    if (s.kind === "arc") {
      const r = Math.max(0.2, 0.5 * Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY));
      return { kind: "arc", cx: f2(bb.cx), cy: f2(bb.cy), r: f2(r), a0: "0", a1: "pi" };
    }
    const r = Math.max(0.2, 0.25 * ((bb.maxX - bb.minX) + (bb.maxY - bb.minY)));
    return {
      kind: "parametric",
      xExpr: `${f2(bb.cx)} + ${f2(r)}*cos(u)`,
      yExpr: `${f2(bb.cy)} + ${f2(r)}*sin(u)`,
      u0: "0",
      u1: "2*pi",
      closed: Boolean(s.closed),
    };
  }

  function rebuildFormulaElementsInState(st, paramMap) {
    if (!st) return false;
    let changed = false;
    for (const s of st.shapes || []) {
      if (!s.formula) continue;
      const res = evalShapeFormula(s.formula, paramMap);
      if (res && res.rawPts.length >= 2) {
        s.rawPts = res.rawPts;
        if (s.formula.kind !== "parametric") s.closed = res.closed;
        changed = true;
      }
    }
    for (const p of st.points || []) {
      if (p.xExpr && String(p.xExpr).trim()) {
        const vx = evalParamExpr(p.xExpr, paramMap);
        if (Number.isFinite(vx)) { p.x = vx; changed = true; }
      }
      if (p.yExpr && String(p.yExpr).trim()) {
        const vy = evalParamExpr(p.yExpr, paramMap);
        if (Number.isFinite(vy)) { p.y = vy; changed = true; }
      }
    }
    for (const ln of st.lines || []) {
      if (ln.valExpr && String(ln.valExpr).trim()) {
        const vv = evalParamExpr(ln.valExpr, paramMap);
        if (Number.isFinite(vv)) { ln.value = vv; changed = true; }
      }
    }
    for (const tb of st.texts || []) {
      if (tb.xExpr && String(tb.xExpr).trim()) {
        const vx = evalParamExpr(tb.xExpr, paramMap);
        if (Number.isFinite(vx)) { tb.x = vx; changed = true; }
      }
      if (tb.yExpr && String(tb.yExpr).trim()) {
        const vy = evalParamExpr(tb.yExpr, paramMap);
        if (Number.isFinite(vy)) { tb.y = vy; changed = true; }
      }
    }
    return changed;
  }

  /* =========================================================================
   * 2x2 Matrix & 2D Vector Linear Algebra Engine (CFVLinAlg)
   * Supports:
   *   - Literal matrices: [[a, b], [c, d]]
   *   - Constructors: rot(t), scale(sx, sy), shear(kx, ky), reflect(t), proj(t), eye()
   *   - Matrix ops: M1 * M2, M1 + M2, M1 - M2, k * M1, inv(M1), T(M1), transpose(M1), pow(M1, n)
   *   - Vector literals & ops: [x, y], M1 * v1, v1 + v2, v1 - v2, k * v1, norm(v1), perp(v1), dot(v1, v2)
   * ========================================================================= */
  function isMat2(x) { return Boolean(x && x.__t === "mat2"); }
  function isRow2(x) { return Boolean(x && x.__t === "row2"); }
  function isVec2(x) { return Boolean(x && x.__t === "vec2"); }
  function makeMat2(a, b, c, d) {
    return { __t: "mat2", a: Number(a), b: Number(b), c: Number(c), d: Number(d) };
  }
  function makeRow2(a, b) {
    return { __t: "row2", a: Number(a), b: Number(b) };
  }
  function makeVec2(x, y) {
    return { __t: "vec2", x: Number(x), y: Number(y) };
  }
  function matMul(A, B) {
    return makeMat2(
      A.a * B.a + A.b * B.c, A.a * B.b + A.b * B.d,
      A.c * B.a + A.d * B.c, A.c * B.b + A.d * B.d
    );
  }
  function matVec(A, v) {
    return makeVec2(A.a * v.x + A.b * v.y, A.c * v.x + A.d * v.y);
  }
  function rowVec(r, v) {
    return r.a * v.x + r.b * v.y;
  }
  function rowMat(r, M) {
    return makeRow2(r.a * M.a + r.b * M.c, r.a * M.b + r.b * M.d);
  }
  function vecRow(v, r) {
    return makeMat2(v.x * r.a, v.x * r.b, v.y * r.a, v.y * r.b);
  }
  function matInv(A) {
    const det = A.a * A.d - A.b * A.c;
    if (Math.abs(det) < 1e-12) return makeMat2(NaN, NaN, NaN, NaN);
    const inv = 1 / det;
    return makeMat2(A.d * inv, -A.b * inv, -A.c * inv, A.a * inv);
  }
  function matTrans(A) {
    if (isRow2(A)) return makeVec2(A.a, A.b);
    if (isVec2(A)) return makeRow2(A.x, A.y);
    return makeMat2(A.a, A.c, A.b, A.d);
  }
  function matPow(A, n) {
    let k = Math.round(Number(n) || 0);
    if (k === 0) return makeMat2(1, 0, 0, 1);
    let base = k < 0 ? matInv(A) : A;
    k = Math.abs(k);
    let acc = makeMat2(1, 0, 0, 1);
    for (let i = 0; i < Math.min(k, 64); i++) acc = matMul(acc, base);
    return acc;
  }

  /* Recursive-descent expression parser supporting scalars, mat2, and vec2 seamlessly! */
  function evalLinAlgExpr(src, paramMap, envObjects) {
    const text = String(src ?? "").trim();
    if (!text) return null;
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (/[0-9.]/.test(ch)) {
        let j = i;
        while (j < text.length && /[0-9.]/.test(text[j])) j++;
        if (j < text.length && (text[j] === "e" || text[j] === "E")) {
          j++;
          if (j < text.length && (text[j] === "+" || text[j] === "-")) j++;
          while (j < text.length && /[0-9]/.test(text[j])) j++;
        }
        tokens.push({ t: "num", v: parseFloat(text.slice(i, j)) });
        i = j; continue;
      }
      if (/[a-zA-Z_]/.test(ch)) {
        let j = i;
        while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) j++;
        tokens.push({ t: "id", v: text.slice(i, j) });
        i = j; continue;
      }
      if ("+-*/^()[],;".includes(ch)) {
        tokens.push({ t: "op", v: ch });
        i++; continue;
      }
      return null;
    }

    let pos = 0;
    const peek = () => tokens[pos] || null;
    const eat = (v) => {
      const tok = tokens[pos];
      if (!tok || (v && tok.v !== v)) return null;
      pos++;
      return tok;
    };

    const scope = Object.assign({}, MATH_ENV, paramMap || {}, envObjects || {});

    function callFn(name, args) {
      const s = (idx, def = 0) => (typeof args[idx] === "number" ? args[idx] : def);
      if (name === "rot") {
        const th = s(0, 0), c = Math.cos(th), sn = Math.sin(th);
        return makeMat2(c, -sn, sn, c);
      }
      if (name === "scale") {
        const sx = s(0, 1), sy = args.length >= 2 ? s(1, sx) : sx;
        return makeMat2(sx, 0, 0, sy);
      }
      if (name === "shear") return makeMat2(1, s(0, 0), s(1, 0), 1);
      if (name === "reflect") {
        const th = s(0, 0), c = Math.cos(2 * th), sn = Math.sin(2 * th);
        return makeMat2(c, sn, sn, -c);
      }
      if (name === "proj") {
        const th = s(0, 0), c = Math.cos(th), sn = Math.sin(th);
        return makeMat2(c * c, c * sn, c * sn, sn * sn);
      }
      if (name === "eye" || name === "I") return makeMat2(1, 0, 0, 1);
      if (name === "mat" && args.length >= 4) return makeMat2(s(0), s(1), s(2), s(3));
      if (name === "row" && args.length >= 2) return makeRow2(s(0), s(1));
      if (name === "vec" && args.length >= 2) return makeVec2(s(0), s(1));
      if (name === "inv" && isMat2(args[0])) return matInv(args[0]);
      if ((name === "T" || name === "transpose") && (isMat2(args[0]) || isRow2(args[0]) || isVec2(args[0]))) return matTrans(args[0]);
      if (name === "det" && isMat2(args[0])) return args[0].a * args[0].d - args[0].b * args[0].c;
      if ((name === "tr" || name === "trace") && isMat2(args[0])) return args[0].a + args[0].d;
      if (name === "dot" && isVec2(args[0]) && isVec2(args[1])) return args[0].x * args[1].x + args[0].y * args[1].y;
      if (name === "cross" && isVec2(args[0]) && isVec2(args[1])) return args[0].x * args[1].y - args[0].y * args[1].x;
      if ((name === "len" || name === "mag" || name === "abs") && isVec2(args[0])) return Math.hypot(args[0].x, args[0].y);
      if ((name === "len" || name === "mag" || name === "abs") && isRow2(args[0])) return Math.hypot(args[0].a, args[0].b);
      if (name === "norm" && isVec2(args[0])) {
        const l = Math.hypot(args[0].x, args[0].y);
        return l > 1e-12 ? makeVec2(args[0].x / l, args[0].y / l) : makeVec2(0, 0);
      }
      if (name === "perp" && isVec2(args[0])) return makeVec2(-args[0].y, args[0].x);
      if (name === "angle" && isVec2(args[0]) && isVec2(args[1])) {
        const d = Math.hypot(args[0].x, args[0].y) * Math.hypot(args[1].x, args[1].y);
        return d > 1e-12 ? Math.acos(Math.max(-1, Math.min(1, (args[0].x * args[1].x + args[0].y * args[1].y) / d))) : 0;
      }
      if (name === "proj_v" && isVec2(args[0]) && isVec2(args[1])) {
        const d = args[1].x * args[1].x + args[1].y * args[1].y;
        const k = d > 1e-12 ? (args[0].x * args[1].x + args[0].y * args[1].y) / d : 0;
        return makeVec2(k * args[1].x, k * args[1].y);
      }
      if (name === "dist" && isVec2(args[0]) && isVec2(args[1])) return Math.hypot(args[0].x - args[1].x, args[0].y - args[1].y);
      if (name === "lerp" && isVec2(args[0]) && isVec2(args[1])) {
        const t = s(2, 0.5);
        return makeVec2(args[0].x + t * (args[1].x - args[0].x), args[0].y + t * (args[1].y - args[0].y));
      }
      if (name === "outer" && isVec2(args[0]) && isVec2(args[1])) {
        return makeMat2(args[0].x * args[1].x, args[0].x * args[1].y, args[0].y * args[1].x, args[0].y * args[1].y);
      }
      if (name === "diag" && args.length >= 2) return makeMat2(s(0), 0, 0, s(1));
      if (name === "adj" && isMat2(args[0])) return makeMat2(args[0].d, -args[0].b, -args[0].c, args[0].a);
      if ((name === "eig1" || name === "eig2") && isMat2(args[0])) {
        const info = analyzeMat2(args[0]);
        return info && info.eigen.real ? (name === "eig1" ? info.eigen.l1 : info.eigen.l2) : NaN;
      }
      if (name === "cond" && isMat2(args[0])) {
        const A = args[0], d = Math.abs(A.a * A.d - A.b * A.c);
        if (d < 1e-12) return Infinity;
        const f2 = A.a * A.a + A.b * A.b + A.c * A.c + A.d * A.d;
        const disc = Math.sqrt(Math.max(0, f2 * f2 - 4 * d * d));
        return Math.sqrt(0.5 * (f2 + disc)) / Math.sqrt(Math.max(1e-18, 0.5 * (f2 - disc)));
      }
      if (name === "pow" && isMat2(args[0])) return matPow(args[0], s(1, 1));
      const fn = scope[name];
      if (typeof fn === "function") return fn(...args);
      return NaN;
    }

    function addVal(a, b, sign) {
      if (typeof a === "number" && typeof b === "number") return a + sign * b;
      if (isMat2(a) && isMat2(b)) return makeMat2(a.a + sign * b.a, a.b + sign * b.b, a.c + sign * b.c, a.d + sign * b.d);
      if (isRow2(a) && isRow2(b)) return makeRow2(a.a + sign * b.a, a.b + sign * b.b);
      if (isVec2(a) && isVec2(b)) return makeVec2(a.x + sign * b.x, a.y + sign * b.y);
      return NaN;
    }
    function mulVal(a, b) {
      if (typeof a === "number" && typeof b === "number") return a * b;
      if (typeof a === "number" && isMat2(b)) return makeMat2(a * b.a, a * b.b, a * b.c, a * b.d);
      if (isMat2(a) && typeof b === "number") return makeMat2(a.a * b, a.b * b, a.c * b, a.d * b);
      if (typeof a === "number" && isRow2(b)) return makeRow2(a * b.a, a * b.b);
      if (isRow2(a) && typeof b === "number") return makeRow2(a.a * b, a.b * b);
      if (typeof a === "number" && isVec2(b)) return makeVec2(a * b.x, a * b.y);
      if (isVec2(a) && typeof b === "number") return makeVec2(a.x * b, a.y * b);
      if (isMat2(a) && isMat2(b)) return matMul(a, b);
      if (isMat2(a) && isVec2(b)) return matVec(a, b);
      if (isRow2(a) && isVec2(b)) return rowVec(a, b);
      if (isRow2(a) && isMat2(b)) return rowMat(a, b);
      if (isVec2(a) && isRow2(b)) return vecRow(a, b);
      return NaN;
    }
    function divVal(a, b) {
      if (typeof b !== "number" || Math.abs(b) < 1e-15) return NaN;
      return mulVal(a, 1 / b);
    }

    function parseExpr() {
      let left = parseTerm();
      while (peek() && (peek().v === "+" || peek().v === "-")) {
        const op = eat().v;
        const right = parseTerm();
        left = addVal(left, right, op === "+" ? 1 : -1);
      }
      return left;
    }
    function parseTerm() {
      let left = parsePower();
      while (peek() && (peek().v === "*" || peek().v === "/")) {
        const op = eat().v;
        const right = parsePower();
        left = op === "*" ? mulVal(left, right) : divVal(left, right);
      }
      return left;
    }
    function parsePower() {
      let base = parseUnary();
      if (peek() && peek().v === "^") {
        eat("^");
        const exp = parsePower();
        if (isMat2(base)) return matPow(base, exp);
        if (typeof base === "number" && typeof exp === "number") return Math.pow(base, exp);
        return NaN;
      }
      return base;
    }
    function parseUnary() {
      if (peek() && peek().v === "+") { eat("+"); return parseUnary(); }
      if (peek() && peek().v === "-") { eat("-"); return mulVal(-1, parseUnary()); }
      return parsePrimary();
    }
    function parsePrimary() {
      const tok = peek();
      if (!tok) return NaN;
      if (tok.t === "num") { eat(); return tok.v; }
      if (tok.t === "id") {
        eat();
        if (peek() && peek().v === "(") {
          eat("(");
          const args = [];
          if (!peek() || peek().v !== ")") {
            while (true) {
              args.push(parseExpr());
              if (!eat(",")) break;
            }
          }
          eat(")");
          return callFn(tok.v, args);
        }
        return Object.prototype.hasOwnProperty.call(scope, tok.v) ? scope[tok.v] : NaN;
      }
      if (tok.v === "(") {
        eat("(");
        const first = parseExpr();
        if (eat(",")) {
          const second = parseExpr();
          eat(")");
          if (typeof first === "number" && typeof second === "number") return makeVec2(first, second);
          return NaN;
        }
        eat(")");
        return first;
      }
      if (tok.v === "[") {
        eat("[");
        const items = [];
        if (!peek() || peek().v !== "]") {
          while (true) {
            items.push(parseExpr());
            if (!eat(",") && !eat(";")) break;
          }
        }
        eat("]");
        /* [[x]] or [x] -> 1x1 naturally interpreted as scalar! */
        if (items.length === 1 && typeof items[0] === "number") {
          return items[0];
        }
        /* [[a, b]] -> 1x2 Row Matrix! */
        if (items.length === 1 && isVec2(items[0])) {
          return makeRow2(items[0].x, items[0].y);
        }
        /* [[a, b], [c, d]] -> 2x2 Matrix! */
        if (items.length === 2 && isVec2(items[0]) && isVec2(items[1])) {
          return makeMat2(items[0].x, items[0].y, items[1].x, items[1].y);
        }
        /* [a, b] or [[a], [b]] -> 2x1 Column Vector! */
        if (items.length === 2 && typeof items[0] === "number" && typeof items[1] === "number") {
          return makeVec2(items[0], items[1]);
        }
        if (items.length === 4 && items.every((x) => typeof x === "number")) {
          return makeMat2(items[0], items[1], items[2], items[3]);
        }
        return NaN;
      }
      return NaN;
    }

    try {
      const res = parseExpr();
      return res;
    } catch (_) {
      return null;
    }
  }

  function analyzeMat2(M) {
    if (!isMat2(M) || !Number.isFinite(M.a) || !Number.isFinite(M.b) || !Number.isFinite(M.c) || !Number.isFinite(M.d)) {
      return null;
    }
    const tr = M.a + M.d;
    const det = M.a * M.d - M.b * M.c;
    const disc = tr * tr - 4 * det;
    const eigen = { real: disc >= -1e-9, l1: 0, l2: 0, re: 0.5 * tr, im: 0, vecs: [] };
    if (disc >= -1e-9) {
      const sd = Math.sqrt(Math.max(0, disc));
      eigen.l1 = 0.5 * (tr + sd);
      eigen.l2 = 0.5 * (tr - sd);
      const findEigVec = (lam) => {
        const r1x = M.a - lam, r1y = M.b;
        const r2x = M.c, r2y = M.d - lam;
        let vx = 0, vy = 0;
        if (Math.hypot(r1x, r1y) >= Math.hypot(r2x, r2y)) {
          if (Math.hypot(r1x, r1y) < 1e-9) return null;
          vx = -r1y; vy = r1x;
        } else {
          if (Math.hypot(r2x, r2y) < 1e-9) return null;
          vx = -r2y; vy = r2x;
        }
        const len = Math.hypot(vx, vy);
        if (len < 1e-9) return null;
        return { x: vx / len, y: vy / len, lambda: lam };
      };
      if (Math.abs(M.b) < 1e-9 && Math.abs(M.c) < 1e-9 && Math.abs(M.a - M.d) < 1e-9) {
        eigen.vecs.push({ x: 1, y: 0, lambda: M.a }, { x: 0, y: 1, lambda: M.d });
      } else {
        const v1 = findEigVec(eigen.l1);
        if (v1) eigen.vecs.push(v1);
        if (Math.abs(eigen.l1 - eigen.l2) > 1e-6) {
          const v2 = findEigVec(eigen.l2);
          if (v2) eigen.vecs.push(v2);
        }
      }
    } else {
      eigen.re = 0.5 * tr;
      eigen.im = 0.5 * Math.sqrt(-disc);
    }
    return { ...M, tr, det, disc, eigen };
  }

  function fmtNum(v) {
    if (!Number.isFinite(v)) return "—";
    if (Math.abs(v) < 1e-6) return "0";
    const r = Math.round(v * 100) / 100;
    return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, "");
  }

  function renderMatrixLatexHtml(name, M) {
    if (isRow2(M) && Number.isFinite(M.a) && Number.isFinite(M.b)) {
      return renderRow2LatexHtml(name, M);
    }
    if (!M) return `<span class="la-err">Invalid matrix</span>`;
    const info = analyzeMat2(M);
    if (!info) return `<span class="la-err">Invalid 2×2 matrix</span>`;
    const eigTxt = info.eigen.real
      ? `&lambda; = ${fmtNum(info.eigen.l1)}, ${fmtNum(info.eigen.l2)}`
      : `&lambda; = ${fmtNum(info.eigen.re)} &plusmn; ${fmtNum(info.eigen.im)}<i>i</i>`;
    return `
      <div class="la-eq-row">
        <span class="la-lhs"><i>${name}</i> =</span>
        <span class="la-mat-wrap">
          <span class="la-br la-br-l"></span>
          <span class="la-mat-grid">
            <span>${fmtNum(info.a)}</span><span>${fmtNum(info.b)}</span>
            <span>${fmtNum(info.c)}</span><span>${fmtNum(info.d)}</span>
          </span>
          <span class="la-br la-br-r"></span>
        </span>
        <span class="la-meta-pills">
          <span class="la-pill ${info.det < -1e-5 ? "neg" : Math.abs(info.det) < 1e-5 ? "zero" : "pos"}">det ${fmtNum(info.det)}</span>
          <span class="la-pill">tr ${fmtNum(info.tr)}</span>
          <span class="la-pill eig">${eigTxt}</span>
        </span>
      </div>`;
  }

  function renderRow2LatexHtml(name, R) {
    if (!isRow2(R) || !Number.isFinite(R.a) || !Number.isFinite(R.b)) {
      return `<span class="la-err">Invalid 1×2 row matrix</span>`;
    }
    return `
      <div class="la-eq-row">
        <span class="la-lhs"><i>${name}</i> =</span>
        <span class="la-mat-wrap">
          <span class="la-br la-br-l"></span>
          <span class="la-row-grid"><span>${fmtNum(R.a)}</span><span>${fmtNum(R.b)}</span></span>
          <span class="la-br la-br-r"></span>
        </span>
        <span class="la-meta-pills">
          <span class="la-pill">1×2 row</span>
          <span class="la-pill">‖${name}‖=${fmtNum(Math.hypot(R.a, R.b))}</span>
        </span>
      </div>`;
  }

  function renderVectorLatexHtml(name, v, matName, mv) {
    if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y)) {
      return `<span class="la-err">Invalid 2D vector</span>`;
    }
    const mag = Math.hypot(v.x, v.y);
    const deg = (Math.atan2(v.y, v.x) * 180) / Math.PI;
    let mappedHtml = "";
    if (mv && Number.isFinite(mv.x) && Number.isFinite(mv.y)) {
      const mMag = Math.hypot(mv.x, mv.y);
      const cross = Math.abs(v.x * mv.y - v.y * mv.x);
      const isEig = mag > 1e-4 && mMag > 1e-4 && cross / (mag * mMag) < 0.035;
      const ratio = mag > 1e-5 ? ((v.x * mv.x + v.y * mv.y) / (mag * mag)) : 0;
      mappedHtml = `
        <span class="la-arrow">&mapsto;</span>
        <span class="la-lhs"><i>${matName}${name}</i> =</span>
        <span class="la-mat-wrap out">
          <span class="la-br la-br-l"></span>
          <span class="la-vec-col"><span>${fmtNum(mv.x)}</span><span>${fmtNum(mv.y)}</span></span>
          <span class="la-br la-br-r"></span>
        </span>
        ${isEig ? `<span class="la-pill eig-hit">&lambda;&approx;${fmtNum(ratio)} Eigen!</span>` : ""}`;
    }
    return `
      <div class="la-eq-row">
        <span class="la-lhs"><b>${name}</b> =</span>
        <span class="la-mat-wrap">
          <span class="la-br la-br-l"></span>
          <span class="la-vec-col"><span>${fmtNum(v.x)}</span><span>${fmtNum(v.y)}</span></span>
          <span class="la-br la-br-r"></span>
        </span>
        ${mappedHtml}
        <span class="la-meta-pills"><span class="la-pill">|v|=${fmtNum(mag)} · ${Math.round(deg)}°</span></span>
      </div>`;
  }

  function parseMatrixCellsFromCode(code) {
    const s = String(code || "").trim();
    /* 2x2: [[a, b], [c, d]] */
    const m22 = s.match(/^\[\s*\[\s*([^,\]]+)\s*,\s*([^,\]]+)\s*\]\s*,\s*\[\s*([^,\]]+)\s*,\s*([^,\]]+)\s*\]\s*\]$/);
    if (m22) {
      const arr = [m22[1].trim(), m22[2].trim(), m22[3].trim(), m22[4].trim()];
      arr.rows = 2; arr.cols = 2;
      return arr;
    }
    /* 1x2: [[a, b]] */
    const m12 = s.match(/^\[\s*\[\s*([^,\]]+)\s*,\s*([^,\]]+)\s*\]\s*\]$/);
    if (m12) {
      const arr = [m12[1].trim(), m12[2].trim()];
      arr.rows = 1; arr.cols = 2;
      return arr;
    }
    /* 2x1: [[a], [b]] */
    const m21 = s.match(/^\[\s*\[\s*([^,\]]+)\s*\]\s*,\s*\[\s*([^,\]]+)\s*\]\s*\]$/);
    if (m21) {
      const arr = [m21[1].trim(), m21[2].trim()];
      arr.rows = 2; arr.cols = 1;
      return arr;
    }
    /* 1x1: [[a]] */
    const m11 = s.match(/^\[\s*\[\s*([^,\]]+)\s*\]\s*\]$/);
    if (m11) {
      const arr = [m11[1].trim()];
      arr.rows = 1; arr.cols = 1;
      return arr;
    }
    return null;
  }

  function parseVectorCellsFromCode(code) {
    const s = String(code || "").trim();
    const m = s.match(/^[\[\(]\s*([^,\]\)]+)\s*,\s*([^,\]\)]+)\s*[\]\)]$/);
    if (m) return [m[1].trim(), m[2].trim()];
    const m21 = s.match(/^\[\s*\[\s*([^,\]]+)\s*\]\s*,\s*\[\s*([^,\]]+)\s*\]\s*\]$/);
    if (m21) return [m21[1].trim(), m21[2].trim()];
    return null;
  }

  /* =========================================================================
   * Vector & Matrix C11 Transpiler + Dimensional Type Checker!
   * Supports ALL shapes up to 2x2:
   *   - "mat" = 2×2 matrix (mat2)
   *   - "row" = 1×2 row matrix (row2)
   *   - "vec" = 2×1 column vector (vec2)
   *   - "num" = 1×1 scalar (double)
   * Returns { type, code } on success, OR { error, hint } on a dimensional mismatch!
   * ========================================================================= */
  const DIM_LABEL = { mat: "2×2 matrix", row: "1×2 row matrix", vec: "2×1 vector", num: "1×1 scalar" };
  const RESERVED_IDENT = new Set([
    "auto", "break", "case", "char", "const", "continue", "default", "do", "double", "else", "enum",
    "extern", "float", "for", "goto", "if", "inline", "int", "long", "register", "restrict", "return",
    "short", "signed", "sizeof", "static", "struct", "switch", "typedef", "union", "unsigned", "void",
    "volatile", "while", "bool", "true", "false", "NULL", "NAN", "INFINITY",
    "x", "y", "z", "s", "t", "v", "i", "I", "e", "E", "pi", "PI", "fx", "fy", "phi", "P",
    "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "exp", "log", "log10",
    "sqrt", "cbrt", "pow", "fabs", "abs", "hypot", "floor", "ceil", "round", "fmod", "fmin", "fmax",
    "vec", "mat", "row", "rot", "scale", "shear", "reflect", "proj", "proj_v", "eye", "inv", "T",
    "transpose", "det", "tr", "trace", "dot", "cross", "len", "mag", "norm", "perp", "angle", "dist",
    "lerp", "outer", "diag", "adj", "eig1", "eig2", "cond", "div", "curl", "grad", "laplacian", "lap",
    "jacobian", "jac", "c_zeta", "c_gamma", "c_sin", "c_cos", "c_exp", "c_log", "c_pow", "c_make",
  ]);

  function validateIdentifierName(raw, usedNamesSet) {
    const nm = String(raw || "").trim();
    if (!nm) return { ok: false, error: "Name cannot be empty." };
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(nm)) {
      return { ok: false, error: `'${nm}' must start with a letter/underscore and contain only letters, digits, or _.` };
    }
    if (nm.length > 24) return { ok: false, error: `'${nm}' is too long (max 24 chars).` };
    if (RESERVED_IDENT.has(nm)) return { ok: false, error: `'${nm}' is a reserved math/C keyword.` };
    if (usedNamesSet && usedNamesSet.has(nm)) return { ok: false, error: `'${nm}' is already used by another card.` };
    return { ok: true, name: nm };
  }

  function transpileLinAlgToC11(src, matNamesSet, vecNamesSet, rowNamesSet, fnMetaMap) {
    const text = String(src || "").trim();
    if (!text) return null;
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (/[0-9.]/.test(ch)) {
        let j = i;
        while (j < text.length && /[0-9.]/.test(text[j])) j++;
        if (j < text.length && (text[j] === "e" || text[j] === "E")) {
          j++;
          if (j < text.length && (text[j] === "+" || text[j] === "-")) j++;
          while (j < text.length && /[0-9]/.test(text[j])) j++;
        }
        tokens.push({ t: "num", v: text.slice(i, j) });
        i = j; continue;
      }
      if (/[a-zA-Z_]/.test(ch)) {
        let j = i;
        while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) j++;
        tokens.push({ t: "id", v: text.slice(i, j) });
        i = j; continue;
      }
      if ("+-*/^()[],".includes(ch)) {
        tokens.push({ t: "op", v: ch });
        i++; continue;
      }
      return null;
    }

    let pos = 0;
    let dimErr = null;
    const setDimErr = (error, hint) => {
      if (!dimErr) dimErr = { error, hint };
      return null;
    };
    const peek = () => tokens[pos] || null;
    const eat = (v) => {
      const tok = tokens[pos];
      if (!tok || (v && tok.v !== v)) return null;
      pos++;
      return tok;
    };

    const MAT_FNS = { rot: "mrot", scale: "mscale", shear: "mshear", reflect: "mreflect", proj: "mproj", eye: "meye", I: "meye", mat: "mat", diag: "mdiag", adj: "madj", outer: "mouter" };
    const VEC_FNS = { vec: "vec", norm: "vnorm", perp: "vperp", proj_v: "vproj", lerp: "vlerp" };
    const SCALAR_MAT_FNS = { det: "mdet", tr: "mtr", trace: "mtr", eig1: "meig1", eig2: "meig2", cond: "mcond" };
    const SCALAR_VEC_FNS = { dot: "vdot", cross: "vcross", len: "vlen", mag: "vlen", angle: "vangle", dist: "vdist" };

    function combineAdd(a, b, sign) {
      const opSym = sign > 0 ? "+" : "-";
      if (a.type === "vec" && b.type === "vec") return { type: "vec", code: `${sign > 0 ? "vadd" : "vsub"}(${a.code}, ${b.code})` };
      if (a.type === "mat" && b.type === "mat") return { type: "mat", code: `${sign > 0 ? "madd" : "msub"}(${a.code}, ${b.code})` };
      if (a.type === "row" && b.type === "row") return { type: "row", code: `${sign > 0 ? "radd" : "rsub"}(${a.code}, ${b.code})` };
      if (a.type === "num" && b.type === "num") return { type: "num", code: `(${a.code} ${opSym} ${b.code})` };
      return setDimErr(
        `Dimension mismatch on '${opSym}': cannot combine ${DIM_LABEL[a.type]} and ${DIM_LABEL[b.type]}.`,
        `Addition/subtraction requires matching dimensions (e.g. 2×2 ± 2×2, 1×2 ± 1×2, 2×1 ± 2×1, or scalar ± scalar).`
      );
    }
    function combineMul(a, b) {
      if (a.type === "mat" && b.type === "vec") return { type: "vec", code: `mv(${a.code}, ${b.code})` };
      if (a.type === "mat" && b.type === "mat") return { type: "mat", code: `mm(${a.code}, ${b.code})` };
      if (a.type === "row" && b.type === "vec") return { type: "num", code: `rv(${a.code}, ${b.code})` };
      if (a.type === "row" && b.type === "mat") return { type: "row", code: `rm(${a.code}, ${b.code})` };
      if (a.type === "vec" && b.type === "row") return { type: "mat", code: `vr(${a.code}, ${b.code})` };
      if (a.type === "num" && b.type === "vec") return { type: "vec", code: `vscale((${a.code}), ${b.code})` };
      if (a.type === "vec" && b.type === "num") return { type: "vec", code: `vscale((${b.code}), ${a.code})` };
      if (a.type === "num" && b.type === "mat") return { type: "mat", code: `mscale_k((${a.code}), ${b.code})` };
      if (a.type === "mat" && b.type === "num") return { type: "mat", code: `mscale_k((${b.code}), ${a.code})` };
      if (a.type === "num" && b.type === "row") return { type: "row", code: `rscale((${a.code}), ${b.code})` };
      if (a.type === "row" && b.type === "num") return { type: "row", code: `rscale((${b.code}), ${a.code})` };
      if (a.type === "num" && b.type === "num") return { type: "num", code: `(${a.code} * ${b.code})` };
      if (a.type === "vec" && b.type === "mat") {
        return setDimErr(
          `Dimension mismatch on '*': cannot multiply 2×1 vector by 2×2 matrix (inner dims 1 ≠ 2).`,
          `Try multiplying on the left (M * v → 2×1) or transpose the vector first (T(v) * M → 1×2).`
        );
      }
      if (a.type === "mat" && b.type === "row") {
        return setDimErr(
          `Dimension mismatch on '*': cannot multiply 2×2 matrix by 1×2 row matrix (inner dims 2 ≠ 1).`,
          `Try R * M (1×2 · 2×2 → 1×2) or M * T(R) (2×2 · 2×1 → 2×1).`
        );
      }
      if (a.type === "vec" && b.type === "vec") {
        return setDimErr(
          `Dimension mismatch on '*': cannot multiply two 2×1 vectors (inner dims 1 ≠ 2).`,
          `Use dot(u, v) or T(u) * v for the 1×1 inner product, or u * T(v) for the 2×2 outer product.`
        );
      }
      if (a.type === "row" && b.type === "row") {
        return setDimErr(
          `Dimension mismatch on '*': cannot multiply two 1×2 row matrices (inner dims 2 ≠ 1).`,
          `Transpose the right factor: R1 * T(R2) produces a 1×1 scalar.`
        );
      }
      return setDimErr(
        `Dimension mismatch on '*': incompatible shapes ${DIM_LABEL[a.type]} and ${DIM_LABEL[b.type]}.`,
        `Matrix product (m×n) * (p×q) requires inner dimensions n = p.`
      );
    }
    function combineDiv(a, b) {
      if (b.type !== "num") {
        return setDimErr(
          `Dimension mismatch on '/': cannot divide by a ${DIM_LABEL[b.type]}.`,
          `Division is only defined by a 1×1 scalar. To invert a 2×2 matrix, use inv(M).`
        );
      }
      if (a.type === "vec") return { type: "vec", code: `vscale(1.0 / (${b.code}), ${a.code})` };
      if (a.type === "mat") return { type: "mat", code: `mscale_k(1.0 / (${b.code}), ${a.code})` };
      if (a.type === "row") return { type: "row", code: `rscale(1.0 / (${b.code}), ${a.code})` };
      return { type: "num", code: `(${a.code} / ${b.code})` };
    }

    function parseExpr() {
      let left = parseTerm();
      if (!left) return null;
      while (peek() && (peek().v === "+" || peek().v === "-")) {
        const op = eat().v;
        const right = parseTerm();
        if (!right) return null;
        left = combineAdd(left, right, op === "+" ? 1 : -1);
        if (!left) return null;
      }
      return left;
    }
    function parseTerm() {
      let left = parsePower();
      if (!left) return null;
      while (peek() && (peek().v === "*" || peek().v === "/")) {
        const op = eat().v;
        const right = parsePower();
        if (!right) return null;
        left = op === "*" ? combineMul(left, right) : combineDiv(left, right);
        if (!left) return null;
      }
      return left;
    }
    function parsePower() {
      let base = parseUnary();
      if (!base) return null;
      if (peek() && peek().v === "^") {
        eat("^");
        const exp = parsePower();
        if (!exp || exp.type !== "num") {
          return setDimErr(`Dimension mismatch on '^': exponent must be a 1×1 scalar.`, `Use an integer or scalar power like M^2 or M^(-1).`);
        }
        if (base.type === "mat") return { type: "mat", code: `mpow(${base.code}, ${exp.code})` };
        if (base.type === "num") return { type: "num", code: `pow(${base.code}, ${exp.code})` };
        return setDimErr(`Dimension mismatch on '^': cannot raise a ${DIM_LABEL[base.type]} to a power.`, `Only 1×1 scalars and square 2×2 matrices can be exponentiated.`);
      }
      return base;
    }
    function parseUnary() {
      if (peek() && peek().v === "+") { eat("+"); return parseUnary(); }
      if (peek() && peek().v === "-") {
        eat("-");
        const u = parseUnary();
        if (!u) return null;
        if (u.type === "vec") return { type: "vec", code: `vscale(-1.0, ${u.code})` };
        if (u.type === "mat") return { type: "mat", code: `mscale_k(-1.0, ${u.code})` };
        if (u.type === "row") return { type: "row", code: `rscale(-1.0, ${u.code})` };
        return { type: "num", code: `(-(${u.code}))` };
      }
      return parsePrimary();
    }
    function parsePrimary() {
      const tok = peek();
      if (!tok) return null;
      if (tok.t === "num") { eat(); return { type: "num", code: tok.v }; }
      if (tok.t === "id") {
        eat();
        const nm = tok.v;
        if (peek() && peek().v === "(") {
          eat("(");
          const args = [];
          if (!peek() || peek().v !== ")") {
            while (true) {
              const a = parseExpr();
              if (!a) return null;
              args.push(a);
              if (!eat(",")) break;
            }
          }
          if (!eat(")")) return null;
          if (nm === "row" && args.length === 2 && args[0].type === "num" && args[1].type === "num") {
            return { type: "row", code: `row(${args[0].code}, ${args[1].code})` };
          }
          /* Vector Calculus Differential Operators on Named Cards: div(F), curl(F), jac(F), grad(f), lap(f) */
          if (nm === "div" || nm === "curl" || nm === "jac" || nm === "jacobian" || nm === "grad" || nm === "lap" || nm === "laplacian") {
            if (args.length < 1) return setDimErr(`${nm}() requires a function name (e.g. ${nm}(F)).`, `Pass the name of a defined Vector or Scalar function card.`);
            const fnArg = args[0].code;
            const meta = fnMetaMap && fnMetaMap.get ? fnMetaMap.get(fnArg) : null;
            const ax = args.length >= 3 ? args[1].code : "x";
            const ay = args.length >= 3 ? args[2].code : "y";
            const isVecOp = nm === "div" || nm === "curl" || nm === "jac" || nm === "jacobian";
            if (isVecOp) {
              if (meta && meta.kind !== "field" && meta.kind !== "matrix") {
                return setDimErr(`Dimension error in ${nm}(${fnArg}): expects a Vector Function ℝ² → ℝ², got ${meta.label || meta.kind}.`, `Use ${nm}() on an F(x,y) → ℝ² card.`);
              }
              if (nm === "div") return { type: "num", code: `__cfv_div_${fnArg}(${ax}, ${ay})` };
              if (nm === "curl") return { type: "num", code: `__cfv_curl_${fnArg}(${ax}, ${ay})` };
              return { type: "mat", code: `__cfv_jac_${fnArg}(${ax}, ${ay})` };
            } else {
              if (meta && meta.kind !== "potential") {
                return setDimErr(`Dimension error in ${nm}(${fnArg}): expects a Scalar Function ℝ² → ℝ, got ${meta.label || meta.kind}.`, `Use ${nm}() on a Scalar f(x,y) → ℝ card.`);
              }
              if (nm === "grad") return { type: "vec", code: `__cfv_grad_${fnArg}(${ax}, ${ay})` };
              return { type: "num", code: `__cfv_lap_${fnArg}(${ax}, ${ay})` };
            }
          }
          if (fnMetaMap && fnMetaMap.has && fnMetaMap.has(nm)) {
            const fm = fnMetaMap.get(nm);
            if (fm.kind === "field") {
              if (args.length === 1 && args[0].type === "vec") return { type: "vec", code: `${nm}(${args[0].code})` };
              if (args.length === 2 && args[0].type === "num" && args[1].type === "num") return { type: "vec", code: `${nm}(vec(${args[0].code}, ${args[1].code}))` };
              return setDimErr(`Argument mismatch calling ${nm}(...): Vector Function expects (v) or (x, y).`, `Pass a 2×1 vector like ${nm}(v) or two scalars like ${nm}(x, y).`);
            }
            if (fm.kind === "potential") {
              if (args.length === 2 && args[0].type === "num" && args[1].type === "num") return { type: "num", code: `${nm}(${args[0].code}, ${args[1].code})` };
              if (args.length === 1 && args[0].type === "vec") return { type: "num", code: `${nm}((${args[0].code}).x, (${args[0].code}).y)` };
              return setDimErr(`Argument mismatch calling ${nm}(...): Scalar Function expects (x, y) or (v).`, `Pass (x, y) or a 2D vector v.`);
            }
            if (fm.kind === "curve") {
              if (args.length === 1 && args[0].type === "num") return { type: "vec", code: `${nm}(${args[0].code})` };
              return setDimErr(`Argument mismatch calling ${nm}(...): Curve ℝ → ℝ² expects a single scalar t.`, `Call ${nm}(t) with a scalar parameter.`);
            }
            if (fm.kind === "s2s") {
              if (args.length === 1 && args[0].type === "num") return { type: "num", code: `${nm}(${args[0].code})` };
              return setDimErr(`Argument mismatch calling ${nm}(...): Scalar Function ℝ → ℝ expects 1 scalar.`, `Call ${nm}(x) with a single number.`);
            }
          }
          if (nm === "T" || nm === "transpose") {
            if (args.length !== 1) return setDimErr(`${nm}() expects 1 argument.`, `Pass a 2×2 matrix, 1×2 row matrix, or 2×1 vector.`);
            if (args[0].type === "mat") return { type: "mat", code: `mtrans(${args[0].code})` };
            if (args[0].type === "row") return { type: "vec", code: `rtrans(${args[0].code})` };
            if (args[0].type === "vec") return { type: "row", code: `vtrans(${args[0].code})` };
            return { type: "num", code: args[0].code };
          }
          if (nm === "inv") {
            if (args.length !== 1 || args[0].type !== "mat") {
              return setDimErr(
                `Dimension error in inv(): requires a square 2×2 matrix, got ${args[0] ? DIM_LABEL[args[0].type] : "nothing"}.`,
                `Only square 2×2 matrices have an inverse.`
              );
            }
            return { type: "mat", code: `minv(${args[0].code})` };
          }
          if (SCALAR_MAT_FNS[nm]) {
            if (args.length !== 1 || args[0].type !== "mat") {
              return setDimErr(
                `Dimension error in ${nm}(): requires a square 2×2 matrix, got ${args[0] ? DIM_LABEL[args[0].type] : "nothing"}.`,
                `${nm}() is only defined for square matrices (2×2).`
              );
            }
            return { type: "num", code: `${SCALAR_MAT_FNS[nm]}(${args[0].code})` };
          }
          if (nm === "scale" && args.length === 1) return { type: "mat", code: `mscale(${args[0].code}, ${args[0].code})` };
          if (nm === "shear" && args.length === 1) return { type: "mat", code: `mshear(${args[0].code}, 0.0)` };
          if (MAT_FNS[nm]) return { type: "mat", code: `${MAT_FNS[nm]}(${args.map((a) => a.code).join(", ")})` };
          if (VEC_FNS[nm]) return { type: "vec", code: `${VEC_FNS[nm]}(${args.map((a) => a.code).join(", ")})` };
          if (SCALAR_VEC_FNS[nm]) {
            if ((nm === "dot" || nm === "cross") && (args.length !== 2 || args[0].type !== "vec" || args[1].type !== "vec")) {
              return setDimErr(
                `Dimension error in ${nm}(): expects two 2×1 vectors.`,
                `For row×col multiplication use R * v directly, or transpose a row matrix with T(R).`
              );
            }
            return { type: "num", code: `${SCALAR_VEC_FNS[nm]}(${args.map((a) => a.code).join(", ")})` };
          }
          if (/^T\d+$/.test(nm) && args.length === 1 && args[0].type === "vec") {
            return { type: "vec", code: `${nm}(${args[0].code})` };
          }
          return { type: "num", code: `${nm}(${args.map((a) => a.code).join(", ")})` };
        }
        if (nm === "pi" || nm === "PI") return { type: "num", code: "M_PI" };
        if (nm === "e" || nm === "E") return { type: "num", code: "M_E" };
        if (rowNamesSet && rowNamesSet.has(nm)) return { type: "row", code: nm };
        if (matNamesSet && matNamesSet.has(nm)) return { type: "mat", code: nm };
        if (nm === "v" || (vecNamesSet && vecNamesSet.has(nm))) return { type: "vec", code: nm };
        return { type: "num", code: nm };
      }
      if (tok.v === "(") {
        eat("(");
        const first = parseExpr();
        if (!first) return null;
        if (eat(",")) {
          const second = parseExpr();
          if (!second || !eat(")")) return null;
          if (first.type === "num" && second.type === "num") {
            return { type: "vec", code: `vec(${first.code}, ${second.code})` };
          }
          return setDimErr(`Tuple components must be 1×1 scalars, got (${DIM_LABEL[first.type]}, ${DIM_LABEL[second.type]}).`, `Write (x_expr, y_expr) using scalar expressions.`);
        }
        if (!eat(")")) return null;
        return first;
      }
      if (tok.v === "[") {
        eat("[");
        const items = [];
        if (!peek() || peek().v !== "]") {
          while (true) {
            const a = parseExpr();
            if (!a) return null;
            items.push(a);
            if (!eat(",")) break;
          }
        }
        if (!eat("]")) return null;
        /* [a] or [[a]] -> 1x1 naturally interpreted as scalar */
        if (items.length === 1 && items[0].type === "num") {
          return { type: "num", code: items[0].code };
        }
        /* [[a, b]] -> 1x2 Row Matrix */
        if (items.length === 1 && items[0].type === "vec") {
          const m0 = items[0].code.match(/^vec\((.+)\)$/);
          if (m0) return { type: "row", code: `row(${m0[1]})` };
          return { type: "row", code: `vtrans(${items[0].code})` };
        }
        /* [a, b] or [[a], [b]] -> 2x1 Column Vector */
        if (items.length === 2 && items[0].type === "num" && items[1].type === "num") {
          return { type: "vec", code: `vec(${items[0].code}, ${items[1].code})` };
        }
        /* [[a, b], [c, d]] -> 2x2 Matrix */
        if (items.length === 2 && items[0].type === "vec" && items[1].type === "vec") {
          const m0 = items[0].code.match(/^vec\((.+)\)$/);
          const m1 = items[1].code.match(/^vec\((.+)\)$/);
          if (m0 && m1) return { type: "mat", code: `mat(${m0[1]}, ${m1[1]})` };
        }
        return setDimErr(
          `Unsupported matrix literal dimensions (max supported is 2×2).`,
          `Use [[a,b],[c,d]] for 2×2, [[a,b]] for 1×2, [a,b] or [[a],[b]] for 2×1, or [[a]] for 1×1 scalar.`
        );
      }
      return null;
    }

    const res = parseExpr();
    if (dimErr) return dimErr;
    if (!res || pos !== tokens.length) return null;
    return res;
  }

  function matrixCodeToC11(code, matNamesSet, vecNamesSet, rowNamesSet, fnMetaMap) {
    const parsed = transpileLinAlgToC11(code, matNamesSet, vecNamesSet, rowNamesSet, fnMetaMap);
    if (parsed && parsed.error) return { ok: false, error: parsed.error, hint: parsed.hint, code: "meye()", type: "mat" };
    if (parsed && (parsed.type === "mat" || parsed.type === "row")) {
      return { ok: true, type: parsed.type, code: parsed.code };
    }
    if (parsed && parsed.type) {
      return {
        ok: false,
        type: parsed.type,
        code: "meye()",
        error: `Matrix expression evaluates to a ${DIM_LABEL[parsed.type]} instead of a 2×2 or 1×2 matrix.`,
        hint: parsed.type === "vec" ? `Resize this matrix to 2×1 to convert it into a Vector Variable.` : `Resize this matrix to 1×1 to convert it into a Scalar Variable.`,
      };
    }
    return { ok: true, type: "mat", code: "meye()" };
  }

  function vectorFnCodeToC11(raw, matNamesSet, vecNamesSet, rowNamesSet, fnMetaMap) {
    const s = String(raw || "").trim();
    if (!s) return { ok: true, code: "fx = 0.0; fy = 0.0;" };
    if (/\bfx\s*=/.test(s) || /\bfy\s*=/.test(s)) return { ok: true, code: s };
    const body = s.replace(/^return\s+/, "").replace(/;\s*$/, "").trim();
    const parsed = transpileLinAlgToC11(body, matNamesSet, vecNamesSet, rowNamesSet, fnMetaMap);
    if (parsed && parsed.error) return { ok: false, error: parsed.error, hint: parsed.hint, code: s };
    if (parsed && parsed.type === "vec") {
      return { ok: true, code: `vec2 _cfv_out = (${parsed.code}); fx = _cfv_out.x; fy = _cfv_out.y;` };
    }
    if (parsed && parsed.type && parsed.type !== "vec") {
      return {
        ok: false,
        code: s,
        error: `Dimension mismatch: Vector Function F(x,y) must return a 2×1 vector, but your formula returns a ${DIM_LABEL[parsed.type]}.`,
        hint: parsed.type === "num"
          ? `If you want to graph a scalar function R² → R (with Contours), switch this card to ℝ² → ℝ.`
          : parsed.type === "row"
            ? `Wrap with T(...) to transpose a 1×2 row into a 2×1 vector, or multiply by v (R * v) in a Scalar f(x,y) card.`
            : `Multiply the 2×2 matrix by input vector v (e.g. M * v) to get a 2×1 vector output.`,
      };
    }
    return { ok: true, code: s };
  }

  function curveFnCodeToC11(raw, matNamesSet, vecNamesSet, rowNamesSet, fnMetaMap) {
    const s = String(raw || "").trim();
    if (!s) return { ok: true, code: "vec(cos(t), sin(t))" };
    const body = s.replace(/^return\s+/, "").replace(/;\s*$/, "").trim();
    const parsed = transpileLinAlgToC11(body, matNamesSet, vecNamesSet, rowNamesSet, fnMetaMap);
    if (parsed && parsed.error) return { ok: false, error: parsed.error, hint: parsed.hint, code: s };
    if (parsed && parsed.type === "vec") return { ok: true, code: parsed.code };
    if (parsed && parsed.type && parsed.type !== "vec") {
      return {
        ok: false,
        code: s,
        error: `Dimension mismatch: Parametric Curve γ(t) → ℝ² must return a 2×1 vector, got ${DIM_LABEL[parsed.type]}.`,
        hint: `Write a vector expression of t like (cos(t), sin(t)), [t, sin(t)], or rot(t) * u.`,
      };
    }
    return { ok: true, code: s };
  }

  function scalarFnCodeToC11(raw, matNamesSet, vecNamesSet, rowNamesSet, fnMetaMap) {
    const s = String(raw || "").trim();
    if (!s) return { ok: true, code: "0.0" };
    if (s.includes(";") || /\breturn\b/.test(s)) return { ok: true, code: s };
    const parsed = transpileLinAlgToC11(s, matNamesSet, vecNamesSet, rowNamesSet, fnMetaMap);
    if (parsed && parsed.error) return { ok: false, error: parsed.error, hint: parsed.hint, code: s };
    if (parsed && parsed.type === "num") {
      return { ok: true, code: parsed.code };
    }
    if (parsed && parsed.type && parsed.type !== "num") {
      return {
        ok: false,
        code: s,
        error: `Dimension mismatch: Scalar Function must return a 1×1 scalar, but your formula returns a ${DIM_LABEL[parsed.type]}.`,
        hint: parsed.type === "vec"
          ? `Take a scalar reduction like len(v), dot(u, v), or R * v (1×2 · 2×1 → 1×1), or switch this card to ℝ² → ℝ².`
          : parsed.type === "row"
            ? `Multiply the 1×2 row by a 2×1 vector (e.g. R * v) to produce a 1×1 scalar.`
            : `Use det(M), tr(M), or quadratic form T(v) * M * v to get a 1×1 scalar.`,
      };
    }
    return { ok: true, code: s };
  }

  function explainC11Error(rawDiag) {
    const d = String(rawDiag || "");
    const binMatch = d.match(/invalid operands to binary expression \('([^']+)' and '([^']+)'\)/i);
    if (binMatch) {
      const mapT = (t) => t === "mat2" ? "2×2 matrix" : t === "row2" ? "1×2 row matrix" : t === "vec2" ? "2×1 vector" : t === "double" ? "1×1 scalar" : t;
      return {
        title: `Dimension / Type Mismatch: cannot apply operator between ${mapT(binMatch[1])} and ${mapT(binMatch[2])}.`,
        hint: `Check matrix/vector shapes (2×2 · 2×1 → 2×1, 1×2 · 2×1 → 1×1, 1×2 · 2×2 → 1×2). In multi-line C code, use helpers mv(M,v), mm(A,B), rv(R,v), vadd(u,w), vdot(u,w).`,
      };
    }
    const retMatch = d.match(/(?:returning|assigning to)\s+'([^']+)'\s+from\s+(?:incompatible\s+type|expression\s+of\s+incompatible\s+type)\s+'([^']+)'/i);
    if (retMatch) {
      const mapT = (t) => t === "mat2" ? "2×2 matrix" : t === "row2" ? "1×2 row matrix" : t === "vec2" ? "2×1 vector" : t === "double" ? "1×1 scalar" : t;
      return {
        title: `Return Dimension Mismatch: expected ${mapT(retMatch[1])}, got ${mapT(retMatch[2])}.`,
        hint: `Make sure a Scalar f(x,y) card outputs a 1×1 scalar, a Vector F(x,y) card outputs a 2×1 vector (or sets fx, fy), and a Matrix card matches its selected dimensions.`,
      };
    }
    const undMatch = d.match(/use of undeclared identifier '([^']+)'/i);
    if (undMatch) {
      return {
        title: `Unknown symbol '${undMatch[1]}'`,
        hint: `'${undMatch[1]}' isn't defined yet. Define it as a Slider, Var, Vec Var, or Matrix card (matrices are named M1, M2, ... and M/A for the first matrix).`,
      };
    }
    return null;
  }

  function createHistoryStack(maxLen = 48) {
    const undo = [];
    const redo = [];
    return {
      push(snapshot) {
        if (!snapshot) return;
        undo.push(snapshot);
        if (undo.length > maxLen) undo.shift();
        redo.length = 0;
      },
      undo(currentSnapshot) {
        if (!undo.length) return null;
        if (currentSnapshot) {
          redo.push(currentSnapshot);
          if (redo.length > maxLen) redo.shift();
        }
        return undo.pop();
      },
      redo(currentSnapshot) {
        if (!redo.length) return null;
        if (currentSnapshot) {
          undo.push(currentSnapshot);
          if (undo.length > maxLen) undo.shift();
        }
        return redo.pop();
      },
      clear() { undo.length = 0; redo.length = 0; },
      canUndo() { return undo.length > 0; },
      canRedo() { return redo.length > 0; },
    };
  }

  /* Multi-Touch PointerEvent Pinch-to-Zoom & Two-Finger Pan/Orbit Controller */
  function attachPinchController(el, { onPinch, onTwoFingerPan } = {}) {
    if (!el) return () => {};
    const active = new Map();
    let lastDist = 0;
    let lastMid = null;
    function getPair() {
      const vals = Array.from(active.values());
      return vals.length >= 2 ? [vals[0], vals[1]] : null;
    }
    function onDown(e) {
      if (e.pointerType !== "touch") return;
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pair = getPair();
      if (pair) {
        lastDist = Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y);
        lastMid = { x: 0.5 * (pair[0].x + pair[1].x), y: 0.5 * (pair[0].y + pair[1].y) };
      }
    }
    function onMove(e) {
      if (e.pointerType !== "touch" || !active.has(e.pointerId)) return;
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pair = getPair();
      if (!pair) return;
      e.preventDefault();
      const dist = Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y);
      const mid = { x: 0.5 * (pair[0].x + pair[1].x), y: 0.5 * (pair[0].y + pair[1].y) };
      const rect = el.getBoundingClientRect();
      if (lastDist > 8 && dist > 8 && typeof onPinch === "function") {
        const factor = dist / lastDist;
        if (Math.abs(factor - 1.0) > 0.004) onPinch(factor, mid.x - rect.left, mid.y - rect.top);
      }
      if (lastMid && typeof onTwoFingerPan === "function") {
        const dx = mid.x - lastMid.x, dy = mid.y - lastMid.y;
        if (Math.abs(dx) > 0.25 || Math.abs(dy) > 0.25) onTwoFingerPan(dx, dy);
      }
      lastDist = dist; lastMid = mid;
    }
    function onUp(e) {
      active.delete(e.pointerId);
      if (active.size < 2) { lastDist = 0; lastMid = null; }
    }
    el.addEventListener("pointerdown", onDown, { passive: true });
    el.addEventListener("pointermove", onMove, { passive: false });
    el.addEventListener("pointerup", onUp, { passive: true });
    el.addEventListener("pointercancel", onUp, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }

  function niceStep(rawStep) {
    if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const f = rawStep / p;
    if (f < 1.5) return p;
    if (f < 3.5) return 2 * p;
    if (f < 7.5) return 5 * p;
    return 10 * p;
  }

  function fmtTick(v) {
    if (Math.abs(v) < 1e-11) return "0";
    if (Math.abs(v) >= 1e5 || (Math.abs(v) > 0 && Math.abs(v) < 1e-3)) return v.toExponential(1);
    return Number(v.toPrecision(6)).toString();
  }

  /* -------------------------------------------------------------------------
   * Standardized Multi-Select, Marquee & Group Bounding Box Helpers
   * Shared across Complex, Real, and Vector modes for identical Move UX!
   * ------------------------------------------------------------------------- */
  function computeGroupBounds(shapes, points) {
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const s of shapes || []) {
      for (const p of s.rawPts || []) {
        if (p.x < xmin) xmin = p.x;
        if (p.x > xmax) xmax = p.x;
        if (p.y < ymin) ymin = p.y;
        if (p.y > ymax) ymax = p.y;
      }
    }
    for (const pt of points || []) {
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

  function shapeIntersectsRect(rawPts, rxmin, rxmax, rymin, rymax) {
    if (!rawPts || rawPts.length === 0) return false;
    let sxmin = Infinity, sxmax = -Infinity, symin = Infinity, symax = -Infinity;
    for (const p of rawPts) {
      if (p.x >= rxmin && p.x <= rxmax && p.y >= rymin && p.y <= rymax) return true;
      if (p.x < sxmin) sxmin = p.x;
      if (p.x > sxmax) sxmax = p.x;
      if (p.y < symin) symin = p.y;
      if (p.y > symax) symax = p.y;
    }
    return !(sxmax < rxmin || sxmin > rxmax || symax < rymin || symin > rymax);
  }

  function drawMarqueeRect(ctx, x0, y0, x1, y1, light) {
    const lx = Math.min(x0, x1), ty = Math.min(y0, y1);
    const rw = Math.abs(x1 - x0), rh = Math.abs(y1 - y0);
    ctx.save();
    ctx.fillStyle = light ? "rgba(2, 132, 199, 0.12)" : "rgba(56, 189, 248, 0.14)";
    ctx.strokeStyle = light ? "rgba(2, 132, 199, 0.85)" : "rgba(56, 189, 248, 0.90)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    ctx.fillRect(lx, ty, rw, rh);
    ctx.strokeRect(lx + 0.5, ty + 0.5, rw, rh);
    ctx.restore();
  }

  function drawGroupBoxAndHandles(ctx, bb, xToS, yToS, rotInfo, light, isRotating) {
    if (!bb) return;
    const x0 = xToS(bb.xmin), y0 = yToS(bb.ymax);
    const x1 = xToS(bb.xmax), y1 = yToS(bb.ymin);
    ctx.save();
    ctx.strokeStyle = light ? "rgba(2, 132, 199, 0.78)" : "rgba(56, 189, 248, 0.82)";
    ctx.fillStyle = light ? "rgba(2, 132, 199, 0.05)" : "rgba(56, 189, 248, 0.05)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
    for (const hd of getGroupHandles(bb)) {
      const sx = xToS(hd.x), sy = yToS(hd.y);
      ctx.fillStyle = light ? "#ffffff" : "#0a0e17";
      ctx.strokeStyle = light ? "#0284c7" : "#38bdf8";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.rect(sx - 4.5, sy - 4.5, 9, 9); ctx.fill(); ctx.stroke();
    }
    if (rotInfo) {
      ctx.strokeStyle = light ? "rgba(2, 132, 199, 0.82)" : "rgba(56, 189, 248, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(rotInfo.stemX, rotInfo.stemY); ctx.lineTo(rotInfo.handleX, rotInfo.handleY); ctx.stroke();
      ctx.fillStyle = isRotating ? "#38bdf8" : (light ? "#ffffff" : "#0a0e17");
      ctx.beginPath(); ctx.arc(rotInfo.handleX, rotInfo.handleY, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  /* -------------------------------------------------------------------------
   * Standardized Draggable / Resizable / Minimizable Floating Panel
   * Shared by Complex Contour Integration & Vector Line Integral Panels!
   * ------------------------------------------------------------------------- */
  function attachFloatingPanel(panelEl, opts = {}) {
    if (!panelEl) return null;
    const containerEl = opts.containerEl || panelEl.parentElement;
    const headerEl = opts.headerEl || panelEl.querySelector(".integral-panel-hdr");
    const minBtnEl = opts.minBtnEl || null;
    const resizeHandleEl = opts.resizeHandleEl || null;
    const minSumEl = opts.minSumEl || null;
    let minimized = false;
    let savedSize = null;

    const setMinimized = (next) => {
      minimized = Boolean(next);
      if (minimized) {
        savedSize = { w: panelEl.style.width, h: panelEl.style.height, mh: panelEl.style.maxHeight };
        panelEl.style.width = "";
        panelEl.style.height = "";
      } else if (savedSize) {
        panelEl.style.width = savedSize.w || "";
        panelEl.style.height = savedSize.h || "";
        panelEl.style.maxHeight = savedSize.mh || "";
      }
      panelEl.classList.toggle("minimized", minimized);
      if (minBtnEl) minBtnEl.textContent = minimized ? "+" : "−";
      if (minSumEl) {
        const hasVal = minSumEl.textContent && minSumEl.textContent.trim().length > 0;
        minSumEl.classList.toggle("hidden", !minimized || !hasVal);
      }
      if (typeof opts.onMinimizeChange === "function") opts.onMinimizeChange(minimized);
    };

    if (minBtnEl) {
      minBtnEl.addEventListener("click", (e) => {
        e.stopPropagation();
        setMinimized(!minimized);
      });
    }

    if (resizeHandleEl && containerEl) {
      let res = null;
      resizeHandleEl.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cr = containerEl.getBoundingClientRect();
        const pr = panelEl.getBoundingClientRect();
        const startLeft = pr.left - cr.left, startTop = pr.top - cr.top;
        panelEl.style.left = `${startLeft}px`;
        panelEl.style.top = `${startTop}px`;
        panelEl.style.bottom = "auto";
        panelEl.style.right = "auto";
        res = { startX: e.clientX, startY: e.clientY, startW: pr.width, startH: pr.height, startLeft, startTop };
        panelEl.classList.add("dragging");
        if (resizeHandleEl.setPointerCapture) resizeHandleEl.setPointerCapture(e.pointerId);
      });
      resizeHandleEl.addEventListener("pointermove", (e) => {
        if (!res) return;
        const maxW = Math.max(220, containerEl.clientWidth - res.startLeft - 8);
        const maxH = Math.max(96, containerEl.clientHeight - res.startTop - 8);
        const nw = Math.max(220, Math.min(maxW, res.startW + (e.clientX - res.startX)));
        const nh = Math.max(96, Math.min(maxH, res.startH + (e.clientY - res.startY)));
        panelEl.style.width = `${Math.round(nw)}px`;
        panelEl.style.height = `${Math.round(nh)}px`;
        panelEl.style.maxHeight = "none";
      });
      const endRes = () => { if (!res) return; res = null; panelEl.classList.remove("dragging"); };
      resizeHandleEl.addEventListener("pointerup", endRes);
      resizeHandleEl.addEventListener("pointercancel", endRes);
    }

    if (headerEl && containerEl) {
      let drag = null;
      headerEl.addEventListener("pointerdown", (e) => {
        if (e.target && e.target.closest && e.target.closest("button")) return;
        e.preventDefault();
        e.stopPropagation();
        const cr = containerEl.getBoundingClientRect();
        const pr = panelEl.getBoundingClientRect();
        const startLeft = pr.left - cr.left, startTop = pr.top - cr.top;
        panelEl.style.left = `${startLeft}px`;
        panelEl.style.top = `${startTop}px`;
        panelEl.style.bottom = "auto";
        panelEl.style.right = "auto";
        drag = { startX: e.clientX, startY: e.clientY, startLeft, startTop };
        panelEl.classList.add("dragging");
        if (headerEl.setPointerCapture) headerEl.setPointerCapture(e.pointerId);
      });
      headerEl.addEventListener("pointermove", (e) => {
        if (!drag) return;
        const maxL = Math.max(8, containerEl.clientWidth - panelEl.offsetWidth - 8);
        const maxT = Math.max(46, containerEl.clientHeight - panelEl.offsetHeight - 8);
        const nl = Math.max(8, Math.min(maxL, drag.startLeft + (e.clientX - drag.startX)));
        const nt = Math.max(46, Math.min(maxT, drag.startTop + (e.clientY - drag.startY)));
        panelEl.style.left = `${nl}px`;
        panelEl.style.top = `${nt}px`;
      });
      const endDrag = () => { if (!drag) return; drag = null; panelEl.classList.remove("dragging"); };
      headerEl.addEventListener("pointerup", endDrag);
      headerEl.addEventListener("pointercancel", endDrag);
    }

    return { setMinimized, isMinimized: () => minimized };
  }

  /* -------------------------------------------------------------------------
   * Single Source of Truth for Light / Dark Theme Detection
   * ------------------------------------------------------------------------- */
  function isLightTheme() {
    return typeof document !== "undefined" && Boolean(document.documentElement) && document.documentElement.dataset.theme === "light";
  }

  /* -------------------------------------------------------------------------
   * Standardized Smart Magnetic Snapping Engine (Complex, Real & Vector Modes)
   * Snaps to: Origin (0,0), Points P, Endpoints (Tail/Tip/End), Corners,
   * Edge Midpoints, Centers, Circle Cardinals (0/90/180/270°) & Diagonals
   * (45/135/225/315°), Guide Line Intersections & Guide Lines, and Shift Grid!
   * ------------------------------------------------------------------------- */
  function findSmartSnap(sx, sy, opts = {}) {
    const xToS = opts.xToS;
    const yToS = opts.yToS;
    if (typeof xToS !== "function" || typeof yToS !== "function") return null;

    const shapes = Array.isArray(opts.shapes) ? opts.shapes : [];
    const points = Array.isArray(opts.points) ? opts.points : [];
    const lines = Array.isArray(opts.lines) ? opts.lines : [];
    const snapPx = Number.isFinite(opts.snapPx) ? opts.snapPx : 13;
    const excludeShapeId = opts.excludeShapeId !== undefined ? opts.excludeShapeId : null;
    const excludePointId = opts.excludePointId !== undefined ? opts.excludePointId : null;

    let best = null;
    let bestScore = Infinity;

    const consider = (x, y, kind, label, priorityBias = 0, extra = null) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const px = xToS(x), py = yToS(y);
      if (!Number.isFinite(px) || !Number.isFinite(py)) return;
      const d = Math.hypot(sx - px, sy - py);
      if (d > snapPx) return;
      const score = d + priorityBias;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y, kind, label, distPx: d, ...(extra || {}) };
      }
    };

    /* 1. Origin (0, 0) */
    consider(0, 0, "origin", "(0, 0)", -1.6);

    /* 2. Visible Points P (preserves pointId so vector tails can pin to moving points!) */
    for (const p of points) {
      if (!p || p.visible === false || p.id === excludePointId) continue;
      consider(p.x, p.y, "point", p.label || "Pt", -1.2, { pointId: p.id });
    }

    /* 3. Shape Landmarks: Endpoints, Corners, Midpoints, Centers, Circle Cardinals & Diagonals */
    for (const s of shapes) {
      if (!s || s.visible === false || s.id === excludeShapeId || s.kind === "image") continue;
      const pts = s.rawPts;
      if (!Array.isArray(pts) || pts.length < 2) continue;
      const sk = s.kind || "";

      if (sk === "circle") {
        const bb = getShapeBounds(pts);
        if (bb) {
          const r = 0.25 * ((bb.maxX - bb.minX) + (bb.maxY - bb.minY));
          consider(bb.cx, bb.cy, "center", "Center", -0.6, { shapeId: s.id });
          if (r > 1e-6) {
            const angles = [
              [0, "0°", "cardinal"],
              [45, "45°", "diagonal"],
              [90, "90°", "cardinal"],
              [135, "135°", "diagonal"],
              [180, "180°", "cardinal"],
              [225, "225°", "diagonal"],
              [270, "270°", "cardinal"],
              [315, "315°", "diagonal"],
            ];
            for (const [deg, lbl, kind] of angles) {
              const rad = (deg * Math.PI) / 180;
              consider(bb.cx + r * Math.cos(rad), bb.cy + r * Math.sin(rad), kind, lbl, 0.2, { shapeId: s.id });
            }
          }
        }
        continue;
      }

      if (sk === "rect" || isRectShape(s)) {
        let sumX = 0, sumY = 0;
        const n = pts.length;
        for (let i = 0; i < n; i++) {
          const a = pts[i], b = pts[(i + 1) % n];
          sumX += a.x; sumY += a.y;
          consider(a.x, a.y, "corner", "Corner", -0.4, { shapeId: s.id });
          consider(0.5 * (a.x + b.x), 0.5 * (a.y + b.y), "midpoint", "Midpoint", 0.4, { shapeId: s.id });
        }
        consider(sumX / n, sumY / n, "center", "Center", 0.5, { shapeId: s.id });
        continue;
      }

      if (sk === "polygon" || (s.closed && pts.length <= 24)) {
        let sumX = 0, sumY = 0;
        const n = pts.length;
        for (let i = 0; i < n; i++) {
          const a = pts[i], b = pts[(i + 1) % n];
          sumX += a.x; sumY += a.y;
          consider(a.x, a.y, "corner", "Corner", -0.4, { shapeId: s.id });
          if (n <= 16) {
            consider(0.5 * (a.x + b.x), 0.5 * (a.y + b.y), "midpoint", "Midpoint", 0.5, { shapeId: s.id });
          }
        }
        consider(sumX / n, sumY / n, "center", "Center", 0.7, { shapeId: s.id });
        continue;
      }

      if (sk === "vector" || sk === "seg" || sk === "line" || sk === "ray" || sk === "infline") {
        const p0 = pts[0], p1 = pts[pts.length - 1];
        consider(p0.x, p0.y, "endpoint", sk === "vector" ? "Tail" : "End", -0.7, { shapeId: s.id });
        consider(p1.x, p1.y, "endpoint", sk === "vector" ? "Tip" : "End", -0.7, { shapeId: s.id });
        if (sk === "vector" || sk === "seg" || sk === "line") {
          consider(0.5 * (p0.x + p1.x), 0.5 * (p0.y + p1.y), "midpoint", "Midpoint", 0.4, { shapeId: s.id });
        }
        continue;
      }

      /* Open arcs, freehand & joined paths: endpoints + midpoint along arc */
      if (!s.closed) {
        const p0 = pts[0], p1 = pts[pts.length - 1];
        consider(p0.x, p0.y, "endpoint", "End", -0.6, { shapeId: s.id });
        consider(p1.x, p1.y, "endpoint", "End", -0.6, { shapeId: s.id });
        if (pts.length >= 3) {
          const mid = pts[Math.floor(pts.length / 2)];
          consider(mid.x, mid.y, "midpoint", "Midpoint", 0.6, { shapeId: s.id });
        }
      } else {
        const bb = getShapeBounds(pts);
        if (bb) consider(bb.cx, bb.cy, "center", "Center", 0.7, { shapeId: s.id });
      }
    }

    /* 4. Guide Lines: H x V Intersections + Orthogonal Projection */
    const visH = [], visV = [];
    for (const ln of lines) {
      if (!ln || ln.visible === false || !Number.isFinite(ln.value)) continue;
      if (ln.orientation === "horizontal") visH.push(ln);
      else visV.push(ln);
    }
    for (const hLn of visH) {
      for (const vLn of visV) {
        consider(vLn.value, hLn.value, "intersection", "Intersect", -0.8);
      }
    }
    if (!best && typeof opts.sToX === "function" && typeof opts.sToY === "function") {
      const wx = opts.sToX(sx), wy = opts.sToY(sy);
      const guidePx = Math.min(9, snapPx * 0.75);
      for (const hLn of visH) {
        const d = Math.abs(sy - yToS(hLn.value));
        if (d <= guidePx && d + 2.5 < bestScore) {
          bestScore = d + 2.5;
          best = { x: wx, y: hLn.value, kind: "guide", label: hLn.label || `y=${fmtTick(hLn.value)}`, distPx: d };
        }
      }
      for (const vLn of visV) {
        const d = Math.abs(sx - xToS(vLn.value));
        if (d <= guidePx && d + 2.5 < bestScore) {
          bestScore = d + 2.5;
          best = { x: vLn.value, y: wy, kind: "guide", label: vLn.label || `x=${fmtTick(vLn.value)}`, distPx: d };
        }
      }
    }

    /* 5. Optional Shift Half-Integer Grid Fallback */
    if (!best && opts.shiftKey && opts.includeGrid && typeof opts.sToX === "function" && typeof opts.sToY === "function") {
      const step = Number.isFinite(opts.gridStep) && opts.gridStep > 0 ? opts.gridStep : 0.5;
      return {
        x: Math.round(opts.sToX(sx) / step) * step,
        y: Math.round(opts.sToY(sy) / step) * step,
        kind: "grid",
        label: null,
        distPx: 0,
      };
    }

    return best;
  }

  function drawSnapIndicator(ctx, snap, xToS, yToS, light = false) {
    if (!ctx || !snap || !Number.isFinite(snap.x) || !Number.isFinite(snap.y)) return;
    if (snap.kind === "grid") return;
    const sx = xToS(snap.x), sy = yToS(snap.y);
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;

    const palette = {
      origin:       { stroke: light ? "#0284c7" : "#38bdf8", fill: "rgba(56, 189, 248, 0.22)", text: light ? "#0369a1" : "#7dd3fc" },
      point:        { stroke: light ? "#d97706" : "#fbbf24", fill: "rgba(251, 191, 36, 0.22)", text: light ? "#b45309" : "#fde047" },
      endpoint:     { stroke: light ? "#059669" : "#34d399", fill: "rgba(52, 211, 153, 0.22)", text: light ? "#047857" : "#6ee7b7" },
      corner:       { stroke: light ? "#059669" : "#34d399", fill: "rgba(52, 211, 153, 0.22)", text: light ? "#047857" : "#6ee7b7" },
      midpoint:     { stroke: light ? "#7c3aed" : "#a78bfa", fill: "rgba(167, 139, 250, 0.22)", text: light ? "#6d28d9" : "#ddd6fe" },
      center:       { stroke: light ? "#0891b2" : "#22d3ee", fill: "rgba(34, 211, 238, 0.22)", text: light ? "#0e7490" : "#67e8f9" },
      cardinal:     { stroke: light ? "#0d9488" : "#2dd4bf", fill: "rgba(45, 212, 191, 0.22)", text: light ? "#0f766e" : "#99f6e4" },
      diagonal:     { stroke: light ? "#e11d48" : "#fb7185", fill: "rgba(251, 113, 133, 0.22)", text: light ? "#be123c" : "#fda4af" },
      intersection: { stroke: light ? "#4f46e5" : "#818cf8", fill: "rgba(129, 140, 248, 0.22)", text: light ? "#4338ca" : "#c7d2fe" },
      guide:        { stroke: light ? "#0284c7" : "#38bdf8", fill: "rgba(56, 189, 248, 0.16)", text: light ? "#0369a1" : "#7dd3fc" },
      curve:        { stroke: light ? "#059669" : "#34d399", fill: "rgba(52, 211, 153, 0.20)", text: light ? "#047857" : "#6ee7b7" },
    };
    const sty = palette[snap.kind] || palette.endpoint;

    ctx.save();
    ctx.strokeStyle = sty.stroke;
    ctx.fillStyle = sty.fill;
    ctx.lineWidth = 2;

    if (snap.kind === "corner" || snap.kind === "endpoint") {
      ctx.beginPath();
      ctx.rect(sx - 7, sy - 7, 14, 14);
      ctx.fill();
      ctx.stroke();
    } else if (snap.kind === "midpoint" || snap.kind === "cardinal" || snap.kind === "diagonal") {
      const r = 8.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy - r);
      ctx.lineTo(sx + r, sy);
      ctx.lineTo(sx, sy + r);
      ctx.lineTo(sx - r, sy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (snap.kind === "intersection") {
      ctx.beginPath(); ctx.arc(sx, sy, 8.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx - 5, sy - 5); ctx.lineTo(sx + 5, sy + 5);
      ctx.moveTo(sx + 5, sy - 5); ctx.lineTo(sx - 5, sy + 5);
      ctx.stroke();
    } else if (snap.kind === "center") {
      ctx.beginPath(); ctx.arc(sx, sy, 8.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx - 6, sy); ctx.lineTo(sx + 6, sy);
      ctx.moveTo(sx, sy - 6); ctx.lineTo(sx, sy + 6);
      ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(sx, sy, 9.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(sx, sy, 2.8, 0, Math.PI * 2);
    ctx.fillStyle = sty.stroke;
    ctx.fill();

    if (snap.label) {
      ctx.font = '700 10.5px "JetBrains Mono", monospace';
      const tw = ctx.measureText(snap.label).width;
      const bx = sx + 12, by = sy - 20;
      ctx.fillStyle = light ? "rgba(255,255,255,0.94)" : "rgba(10,14,23,0.92)";
      ctx.strokeStyle = sty.stroke;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, tw + 10, 18, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = sty.text;
      ctx.fillText(snap.label, bx + 5, by + 12.5);
    }
    ctx.restore();
  }

  /* -------------------------------------------------------------------------
   * Standardized Open-Path Joiner (Shared by Complex & Vector Modes!)
   * Chains open segments/paths end-to-end and auto-closes loops when endpoints meet.
   * ------------------------------------------------------------------------- */
  function joinOpenPaths(candidates, opts = {}) {
    if (!Array.isArray(candidates) || candidates.length < 2) {
      return { groups: [], removedIds: new Set(), mergedCount: 0 };
    }
    const tol = Number.isFinite(opts.tolerance) ? opts.tolerance : 0.14;
    const useSelectedMode = Boolean(opts.useSelectedMode);
    const selectedId = opts.selectedId !== undefined ? opts.selectedId : null;
    const connectLimit = useSelectedMode ? Infinity : tol;
    const used = new Set();
    const removedIds = new Set();
    const groups = [];
    let mergedCount = 0;

    const ordered = [...candidates].sort((a, b) =>
      a.id === selectedId ? -1 : b.id === selectedId ? 1 : 0
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
        const head = pts[0], tail = pts[pts.length - 1];
        let best = null, bestDist = connectLimit;

        for (const cand of candidates) {
          if (used.has(cand.id)) continue;
          const cFirst = cand.rawPts[0];
          const cLast = cand.rawPts[cand.rawPts.length - 1];
          const checks = [
            [dist(tail, cFirst), "tail", false],
            [dist(tail, cLast), "tail", true],
            [dist(head, cLast), "head", false],
            [dist(head, cFirst), "head", true],
          ];
          for (const [d, where, rev] of checks) {
            if (d <= bestDist) { bestDist = d; best = { cand, where, rev }; }
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
        groups.push({ seed, group, pts, closed });
      }
    }

    return { groups, removedIds, mergedCount };
  }

  /* -------------------------------------------------------------------------
   * Standardized Selectable Integral Row Card (Shared by Complex & Vector Panels!)
   * ------------------------------------------------------------------------- */
  function createIntegralRowCard(opts = {}) {
    const row = document.createElement("div");
    row.className = "integral-row-card" + (opts.selected ? " selected" : "");
    if (opts.tooltip) row.title = opts.tooltip;

    const top = document.createElement("div");
    top.className = "integral-row-top";

    const dot = document.createElement("span");
    dot.className = "integral-dot";
    dot.style.background = opts.color || "#34d399";
    top.appendChild(dot);

    const title = document.createElement("span");
    title.textContent = opts.title || "Contour";
    top.appendChild(title);

    if (opts.badgeText) {
      const badge = document.createElement("span");
      badge.className = "integral-row-badge" + (opts.badgeClass ? " " + opts.badgeClass : "");
      badge.textContent = opts.badgeText;
      top.appendChild(badge);
    }

    if (typeof opts.onReverse === "function") {
      const revBtn = document.createElement("button");
      revBtn.className = "integral-row-rev";
      revBtn.textContent = "⇄";
      revBtn.title = "Reverse contour orientation (flips sign of integral)";
      revBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        opts.onReverse();
      });
      top.appendChild(revBtn);
    }
    row.appendChild(top);

    const metrics = document.createElement("div");
    metrics.className = "integral-row-metrics";
    for (const m of (opts.metrics || [])) {
      const cell = document.createElement("div");
      cell.className = "integral-row-metric";
      const lbl = document.createElement("span");
      lbl.className = "integral-metric-lbl";
      lbl.textContent = m.label || "";
      const val = document.createElement("span");
      val.className = m.valClass || "integral-row-main";
      if (m.valColor) val.style.color = m.valColor;
      val.textContent = m.value || "";
      cell.appendChild(lbl);
      cell.appendChild(val);
      if (m.hint) {
        const hEl = document.createElement("span");
        hEl.className = "integral-row-exact";
        hEl.textContent = m.hint;
        cell.appendChild(hEl);
      }
      metrics.appendChild(cell);
    }
    row.appendChild(metrics);

    if (typeof opts.onSelect === "function") {
      row.addEventListener("click", () => opts.onSelect());
    }
    if (typeof opts.onHover === "function") {
      row.addEventListener("pointerenter", () => opts.onHover(true));
      row.addEventListener("pointerleave", () => opts.onHover(false));
    }
    return row;
  }

  window.CFVGeom = {
    isLightTheme,
    getShapeBounds,
    isRectShape,
    rectLocalFrame,
    distPtToSeg,
    pointInPolygon,
    makeCirclePoints,
    makeArcPoints,
    makeLinePoints,
    makeRectPoints,
    evalParamExpr,
    evalShapeFormula,
    createDefaultFormulaForShape,
    rebuildFormulaElementsInState,
    createHistoryStack,
    attachPinchController,
    attachFloatingPanel,
    findSmartSnap,
    drawSnapIndicator,
    joinOpenPaths,
    createIntegralRowCard,
    niceStep,
    fmtTick,
    computeGroupBounds,
    getGroupHandles,
    shapeIntersectsRect,
    drawMarqueeRect,
    drawGroupBoxAndHandles,
  };

  window.CFVLinAlg = {
    isMat2,
    isRow2,
    isVec2,
    makeMat2,
    makeRow2,
    makeVec2,
    matMul,
    matVec,
    rowVec,
    rowMat,
    vecRow,
    matInv,
    matTrans,
    matPow,
    evalExpr: evalLinAlgExpr,
    analyzeMat2,
    fmtNum,
    renderMatrixLatexHtml,
    renderRow2LatexHtml,
    renderVectorLatexHtml,
    parseMatrixCellsFromCode,
    parseVectorCellsFromCode,
    transpileLinAlgToC11,
    matrixCodeToC11,
    vectorFnCodeToC11,
    curveFnCodeToC11,
    scalarFnCodeToC11,
    explainC11Error,
    validateIdentifierName,
  };
})();
