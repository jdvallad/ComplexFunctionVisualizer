(() => {
  "use strict";

  /* =========================================================================
   * Theme-Aware Adaptive Color Engine (window.CFVTheme)
   * Automatically preserves contrast across Light <-> Dark theme toggles:
   *  - White / pale lines & markers on a Light canvas shift to crisp dark slate
   *    or richly darkened hues (preserving hue & vibrancy).
   *  - Pitch-black / near-black lines on a Dark canvas lift to soft light tones.
   *  - Pass { onDarkSurface: true } when drawing over a dark opaque globe/ocean
   *    so polar ice/snow stays crisp white over sapphire ocean!
   * ========================================================================= */
  const _colorCache = new Map();

  function isLight() {
    return typeof document !== "undefined" && document.documentElement && document.documentElement.dataset.theme === "light";
  }

  function parseHexRgb(col) {
    if (!col || typeof col !== "string") return null;
    const s = col.trim();
    if (s[0] === "#") {
      if (s.length === 4) {
        return [
          parseInt(s[1] + s[1], 16),
          parseInt(s[2] + s[2], 16),
          parseInt(s[3] + s[3], 16),
        ];
      }
      if (s.length >= 7) {
        const r = parseInt(s.slice(1, 3), 16);
        const g = parseInt(s.slice(3, 5), 16);
        const b = parseInt(s.slice(5, 7), 16);
        if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return [r, g, b];
      }
    }
    const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    return null;
  }

  function rgbToHsl(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const l = (max + min) * 0.5;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
      else if (max === gn) h = (bn - rn) / d + 2;
      else h = (rn - gn) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    return [
      Math.round(hue2rgb(h + 1 / 3) * 255),
      Math.round(hue2rgb(h) * 255),
      Math.round(hue2rgb(h - 1 / 3) * 255),
    ];
  }

  function toHex(r, g, b) {
    const h = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  function adaptRgb(col, opts = {}) {
    const light = opts.isLight !== undefined ? Boolean(opts.isLight) : isLight();
    const onDark = Boolean(opts.onDarkSurface);
    const isSolidFill = Boolean(opts.solidFill);
    const key = `${col}|${light ? 1 : 0}|${onDark ? 1 : 0}|${isSolidFill ? 1 : 0}`;
    const hit = _colorCache.get(key);
    if (hit) return hit;

    const rgb = parseHexRgb(col);
    if (!rgb) return null;
    let [r, g, b] = rgb;
    if (onDark) {
      const res = { r, g, b, hex: toHex(r, g, b) };
      _colorCache.set(key, res);
      return res;
    }
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (light) {
      if (!isSolidFill && lum > 0.52) {
        const [h, s, l] = rgbToHsl(r, g, b);
        if (s < 0.14) {
          const nl = Math.max(0.16, Math.min(0.36, 1.0 - l * 0.84));
          [r, g, b] = hslToRgb(215 / 360, 0.22, nl);
        } else {
          const targetL = lum > 0.72 ? Math.min(l * 0.48, 0.35) : Math.min(l * 0.66, 0.41);
          const targetS = Math.min(0.94, Math.max(s, 0.62) * 1.1);
          [r, g, b] = hslToRgb(h, targetS, Math.max(0.22, targetL));
        }
      }
    } else {
      if (!isSolidFill && lum < 0.10) {
        const [h, s, l] = rgbToHsl(r, g, b);
        if (s < 0.14) {
          const nl = Math.min(0.88, Math.max(0.72, 1.0 - l * 0.85));
          [r, g, b] = hslToRgb(215 / 360, 0.16, nl);
        } else {
          [r, g, b] = hslToRgb(h, Math.min(0.92, Math.max(s, 0.65)), Math.max(0.58, 1.0 - l * 0.6));
        }
      }
    }
    const res = { r, g, b, hex: toHex(r, g, b) };
    if (_colorCache.size > 512) _colorCache.clear();
    _colorCache.set(key, res);
    return res;
  }

  function adaptColor(col, opts = {}) {
    const res = adaptRgb(col, opts);
    return res ? res.hex : (col || (isLight() ? "#0369a1" : "#38bdf8"));
  }

  function adaptRgba(col, alpha, opts = {}) {
    const res = adaptRgb(col, opts);
    if (!res) return `rgba(56,189,248,${alpha})`;
    return `rgba(${res.r},${res.g},${res.b},${alpha})`;
  }

  window.CFVTheme = {
    isLight,
    adaptColor,
    adaptRgba,
    hiStroke: () => (isLight() ? "#0f172a" : "#ffffff"),
    labelBg: () => (isLight() ? "rgba(248, 250, 252, 0.90)" : "rgba(7, 10, 16, 0.84)"),
    labelBorder: () => (isLight() ? "rgba(30, 41, 59, 0.18)" : "rgba(148, 163, 184, 0.25)"),
  };

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

  /* Built-in 2D finite & coordinate projections of the extended complex plane C ∪ {∞}
   * Every curated projection has an exact forward + exact analytic inverse! */
  function projectStereographicDisk(u, v) {
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    const r = Math.hypot(u, v);
    if (r < 1e-15) return { x: 0, y: 0 };
    const rho = (2.0 / Math.PI) * Math.atan(r);
    return { x: (u / r) * rho, y: (v / r) * rho };
  }

  function inverseStereographicDisk(x, y) {
    const rho = Math.hypot(x, y);
    if (rho < 1e-15) return { x: 0, y: 0 };
    const rc = Math.min(0.996, rho);
    const r = Math.tan(rc * Math.PI * 0.5);
    return { x: (x / rho) * r, y: (y / rho) * r };
  }

  function projectPoincareDisk(u, v) {
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    const r2 = u * u + v * v;
    if (r2 > 1e14) {
      const r = Math.sqrt(r2);
      return { x: u / r, y: v / r };
    }
    const denom = 1.0 + Math.sqrt(1.0 + r2);
    return { x: u / denom, y: v / denom };
  }

  function inversePoincareDisk(x, y) {
    const r2 = x * x + y * y;
    if (r2 < 1e-15) return { x: 0, y: 0 };
    const denom = Math.max(1e-4, 1.0 - Math.min(0.996, r2));
    return { x: (2.0 * x) / denom, y: (2.0 * y) / denom };
  }

  function projectMercator(u, v) {
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    const r = Math.hypot(u, v);
    if (r < 1e-12) return { x: 0, y: -2.65 };
    const lon = Math.atan2(u, v);
    const y = Math.max(-2.65, Math.min(2.65, Math.log(r)));
    return { x: lon, y };
  }

  function inverseMercator(x, y) {
    const r = Math.exp(Math.max(-6, Math.min(6, y)));
    return { x: r * Math.sin(x), y: r * Math.cos(x) };
  }

  function projectPoint(mode, pt) {
    if (!pt) return null;
    if (mode === "planar" || mode === "polar" || mode === "sphere") return pt;
    if (mode === "stereographic") return projectStereographicDisk(pt.x, pt.y);
    if (mode === "poincare") return projectPoincareDisk(pt.x, pt.y);
    if (mode === "mercator") return projectMercator(pt.x, pt.y);
    return pt;
  }

  function inverseProjectPoint(mode, pt) {
    if (!pt) return null;
    if (mode === "stereographic") return inverseStereographicDisk(pt.x, pt.y);
    if (mode === "poincare") return inversePoincareDisk(pt.x, pt.y);
    if (mode === "mercator") return inverseMercator(pt.x, pt.y);
    return pt;
  }

  function projectPoints(mode, pts) {
    if (!pts || mode === "planar" || mode === "polar" || mode === "sphere") return pts;
    if (mode === "mercator") {
      const mapped = [];
      let validCount = 0;
      let sumY = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = projectMercator(pts[i] ? pts[i].x : NaN, pts[i] ? pts[i].y : NaN);
        mapped.push(p);
        if (p) { validCount++; sumY += p.y; }
      }
      /* Detect polar-cap polygons (e.g. Antarctica encircling South Pole 0) so Mercator fills
       * cleanly down to the southern (or northern) map border with ZERO antimeridian tearing! */
      if (validCount >= 8) {
        let totalDlon = 0;
        let prevM = null;
        let firstM = null;
        for (let i = 0; i < mapped.length; i++) {
          const p = mapped[i];
          if (!p) continue;
          if (!firstM) firstM = p;
          if (prevM) {
            let d = p.x - prevM.x;
            if (d > Math.PI) d -= Math.PI * 2;
            else if (d < -Math.PI) d += Math.PI * 2;
            totalDlon += d;
          }
          prevM = p;
        }
        if (prevM && firstM) {
          let d = firstM.x - prevM.x;
          if (d > Math.PI) d -= Math.PI * 2;
          else if (d < -Math.PI) d += Math.PI * 2;
          totalDlon += d;
        }
        if (Math.abs(totalDlon) > Math.PI * 1.45) {
          const avgY = sumY / validCount;
          const poleY = avgY < 0 ? -2.65 : 2.65;
          const ring = mapped.filter(Boolean).sort((a, b) => a.x - b.x);
          if (ring.length >= 3) {
            const leftEdgeY = ring[0].y;
            const rightEdgeY = ring[ring.length - 1].y;
            return [
              { x: -Math.PI, y: poleY },
              { x: -Math.PI, y: leftEdgeY },
              ...ring,
              { x: Math.PI, y: rightEdgeY },
              { x: Math.PI, y: poleY },
            ];
          }
        }
      }
      const out = [];
      let prev = null;
      for (let i = 0; i < mapped.length; i++) {
        const p = mapped[i];
        if (!p) { out.push(null); prev = null; continue; }
        if (prev && Math.abs(p.x - prev.x) > Math.PI * 0.95) {
          out.push(null);
        }
        out.push(p);
        prev = p;
      }
      return out;
    }
    const out = new Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      out[i] = projectPoint(mode, pts[i]);
    }
    return out;
  }

  /* Draws specialized coordinate backdrops: Polar Grid, Mercator Lat/Lon Graticule,
   * Stereographic Disk, and Poincaré Disk (making each coordinate system unmistakable!). */
  function drawProjectionOverlay(ctx, canvas, view, worldToScreen, mode, isLight, drawDomainCb) {
    if (mode === "polar") {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const scX = view.scaleX || view.scale, scY = view.scaleY || view.scale;
      const o = worldToScreen(view, canvas, 0, 0);
      const maxWorldR = Math.hypot(Math.max(Math.abs(o.x), Math.abs(w - o.x)) / scX, Math.max(Math.abs(o.y), Math.abs(h - o.y)) / scY);
      const rawStep = Math.max(0.25, maxWorldR / 6);
      const pow10 = Math.pow(10, Math.floor(Math.log10(rawStep)));
      const norm = rawStep / pow10;
      const step = (norm <= 1.5 ? 1 : norm <= 3.5 ? 2 : norm <= 7.5 ? 5 : 10) * pow10;

      ctx.save();
      ctx.fillStyle = isLight ? "#f4f7fb" : "#080c14";
      ctx.fillRect(0, 0, w, h);
      if (typeof drawDomainCb === "function") drawDomainCb();
      const ringCol = isLight ? "rgba(15, 23, 42, 0.14)" : "rgba(148, 163, 184, 0.18)";
      const axisCol = isLight ? "rgba(15, 23, 42, 0.28)" : "rgba(203, 213, 225, 0.30)";
      const lblCol = isLight ? "rgba(51, 65, 85, 0.78)" : "rgba(148, 163, 184, 0.78)";
      ctx.font = '10px "JetBrains Mono", monospace';
      for (let r = step; r <= maxWorldR + step; r += step) {
        ctx.beginPath();
        ctx.ellipse(o.x, o.y, r * scX, r * scY, 0, 0, Math.PI * 2);
        ctx.strokeStyle = Math.abs(r - 1.0) < 1e-6 ? (isLight ? "rgba(109,40,217,0.45)" : "rgba(167,139,250,0.48)") : ringCol;
        ctx.lineWidth = Math.abs(r - 1.0) < 1e-6 ? 1.4 : 1;
        ctx.stroke();
        const lx = o.x + r * scX * 0.707 + 3, ly = o.y - r * scY * 0.707 - 3;
        if (lx > 10 && lx < w - 30 && ly > 44 && ly < h - 10) {
          ctx.fillStyle = lblCol;
          ctx.fillText(`r=${Number(r.toPrecision(3))}`, lx, ly);
        }
      }
      const rayLen = Math.max(w, h) * 1.5;
      for (let deg = 0; deg < 360; deg += 30) {
        const rad = (deg * Math.PI) / 180;
        const isAxis = deg % 90 === 0;
        ctx.strokeStyle = isAxis ? axisCol : ringCol;
        ctx.lineWidth = isAxis ? 1.3 : 0.9;
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(o.x + Math.cos(rad) * rayLen, o.y - Math.sin(rad) * rayLen);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }

    if (mode === "mercator") {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      ctx.save();
      ctx.fillStyle = isLight ? "#e6edf5" : "#060a12";
      ctx.fillRect(0, 0, w, h);
      const tl = worldToScreen(view, canvas, -Math.PI, 2.65);
      const br = worldToScreen(view, canvas, Math.PI, -2.65);
      ctx.fillStyle = isLight ? "#f7f9fc" : "#0b111e";
      ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      if (typeof drawDomainCb === "function") {
        ctx.save();
        ctx.beginPath();
        ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        ctx.clip();
        drawDomainCb();
        ctx.restore();
      }
      ctx.strokeStyle = isLight ? "rgba(2, 132, 199, 0.55)" : "rgba(56, 189, 248, 0.55)";
      ctx.lineWidth = 1.6;
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

      const gridCol = isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(148, 163, 184, 0.16)";
      const eqCol = isLight ? "rgba(2, 132, 199, 0.45)" : "rgba(56, 189, 248, 0.45)";
      const lblCol = isLight ? "rgba(51, 65, 85, 0.80)" : "rgba(148, 163, 184, 0.80)";
      ctx.font = '10px "JetBrains Mono", monospace';
      for (let lon = -180; lon <= 180; lon += 30) {
        const sp = worldToScreen(view, canvas, (lon * Math.PI) / 180, 0);
        ctx.strokeStyle = lon === 0 ? eqCol : gridCol;
        ctx.lineWidth = lon === 0 ? 1.3 : 0.9;
        ctx.beginPath(); ctx.moveTo(sp.x, tl.y); ctx.lineTo(sp.x, br.y); ctx.stroke();
        if (sp.x > tl.x - 10 && sp.x < br.x + 10 && br.y < h - 10) {
          ctx.fillStyle = lblCol;
          ctx.fillText(`${lon}°`, sp.x - 10, Math.min(h - 6, br.y + 13));
        }
      }
      for (let lat = -60; lat <= 60; lat += 30) {
        const ym = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
        const sp = worldToScreen(view, canvas, 0, ym);
        ctx.strokeStyle = lat === 0 ? eqCol : gridCol;
        ctx.lineWidth = lat === 0 ? 1.4 : 0.9;
        ctx.beginPath(); ctx.moveTo(tl.x, sp.y); ctx.lineTo(br.x, sp.y); ctx.stroke();
        ctx.fillStyle = lblCol;
        ctx.fillText(lat === 0 ? "Eq" : `${lat > 0 ? "+" : ""}${lat}°`, Math.max(8, tl.x - 28), sp.y + 3);
      }
      ctx.restore();
      return;
    }

    if (mode !== "stereographic" && mode !== "poincare") return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const scX = view.scaleX || view.scale;
    const scY = view.scaleY || view.scale;
    const o = worldToScreen(view, canvas, 0, 0);
    const rx = scX;
    const ry = scY;

    ctx.save();
    /* Clear distinct exterior void outside the disk so the disk is unmistakably the entire plane ℂ */
    ctx.fillStyle = isLight ? "#e4eaf2" : "#060910";
    ctx.fillRect(0, 0, w, h);

    /* Subtle radial halo around the disk boundary */
    const haloR = Math.max(rx, ry);
    if (haloR > 12 && haloR < 4000) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(o.x, o.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = isLight ? "#f7f9fc" : "#0b111e";
      ctx.shadowColor = isLight ? "rgba(15, 23, 42, 0.14)" : "rgba(56, 189, 248, 0.22)";
      ctx.shadowBlur = isLight ? 22 : 28;
      ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.ellipse(o.x, o.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = isLight ? "#f7f9fc" : "#0b111e";
      ctx.fill();
    }

    /* Clip ALL interior coordinate grid lines & axes strictly inside the unit disk |W| <= 1 */
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(o.x, o.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();
    if (typeof drawDomainCb === "function") drawDomainCb();

    const gridCol = isLight ? "rgba(15, 23, 42, 0.13)" : "rgba(148, 163, 184, 0.16)";
    const axisCol = isLight ? "rgba(15, 23, 42, 0.30)" : "rgba(203, 213, 225, 0.32)";
    const eqCol = isLight ? "rgba(109, 40, 217, 0.45)" : "rgba(167, 139, 250, 0.48)";
    const labelCol = isLight ? "rgba(51, 65, 85, 0.80)" : "rgba(148, 163, 184, 0.78)";

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
        if (rho * rx > 24) {
          ctx.fillStyle = m === 1 ? eqCol : labelCol;
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.fillText(`|w|=${m}`, o.x + rho * rx * 0.707 + 3, o.y - rho * ry * 0.707 - 3);
        }
      }
      /* Radial phase rays every 30° (0° and 90° drawn as Re/Im axes) */
      for (let deg = 0; deg < 180; deg += 30) {
        const isAxis = deg === 0 || deg === 90;
        const a = (deg * Math.PI) / 180;
        ctx.strokeStyle = isAxis ? axisCol : gridCol;
        ctx.lineWidth = isAxis ? 1.25 : 1;
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
        ctx.lineWidth = m === 1 ? 1.45 : 1;
        ctx.setLineDash(m === 1 ? [5, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        if (rho * rx > 24) {
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
      /* Real & Imaginary hyperbolic diameters strictly inside the disk */
      ctx.strokeStyle = axisCol;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(o.x - rx, o.y); ctx.lineTo(o.x + rx, o.y);
      ctx.moveTo(o.x, o.y - ry); ctx.lineTo(o.x, o.y + ry);
      ctx.stroke();
    }

    /* Interior Cardinal Axis Labels (strictly inside the disk) */
    if (rx > 55 && ry > 55) {
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillStyle = labelCol;
      const eqFrac = mode === "stereographic" ? 0.5 : 1.0 / (1.0 + Math.SQRT2);
      ctx.fillText("1", o.x + eqFrac * rx + 3, o.y + 12);
      ctx.fillText("−1", o.x - eqFrac * rx - 16, o.y + 12);
      ctx.fillText("i", o.x + 5, o.y - eqFrac * ry - 3);
      ctx.fillText("−i", o.x + 5, o.y + eqFrac * ry + 11);
      ctx.fillText("+∞", o.x + rx - 22, o.y - 5);
      ctx.fillText("−∞", o.x - rx + 6, o.y - 5);
      ctx.fillText("+i∞", o.x + 5, o.y - ry + 14);
      ctx.fillText("−i∞", o.x + 5, o.y + ry - 6);
    }
    ctx.restore();

    /* Crisp ideal boundary circle |W| = 1 representing ∞ (compactification of ALL of ℂ) */
    ctx.beginPath();
    ctx.ellipse(o.x, o.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = isLight ? "rgba(2, 132, 199, 0.78)" : "rgba(56, 189, 248, 0.80)";
    ctx.lineWidth = 2.0;
    ctx.stroke();

    /* Clear bottom caption banner making it unmistakable that the disk IS the entire plane ℂ */
    const caption = mode === "poincare"
      ? "Entire Complex Plane ℂ in Poincaré Disk  ·  Boundary ∂𝔻 (|W|=1) is ∞"
      : "Entire Complex Plane ℂ in Stereographic Disk  ·  Boundary |W|=1 is ∞";
    ctx.font = '600 10.5px "JetBrains Mono", monospace';
    const tw = ctx.measureText(caption).width;
    const bx = Math.max(10, Math.min(w - tw - 26, o.x - (tw + 16) * 0.5));
    const by = Math.min(h - 28, Math.max(46, o.y + ry + 14));
    ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.90)" : "rgba(10, 15, 26, 0.86)";
    ctx.strokeStyle = isLight ? "rgba(2, 132, 199, 0.35)" : "rgba(56, 189, 248, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(bx, by, tw + 16, 20, 6);
    else ctx.rect(bx, by, tw + 16, 20);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = isLight ? "#0369a1" : "#7dd3fc";
    ctx.fillText(caption, bx + 8, by + 13.5);
    ctx.restore();
  }

  function getSubtitle(mode) {
    if (mode === "sphere") return "Riemann Sphere S²";
    if (mode === "polar") return "Polar ℂ (r, θ)";
    if (mode === "mercator") return "Mercator (lon, ln|w|)";
    if (mode === "stereographic") return "Stereographic Disk · (2/π)atan|w|·e^(iθ)";
    if (mode === "poincare") return "Poincaré Disk · w / (1 + √(1+|w|²))";
    return "w = f(z)";
  }

  /* =========================================================================
   * Zero-Dependency Inline LaTeX Math Renderer (window.CFVMathTex)
   * Renders $...$ inline LaTeX natively on BOTH <canvas> AND HTML sidebar cards!
   * Supports \frac{a}{b}, \sqrt{x}, superscripts ^, subscripts _, \mathbb{},
   * Greek letters, calculus/set operators, and crisp italic math serif!
   * ========================================================================= */
  const TEX_SYMS = {
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
    zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
    lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ",
    sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ",
    psi: "ψ", omega: "ω",
    Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
    Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
    infty: "∞", oint: "∮", int: "∫", sum: "∑", prod: "∏",
    partial: "∂", nabla: "∇", pm: "±", mp: "∓", cdot: "·", times: "×",
    approx: "≈", sim: "∼", equiv: "≡", neq: "≠", ne: "≠",
    le: "≤", leq: "≤", ge: "≥", geq: "≥",
    to: "→", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔", mapsto: "↦",
    Rightarrow: "⇒", Leftrightarrow: "⇔", nearrow: "↗", searrow: "↘", uparrow: "↑", downarrow: "↓",
    in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", cup: "∪", cap: "∩",
    setminus: "∖", forall: "∀", exists: "∃", ell: "ℓ", hbar: "ℏ",
    dots: "…", ldots: "…", cdots: "⋯", prime: "′", deg: "°", angle: "∠",
    Re: "Re", Im: "Im", Res: "Res", arg: "arg", sin: "sin", cos: "cos", tan: "tan",
    exp: "exp", ln: "ln", log: "log", lim: "lim", liminf: "lim inf", sup: "sup", inf: "inf",
    min: "min", max: "max", d: "d", ",": " ", ";": " ", "!": "", " ": " ",
  };
  const TEX_ROMAN_OPS = new Set([
    "Re", "Im", "Res", "arg", "sin", "cos", "tan", "exp", "ln", "log", "lim", "liminf", "sup", "inf", "min", "max",
  ]);
  const TEX_BB = { C: "ℂ", R: "ℝ", Z: "ℤ", N: "ℕ", Q: "ℚ", D: "𝔻", H: "ℍ" };
  const TEX_CAL = { M: "ℳ", C: "𝒞", F: "ℱ", H: "ℋ", L: "ℒ", P: "𝒫", S: "𝒮", O: "𝒪" };

  function parseTexNodes(src) {
    let i = 0;
    const n = src.length;
    function skipWs() { while (i < n && src[i] === " ") i++; }
    function readGroup() {
      skipWs();
      if (i >= n) return [];
      if (src[i] === "{") {
        i++;
        const nodes = parseSeq("}");
        if (i < n && src[i] === "}") i++;
        return nodes;
      }
      const atom = readAtom();
      return atom ? [atom] : [];
    }
    function readRawGroup() {
      skipWs();
      if (i >= n) return "";
      if (src[i] === "{") {
        i++;
        let out = "";
        let depth = 1;
        while (i < n && depth > 0) {
          if (src[i] === "{") depth++;
          else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
          out += src[i++];
        }
        return out;
      }
      return src[i++] || "";
    }
    function readAtom() {
      if (i >= n) return null;
      const ch = src[i];
      if (ch === "{") {
        i++;
        const inner = parseSeq("}");
        if (i < n && src[i] === "}") i++;
        return { t: "grp", c: inner };
      }
      if (ch === "\\") {
        i++;
        if (i >= n) return { t: "rm", v: "\\" };
        let cmd = "";
        if (/[a-zA-Z]/.test(src[i])) {
          while (i < n && /[a-zA-Z]/.test(src[i])) cmd += src[i++];
        } else {
          cmd = src[i++];
        }
        if (cmd === "frac" || cmd === "dfrac" || cmd === "tfrac") {
          const num = readGroup();
          const den = readGroup();
          return { t: "frac", num, den };
        }
        if (cmd === "sqrt") {
          const arg = readGroup();
          return { t: "sqrt", arg };
        }
        if (cmd === "mathbb") {
          const raw = readRawGroup().trim();
          return { t: "rm", v: TEX_BB[raw] || raw };
        }
        if (cmd === "mathcal") {
          const raw = readRawGroup().trim();
          return { t: "rm", v: TEX_CAL[raw] || raw };
        }
        if (cmd === "text" || cmd === "mathrm" || cmd === "operatorname") {
          return { t: "rm", v: readRawGroup().replace(/\\([_%&{}])/g, "$1") };
        }
        if (cmd === "mathbf" || cmd === "boldsymbol") {
          return { t: "bf", v: readRawGroup() };
        }
        if (cmd === "bar" || cmd === "overline") {
          return { t: "over", arg: readGroup() };
        }
        if (cmd === "dot") {
          const g = readGroup();
          return { t: "dot", arg: g, count: 1 };
        }
        if (cmd === "ddot") {
          const g = readGroup();
          return { t: "dot", arg: g, count: 2 };
        }
        if (cmd === "left" || cmd === "right") {
          skipWs();
          const d = src[i] === "\\" ? (i++, src[i++] || "") : (src[i++] || "");
          return { t: "rm", v: d === "." ? "" : d };
        }
        if (Object.prototype.hasOwnProperty.call(TEX_SYMS, cmd)) {
          const sym = TEX_SYMS[cmd];
          const isBig = cmd === "sum" || cmd === "int" || cmd === "oint" || cmd === "prod";
          return { t: isBig ? "big" : (TEX_ROMAN_OPS.has(cmd) ? "rm" : "sym"), v: sym };
        }
        return { t: "rm", v: cmd };
      }
      if (ch === " ") {
        i++;
        return { t: "sp" };
      }
      i++;
      if (/[a-zA-Z]/.test(ch)) return { t: "var", v: ch };
      if (ch === "-") return { t: "rm", v: "−" };
      if (ch === "'") return { t: "rm", v: "′" };
      return { t: "rm", v: ch };
    }
    function parseSeq(stopChar) {
      const seq = [];
      while (i < n) {
        if (stopChar && src[i] === stopChar) break;
        if (src[i] === "^" || src[i] === "_") {
          const kind = src[i++];
          const script = readGroup();
          const base = seq.length > 0 ? seq.pop() : { t: "rm", v: "" };
          if (base.t === "scr") {
            if (kind === "^") base.sup = script;
            else base.sub = script;
            seq.push(base);
          } else {
            seq.push({ t: "scr", base, sup: kind === "^" ? script : null, sub: kind === "_" ? script : null });
          }
          continue;
        }
        const atom = readAtom();
        if (atom) seq.push(atom);
      }
      return seq;
    }
    return parseSeq(null);
  }

  function splitMixedRuns(str) {
    const s = String(str || "");
    const runs = [];
    let i = 0;
    let buf = "";
    while (i < s.length) {
      if (s[i] === "\\" && s[i + 1] === "$") {
        buf += "$";
        i += 2;
        continue;
      }
      if (s[i] === "$") {
        const end = s.indexOf("$", i + 1);
        if (end > i + 1) {
          if (buf) { runs.push({ kind: "text", val: buf }); buf = ""; }
          const inner = s.slice(i + 1, end);
          runs.push({ kind: "math", raw: inner, nodes: parseTexNodes(inner) });
          i = end + 1;
          continue;
        }
      }
      buf += s[i++];
    }
    if (buf) runs.push({ kind: "text", val: buf });
    return runs;
  }

  function escHtmlTex(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function texNodesToHtml(nodes) {
    let out = "";
    for (const nd of nodes || []) {
      if (nd.t === "var") out += escHtmlTex(nd.v);
      else if (nd.t === "bf") out += `<strong class="cfv-mrm">${escHtmlTex(nd.v)}</strong>`;
      else if (nd.t === "rm" || nd.t === "sym" || nd.t === "big") out += `<span class="cfv-mrm">${escHtmlTex(nd.v)}</span>`;
      else if (nd.t === "sp") out += " ";
      else if (nd.t === "grp") out += texNodesToHtml(nd.c);
      else if (nd.t === "scr") {
        out += texNodesToHtml([nd.base]);
        if (nd.sub) out += `<sub>${texNodesToHtml(nd.sub)}</sub>`;
        if (nd.sup) out += `<sup>${texNodesToHtml(nd.sup)}</sup>`;
      } else if (nd.t === "frac") {
        out += `<span class="cfv-mfrac"><span class="cfv-mnum">${texNodesToHtml(nd.num)}</span><span class="cfv-mden">${texNodesToHtml(nd.den)}</span></span>`;
      } else if (nd.t === "sqrt") {
        out += `<span class="cfv-msqrt"><span class="cfv-mrm">√</span><span class="cfv-mrad">${texNodesToHtml(nd.arg)}</span></span>`;
      } else if (nd.t === "over") {
        out += `<span style="text-decoration:overline">${texNodesToHtml(nd.arg)}</span>`;
      } else if (nd.t === "dot") {
        out += texNodesToHtml(nd.arg) + (nd.count === 2 ? "̈" : "̇");
      }
    }
    return out;
  }

  function renderToHtml(str) {
    const runs = splitMixedRuns(str);
    return runs.map((r) => (r.kind === "math" ? `<span class="cfv-math">${texNodesToHtml(r.nodes)}</span>` : escHtmlTex(r.val))).join("");
  }

  function mathFont(sz, style = "italic", weight = "400") {
    return `${style} ${weight} ${sz}px "Cambria Math", "STIX Two Math", Georgia, serif`;
  }

  function measureTexNodes(ctx, nodes, sz, bold) {
    let w = 0;
    let hasTall = false;
    const wt = bold ? "700" : "400";
    for (const nd of nodes || []) {
      if (nd.t === "var") {
        ctx.font = mathFont(sz, "italic", wt);
        w += ctx.measureText(nd.v).width;
      } else if (nd.t === "bf") {
        ctx.font = mathFont(sz, "normal", "700");
        w += ctx.measureText(nd.v).width;
      } else if (nd.t === "rm" || nd.t === "sym") {
        ctx.font = mathFont(sz, "normal", wt);
        w += ctx.measureText(nd.v).width;
      } else if (nd.t === "big") {
        ctx.font = mathFont(sz * 1.18, "normal", wt);
        w += ctx.measureText(nd.v).width + 1;
      } else if (nd.t === "sp") {
        w += sz * 0.24;
      } else if (nd.t === "grp" || nd.t === "over" || nd.t === "dot") {
        const m = measureTexNodes(ctx, nd.c || nd.arg, sz, bold);
        w += m.w;
        if (m.hasTall) hasTall = true;
      } else if (nd.t === "scr") {
        const mb = measureTexNodes(ctx, [nd.base], sz, bold);
        const sSz = Math.max(8, sz * 0.72);
        const mSup = nd.sup ? measureTexNodes(ctx, nd.sup, sSz, bold) : { w: 0 };
        const mSub = nd.sub ? measureTexNodes(ctx, nd.sub, sSz, bold) : { w: 0 };
        w += mb.w + Math.max(mSup.w, mSub.w) + 0.5;
        if (mb.hasTall) hasTall = true;
      } else if (nd.t === "frac") {
        const fSz = Math.max(8.5, sz * 0.78);
        const mn = measureTexNodes(ctx, nd.num, fSz, bold);
        const md = measureTexNodes(ctx, nd.den, fSz, bold);
        w += Math.max(mn.w, md.w) + 6;
        hasTall = true;
      } else if (nd.t === "sqrt") {
        ctx.font = mathFont(sz, "normal", wt);
        const rw = ctx.measureText("√").width;
        const ma = measureTexNodes(ctx, nd.arg, sz * 0.94, bold);
        w += rw + ma.w + 3;
        if (ma.hasTall) hasTall = true;
      }
    }
    return { w, hasTall };
  }

  function drawTexNodes(ctx, nodes, x, y, sz, bold) {
    let cx = x;
    const wt = bold ? "700" : "400";
    for (const nd of nodes || []) {
      if (nd.t === "var") {
        ctx.font = mathFont(sz, "italic", wt);
        ctx.fillText(nd.v, cx, y);
        cx += ctx.measureText(nd.v).width;
      } else if (nd.t === "bf") {
        ctx.font = mathFont(sz, "normal", "700");
        ctx.fillText(nd.v, cx, y);
        cx += ctx.measureText(nd.v).width;
      } else if (nd.t === "rm" || nd.t === "sym") {
        ctx.font = mathFont(sz, "normal", wt);
        ctx.fillText(nd.v, cx, y);
        cx += ctx.measureText(nd.v).width;
      } else if (nd.t === "big") {
        ctx.font = mathFont(sz * 1.18, "normal", wt);
        ctx.fillText(nd.v, cx, y + 1);
        cx += ctx.measureText(nd.v).width + 1;
      } else if (nd.t === "sp") {
        cx += sz * 0.24;
      } else if (nd.t === "grp") {
        cx = drawTexNodes(ctx, nd.c, cx, y, sz, bold);
      } else if (nd.t === "over") {
        const m = measureTexNodes(ctx, nd.arg, sz, bold);
        drawTexNodes(ctx, nd.arg, cx, y, sz, bold);
        ctx.save();
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, y - sz * 0.78);
        ctx.lineTo(cx + m.w, y - sz * 0.78);
        ctx.stroke();
        ctx.restore();
        cx += m.w;
      } else if (nd.t === "dot") {
        const m = measureTexNodes(ctx, nd.arg, sz, bold);
        drawTexNodes(ctx, nd.arg, cx, y, sz, bold);
        const mid = cx + m.w * 0.52;
        ctx.beginPath();
        if (nd.count === 2) {
          ctx.arc(mid - 2.1, y - sz * 0.86, 1.1, 0, Math.PI * 2);
          ctx.arc(mid + 2.1, y - sz * 0.86, 1.1, 0, Math.PI * 2);
        } else {
          ctx.arc(mid, y - sz * 0.86, 1.15, 0, Math.PI * 2);
        }
        ctx.fill();
        cx += m.w;
      } else if (nd.t === "scr") {
        const nextX = drawTexNodes(ctx, [nd.base], cx, y, sz, bold);
        const sSz = Math.max(8, sz * 0.72);
        let maxEnd = nextX;
        if (nd.sup) maxEnd = Math.max(maxEnd, drawTexNodes(ctx, nd.sup, nextX + 0.5, y - sz * 0.36, sSz, bold));
        if (nd.sub) maxEnd = Math.max(maxEnd, drawTexNodes(ctx, nd.sub, nextX + 0.5, y + sz * 0.24, sSz, bold));
        cx = maxEnd + 0.5;
      } else if (nd.t === "frac") {
        const fSz = Math.max(8.5, sz * 0.78);
        const mn = measureTexNodes(ctx, nd.num, fSz, bold);
        const md = measureTexNodes(ctx, nd.den, fSz, bold);
        const fw = Math.max(mn.w, md.w) + 4;
        const barY = y - sz * 0.30;
        drawTexNodes(ctx, nd.num, cx + 1 + (fw - mn.w) * 0.5, barY - 2.6, fSz, bold);
        ctx.save();
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1.05;
        ctx.beginPath();
        ctx.moveTo(cx + 1, barY);
        ctx.lineTo(cx + 1 + fw, barY);
        ctx.stroke();
        ctx.restore();
        drawTexNodes(ctx, nd.den, cx + 1 + (fw - md.w) * 0.5, barY + fSz * 0.94, fSz, bold);
        cx += fw + 2;
      } else if (nd.t === "sqrt") {
        ctx.font = mathFont(sz, "normal", wt);
        const rw = ctx.measureText("√").width;
        const ma = measureTexNodes(ctx, nd.arg, sz * 0.94, bold);
        ctx.fillText("√", cx, y);
        drawTexNodes(ctx, nd.arg, cx + rw + 1, y, sz * 0.94, bold);
        ctx.save();
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(cx + rw - 0.5, y - sz * 0.82);
        ctx.lineTo(cx + rw + ma.w + 2, y - sz * 0.82);
        ctx.stroke();
        ctx.restore();
        cx += rw + ma.w + 3;
      }
    }
    return cx;
  }

  function layoutMixedLines(ctx, text, maxW, fontSz, bold) {
    const out = [];
    const paras = String(text || "").split("\n");
    const proseFont = `${bold ? "700" : "400"} ${fontSz}px Inter, system-ui, sans-serif`;
    for (const para of paras) {
      if (!para.trim()) {
        out.push({ tokens: [], width: 0, extraH: 0 });
        continue;
      }
      /* Tokenize into indivisible words and inline math spans so $...$ never splits mid-formula! */
      const runs = splitMixedRuns(para);
      const tokens = [];
      for (const r of runs) {
        if (r.kind === "math") {
          const m = measureTexNodes(ctx, r.nodes, fontSz * 1.04, bold);
          tokens.push({ kind: "math", nodes: r.nodes, w: m.w, tall: m.hasTall });
        } else {
          const parts = r.val.split(/(\s+)/);
          ctx.font = proseFont;
          for (const p of parts) {
            if (!p) continue;
            tokens.push({ kind: /^\s+$/.test(p) ? "space" : "text", val: p, w: ctx.measureText(p).width, tall: false });
          }
        }
      }
      let cur = [];
      let curW = 0;
      let curTall = false;
      for (const tok of tokens) {
        if (tok.kind === "space" && cur.length === 0) continue;
        if (tok.kind !== "space" && cur.length > 0 && curW + tok.w > maxW) {
          while (cur.length > 0 && cur[cur.length - 1].kind === "space") {
            curW -= cur.pop().w;
          }
          out.push({ tokens: cur, width: curW, extraH: curTall ? Math.round(fontSz * 0.42) : 0 });
          cur = [tok];
          curW = tok.w;
          curTall = Boolean(tok.tall);
        } else {
          cur.push(tok);
          curW += tok.w;
          if (tok.tall) curTall = true;
        }
      }
      if (cur.length > 0) {
        while (cur.length > 0 && cur[cur.length - 1].kind === "space") curW -= cur.pop().w;
        out.push({ tokens: cur, width: curW, extraH: curTall ? Math.round(fontSz * 0.42) : 0 });
      }
    }
    return out;
  }

  function drawMixedLine(ctx, line, x, baselineY, fontSz, bold, proseColor, mathColor) {
    let cx = x;
    const proseFont = `${bold ? "700" : "400"} ${fontSz}px Inter, system-ui, sans-serif`;
    for (const tok of line.tokens || []) {
      if (tok.kind === "math") {
        ctx.fillStyle = mathColor || proseColor;
        cx = drawTexNodes(ctx, tok.nodes, cx, baselineY, fontSz * 1.04, bold);
      } else {
        ctx.font = proseFont;
        ctx.fillStyle = proseColor;
        ctx.fillText(tok.val, cx, baselineY);
        cx += tok.w;
      }
    }
  }

  window.CFVMathTex = {
    parseTexNodes,
    renderToHtml,
    layoutMixedLines,
    drawMixedLine,
  };

  /* =========================================================================
   * Shared Canvas Text Box Annotations (Complex Input/Output + Real Plane)
   * Pretty Light/Dark glass cards with Native Inline LaTeX ($...$) Support!
   * ========================================================================= */

  function layoutTextBoxes(ctx, canvas, texts, opts = {}) {
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 400;
    const cornerOffsets = {
      "top-left": 54,
      "top-right": opts.topRightOffset || 54,
      "bottom-left": opts.bottomLeftOffset || 14,
      "bottom-right": opts.bottomRightOffset || 14,
    };
    const layouts = [];
    for (const tb of texts || []) {
      if (!tb || !tb.visible) continue;
      if (opts.plane && (tb.plane || "in") !== opts.plane) continue;
      const title = String(tb.title || "").trim();
      const body = String(tb.text || "").trim();
      if (!title && !body) continue;

      const padX = 12, padY = 9;
      const reqW = Math.max(150, Math.min(760, Number(tb.width || tb.maxWidth) || 305));
      const maxBoxW = Math.min(reqW, Math.max(160, w - 24));
      const innerW = maxBoxW - padX * 2 - 4;
      const fontSz = Math.max(10, Math.min(20, Number(tb.fontSize) || 12));
      const lineH = Math.round(fontSz * 1.48);

      ctx.save();
      const titleLines = title ? layoutMixedLines(ctx, title, innerW, fontSz + 0.5, true) : [];
      const bodyLines = body ? layoutMixedLines(ctx, body, innerW, fontSz, false) : [];
      let contentW = 0;
      let titleH = 0;
      for (const l of titleLines) { contentW = Math.max(contentW, l.width); titleH += lineH + 1 + (l.extraH || 0); }
      let bodyH = 0;
      for (const l of bodyLines) { contentW = Math.max(contentW, l.width); bodyH += lineH + (l.extraH || 0); }
      ctx.restore();

      const explicitW = Boolean(tb.height || tb.anchor === "free");
      const boxW = explicitW
        ? maxBoxW
        : Math.min(maxBoxW, Math.max(130, Math.ceil(contentW) + padX * 2 + 10));
      const gap = titleLines.length && bodyLines.length ? 4 : 0;
      const naturalH = padY * 2 + titleH + gap + bodyH;
      const reqH = Number(tb.height) > 0 ? Math.max(38, Math.min(h - 24, Number(tb.height))) : 0;
      const boxH = reqH > 0 ? reqH : naturalH;

      const anchor = tb.anchor || "bottom-left";
      let bx = 14, by = 54;
      if (anchor === "free" && Number.isFinite(Number(tb.nx)) && Number.isFinite(Number(tb.ny))) {
        bx = Math.max(8, Math.min(Math.max(8, w - boxW - 8), Number(tb.nx) * w));
        by = Math.max(8, Math.min(Math.max(8, h - boxH - 8), Number(tb.ny) * h));
      } else if (anchor === "world" && typeof opts.worldToScreen === "function") {
        const sp = opts.worldToScreen(Number(tb.x) || 0, Number(tb.y) || 0);
        bx = sp.x;
        by = sp.y;
      } else if (anchor === "top-left") {
        bx = 12;
        by = cornerOffsets["top-left"];
        cornerOffsets["top-left"] += boxH + 8;
      } else if (anchor === "top-right") {
        bx = Math.max(12, w - boxW - 12);
        by = cornerOffsets["top-right"];
        cornerOffsets["top-right"] += boxH + 8;
      } else if (anchor === "bottom-right") {
        bx = Math.max(12, w - boxW - 12);
        by = Math.max(50, h - boxH - cornerOffsets["bottom-right"]);
        cornerOffsets["bottom-right"] += boxH + 8;
      } else {
        bx = 12;
        by = Math.max(50, h - boxH - cornerOffsets["bottom-left"]);
        cornerOffsets["bottom-left"] += boxH + 8;
      }

      layouts.push({
        tb, bx, by, boxW, boxH, naturalH, padX, padY, fontSz, lineH, titleLines, bodyLines, titleH, gap,
      });
    }
    return layouts;
  }

  function drawTextBoxes(ctx, canvas, texts, opts = {}) {
    const layouts = layoutTextBoxes(ctx, canvas, texts, opts);
    if (canvas) canvas._textLayouts = layouts;
    if (layouts.length === 0) return layouts;
    const isLight = Boolean(opts.isLight);
    const selId = opts.selectedTextId;
    const hovId = opts.hoveredTextId;

    for (const L of layouts) {
      const { tb, bx, by, boxW, boxH, padX, padY, fontSz, lineH, titleLines, bodyLines, gap } = L;
      const accent = window.CFVTheme ? window.CFVTheme.adaptColor(tb.color || "#38bdf8", { isLight }) : (tb.color || "#38bdf8");
      const alpha = Math.max(0.15, Math.min(1, tb.opacity !== undefined ? Number(tb.opacity) : 0.92));
      const isSel = selId !== null && selId !== undefined && tb.id === selId;
      const isHov = hovId !== null && hovId !== undefined && tb.id === hovId;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = isLight ? "rgba(15, 23, 42, 0.12)" : "rgba(0, 0, 0, 0.45)";
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;

      ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.95)" : "rgba(11, 17, 30, 0.90)";
      ctx.strokeStyle = isSel ? accent : (isHov ? accent : (isLight ? "rgba(15, 23, 42, 0.14)" : "rgba(148, 163, 184, 0.24)"));
      ctx.lineWidth = isSel ? 2.0 : (isHov ? 1.5 : 1.0);
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(bx, by, boxW, boxH, 9);
      else ctx.rect(bx, by, boxW, boxH);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(bx + 1, by + 1, Math.max(10, boxW - 2), Math.max(10, boxH - 2), 8);
      else ctx.rect(bx + 1, by + 1, Math.max(10, boxW - 2), Math.max(10, boxH - 2));
      ctx.clip();

      ctx.fillStyle = accent;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(bx + 1.5, by + 6, 3.5, Math.max(12, boxH - 12), 2);
      else ctx.rect(bx + 1.5, by + 6, 3.5, Math.max(12, boxH - 12));
      ctx.fill();

      let ty = by + padY + fontSz;
      const mathCol = isLight ? "#0369a1" : "#bae6fd";
      const bodyCol = isLight ? "#1e293b" : "#e2e8f0";
      if (titleLines.length > 0) {
        for (const l of titleLines) {
          ty += (l.extraH || 0) * 0.45;
          drawMixedLine(ctx, l, bx + padX + 4, ty, fontSz + 0.5, true, accent, accent);
          ty += lineH + 1 + (l.extraH || 0) * 0.55;
        }
        ty += gap;
      }
      if (bodyLines.length > 0) {
        for (const l of bodyLines) {
          ty += (l.extraH || 0) * 0.45;
          drawMixedLine(ctx, l, bx + padX + 4, ty, fontSz, false, bodyCol, mathCol);
          ty += lineH + (l.extraH || 0) * 0.55;
        }
      }
      ctx.restore();

      /* Subtle bottom-right resize grip on unlocked text boxes (stronger when hovered/selected) */
      if (!tb.locked) {
        const gripAlpha = isSel || isHov ? 0.85 : 0.35;
        ctx.save();
        ctx.strokeStyle = isSel || isHov ? accent : (isLight ? "#64748b" : "#94a3b8");
        ctx.globalAlpha = gripAlpha;
        ctx.lineWidth = 1.4;
        ctx.lineCap = "round";
        const rx = bx + boxW - 4, ry = by + boxH - 4;
        ctx.beginPath();
        ctx.moveTo(rx - 9, ry); ctx.lineTo(rx, ry - 9);
        ctx.moveTo(rx - 5, ry); ctx.lineTo(rx, ry - 5);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    }
    return layouts;
  }

  function hitTestTextBoxes(ctx, canvas, texts, sx, sy, opts = {}) {
    const layouts = (canvas && Array.isArray(canvas._textLayouts) && !opts.forceLayout)
      ? canvas._textLayouts
      : layoutTextBoxes(ctx, canvas, texts, opts);
    for (let i = layouts.length - 1; i >= 0; i--) {
      const L = layouts[i];
      if (sx >= L.bx && sx <= L.bx + L.boxW && sy >= L.by && sy <= L.by + L.boxH) {
        const inResize = !L.tb.locked && sx >= L.bx + L.boxW - 18 && sy >= L.by + L.boxH - 18;
        return { ...L, hit: inResize ? "resize" : "body" };
      }
    }
    return null;
  }

  window.CFVAnnotations = {
    drawTextBoxes,
    hitTestTextBoxes,
    layoutTextBoxes,
  };

  window.CFVProjections = {
    projectPoint,
    projectPoints,
    inverseProjectPoint,
    drawProjectionOverlay,
    getSubtitle,
    is3D: (m) => m === "sphere",
    isDisk: (m) => m === "stereographic" || m === "poincare",
  };
})();
