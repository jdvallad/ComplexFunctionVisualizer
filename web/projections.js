(() => {
  "use strict";

  /*
   * Output Space Projections Engine (Planar, 3D Sphere, Stereographic Finite Disk,
   * Poincaré Disk, and Arbitrary User-Defined Complex Projection P(w))
   *
   * Also hosts a lightweight zero-dependency Complex Expression Compiler so users can
   * type arbitrary expressions in w, u (Re), v (Im), r (|w|), theta (arg w), i, pi, e,
   * plus all workspace sliders & computed variables!
   */

  const C = {
    make: (re, im = 0) => ({ x: re, y: im }),
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
    sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
    neg: (a) => ({ x: -a.x, y: -a.y }),
    mul: (a, b) => ({ x: a.x * b.x - a.y * b.y, y: a.x * b.y + a.y * b.x }),
    div: (a, b) => {
      const d = b.x * b.x + b.y * b.y;
      if (d < 1e-30) return { x: NaN, y: NaN };
      return { x: (a.x * b.x + a.y * b.y) / d, y: (a.y * b.x - a.x * b.y) / d };
    },
    abs: (a) => ({ x: Math.hypot(a.x, a.y), y: 0 }),
    arg: (a) => ({ x: Math.atan2(a.y, a.x), y: 0 }),
    conj: (a) => ({ x: a.x, y: -a.y }),
    re: (a) => ({ x: a.x, y: 0 }),
    im: (a) => ({ x: a.y, y: 0 }),
    exp: (a) => {
      const er = Math.exp(Math.max(-700, Math.min(700, a.x)));
      return { x: er * Math.cos(a.y), y: er * Math.sin(a.y) };
    },
    log: (a) => {
      const r = Math.hypot(a.x, a.y);
      if (r < 1e-30) return { x: NaN, y: NaN };
      return { x: Math.log(r), y: Math.atan2(a.y, a.x) };
    },
    sqrt: (a) => {
      const r = Math.hypot(a.x, a.y);
      const th = Math.atan2(a.y, a.x) * 0.5;
      const sr = Math.sqrt(r);
      return { x: sr * Math.cos(th), y: sr * Math.sin(th) };
    },
    pow: (a, b) => {
      if (b.y === 0 && Number.isInteger(b.x) && b.x >= 0 && b.x <= 8) {
        let res = { x: 1, y: 0 };
        for (let k = 0; k < b.x; k++) res = C.mul(res, a);
        return res;
      }
      const r = Math.hypot(a.x, a.y);
      if (r < 1e-30) return b.x > 0 ? { x: 0, y: 0 } : { x: NaN, y: NaN };
      return C.exp(C.mul(b, C.log(a)));
    },
    sin: (a) => ({ x: Math.sin(a.x) * Math.cosh(a.y), y: Math.cos(a.x) * Math.sinh(a.y) }),
    cos: (a) => ({ x: Math.cos(a.x) * Math.cosh(a.y), y: -Math.sin(a.x) * Math.sinh(a.y) }),
    tan: (a) => C.div(C.sin(a), C.cos(a)),
    sinh: (a) => ({ x: Math.sinh(a.x) * Math.cos(a.y), y: Math.cosh(a.x) * Math.sin(a.y) }),
    cosh: (a) => ({ x: Math.cosh(a.x) * Math.cos(a.y), y: Math.sinh(a.x) * Math.sin(a.y) }),
    tanh: (a) => C.div(C.sinh(a), C.cosh(a)),
    atan: (a) => {
      /* atan(z) = (i/2) * log((i + z) / (i - z)) */
      const ipz = { x: a.x, y: a.y + 1 };
      const imz = { x: -a.x, y: 1 - a.y };
      const lg = C.log(C.div(ipz, imz));
      return C.mul({ x: 0, y: 0.5 }, lg);
    },
    asin: (a) => {
      /* -i * log(i*z + sqrt(1 - z^2)) */
      const iz = { x: -a.y, y: a.x };
      const oneMinusZ2 = C.sub({ x: 1, y: 0 }, C.mul(a, a));
      const lg = C.log(C.add(iz, C.sqrt(oneMinusZ2)));
      return { x: lg.y, y: -lg.x };
    },
    acos: (a) => C.sub({ x: Math.PI * 0.5, y: 0 }, C.asin(a)),
  };

  /* Recursive-descent tokenizer & parser for complex expressions in w */
  function tokenize(src) {
    const toks = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (/[0-9.]/.test(ch)) {
        let j = i;
        while (j < n && /[0-9.]/.test(src[j])) j++;
        if (j < n && (src[j] === "e" || src[j] === "E")) {
          j++;
          if (j < n && (src[j] === "+" || src[j] === "-")) j++;
          while (j < n && /[0-9]/.test(src[j])) j++;
        }
        const val = parseFloat(src.slice(i, j));
        if (!Number.isFinite(val)) throw new Error(`Invalid number '${src.slice(i, j)}'`);
        toks.push({ t: "num", v: val });
        i = j;
        continue;
      }
      if (/[a-zA-Z_]/.test(ch)) {
        let j = i;
        while (j < n && /[a-zA-Z0-9_]/.test(src[j])) j++;
        toks.push({ t: "id", v: src.slice(i, j) });
        i = j;
        continue;
      }
      if ("+-*/^(),".includes(ch)) {
        toks.push({ t: "op", v: ch });
        i++;
        continue;
      }
      throw new Error(`Unexpected character '${ch}'`);
    }
    return toks;
  }

  function compileComplexProjection(exprStr) {
    const raw = String(exprStr || "").trim();
    if (!raw) throw new Error("Empty projection expression");
    const toks = tokenize(raw);
    let pos = 0;
    const peek = () => toks[pos] || null;
    const eat = (v) => {
      const t = toks[pos];
      if (!t || (v !== undefined && t.v !== v)) throw new Error(`Expected '${v}'`);
      pos++;
      return t;
    };

    function parseExpr() {
      let left = parseTerm();
      while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
        const op = eat().v;
        const right = parseTerm();
        const l = left, r = right;
        left = op === "+" ? (ctx) => C.add(l(ctx), r(ctx)) : (ctx) => C.sub(l(ctx), r(ctx));
      }
      return left;
    }

    function parseTerm() {
      let left = parsePower();
      while (peek()) {
        const tk = peek();
        if (tk.t === "op" && (tk.v === "*" || tk.v === "/")) {
          const op = eat().v;
          const right = parsePower();
          const l = left, r = right;
          left = op === "*" ? (ctx) => C.mul(l(ctx), r(ctx)) : (ctx) => C.div(l(ctx), r(ctx));
        } else if (tk.t === "id" || tk.t === "num" || (tk.t === "op" && tk.v === "(")) {
          /* Implicit multiplication e.g. 2w or 2i */
          const right = parsePower();
          const l = left, r = right;
          left = (ctx) => C.mul(l(ctx), r(ctx));
        } else {
          break;
        }
      }
      return left;
    }

    function parsePower() {
      let base = parseUnary();
      if (peek() && peek().t === "op" && peek().v === "^") {
        eat("^");
        const exp = parsePower();
        const b = base, e = exp;
        return (ctx) => C.pow(b(ctx), e(ctx));
      }
      return base;
    }

    function parseUnary() {
      if (peek() && peek().t === "op" && peek().v === "+") {
        eat("+");
        return parseUnary();
      }
      if (peek() && peek().t === "op" && peek().v === "-") {
        eat("-");
        const sub = parseUnary();
        return (ctx) => C.neg(sub(ctx));
      }
      return parsePrimary();
    }

    function parsePrimary() {
      const tk = peek();
      if (!tk) throw new Error("Unexpected end of expression");
      if (tk.t === "num") {
        eat();
        const val = { x: tk.v, y: 0 };
        return () => val;
      }
      if (tk.t === "op" && tk.v === "(") {
        eat("(");
        const inner = parseExpr();
        eat(")");
        return inner;
      }
      if (tk.t === "id") {
        const name = eat().v;
        if (peek() && peek().t === "op" && peek().v === "(") {
          eat("(");
          const args = [];
          if (!peek() || peek().v !== ")") {
            args.push(parseExpr());
            while (peek() && peek().t === "op" && peek().v === ",") {
              eat(",");
              args.push(parseExpr());
            }
          }
          eat(")");
          const fnKey = name.toLowerCase();
          if (fnKey === "pow" && args.length === 2) {
            const [a, b] = args;
            return (ctx) => C.pow(a(ctx), b(ctx));
          }
          if (fnKey === "c_make" && args.length === 2) {
            const [a, b] = args;
            return (ctx) => ({ x: a(ctx).x, y: b(ctx).x });
          }
          const fnMap = {
            abs: C.abs, cabs: C.abs, fabs: C.abs,
            arg: C.arg, carg: C.arg,
            conj: C.conj,
            re: C.re, creal: C.re, real: C.re,
            im: C.im, cimag: C.im, imag: C.im,
            exp: C.exp, cexp: C.exp,
            log: C.log, ln: C.log, clog: C.log,
            sqrt: C.sqrt, csqrt: C.sqrt,
            sin: C.sin, csin: C.sin,
            cos: C.cos, ccos: C.cos,
            tan: C.tan, ctan: C.tan,
            sinh: C.sinh, csinh: C.sinh,
            cosh: C.cosh, ccosh: C.cosh,
            tanh: C.tanh, ctanh: C.tanh,
            atan: C.atan, catan: C.atan,
            asin: C.asin, casin: C.asin,
            acos: C.acos, cacos: C.acos,
          };
          const fn = fnMap[fnKey];
          if (!fn || args.length !== 1) throw new Error(`Unknown function '${name}(...)'`);
          const a0 = args[0];
          return (ctx) => fn(a0(ctx));
        }
        const low = name.toLowerCase();
        if (low === "w" || low === "z") return (ctx) => ctx.w;
        if (low === "i" || low === "j") return () => ({ x: 0, y: 1 });
        if (low === "pi" || low === "m_pi") return () => ({ x: Math.PI, y: 0 });
        if (low === "e" || low === "m_e") return () => ({ x: Math.E, y: 0 });
        if (low === "u" || low === "x") return (ctx) => ({ x: ctx.w.x, y: 0 });
        if (low === "v" || low === "y") return (ctx) => ({ x: ctx.w.y, y: 0 });
        if (low === "r") return (ctx) => ({ x: ctx.r, y: 0 });
        if (low === "theta" || low === "phi") return (ctx) => ({ x: ctx.theta, y: 0 });
        return (ctx) => {
          const val = ctx.params && Object.prototype.hasOwnProperty.call(ctx.params, name)
            ? Number(ctx.params[name])
            : NaN;
          return { x: Number.isFinite(val) ? val : 0, y: 0 };
        };
      }
      throw new Error(`Unexpected token '${tk.v}'`);
    }

    const ast = parseExpr();
    if (pos < toks.length) throw new Error(`Unexpected trailing '${toks[pos].v}'`);
    return (u, v, params) => {
      if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
      const r = Math.hypot(u, v);
      const theta = Math.atan2(v, u);
      const res = ast({ w: { x: u, y: v }, r, theta, params });
      if (!res || !Number.isFinite(res.x) || !Number.isFinite(res.y)) return null;
      if (Math.hypot(res.x, res.y) > 1e6) return null;
      return res;
    };
  }

  /* Built-in 2D finite projections of the extended complex plane C ∪ {∞} */
  function projectStereographicDisk(u, v) {
    /* Polar-angle azimuthal stereographic compactification of S^2 onto unit disk |W| <= 1:
     *   rho = (2 / pi) * atan(|w|) in [0, 1]
     *   0 -> 0, |w| = 1 (equator) -> |W| = 0.5, infinity (North Pole) -> |W| = 1. */
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    const r = Math.hypot(u, v);
    if (r < 1e-15) return { x: 0, y: 0 };
    const rho = (2.0 / Math.PI) * Math.atan(r);
    return { x: (u / r) * rho, y: (v / r) * rho };
  }

  function projectPoincareDisk(u, v) {
    /* Hyperboloid-to-Poincaré Disk stereographic projection of C onto the open unit disk D:
     *   W = w / (1 + sqrt(1 + |w|^2))
     *   Bijective conformal/radial mapping of all C into |W| < 1 with ∞ -> ∂D (|W| = 1). */
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    const r2 = u * u + v * v;
    if (r2 > 1e14) {
      const r = Math.sqrt(r2);
      return { x: u / r, y: v / r };
    }
    const denom = 1.0 + Math.sqrt(1.0 + r2);
    return { x: u / denom, y: v / denom };
  }

  let cachedCustomExpr = "";
  let cachedCustomFn = null;
  let cachedCustomErr = "";

  function getCustomProjector(exprStr) {
    const clean = String(exprStr || "").trim();
    if (clean === cachedCustomExpr && (cachedCustomFn || cachedCustomErr)) {
      return { fn: cachedCustomFn, err: cachedCustomErr };
    }
    cachedCustomExpr = clean;
    try {
      cachedCustomFn = compileComplexProjection(clean);
      cachedCustomErr = "";
    } catch (e) {
      cachedCustomFn = null;
      cachedCustomErr = e && e.message ? e.message : "Invalid expression";
    }
    return { fn: cachedCustomFn, err: cachedCustomErr };
  }

  function projectPoint(mode, pt, customExpr, params) {
    if (!pt) return null;
    if (mode === "planar" || mode === "sphere") return pt;
    if (mode === "stereographic") return projectStereographicDisk(pt.x, pt.y);
    if (mode === "poincare") return projectPoincareDisk(pt.x, pt.y);
    if (mode === "custom") {
      const { fn } = getCustomProjector(customExpr);
      if (!fn) return pt;
      return fn(pt.x, pt.y, params);
    }
    return pt;
  }

  function projectPoints(mode, pts, customExpr, params) {
    if (!pts || mode === "planar" || mode === "sphere") return pts;
    const out = new Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      out[i] = projectPoint(mode, pts[i], customExpr, params);
    }
    return out;
  }

  /* Draws specialized disk / hyperbolic geodesic / stereographic latitude-longitude backdrop */
  function drawProjectionOverlay(ctx, canvas, view, worldToScreen, mode, isLight) {
    if (mode !== "stereographic" && mode !== "poincare") return;
    const scX = view.scaleX || view.scale;
    const scY = view.scaleY || view.scale;
    const o = worldToScreen(view, canvas, 0, 0);
    const rx = scX;
    const ry = scY;

    ctx.save();
    /* Soft tinted interior for unit disk |W| <= 1 */
    ctx.beginPath();
    ctx.ellipse(o.x, o.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = isLight ? "rgba(56, 189, 248, 0.05)" : "rgba(56, 189, 248, 0.045)";
    ctx.fill();

    /* Clip interior grid lines to unit disk */
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(o.x, o.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();

    const gridCol = isLight ? "rgba(15, 23, 42, 0.14)" : "rgba(148, 163, 184, 0.17)";
    const eqCol = isLight ? "rgba(124, 58, 237, 0.42)" : "rgba(167, 139, 250, 0.42)";
    const labelCol = isLight ? "rgba(51, 65, 85, 0.78)" : "rgba(148, 163, 184, 0.72)";

    if (mode === "stereographic") {
      /* Concentric modulus rings |w| = 0.25, 0.5, 1, 2, 4, 8 */
      const moduli = [0.25, 0.5, 1, 2, 4, 8];
      for (const m of moduli) {
        const rho = (2.0 / Math.PI) * Math.atan(m);
        ctx.beginPath();
        ctx.ellipse(o.x, o.y, rho * rx, rho * ry, 0, 0, Math.PI * 2);
        ctx.strokeStyle = m === 1 ? eqCol : gridCol;
        ctx.lineWidth = m === 1 ? 1.5 : 1;
        ctx.setLineDash(m === 1 ? [5, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        if (rho * rx > 22) {
          ctx.fillStyle = m === 1 ? eqCol : labelCol;
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.fillText(`|w|=${m}`, o.x + rho * rx * 0.707 + 3, o.y - rho * ry * 0.707 - 3);
        }
      }
      /* Radial phase rays every 30° */
      ctx.strokeStyle = gridCol;
      ctx.lineWidth = 1;
      for (let deg = 0; deg < 180; deg += 30) {
        const a = (deg * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(o.x - Math.cos(a) * rx, o.y + Math.sin(a) * ry);
        ctx.lineTo(o.x + Math.cos(a) * rx, o.y - Math.sin(a) * ry);
        ctx.stroke();
      }
    } else if (mode === "poincare") {
      /* Concentric hyperbolic distance circles (|w| = 0.5, 1, 2, 5, 15) */
      const moduli = [0.5, 1, 2, 5, 15];
      for (const m of moduli) {
        const rho = m / (1 + Math.sqrt(1 + m * m));
        ctx.beginPath();
        ctx.ellipse(o.x, o.y, rho * rx, rho * ry, 0, 0, Math.PI * 2);
        ctx.strokeStyle = m === 1 ? eqCol : gridCol;
        ctx.lineWidth = m === 1 ? 1.4 : 1;
        ctx.setLineDash(m === 1 ? [5, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        if (rho * rx > 22) {
          ctx.fillStyle = m === 1 ? eqCol : labelCol;
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.fillText(`|w|=${m}`, o.x + rho * rx * 0.707 + 3, o.y - rho * ry * 0.707 - 3);
        }
      }
      /* Orthogonal hyperbolic geodesic arcs meeting ∂D at 90° */
      ctx.strokeStyle = isLight ? "rgba(14, 116, 144, 0.16)" : "rgba(56, 189, 248, 0.16)";
      ctx.lineWidth = 1;
      for (let k = 0; k < 8; k++) {
        const theta = (k * Math.PI) / 4;
        const d = 1.41421356; /* center at distance sqrt(2), radius 1 -> orthogonal to unit circle! */
        const gcx = d * Math.cos(theta);
        const gcy = d * Math.sin(theta);
        const gp = worldToScreen(view, canvas, gcx, gcy);
        ctx.beginPath();
        ctx.ellipse(gp.x, gp.y, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();

    /* Crisp ideal boundary circle |W| = 1 (w = ∞) */
    ctx.beginPath();
    ctx.ellipse(o.x, o.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = isLight ? "rgba(2, 132, 199, 0.72)" : "rgba(56, 189, 248, 0.72)";
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.fillStyle = isLight ? "#0369a1" : "#38bdf8";
    ctx.font = '600 10.5px "JetBrains Mono", monospace';
    ctx.fillText(mode === "poincare" ? "∂𝔻 (|W|=1, w=∞)" : "|W|=1 (w=∞)", o.x + rx + 6, o.y - 4);
    ctx.restore();
  }

  function getSubtitle(mode, customExpr) {
    if (mode === "sphere") return "3D Riemann Sphere S²";
    if (mode === "stereographic") return "Stereographic Disk · (2/π)atan|w|·e^(iθ)";
    if (mode === "poincare") return "Poincaré Disk · w / (1 + √(1+|w|²))";
    if (mode === "custom") return `Custom P(w) = ${customExpr || "w"}`;
    return "w = f(z)";
  }

  window.CFVProjections = {
    compileComplexProjection,
    getCustomProjector,
    projectPoint,
    projectPoints,
    drawProjectionOverlay,
    getSubtitle,
  };
})();
