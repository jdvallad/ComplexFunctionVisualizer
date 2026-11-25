(() => {
  "use strict";

  /*
   * Interactive 3D Riemann Sphere Stereographic Projection Renderer
   * Maps complex numbers w = u + iv onto the unit sphere S^2:
   *   X = 2u / (r^2 + 1),  Y = 2v / (r^2 + 1),  Z = (r^2 - 1) / (r^2 + 1)
   * South Pole (0, 0, -1) = 0,  Equator Z = 0 = unit circle |w| = 1,  North Pole (0, 0, +1) = infinity.
   *
   * Rendering uses true 3-pass glass depth layering:
   *   Pass 1: Dark sphere interior + Back-hemisphere wireframe, meshes & curves (dashed translucent)
   *   Pass 2: Frosted glass sphere sheen (physically separates back hemisphere from front!)
   *   Pass 3: Front-hemisphere wireframe, conformal meshes, glowing curves, arrows, markers & probe
   * Curves are geodesically subdivided on S^2 so large complex jumps hug the sphere cleanly.
   */

  function createSphereRenderer() {
  const sphere = {
    enabled: false,
    yaw: -0.58,
    pitch: 0.22,
    zoom: 1.0,
    orbiting: false,
    lastX: 0,
    lastY: 0,
  };

  function stereoProject(u, v) {
    if (!Number.isFinite(u) || !Number.isFinite(v)) {
      return { x: 0, y: 0, z: 1 }; /* North Pole = infinity */
    }
    const r2 = u * u + v * v;
    if (r2 > 1e10) {
      return { x: 0, y: 0, z: 1 };
    }
    const d = r2 + 1.0;
    return {
      x: (2.0 * u) / d,
      y: (2.0 * v) / d,
      z: (r2 - 1.0) / d,
    };
  }

  const PERSP_K = 0.72 / 3.8;
  const PERSP_ONE_MINUS_K2 = 1.0 - PERSP_K * PERSP_K;

  /* Precomputed 2048-entry atanh(z) lookup table for zero-Math.log Canvas2D fallback */
  const ATANH_LUT_N = 2048;
  const ATANH_LUT_MAX = 0.992;
  const ATANH_LUT = new Float32Array(ATANH_LUT_N + 1);
  for (let i = 0; i <= ATANH_LUT_N; i++) {
    const z = ((2.0 * i) / ATANH_LUT_N - 1.0) * ATANH_LUT_MAX;
    ATANH_LUT[i] = 0.5 * Math.log((1.0 + z) / (1.0 - z));
  }
  const ATANH_LUT_SCALE = (0.5 * ATANH_LUT_N) / ATANH_LUT_MAX;
  const ATANH_LUT_HALF = 0.5 * ATANH_LUT_N;

  function screenToComplex(sx, sy, canvas) {
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 400;
    const cx = w * 0.5, cy = h * 0.5;
    const R = Math.min(w, h) * 0.38 * sphere.zoom;
    const u = (sx - cx) / Math.max(1, R);
    const v = (cy - sy) / Math.max(1, R);
    updateFrameTrig();
    /* Exact analytic inverse of toCanvas perspective projection: u = x1 / (1 - k*d), v = screenY / (1 - k*d) */
    const a = u * u + v * v;
    const disc = 1.0 - a * PERSP_ONE_MINUS_K2;
    if (disc < 0.0) return null;
    const depth = (a * PERSP_K + Math.sqrt(disc)) / (1.0 + a * PERSP_K * PERSP_K);
    const invP = 1.0 - PERSP_K * depth;
    const x1 = u * invP;
    const screenY = v * invP;
    const y1 = depth * _cp - screenY * _sp;
    const wz = depth * _sp + screenY * _cp;
    const wx = x1 * _cy + y1 * _sy;
    const wy = -x1 * _sy + y1 * _cy;
    const den = 1.0 - wz;
    if (den < 1e-4) return { x: 1e4, y: 0 };
    return { x: wx / den, y: wy / den };
  }

  function projectToCanvas(u, v, canvas) {
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 400;
    const cx = w * 0.5, cy = h * 0.5;
    const R = Math.min(w, h) * 0.38 * sphere.zoom;
    updateFrameTrig();
    return toCanvas(rotate3D(stereoProject(u, v)), cx, cy, R);
  }

  /* Per-frame cached rotation trig & scratch buffers (zero per-vertex allocations during 60 FPS spin!) */
  let _cy = 1, _sy = 0, _cp = 1, _sp = 0;
  let _rotCap = 256;
  let _rx = new Float64Array(_rotCap);
  let _ry = new Float64Array(_rotCap);
  let _rd = new Float64Array(_rotCap);
  let _sx = new Float64Array(_rotCap);
  let _sy2 = new Float64Array(_rotCap);

  function ensureScratch(n) {
    if (n <= _rotCap) return;
    _rotCap = Math.max(n, _rotCap * 2);
    _rx = new Float64Array(_rotCap);
    _ry = new Float64Array(_rotCap);
    _rd = new Float64Array(_rotCap);
    _sx = new Float64Array(_rotCap);
    _sy2 = new Float64Array(_rotCap);
  }

  function updateFrameTrig() {
    _cy = Math.cos(sphere.yaw);
    _sy = Math.sin(sphere.yaw);
    _cp = Math.cos(sphere.pitch);
    _sp = Math.sin(sphere.pitch);
  }

  function rotate3D(p) {
    /* Rotate around Z (yaw) so North Pole stays upright */
    const x1 = p.x * _cy - p.y * _sy;
    const y1 = p.x * _sy + p.y * _cy;
    const z1 = p.z;

    /* Tilt around X (pitch): screenY up, depth positive toward viewer */
    const screenY = z1 * _cp - y1 * _sp;
    const depth = y1 * _cp + z1 * _sp;
    return { x: x1, y: screenY, depth };
  }

  function toCanvas(rot, cx, cy, R) {
    const persp = 3.8 / (3.8 - rot.depth * 0.72);
    return {
      sx: cx + rot.x * R * persp,
      sy: cy - rot.y * R * persp,
      depth: rot.depth,
    };
  }

  function themeColor(col, opts) {
    return (window.CFVTheme && window.CFVTheme.adaptColor) ? window.CFVTheme.adaptColor(col, opts) : (col || "#38bdf8");
  }

  function hexToRgba(hex, a, opts) {
    if (window.CFVTheme && window.CFVTheme.adaptRgba) return window.CFVTheme.adaptRgba(hex, a, opts);
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

  /*
   * Convert an array of 2D complex points (possibly containing null pole/cut breaks)
   * into smooth geodesically-subdivided 3D chains on S^2, then project to screen.
   * Caches the 3D unit-sphere chains on `pts._chains3D` so 60 FPS sphere rotation
   * never repeats stereographic projection or geodesic chord subdivision!
   */
  function buildChains3D(pts, closed) {
    if (!pts || pts.length < 2) return [];
    if (pts._chains3D && pts._chains3DClosed === Boolean(closed) && pts._chains3DLen === pts.length) {
      return pts._chains3D;
    }

    /* Build raw 3D point list; connect to North Pole only if escaping to infinity (|w| >= 3) */
    const chains3 = [];
    let cur = [];

    const pushSubdivided = (a, b) => {
      if (cur.length === 0) cur.push(a);
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const chord = Math.hypot(dx, dy, dz);
      if (chord > 0.08) {
        const steps = Math.min(24, Math.ceil(chord / 0.07));
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const mx = a.x + dx * t;
          const my = a.y + dy * t;
          const mz = a.z + dz * t;
          const len = Math.hypot(mx, my, mz);
          if (len > 1e-6) {
            cur.push({ x: mx / len, y: my / len, z: mz / len });
          }
        }
      }
      cur.push(b);
    };

    const raw = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        raw.push({ p3: stereoProject(p.x, p.y), mag: Math.hypot(p.x, p.y) });
      } else {
        /* Pole / clip break: check if neighboring finite point was large (heading to infinity) */
        const prev = i > 0 ? pts[i - 1] : null;
        const next = i + 1 < pts.length ? pts[i + 1] : null;
        const prevBig = prev && Math.hypot(prev.x, prev.y) >= 3.0;
        const nextBig = next && Math.hypot(next.x, next.y) >= 3.0;
        if (prevBig || nextBig) {
          raw.push({ p3: { x: 0, y: 0, z: 1 }, mag: Infinity });
        } else {
          raw.push(null);
        }
      }
    }

    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      if (!item) {
        if (cur.length >= 2) chains3.push(cur);
        cur = [];
      } else if (cur.length === 0) {
        cur.push(item.p3);
      } else {
        pushSubdivided(cur[cur.length - 1], item.p3);
      }
    }
    if (closed && chains3.length === 0 && cur.length >= 3 && raw[0] && raw[raw.length - 1]) {
      pushSubdivided(cur[cur.length - 1], cur[0]);
    }
    if (cur.length >= 2) chains3.push(cur);

    /* Compute & cache 3D spherical bounding cap for O(1) back-hemisphere culling during 60 FPS spin! */
    for (const ch of chains3) {
      let sx = 0, sy = 0, sz = 0;
      const n = ch.length;
      for (let i = 0; i < n; i++) {
        sx += ch[i].x; sy += ch[i].y; sz += ch[i].z;
      }
      const clen = Math.hypot(sx, sy, sz);
      if (clen > 1e-5) {
        const bx = sx / clen, by = sy / clen, bz = sz / clen;
        let minDot = 1.0;
        for (let i = 0; i < n; i++) {
          const d = ch[i].x * bx + ch[i].y * by + ch[i].z * bz;
          if (d < minDot) minDot = d;
        }
        const sinRad = minDot > -0.999 ? Math.sqrt(Math.max(0, 1 - minDot * minDot)) : 1.0;
        ch._bounds = { x: bx, y: by, z: bz, pad: minDot <= 0 ? 1.1 : sinRad + 0.06 };
      } else {
        ch._bounds = { x: 0, y: 0, z: 0, pad: 1.1 };
      }
    }

    pts._chains3D = chains3;
    pts._chains3DClosed = Boolean(closed);
    pts._chains3DLen = pts.length;
    return chains3;
  }

  function isChainPotentiallyFront(ch3) {
    const b = ch3 && ch3._bounds;
    if (!b || b.pad >= 1.05) return true;
    const y1 = b.x * _sy + b.y * _cy;
    const depth = y1 * _cp + b.z * _sp;
    return depth >= -b.pad;
  }

  function projectCurveChains(pts, closed, cx, cy, R) {
    const chains3 = buildChains3D(pts, closed);
    if (chains3.length === 0) return [];
    const res = [];
    for (let c = 0; c < chains3.length; c++) {
      const chain = chains3[c];
      const len = chain.length;
      const out = new Array(len);
      for (let i = 0; i < len; i++) {
        const p = chain[i];
        const x1 = p.x * _cy - p.y * _sy;
        const y1 = p.x * _sy + p.y * _cy;
        const screenY = p.z * _cp - y1 * _sp;
        const depth = y1 * _cp + p.z * _sp;
        const persp = 3.8 / (3.8 - depth * 0.72);
        out[i] = {
          sx: cx + x1 * R * persp,
          sy: cy - screenY * R * persp,
          depth,
        };
      }
      res.push(out);
    }
    return res;
  }

  function strokeHemisphereChains(ctx, chains, isFront, color, lineWidth, alpha, dashPattern) {
    if (!chains || chains.length === 0) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = alpha;
    if (dashPattern) ctx.setLineDash(dashPattern);
    else ctx.setLineDash([]);

    ctx.beginPath();
    let any = false;
    for (const ch of chains) {
      let drawing = false;
      for (let i = 0; i < ch.length - 1; i++) {
        const a = ch[i], b = ch[i + 1];
        const avgD = 0.5 * (a.depth + b.depth);
        const match = isFront ? avgD >= -0.02 : avgD < -0.02;
        if (match) {
          if (!drawing) {
            ctx.moveTo(a.sx, a.sy);
            drawing = true;
          }
          ctx.lineTo(b.sx, b.sy);
          any = true;
        } else {
          drawing = false;
        }
      }
    }
    if (any) ctx.stroke();
    ctx.restore();
  }

  function drawWireArcPass(ctx, pts3, cx, cy, R, isFront, color, lineWidth) {
    const proj = pts3.map((p) => toCanvas(rotate3D(p), cx, cy, R));
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    let drawing = false;
    for (let i = 0; i < proj.length - 1; i++) {
      const a = proj[i], b = proj[i + 1];
      const match = isFront ? 0.5 * (a.depth + b.depth) >= -0.02 : 0.5 * (a.depth + b.depth) < -0.02;
      if (match) {
        if (!drawing) { ctx.moveTo(a.sx, a.sy); drawing = true; }
        ctx.lineTo(b.sx, b.sy);
      } else {
        drawing = false;
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  function buildGridArcs() {
    const latitudes = [
      { r: 0.5, front: "rgba(148,163,184,0.20)", back: "rgba(148,163,184,0.08)", lw: 1.0 },
      { r: 1.0, front: "rgba(56,189,248,0.44)", back: "rgba(56,189,248,0.16)", lw: 1.45 },
      { r: 2.0, front: "rgba(148,163,184,0.20)", back: "rgba(148,163,184,0.08)", lw: 1.0 },
    ].map((lat) => {
      const pts = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        pts.push(stereoProject(lat.r * Math.cos(a), lat.r * Math.sin(a)));
      }
      return { ...lat, pts };
    });

    const meridians = [];
    for (let m = 0; m < 8; m++) {
      const ang = (m / 8) * Math.PI;
      const isAxis = m === 0 || m === 4;
      const pts = [];
      for (let i = 0; i <= 64; i++) {
        const phi = -Math.PI * 0.5 + (i / 64) * Math.PI;
        pts.push({
          x: Math.cos(phi) * Math.cos(ang),
          y: Math.cos(phi) * Math.sin(ang),
          z: Math.sin(phi),
        });
      }
      meridians.push({
        pts,
        front: isAxis ? "rgba(203,213,225,0.34)" : "rgba(148,163,184,0.14)",
        back: isAxis ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.06)",
        lw: isAxis ? 1.25 : 0.9,
      });
    }
    return { latitudes, meridians };
  }

  const GRID = buildGridArcs();

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

  /* Trace front-hemisphere polygon path onto current ctx path (no beginPath/fill so caller can batch-clip!) */
  function traceFrontPolygonPath(ctx, chains3, cx, cy, R) {
    if (!chains3 || chains3.length === 0) return false;
    let any = false;
    for (let cIdx = 0; cIdx < chains3.length; cIdx++) {
      const ch3 = chains3[cIdx];
      const n = ch3 ? ch3.length : 0;
      if (n < 3 || !isChainPotentiallyFront(ch3)) continue;

      ensureScratch(n);
      let firstFrontIdx = -1;
      for (let i = 0; i < n; i++) {
        const p = ch3[i];
        const x1 = p.x * _cy - p.y * _sy;
        const y1 = p.x * _sy + p.y * _cy;
        const screenY = p.z * _cp - y1 * _sp;
        const depth = y1 * _cp + p.z * _sp;
        _rx[i] = x1;
        _ry[i] = screenY;
        _rd[i] = depth;
        if (depth >= 0) {
          if (firstFrontIdx < 0) firstFrontIdx = i;
          const persp = 3.8 / (3.8 - depth * 0.72);
          _sx[i] = cx + x1 * R * persp;
          _sy2[i] = cy - screenY * R * persp;
        }
      }
      if (firstFrontIdx < 0) continue;

      let started = false;
      let hasExit = false;
      let exitAng = 0;

      for (let step = 0; step <= n; step++) {
        const i0 = (firstFrontIdx + step) % n;
        const i1 = (firstFrontIdx + step + 1) % n;
        const d0 = _rd[i0];
        const d1 = _rd[i1];
        const aIn = d0 >= 0;
        const bIn = d1 >= 0;

        if (aIn) {
          if (!started) { ctx.moveTo(_sx[i0], _sy2[i0]); started = true; }
          else ctx.lineTo(_sx[i0], _sy2[i0]);
        }

        if (aIn && !bIn) {
          const t = d0 / (d0 - d1);
          const hx = _rx[i0] + (_rx[i1] - _rx[i0]) * t;
          const hy = _ry[i0] + (_ry[i1] - _ry[i0]) * t;
          const invLen = 1.0 / (Math.hypot(hx, hy) || 1.0);
          ctx.lineTo(cx + hx * invLen * R, cy - hy * invLen * R);
          exitAng = Math.atan2(-hy, hx);
          hasExit = true;
        } else if (!aIn && bIn) {
          const t = -d0 / (d1 - d0);
          const hx = _rx[i0] + (_rx[i1] - _rx[i0]) * t;
          const hy = _ry[i0] + (_ry[i1] - _ry[i0]) * t;
          const invLen = 1.0 / (Math.hypot(hx, hy) || 1.0);
          const ang = Math.atan2(-hy, hx);
          if (hasExit) {
            let da = ang - exitAng;
            while (da > Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            ctx.arc(cx, cy, R, exitAng, exitAng + da, da < 0);
            hasExit = false;
          } else if (!started) {
            ctx.moveTo(cx + hx * invLen * R, cy - hy * invLen * R);
            started = true;
          } else {
            ctx.lineTo(cx + hx * invLen * R, cy - hy * invLen * R);
          }
        }
      }
      if (started) {
        ctx.closePath();
        any = true;
      }
    }
    return any;
  }

  /* Zero-allocation horizon-clipped front-hemisphere polygon fill on S^2.
   * Caller clips ctx to rimR ONCE per frame around the entire fill pass! */
  function fillFrontPolygonOnSphere(ctx, chains3, cx, cy, R, rimR, color, fillAlpha, isOcean) {
    if (fillAlpha <= 0.001) return;
    if (isOcean) {
      if (fillAlpha >= 0.995) {
        const g = ctx.createRadialGradient(cx - R * 0.28, cy - R * 0.22, R * 0.06, cx, cy, rimR * 1.04);
        g.addColorStop(0.0, "#0e5d9e");
        g.addColorStop(0.45, color || "#073466");
        g.addColorStop(0.82, "#05254d");
        g.addColorStop(1.0, "#021329");
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = hexToRgba(color, fillAlpha, { onDarkSurface: true });
      }
      ctx.beginPath();
      ctx.arc(cx, cy, rimR, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.fillStyle = fillAlpha >= 0.995 ? color : hexToRgba(color, fillAlpha, { onDarkSurface: true });
    ctx.beginPath();
    if (traceFrontPolygonPath(ctx, chains3, cx, cy, R)) {
      ctx.fill("nonzero");
    }
  }

  /* =========================================================================
   * Lazy-Baked Continuous 1536x768 3D Perlin/fBm Earth Land & 1024x512 Cloud Atlases
   * + WebGL2 Native HiDPI Fragment Shader (Bilinear + Procedural Zoom Micro-Relief!)
   * ZERO geometric biome blobs & ZERO pixelation even at 22x zoom!
   * ========================================================================= */
  let _earthLandPixels = null;
  let _earthCloudPixels = null;
  const EARTH_TW = 1536;
  const EARTH_TH = 768;
  const CLOUD_TW = 1024;
  const CLOUD_TH = 512;

  function hash3(ix, iy, iz) {
    let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) * (1.0 / 4294967296.0);
  }
  function vnoise3(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uy = fy * fy * (3.0 - 2.0 * fy);
    const uz = fz * fz * (3.0 - 2.0 * fz);
    const c000 = hash3(ix, iy, iz), c100 = hash3(ix + 1, iy, iz);
    const c010 = hash3(ix, iy + 1, iz), c110 = hash3(ix + 1, iy + 1, iz);
    const c001 = hash3(ix, iy, iz + 1), c101 = hash3(ix + 1, iy, iz + 1);
    const c011 = hash3(ix, iy + 1, iz + 1), c111 = hash3(ix + 1, iy + 1, iz + 1);
    const x00 = c000 + ux * (c100 - c000), x10 = c010 + ux * (c110 - c010);
    const x01 = c001 + ux * (c101 - c001), x11 = c011 + ux * (c111 - c011);
    const y0 = x00 + uy * (x10 - x00), y1 = x01 + uy * (x11 - x01);
    return y0 + uz * (y1 - y0);
  }
  function fbm3(x, y, z, oct = 4) {
    let sum = 0.0, amp = 0.5, f = 1.0, norm = 0.0;
    for (let o = 0; o < oct; o++) {
      sum += amp * (vnoise3(x * f, y * f, z * f) * 2.0 - 1.0);
      norm += amp;
      f *= 2.05;
      amp *= 0.5;
    }
    return sum / norm;
  }
  function ridge3(x, y, z) {
    let sum = 0.0, amp = 0.55, f = 1.0;
    for (let o = 0; o < 3; o++) {
      const n = 1.0 - Math.abs(vnoise3(x * f, y * f, z * f) * 2.0 - 1.0);
      sum += amp * n * n;
      f *= 2.15;
      amp *= 0.5;
    }
    return sum;
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function gaussLonLat(lonD, latD, cLon, cLat, sLon, sLat) {
    let dl = lonD - cLon;
    if (dl > 180) dl -= 360;
    else if (dl < -180) dl += 360;
    const d1 = dl / sLon, d2 = (latD - cLat) / sLat;
    return Math.exp(-(d1 * d1 + d2 * d2));
  }

  function ensureEarthAtlases() {
    if (_earthLandPixels && _earthCloudPixels) return;
    const land = new Uint8ClampedArray(EARTH_TW * EARTH_TH * 4);
    const elevBuf = new Float32Array(EARTH_TW * EARTH_TH);
    const DEG = 180.0 / Math.PI;

    /* Pass A: continuous cordillera & plateau elevation field for directional hill-shading */
    for (let j = 0; j < EARTH_TH; j++) {
      const lat = (0.5 - (j + 0.5) / EARTH_TH) * Math.PI;
      const latD = lat * DEG;
      const cl = Math.cos(lat), sz = Math.sin(lat);
      const row = j * EARTH_TW;
      for (let i = 0; i < EARTH_TW; i++) {
        const lon = ((i + 0.5) / EARTH_TW - 0.5) * Math.PI * 2.0;
        const lonD = lon * DEG;
        const sx = cl * Math.sin(lon), sy = cl * Math.cos(lon);
        const rN = ridge3(sx * 7.5 + 3.1, sy * 7.5 - 1.7, sz * 7.5 + 2.3);
        const mN = fbm3(sx * 11.0, sy * 11.0, sz * 11.0, 3);
        const mtn =
          1.18 * gaussLonLat(lonD, latD, 87, 32, 14, 5.8) +
          0.76 * gaussLonLat(lonD, latD, 75, 37, 8, 4.5) +
          0.95 * gaussLonLat(lonD, latD, -70, -18, 4.2, 13) +
          0.86 * gaussLonLat(lonD, latD, -72, -39, 3.5, 11) +
          0.72 * gaussLonLat(lonD, latD, -76, 1, 4.0, 8.5) +
          0.84 * gaussLonLat(lonD, latD, -114, 46, 7.5, 13) +
          0.62 * gaussLonLat(lonD, latD, -124, 56, 7.0, 6.5) +
          0.68 * gaussLonLat(lonD, latD, 10, 46.5, 6.5, 2.5) +
          0.58 * gaussLonLat(lonD, latD, 44, 42.5, 5.5, 2.8) +
          0.55 * gaussLonLat(lonD, latD, 39, 9, 4.5, 5.0) +
          0.48 * gaussLonLat(lonD, latD, 60, 60, 3.2, 10) +
          0.52 * gaussLonLat(lonD, latD, 53, 33, 8.0, 4.5) +
          0.46 * gaussLonLat(lonD, latD, -4, 32, 6.5, 2.6);
        elevBuf[row + i] = mtn * (0.55 + 0.65 * rN) + 0.16 * mN;
      }
    }

    /* Pass B: continuous Blue-Marble climate/biome gradients + directional hill-shading */
    for (let j = 0; j < EARTH_TH; j++) {
      const lat = (0.5 - (j + 0.5) / EARTH_TH) * Math.PI;
      const latD = lat * DEG;
      const absLat = Math.abs(latD);
      const cl = Math.cos(lat), sz = Math.sin(lat);
      const row = j * EARTH_TW;
      const jUp = Math.max(0, j - 1) * EARTH_TW;
      const jDn = Math.min(EARTH_TH - 1, j + 1) * EARTH_TW;
      for (let i = 0; i < EARTH_TW; i++) {
        const lon = ((i + 0.5) / EARTH_TW - 0.5) * Math.PI * 2.0;
        const lonD = lon * DEG;
        const sx = cl * Math.sin(lon), sy = cl * Math.cos(lon);

        const nMacro = fbm3(sx * 4.5, sy * 4.5, sz * 4.5, 4);
        const nFine = fbm3(sx * 16.0 + 4.2, sy * 16.0 - 2.9, sz * 16.0 + 1.5, 3);
        const nDune = fbm3(sx * 26.0, sy * 26.0 + 6.1, sz * 26.0, 2);
        const elev = elevBuf[row + i];

        const effLat = absLat + nMacro * 6.5;
        let r, g, b;
        if (effLat < 16) {
          const t = clamp01(effLat / 16.0);
          r = lerp(24, 62, t); g = lerp(108, 128, t); b = lerp(46, 56, t);
        } else if (effLat < 34) {
          const t = clamp01((effLat - 16.0) / 18.0);
          r = lerp(62, 74, t); g = lerp(128, 124, t); b = lerp(56, 58, t);
        } else if (effLat < 54) {
          const t = clamp01((effLat - 34.0) / 20.0);
          r = lerp(74, 38, t); g = lerp(124, 96, t); b = lerp(58, 58, t);
        } else if (effLat < 67) {
          const t = clamp01((effLat - 54.0) / 13.0);
          r = lerp(38, 114, t); g = lerp(96, 134, t); b = lerp(58, 116, t);
        } else {
          const t = clamp01((effLat - 67.0) / 10.0);
          r = lerp(114, 224, t); g = lerp(134, 236, t); b = lerp(116, 246, t);
        }

        const wet = clamp01(
          1.15 * gaussLonLat(lonD, latD, -63, -4, 15, 10) +
          1.10 * gaussLonLat(lonD, latD, 20, 0, 12, 8.5) +
          1.05 * gaussLonLat(lonD, latD, 108, 4, 20, 12) +
          0.90 * gaussLonLat(lonD, latD, 142, -5, 11, 6.5) +
          0.85 * gaussLonLat(lonD, latD, -85, 11, 8, 6.0) +
          0.70 * gaussLonLat(lonD, latD, 80, 18, 11, 10) +
          0.65 * gaussLonLat(lonD, latD, 112, 27, 13, 9) +
          nMacro * 0.22
        );
        r = lerp(r, 18 + nFine * 14, wet * 0.78);
        g = lerp(g, 92 + nFine * 18, wet * 0.78);
        b = lerp(b, 42 + nFine * 10, wet * 0.78);

        const warpLon = lonD + nMacro * 5.2, warpLat = latD + nMacro * 3.8;
        const sandDesert = clamp01(
          1.25 * gaussLonLat(warpLon, warpLat, 10, 23.5, 22, 8.5) +
          1.20 * gaussLonLat(warpLon, warpLat, 46, 23, 10.5, 7.5) +
          0.92 * gaussLonLat(warpLon, warpLat, 64, 33, 12.5, 7.5) +
          1.05 * gaussLonLat(warpLon, warpLat, 94, 41, 16, 6.2) +
          0.88 * gaussLonLat(warpLon, warpLat, -110, 31, 8.5, 7.0) +
          0.85 * gaussLonLat(warpLon, warpLat, 19, -24, 6.5, 6.5) +
          0.65 * gaussLonLat(warpLon, warpLat, -69, -23, 3.5, 8.5) +
          0.55 * gaussLonLat(warpLon, warpLat, 66, 48, 17, 5.5)
        );
        const duneShade = 1.0 + 0.14 * nDune + 0.09 * nFine;
        r = lerp(r, 214 * duneShade, sandDesert * 0.92);
        g = lerp(g, 178 * duneShade, sandDesert * 0.92);
        b = lerp(b, 114 * duneShade, sandDesert * 0.92);

        const redCentre = clamp01(
          1.25 * gaussLonLat(warpLon, warpLat, 131, -25.5, 13.5, 7.0) +
          0.45 * gaussLonLat(warpLon, warpLat, 123, -24, 7.5, 6.0)
        );
        r = lerp(r, 186 * duneShade, redCentre * 0.90);
        g = lerp(g, 92 * duneShade, redCentre * 0.90);
        b = lerp(b, 50 * duneShade, redCentre * 0.90);

        const iceSheet = clamp01(
          1.5 * gaussLonLat(lonD, latD, -42, 72.5, 15, 8.5) +
          (latD < -62 ? clamp01((-62 - latD) / 7.0) : 0) +
          (latD > 74 ? clamp01((latD - 74) / 6.0) : 0)
        );
        const iceTint = 0.95 + 0.08 * nFine;
        r = lerp(r, 236 * iceTint, iceSheet * 0.95);
        g = lerp(g, 244 * iceTint, iceSheet * 0.95);
        b = lerp(b, 252 * iceTint, iceSheet * 0.95);

        if (elev > 0.22) {
          const rockT = clamp01((elev - 0.22) / 0.45);
          r = lerp(r, 128 + nFine * 18, rockT * 0.85);
          g = lerp(g, 112 + nFine * 16, rockT * 0.85);
          b = lerp(b, 92 + nFine * 14, rockT * 0.85);
        }
        if (elev > 0.56) {
          const snowT = clamp01((elev - 0.56) / 0.34);
          r = lerp(r, 242, snowT * 0.94);
          g = lerp(g, 248, snowT * 0.94);
          b = lerp(b, 254, snowT * 0.94);
        }

        const iL = (i + EARTH_TW - 1) % EARTH_TW;
        const iR = (i + 1) % EARTH_TW;
        const dLon = elevBuf[row + iR] - elevBuf[row + iL];
        const dLat = elevBuf[jUp + i] - elevBuf[jDn + i];
        const hill = 1.0 + Math.max(-0.34, Math.min(0.36, (-dLon * 2.1 + dLat * 1.6))) + nFine * 0.11;

        const p4 = (row + i) << 2;
        land[p4] = Math.max(0, Math.min(255, Math.round(r * hill)));
        land[p4 + 1] = Math.max(0, Math.min(255, Math.round(g * hill)));
        land[p4 + 2] = Math.max(0, Math.min(255, Math.round(b * hill)));
        land[p4 + 3] = 255;
      }
    }
    _earthLandPixels = land;

    /* Seamless 512x256 Swirling Planetary Cloud Wisps Atlas */
    const clouds = new Uint8ClampedArray(CLOUD_TW * CLOUD_TH * 4);
    for (let j = 0; j < CLOUD_TH; j++) {
      const lat = (0.5 - (j + 0.5) / CLOUD_TH) * Math.PI;
      const cl = Math.cos(lat), sz = Math.sin(lat);
      const bandWeight = 0.65 + 0.35 * Math.cos(lat * 3.0);
      const row = j * CLOUD_TW;
      for (let i = 0; i < CLOUD_TW; i++) {
        const lon = ((i + 0.5) / CLOUD_TW - 0.5) * Math.PI * 2.0;
        const sx = cl * Math.sin(lon), sy = cl * Math.cos(lon);
        const wx = fbm3(sx * 3.6 + 1.1, sy * 3.6 - 2.3, sz * 3.6 + 0.8, 3);
        const wy = fbm3(sx * 3.6 - 4.2, sy * 3.6 + 1.9, sz * 3.6 - 1.5, 3);
        const cVal = fbm3((sx + 0.38 * wx) * 5.2, (sy + 0.38 * wy) * 5.2, (sz + 0.25 * wx) * 6.5, 4);
        const density = clamp01((cVal * bandWeight - 0.14) * 2.35);
        const alpha = Math.round(density * density * 145);
        const p4 = (row + i) << 2;
        clouds[p4] = 248;
        clouds[p4 + 1] = 251;
        clouds[p4 + 2] = 255;
        clouds[p4 + 3] = alpha;
      }
    }
    _earthCloudPixels = clouds;
  }

  let _earthTexCanvas = null;
  let _earthTexImgData = null;
  let _cloudTexCanvas = null;
  let _cloudTexImgData = null;

  /* =========================================================================
   * Shared WebGL2 GPU Riemann Sphere Shader Pass (Full Native HiDPI 60 FPS!)
   * Eliminates pixelation on Earth terrain, clouds, AND fast-preview color fields!
   * Falls back cleanly to bilinear Canvas2D if WebGL2 is unavailable.
   * ========================================================================= */
  let _glState = null;
  let _glFailed = false;

  function ensureWebGLSphere() {
    if (_glFailed) return null;
    if (_glState) return _glState;
    try {
      const cvs = document.createElement("canvas");
      const gl = cvs.getContext("webgl2", {
        alpha: true,
        antialias: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
      });
      if (!gl) { _glFailed = true; return null; }

      const vsSrc = `#version 300 es
        const vec2 P[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
        out vec2 v_uv;
        void main() {
          vec2 p = P[gl_VertexID];
          v_uv = p * 0.5 + 0.5;
          gl_Position = vec4(p, 0.0, 1.0);
        }`;

      const fsSrc = `#version 300 es
        precision highp float;
        in vec2 v_uv;
        out vec4 outColor;

        uniform sampler2D u_tex;
        uniform int u_mode; /* 0 = earth land + micro-relief, 1 = clouds, 2 = color field */
        uniform vec2 u_visOrigin;
        uniform vec2 u_visSize;
        uniform vec2 u_center;
        uniform float u_R;
        uniform float u_zoom;
        uniform float u_cy;
        uniform float u_sy;
        uniform float u_cp;
        uniform float u_sp;
        uniform float u_lonShift;
        uniform float u_opacity;
        uniform int u_mercMap;
        uniform vec4 u_cfBounds; /* cx, cy, halfW, halfH */

        const float PI = 3.14159265358979323846;
        const float K_P = 0.72 / 3.8;
        const float K2_P = K_P * K_P;
        const float OMK2_P = 1.0 - K2_P;

        float h31(vec3 p) {
          p = fract(p * vec3(0.1031, 0.1030, 0.0973));
          p += dot(p, p.yxz + 33.33);
          return fract((p.x + p.y) * p.z);
        }
        float vnoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          vec3 u = f * f * (3.0 - 2.0 * f);
          float n000 = h31(i + vec3(0,0,0)), n100 = h31(i + vec3(1,0,0));
          float n010 = h31(i + vec3(0,1,0)), n110 = h31(i + vec3(1,1,0));
          float n001 = h31(i + vec3(0,0,1)), n101 = h31(i + vec3(1,0,1));
          float n011 = h31(i + vec3(0,1,1)), n111 = h31(i + vec3(1,1,1));
          float x00 = mix(n000, n100, u.x), x10 = mix(n010, n110, u.x);
          float x01 = mix(n001, n101, u.x), x11 = mix(n011, n111, u.x);
          return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
        }
        float fbmMicro(vec3 p) {
          float s = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) {
            s += a * (vnoise(p) * 2.0 - 1.0);
            p = p * 2.07 + vec3(3.1, -1.7, 2.3);
            a *= 0.5;
          }
          return s;
        }

        void main() {
          float sx = u_visOrigin.x + v_uv.x * u_visSize.x;
          float sy = u_visOrigin.y + (1.0 - v_uv.y) * u_visSize.y;
          float uN = (sx - u_center.x) / max(1.0, u_R);
          float vN = (u_center.y - sy) / max(1.0, u_R);
          float a = uN * uN + vN * vN;
          float disc = 1.0 - a * OMK2_P;
          if (disc <= 0.0) { outColor = vec4(0.0); return; }

          float depth = (a * K_P + sqrt(disc)) / (1.0 + a * K2_P);
          float invP = 1.0 - K_P * depth;
          float x1 = uN * invP;
          float scrY = vN * invP;
          float y1 = depth * u_cp - scrY * u_sp;
          float wz = depth * u_sp + scrY * u_cp;
          float wx = x1 * u_cy + y1 * u_sy;
          float wy = -x1 * u_sy + y1 * u_cy;

          float rimAlpha = clamp(sqrt(disc) * u_R * 0.14, 0.0, 1.0);

          if (u_mode == 0 || u_mode == 1) {
            float lon = atan(wx, wy) + u_lonShift;
            float lat = asin(clamp(wz, -1.0, 1.0));
            vec2 texUV = vec2(fract(lon / (2.0 * PI) + 0.5), clamp(0.5 - lat / PI, 0.0005, 0.9995));
            vec4 c = texture(u_tex, texUV);
            if (u_mode == 0) {
              /* Procedural zoom-adaptive 3D micro-relief & organic terrain shading (zero blocky zoom pixels!) */
              float zBlend = clamp((u_zoom - 1.05) / 3.0, 0.0, 1.0);
              if (zBlend > 0.005) {
                vec3 p3 = vec3(wx, wy, wz);
                float f1 = fbmMicro(p3 * 36.0);
                float f2 = fbmMicro(p3 * 110.0) * clamp((u_zoom - 2.5) / 5.0, 0.0, 1.0);
                float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
                float isSnow = smoothstep(0.74, 0.92, lum);
                float shade = 1.0 + zBlend * (0.11 * f1 + 0.07 * f2) * (1.0 - 0.55 * isSnow);
                /* Subtle alpine ridge brightening on rocky slopes */
                float ridge = max(0.0, 1.0 - abs(f1)) * zBlend * 0.055 * (1.0 - isSnow);
                c.rgb = clamp(c.rgb * shade + vec3(ridge * 0.9, ridge * 0.95, ridge), 0.0, 1.0);
              }
              outColor = vec4(c.rgb, c.a * rimAlpha);
            } else {
              float zBlend = clamp((u_zoom - 1.2) / 3.5, 0.0, 1.0);
              float wisp = zBlend > 0.01 ? (0.86 + 0.28 * fbmMicro(vec3(wx, wy, wz) * 42.0)) : 1.0;
              outColor = vec4(c.rgb, clamp(c.a * wisp, 0.0, 1.0) * u_opacity * rimAlpha);
            }
            return;
          }

          /* u_mode == 2: Color Field reprojection (Stereographic or Mercator UV) */
          float cu, cv;
          if (u_mercMap == 1) {
            cu = atan(wx, wy);
            float zc = clamp(wz, -0.996, 0.996);
            cv = 0.5 * log((1.0 + zc) / (1.0 - zc));
          } else {
            float den = max(1e-5, 1.0 - wz);
            cu = wx / den;
            cv = wy / den;
          }
          vec2 cfUV = vec2(
            (cu - u_cfBounds.x) / (2.0 * max(1e-12, u_cfBounds.z)) + 0.5,
            0.5 - (cv - u_cfBounds.y) / (2.0 * max(1e-12, u_cfBounds.w))
          );
          if (cfUV.x < 0.0 || cfUV.x > 1.0 || cfUV.y < 0.0 || cfUV.y > 1.0) {
            cfUV = clamp(cfUV, 0.0, 1.0);
          }
          vec4 c = texture(u_tex, cfUV);
          outColor = vec4(c.rgb, c.a * u_opacity * rimAlpha);
        }`;

      const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          gl.deleteShader(sh);
          return null;
        }
        return sh;
      };
      const vs = compile(gl.VERTEX_SHADER, vsSrc);
      const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
      if (!vs || !fs) { _glFailed = true; return null; }
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        _glFailed = true;
        return null;
      }

      const makeTex = (wrapS) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
      };

      const locs = {};
      for (const nm of ["u_tex", "u_mode", "u_visOrigin", "u_visSize", "u_center", "u_R", "u_zoom", "u_cy", "u_sy", "u_cp", "u_sp", "u_lonShift", "u_opacity", "u_mercMap", "u_cfBounds"]) {
        locs[nm] = gl.getUniformLocation(prog, nm);
      }

      _glState = {
        canvas: cvs,
        gl,
        prog,
        locs,
        vao: gl.createVertexArray(),
        earthTex: makeTex(gl.REPEAT),
        earthUploaded: false,
        cloudTex: makeTex(gl.REPEAT),
        cloudUploaded: false,
        cfTex: makeTex(gl.CLAMP_TO_EDGE),
        cfKey: "",
      };
      return _glState;
    } catch (_) {
      _glFailed = true;
      return null;
    }
  }

  function renderWebGLPass(ctx, visL, visT, visW, visH, cx, cy, R, mode, texObj, opacity, lonShift, cfMeta) {
    const g = ensureWebGLSphere();
    if (!g) return false;
    const dpr = Math.min(2.0, window.devicePixelRatio || 1);
    const pw = Math.max(32, Math.min(2048, Math.round(visW * dpr)));
    const ph = Math.max(32, Math.min(2048, Math.round(visH * dpr)));
    if (g.canvas.width !== pw || g.canvas.height !== ph) {
      g.canvas.width = pw;
      g.canvas.height = ph;
    }
    const { gl, prog, locs } = g;
    gl.viewport(0, 0, pw, ph);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindVertexArray(g.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texObj);
    gl.uniform1i(locs.u_tex, 0);
    gl.uniform1i(locs.u_mode, mode);
    gl.uniform2f(locs.u_visOrigin, visL, visT);
    gl.uniform2f(locs.u_visSize, visW, visH);
    gl.uniform2f(locs.u_center, cx, cy);
    gl.uniform1f(locs.u_R, R);
    gl.uniform1f(locs.u_zoom, sphere.zoom);
    gl.uniform1f(locs.u_cy, _cy);
    gl.uniform1f(locs.u_sy, _sy);
    gl.uniform1f(locs.u_cp, _cp);
    gl.uniform1f(locs.u_sp, _sp);
    gl.uniform1f(locs.u_lonShift, lonShift || 0.0);
    gl.uniform1f(locs.u_opacity, opacity);
    if (cfMeta) {
      gl.uniform1i(locs.u_mercMap, cfMeta.mapping === "mercator" ? 1 : 0);
      gl.uniform4f(locs.u_cfBounds, cfMeta.cx || 0, cfMeta.cy || 0, cfMeta.halfW || 1, cfMeta.halfH || 1);
    } else {
      gl.uniform1i(locs.u_mercMap, 0);
      gl.uniform4f(locs.u_cfBounds, 0, 0, 1, 1);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    ctx.drawImage(g.canvas, visL, visT, visW, visH);
    return true;
  }

  function drawEquirectSphereLayer(ctx, cx, cy, R, rimR, srcPixels, tw, th, isAnimating, lonShift = 0.0, useCloudCanvas = false, opacity = 1.0) {
    const cw = ctx.canvas ? (ctx.canvas.clientWidth || 640) : 640;
    const ch = ctx.canvas ? (ctx.canvas.clientHeight || 480) : 480;
    const visL = Math.max(0, Math.floor(cx - rimR));
    const visT = Math.max(0, Math.floor(cy - rimR));
    const visR = Math.min(cw, Math.ceil(cx + rimR));
    const visB = Math.min(ch, Math.ceil(cy + rimR));
    const visW = visR - visL, visH = visB - visT;
    if (visW < 4 || visH < 4) return;

    /* Fast Path: Native HiDPI WebGL2 Fragment Shader (bilinear + zoom-adaptive micro-detail!) */
    const g = ensureWebGLSphere();
    if (g) {
      const gl = g.gl;
      if (useCloudCanvas) {
        if (!g.cloudUploaded) {
          gl.bindTexture(gl.TEXTURE_2D, g.cloudTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, srcPixels);
          g.cloudUploaded = true;
        }
        if (renderWebGLPass(ctx, visL, visT, visW, visH, cx, cy, R, 1, g.cloudTex, opacity, lonShift, null)) return;
      } else {
        if (!g.earthUploaded) {
          gl.bindTexture(gl.TEXTURE_2D, g.earthTex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, srcPixels);
          g.earthUploaded = true;
        }
        if (renderWebGLPass(ctx, visL, visT, visW, visH, cx, cy, R, 0, g.earthTex, opacity, lonShift, null)) return;
      }
    }

    /* Bilinear Canvas2D Fallback */
    const maxEdge = (sphere.orbiting || isAnimating) ? (useCloudCanvas ? 140 : 200) : (useCloudCanvas ? 360 : 580);
    const sc = Math.min(1.0, maxEdge / Math.max(visW, visH));
    const szW = Math.max(64, Math.round(visW * sc));
    const szH = Math.max(64, Math.round(visH * sc));

    let cvs = useCloudCanvas ? _cloudTexCanvas : _earthTexCanvas;
    let img = useCloudCanvas ? _cloudTexImgData : _earthTexImgData;
    if (!cvs) cvs = document.createElement("canvas");
    if (cvs.width !== szW || cvs.height !== szH) {
      cvs.width = szW;
      cvs.height = szH;
      img = cvs.getContext("2d").createImageData(szW, szH);
    }
    if (useCloudCanvas) { _cloudTexCanvas = cvs; _cloudTexImgData = img; }
    else { _earthTexCanvas = cvs; _earthTexImgData = img; }

    const out = img.data;
    const invR = 1.0 / Math.max(1, R);
    const stepX = visW / szW, stepY = visH / szH;
    const duX = stepX * invR;
    const uStart = (visL + 0.5 * stepX - cx) * invR;
    const cyA = _cy, syA = _sy, cpA = _cp, spA = _sp;
    const kP = PERSP_K, k2P = kP * kP, omk2 = PERSP_ONE_MINUS_K2;
    const inv2Pi = 0.5 / Math.PI, invPi = 1.0 / Math.PI;
    const thM1 = th - 1;

    let ptr = 0;
    for (let py = 0; py < szH; py++) {
      const vN = (cy - (visT + (py + 0.5) * stepY)) * invR;
      const v2 = vN * vN;
      let uN = uStart;
      for (let px = 0; px < szW; px++, uN += duX, ptr += 4) {
        const a = uN * uN + v2;
        const disc = 1.0 - a * omk2;
        if (disc < 0.0) { out[ptr + 3] = 0; continue; }
        const depth = (a * kP + Math.sqrt(disc)) / (1.0 + a * k2P);
        const invP = 1.0 - kP * depth;
        const x1 = uN * invP, scrY = vN * invP;
        const y1 = depth * cpA - scrY * spA;
        const wz = depth * spA + scrY * cpA;
        const wx = x1 * cyA + y1 * syA;
        const wy = -x1 * syA + y1 * cyA;

        let lon = Math.atan2(wx, wy) + lonShift;
        if (lon > Math.PI) lon -= Math.PI * 2.0;
        else if (lon < -Math.PI) lon += Math.PI * 2.0;
        const lat = Math.asin(wz < -1.0 ? -1.0 : (wz > 1.0 ? 1.0 : wz));

        const fx = ((lon * inv2Pi + 0.5) * tw) - 0.5;
        const fy = ((0.5 - lat * invPi) * th) - 0.5;
        const x0 = Math.floor(fx), y0 = Math.max(0, Math.min(thM1, Math.floor(fy)));
        const ix0 = ((x0 % tw) + tw) % tw;
        const ix1 = (ix0 + 1) % tw;
        const iy1 = Math.min(thM1, y0 + 1);
        const tx = fx - x0, ty = Math.max(0, Math.min(1, fy - y0));
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        const i00 = (y0 * tw + ix0) << 2, i10 = (y0 * tw + ix1) << 2;
        const i01 = (iy1 * tw + ix0) << 2, i11 = (iy1 * tw + ix1) << 2;
        out[ptr] = (srcPixels[i00] * w00 + srcPixels[i10] * w10 + srcPixels[i01] * w01 + srcPixels[i11] * w11) | 0;
        out[ptr + 1] = (srcPixels[i00 + 1] * w00 + srcPixels[i10 + 1] * w10 + srcPixels[i01 + 1] * w01 + srcPixels[i11 + 1] * w11) | 0;
        out[ptr + 2] = (srcPixels[i00 + 2] * w00 + srcPixels[i10 + 2] * w10 + srcPixels[i01 + 2] * w01 + srcPixels[i11 + 2] * w11) | 0;
        out[ptr + 3] = Math.round((srcPixels[i00 + 3] * w00 + srcPixels[i10 + 3] * w10 + srcPixels[i01 + 3] * w01 + srcPixels[i11 + 3] * w11) * opacity);
      }
    }
    cvs.getContext("2d").putImageData(img, 0, 0);
    ctx.drawImage(cvs, visL, visT, visW, visH);
  }

  let _texCanvas = null;
  let _texImgData = null;

  /* Native HiDPI Sphere Color Field renderer:
   *  1) If `cf.nativeSphere` matches current (yaw, pitch, zoom), stamps the exact C11 ray-traced
   *     4x-MSAA sphere buffer 1:1 with ZERO stretching or pixelation!
   *  2) Otherwise (e.g. live 60 FPS spin/orbit), reprojects via WebGL2 GPU fragment shader
   *     (with Canvas2D fallback) until the native C11 ray-traced pass settles! */
  function drawSphereColorField(ctx, cx, cy, R, rimR, cf, isAnimating = false) {
    if (!cf) return;
    const op = Math.max(0, Math.min(1, Number(cf.opacity ?? 0.9)));
    if (op <= 0.005) return;
    const cw = ctx.canvas ? (ctx.canvas.clientWidth || 640) : 640;
    const ch = ctx.canvas ? (ctx.canvas.clientHeight || 480) : 480;

    if (cf.nativeSphere && cf.canvas &&
        Math.abs((cf.yaw ?? 999) - sphere.yaw) < 1e-3 &&
        Math.abs((cf.pitch ?? 999) - sphere.pitch) < 1e-3 &&
        Math.abs((cf.zoom ?? 999) - sphere.zoom) < 1e-3) {
      ctx.save();
      ctx.globalAlpha = op;
      ctx.drawImage(cf.canvas, 0, 0, cw, ch);
      ctx.restore();
      return;
    }

    if (!cf.pixels || !cf.tw || !cf.th) return;
    const visL = Math.max(0, Math.floor(cx - rimR));
    const visT = Math.max(0, Math.floor(cy - rimR));
    const visR = Math.min(cw, Math.ceil(cx + rimR));
    const visB = Math.min(ch, Math.ceil(cy + rimR));
    const visW = visR - visL;
    const visH = visB - visT;
    if (visW < 4 || visH < 4) return;

    /* WebGL2 60 FPS GPU reprojection pass */
    const g = ensureWebGLSphere();
    if (g) {
      const cfKey = `${cf.paramKey || ""}|${cf.tw}x${cf.th}|${cf.fast ? 1 : 0}|${cf.cx}|${cf.cy}|${cf.halfW}|${cf.halfH}|${cf.reqId || 0}`;
      if (g.cfKey !== cfKey) {
        const gl = g.gl;
        gl.bindTexture(gl.TEXTURE_2D, g.cfTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cf.tw, cf.th, 0, gl.RGBA, gl.UNSIGNED_BYTE, cf.pixels);
        g.cfKey = cfKey;
      }
      if (renderWebGLPass(ctx, visL, visT, visW, visH, cx, cy, R, 2, g.cfTex, op, 0.0, cf)) return;
    }

    /* Canvas2D fallback */
    const maxEdge = (sphere.orbiting || isAnimating) ? 144 : 420;
    const sc = Math.min(1.0, maxEdge / Math.max(visW, visH));
    const szW = Math.max(64, Math.round(visW * sc));
    const szH = Math.max(64, Math.round(visH * sc));
    if (!_texCanvas) _texCanvas = document.createElement("canvas");
    if (_texCanvas.width !== szW || _texCanvas.height !== szH) {
      _texCanvas.width = szW;
      _texCanvas.height = szH;
      _texImgData = _texCanvas.getContext("2d").createImageData(szW, szH);
    }
    const out = _texImgData.data;
    const src = cf.pixels;
    const tw = cf.tw, th = cf.th;
    const twM1 = tw - 1, thM1 = th - 1;
    const fcx = cf.cx, fcy = cf.cy;
    const scaleX = (0.5 / Math.max(1e-12, cf.halfW)) * tw;
    const offsetX = 0.5 * tw - fcx * scaleX;
    const scaleY = (0.5 / Math.max(1e-12, cf.halfH)) * th;
    const offsetY = 0.5 * th + fcy * scaleY;
    const isMerc = cf.mapping === "mercator";
    const alphaByte = Math.round(op * 255);
    const fullAlpha = alphaByte >= 254;
    const out32 = new Uint32Array(out.buffer);
    const src32 = new Uint32Array(src.buffer, src.byteOffset, src.byteLength >> 2);
    const invR = 1.0 / Math.max(1, R);
    const stepX = visW / szW;
    const stepY = visH / szH;
    const duX = stepX * invR;
    const uStart = (visL + 0.5 * stepX - cx) * invR;
    const cyA = _cy, syA = _sy, cpA = _cp, spA = _sp;
    const kP = PERSP_K, k2P = kP * kP, omk2 = PERSP_ONE_MINUS_K2;
    const lut = ATANH_LUT, lutScale = ATANH_LUT_SCALE, lutHalf = ATANH_LUT_HALF, lutMax = ATANH_LUT_N;

    let p32 = 0;
    for (let py = 0; py < szH; py++) {
      const vN = (cy - (visT + (py + 0.5) * stepY)) * invR;
      const v2 = vN * vN;
      let uN = uStart;
      for (let px = 0; px < szW; px++, uN += duX, p32++) {
        const a = uN * uN + v2;
        const disc = 1.0 - a * omk2;
        if (disc < 0.0) {
          out32[p32] = 0;
          continue;
        }
        const depth = (a * kP + Math.sqrt(disc)) / (1.0 + a * k2P);
        const invP = 1.0 - kP * depth;
        const x1 = uN * invP;
        const scrY = vN * invP;
        const y1 = depth * cpA - scrY * spA;
        const wz = depth * spA + scrY * cpA;
        const wx = x1 * cyA + y1 * syA;
        const wy = -x1 * syA + y1 * cyA;

        let u, v;
        if (isMerc) {
          u = Math.atan2(wx, wy);
          let li = (wz * lutScale + lutHalf) | 0;
          if (li < 0) li = 0;
          else if (li > lutMax) li = lutMax;
          v = lut[li];
        } else {
          const den = 1.0 - wz;
          const invD = den > 1e-4 ? (1.0 / den) : 1e4;
          u = wx * invD;
          v = wy * invD;
        }

        let ix = (u * scaleX + offsetX) | 0;
        let iy = (offsetY - v * scaleY) | 0;
        if (ix < 0) ix = 0; else if (ix > twM1) ix = twM1;
        if (iy < 0) iy = 0; else if (iy > thM1) iy = thM1;
        const si = iy * tw + ix;
        if (fullAlpha) {
          out32[p32] = src32[si];
        } else {
          const si4 = si << 2;
          const p4 = p32 << 2;
          out[p4] = src[si4];
          out[p4 + 1] = src[si4 + 1];
          out[p4 + 2] = src[si4 + 2];
          out[p4 + 3] = (src[si4 + 3] * alphaByte) >> 8;
        }
      }
    }
    _texCanvas.getContext("2d").putImageData(_texImgData, 0, 0);
    ctx.drawImage(_texCanvas, visL, visT, visW, visH);
  }

  function render(ctx, canvas, shapes, opts = {}) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 4 || h < 4) return;
    updateFrameTrig();
    const cx = w * 0.5;
    const cy = h * 0.5;
    const R = Math.min(w, h) * 0.38 * sphere.zoom;
    const rimR = R * 1.018;
    const isLight = typeof document !== "undefined" && document.documentElement.dataset.theme === "light";

    /* Backdrop */
    ctx.fillStyle = isLight ? "#eaeff5" : "#080c14";
    ctx.fillRect(0, 0, w, h);

    /* Base sphere silhouette */
    ctx.fillStyle = isLight ? "#dce4ef" : "#0c1322";
    ctx.beginPath();
    ctx.arc(cx, cy, rimR, 0, Math.PI * 2);
    ctx.fill();

    /* First scan: check if a solid opaque ocean globe or opaque surface color field is present */
    let hasSolidGlobe = Boolean(opts.colorField && (opts.colorField.pixels || opts.colorField.canvas) && Number(opts.colorField.opacity ?? 0.9) >= 0.8);
    if (!hasSolidGlobe) {
      for (const s of shapes || []) {
        if (!s || !s.visible) continue;
        const closed = opts.mode === "integral" ? false : Boolean(s.closed);
        if (!closed) continue;
        const isOcean = Boolean(s.isOcean || (s.label && /^global ocean\b/i.test(s.label)));
        if (!isOcean) continue;
        const op = (s.opacity !== undefined && s.opacity !== null && Number.isFinite(Number(s.opacity)))
          ? Math.max(0, Math.min(1, Number(s.opacity)))
          : 0.22;
        if (op >= 0.85) { hasSolidGlobe = true; break; }
      }
    }

    /* Pre-project visible shape boundaries (skipping redundant 2D chain projection for fill-only lw=0 shapes!) */
    const prepared = [];
    for (const s of shapes || []) {
      if (!s || !s.visible) continue;
      const pts = opts.getPts ? opts.getPts(s) : (s.boundary ? s.boundary.outPts : null);
      if (!pts || pts.length < 2) continue;
      const rawCol = s.primaryColor || s.color || "#38bdf8";
      const lw = (s.lineWidth !== undefined && s.lineWidth !== null && Number.isFinite(Number(s.lineWidth)))
        ? Math.max(0, Number(s.lineWidth))
        : 2.3;
      const closed = opts.mode === "integral" ? false : Boolean(s.closed);
      const defaultOp = closed ? 0.22 : 1.0;
      const op = (s.opacity !== undefined && s.opacity !== null && Number.isFinite(Number(s.opacity)))
        ? Math.max(0, Math.min(1, Number(s.opacity)))
        : defaultOp;
      const strokeOp = closed ? (op <= 0.001 ? 0 : (op < 0.22 ? op / 0.22 : 1.0)) : op;
      const isOcean = Boolean(closed && (s.isOcean || (s.label && /^global ocean\b/i.test(s.label))));
      const col = themeColor(rawCol, { onDarkSurface: hasSolidGlobe, solidFill: closed && op >= 0.85 });
      const isHi = s.id === opts.selectedShapeId || s.id === opts.hoveredShapeId;
      const chains3 = buildChains3D(pts, closed);
      const needStrokeChains = !isOcean && (lw > 0 || isHi || Boolean(opts.playing));
      const chains = needStrokeChains ? projectCurveChains(pts, closed, cx, cy, R) : [];

      const meshChains = [];
      if (opts.mode !== "integral" && opts.showMesh !== false && s.closed && op < 0.96 && s.mesh && s.mesh.length > 0 && !isOcean) {
        for (const m of s.mesh) {
          if (m && m.outPts && m.outPts.length >= 2) {
            const mc = projectCurveChains(m.outPts, false, cx, cy, R);
            for (const c of mc) meshChains.push(c);
          }
        }
      }
      prepared.push({ shape: s, color: col, lw, op, strokeOp, closed, isOcean, isHi, chains3, chains, meshChains });
    }

    /* ================= PASS 1: BACK HEMISPHERE ================= */
    if (!hasSolidGlobe) {
      for (const lat of GRID.latitudes) drawWireArcPass(ctx, lat.pts, cx, cy, R, false, isLight ? "rgba(71,85,105,0.14)" : lat.back, lat.lw * 0.8);
      for (const mer of GRID.meridians) drawWireArcPass(ctx, mer.pts, cx, cy, R, false, isLight ? "rgba(71,85,105,0.12)" : mer.back, mer.lw * 0.8);

      for (const item of prepared) {
        if (item.op <= 0.001 || item.isOcean) continue;
        if (item.meshChains.length > 0) {
          strokeHemisphereChains(ctx, item.meshChains, false, item.color, 0.9, 0.14 * item.strokeOp, null);
        }
        if (item.lw > 0) {
          strokeHemisphereChains(ctx, item.chains, false, item.color, Math.max(1.2, item.lw * 0.72), 0.36 * item.strokeOp, [4, 4]);
        }
      }
    }

    /* ================= PASS 2: FROSTED GLASS SPHERE BODY ================= */
    if (!hasSolidGlobe) {
      ctx.save();
      const glassGrad = ctx.createRadialGradient(cx - R * 0.34, cy - R * 0.34, R * 0.08, cx, cy, rimR * 1.05);
      if (isLight) {
        glassGrad.addColorStop(0, "rgba(255, 255, 255, 0.62)");
        glassGrad.addColorStop(0.55, "rgba(218, 227, 238, 0.38)");
        glassGrad.addColorStop(0.88, "rgba(148, 163, 184, 0.28)");
        glassGrad.addColorStop(1, "rgba(2, 132, 199, 0.16)");
      } else {
        glassGrad.addColorStop(0, "rgba(56, 86, 136, 0.28)");
        glassGrad.addColorStop(0.55, "rgba(15, 23, 42, 0.36)");
        glassGrad.addColorStop(0.88, "rgba(8, 12, 22, 0.56)");
        glassGrad.addColorStop(1, "rgba(56, 189, 248, 0.14)");
      }
      ctx.fillStyle = glassGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, rimR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* ================= PASS 3: FRONT HEMISPHERE (SINGLE CLIP FOR ALL POLYGONS!) ================= */
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rimR, 0, Math.PI * 2);
    ctx.clip();

    for (const item of prepared) {
      if (item.closed && item.isOcean && item.op > 0.001) {
        fillFrontPolygonOnSphere(ctx, item.chains3, cx, cy, R, rimR, item.color, item.op, true);
      }
    }

    if (opts.colorField && (opts.colorField.pixels || opts.colorField.canvas)) {
      drawSphereColorField(ctx, cx, cy, R, rimR, opts.colorField, Boolean(opts.isAnimating));
    }

    /* Detect Earth Atlas globes (works for live examples AND saved JSON reloads!) so we apply
     * our Continuous 768x384 3D Perlin/fBm Shaded Land Texture & Swirling Clouds! */
    const isEarthGlobe = hasSolidGlobe && prepared.some((item) => item.shape && (
      item.shape.isEarthLand ||
      /^(North America|South America|Africa|Europe|Asia|Eurasia|Australia|Antarctica)$/i.test(item.shape.label || "")
    ));

    for (const lat of GRID.latitudes) drawWireArcPass(ctx, lat.pts, cx, cy, R, true, hasSolidGlobe ? "rgba(186,230,253,0.16)" : (isLight ? (lat.r === 1 ? "rgba(2,132,199,0.52)" : "rgba(71,85,105,0.28)") : lat.front), lat.lw);
    for (const mer of GRID.meridians) drawWireArcPass(ctx, mer.pts, cx, cy, R, true, hasSolidGlobe ? "rgba(186,230,253,0.14)" : (isLight ? "rgba(71,85,105,0.28)" : mer.front), mer.lw);

    if (isEarthGlobe) {
      ensureEarthAtlases();
      /* Clip ALL front-hemisphere Earth continents & islands in ONE clean path and stamp our
       * continuous 768x384 3D Perlin/fBm hill-shaded climate, desert, rainforest & mountain-snow atlas! */
      ctx.save();
      ctx.beginPath();
      let hasLandClip = false;
      for (const item of prepared) {
        if (item.op <= 0.001 || item.isOcean || !item.closed) continue;
        if (item.shape.isEarthLake || /Lake|Caspian/i.test(item.shape.label || "")) continue;
        if (traceFrontPolygonPath(ctx, item.chains3, cx, cy, R)) hasLandClip = true;
      }
      if (hasLandClip) {
        ctx.clip("nonzero");
        drawEquirectSphereLayer(ctx, cx, cy, R, rimR, _earthLandPixels, EARTH_TW, EARTH_TH, Boolean(opts.isAnimating), 0.0, false);
      }
      ctx.restore();

      /* Crisp sapphire inland lakes & seas on top of the Perlin-textured continents */
      for (const item of prepared) {
        if (item.op <= 0.001 || item.isOcean || !item.closed) continue;
        if (item.shape.isEarthLake || /Lake|Caspian/i.test(item.shape.label || "")) {
          fillFrontPolygonOnSphere(ctx, item.chains3, cx, cy, R, rimR, item.color, item.op, false);
        }
      }

      /* Delicate swirling translucent planetary cloud bands floating above ocean & continents */
      drawEquirectSphereLayer(ctx, cx, cy, R, rimR, _earthCloudPixels, CLOUD_TW, CLOUD_TH, Boolean(opts.isAnimating), sphere.yaw * 0.14, true, 0.56);
    } else {
      for (const item of prepared) {
        if (item.op <= 0.001 || item.isOcean) continue;
        if (item.closed) {
          fillFrontPolygonOnSphere(ctx, item.chains3, cx, cy, R, rimR, item.color, item.op, false);
        }
      }
    }
    ctx.restore();

    for (const item of prepared) {
      if (item.op <= 0.001 || item.isOcean) continue;
      const dash =
        item.shape.lineStyle === "dashed" ? [7, 5] :
        item.shape.lineStyle === "dotted" ? [2, 4] : null;

      if (item.meshChains.length > 0 && item.op < 0.96) {
        strokeHemisphereChains(ctx, item.meshChains, true, item.color, 1.0, 0.30 * item.strokeOp, null);
      }
      if (item.lw > 0 || item.isHi) {
        const effLw = item.lw > 0 ? item.lw : 1.8;
        if (item.lw > 0 && item.op < 0.85 && !item.shape.isBorder) {
          /* Outer soft glow for translucent/wireframe shapes */
          strokeHemisphereChains(ctx, item.chains, true, item.color, effLw + (item.isHi ? 6 : 4), (item.isHi ? 0.42 : 0.28) * item.strokeOp, dash);
        }
        /* Core bright curve (crisp cartographic stroke for political borders, or coastline highlight on hover) */
        const borderLw = item.shape.isBorder ? Math.max(0.7, Math.min(2.1, effLw * (0.85 + 0.14 * Math.log2(Math.max(1, sphere.zoom))))) : effLw;
        strokeHemisphereChains(ctx, item.chains, true, item.isHi ? (isLight && !hasSolidGlobe ? "#0f172a" : "#ffffff") : item.color, item.isHi ? borderLw + 0.8 : borderLw, item.isHi ? 1.0 : item.strokeOp, dash);
      }

      /* Direction arrow along front hemisphere if available (skip when fill-only or political border) */
      const mainChain = item.chains[0];
      if (item.lw > 0 && item.op < 0.85 && !item.shape.isBorder && mainChain && mainChain.length >= 6) {
        const mid = Math.floor(mainChain.length * 0.5);
        const a = mainChain[mid - 1], b = mainChain[mid];
        if (a && b && 0.5 * (a.depth + b.depth) >= -0.02) {
          drawArrow(ctx, a.sx, a.sy, b.sx, b.sy, item.color, 6.5);
        }
      }

      /* Integral final value diamond on the sphere */
      if (opts.mode === "integral" && item.shape.integral && item.shape.integral.total) {
        const tot = item.shape.integral.total;
        const eSp = toCanvas(rotate3D(stereoProject(tot.x, tot.y)), cx, cy, R);
        ctx.save();
        ctx.globalAlpha = eSp.depth >= -0.02 ? 1.0 : 0.4;
        const dSz = item.isHi ? 7 : 5.5;
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(eSp.sx, eSp.sy - dSz);
        ctx.lineTo(eSp.sx + dSz, eSp.sy);
        ctx.lineTo(eSp.sx, eSp.sy + dSz);
        ctx.lineTo(eSp.sx - dSz, eSp.sy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      /* Animated comet */
      if (opts.playing && mainChain && mainChain.length > 1) {
        const idx = Math.floor((opts.playPhase || 0) * (mainChain.length - 1)) % mainChain.length;
        const m = mainChain[idx];
        ctx.save();
        ctx.globalAlpha = m.depth >= -0.02 ? 1.0 : 0.35;
        const g = ctx.createRadialGradient(m.sx, m.sy, 0, m.sx, m.sy, 14);
        g.addColorStop(0, "#ffffff");
        g.addColorStop(0.4, item.color);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(m.sx, m.sy, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    /* Single combined 3D planetary sunlit shading, limb darkening & Rayleigh atmospheric halo (60 FPS!) */
    ctx.save();
    if (hasSolidGlobe) {
      /* Outer soft Rayleigh blue space-horizon glow */
      const atmo = ctx.createRadialGradient(cx, cy, rimR * 0.96, cx, cy, rimR * 1.07);
      atmo.addColorStop(0.0, "rgba(56, 189, 248, 0.24)");
      atmo.addColorStop(0.55, "rgba(14, 165, 233, 0.09)");
      atmo.addColorStop(1.0, "rgba(14, 165, 233, 0.0)");
      ctx.fillStyle = atmo;
      ctx.beginPath();
      ctx.arc(cx, cy, rimR * 1.07, 0, Math.PI * 2);
      ctx.fill();

      const shadeGrad = ctx.createRadialGradient(cx - R * 0.36, cy - R * 0.34, R * 0.04, cx, cy, rimR * 1.01);
      shadeGrad.addColorStop(0.0, "rgba(255, 250, 232, 0.22)");
      shadeGrad.addColorStop(0.32, "rgba(255, 255, 255, 0.02)");
      shadeGrad.addColorStop(0.70, "rgba(3, 12, 28, 0.18)");
      shadeGrad.addColorStop(0.90, "rgba(2, 8, 22, 0.48)");
      shadeGrad.addColorStop(1.0, "rgba(56, 189, 248, 0.40)");
      ctx.fillStyle = shadeGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, rimR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = hasSolidGlobe
      ? (isLight ? "rgba(2, 132, 199, 0.55)" : "rgba(125, 211, 252, 0.55)")
      : (isLight ? "rgba(71, 85, 105, 0.38)" : "rgba(148, 163, 184, 0.34)");
    ctx.lineWidth = hasSolidGlobe ? 1.8 : 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, rimR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    /* Reference poles & unit circle landmarks on the Riemann Sphere */
    const markers = [
      { p: { x: 0, y: 0, z: 1 }, label: "∞", color: "#fb7185" },
      { p: { x: 0, y: 0, z: -1 }, label: "0", color: "#34d399" },
      { p: { x: 1, y: 0, z: 0 }, label: "+1", color: "#94a3b8" },
      { p: { x: -1, y: 0, z: 0 }, label: "−1", color: "#64748b" },
      { p: { x: 0, y: 1, z: 0 }, label: "+i", color: "#94a3b8" },
      { p: { x: 0, y: -1, z: 0 }, label: "−i", color: "#64748b" },
    ];
    ctx.font = '600 11px "JetBrains Mono", monospace';
    for (const mk of markers) {
      const c = toCanvas(rotate3D(mk.p), cx, cy, R);
      if (hasSolidGlobe && c.depth < -0.04) continue;
      ctx.save();
      ctx.globalAlpha = c.depth >= -0.04 ? 0.95 : 0.25;
      ctx.fillStyle = mk.color;
      ctx.beginPath();
      ctx.arc(c.sx, c.sy, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(mk.label, c.sx + 7, c.sy + 3.5);
      ctx.restore();
    }

    /* Mapped non-landmark (unlocked) Domain Points, Country Name Labels & Smart Collision-Free City/Capital Pins! */
    if (opts.mode !== "integral" && Array.isArray(opts.points)) {
      const countryPts = [];
      const visPts = [];
      for (const p of opts.points) {
        if (!p || !p.visible || p.locked || !p.outPt) continue;
        if (!Number.isFinite(p.outPt.x) || !Number.isFinite(p.outPt.y)) continue;
        const c = toCanvas(rotate3D(stereoProject(p.outPt.x, p.outPt.y)), cx, cy, R);
        const isFront = c.depth >= -0.04;
        if (hasSolidGlobe && !isFront) continue;
        const pop = (p.opacity !== undefined && p.opacity !== null && Number.isFinite(Number(p.opacity)))
          ? Math.max(0, Math.min(1, Number(p.opacity)))
          : 1.0;
        if (pop <= 0.001) continue;
        if (p.icon === "country_label") {
          const tier = Math.max(1, Number(p.size) || 2);
          countryPts.push({ p, c, isFront, pop, tier, col: p.color || "#f8fafc" });
        } else {
          const sz = Math.max(2.6, Number(p.size) || 4.0);
          visPts.push({ p, c, isFront, pop, sz, col: p.color || "#34d399" });
        }
      }

      const placedCountryBoxes = [];
      const boxHitsList = (list, x0, y0, x1, y1, padPx) => {
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (x0 < b[2] + padPx && x1 > b[0] - padPx && y0 < b[3] + padPx && y1 > b[1] - padPx) return true;
        }
        return false;
      };

      /* Pass 0: Cartographic Country Name Labels (no dot pin, zoom-tiered uppercase typography!) */
      if (countryPts.length > 0) {
        countryPts.sort((a, b) => (b.tier - a.tier) || (b.c.depth - a.c.depth));
        const z = Math.max(0.5, sphere.zoom);
        for (const item of countryPts) {
          const { p, c, isFront, pop, tier } = item;
          if (!isFront || p.showLabel === false || !p.label) continue;
          if (hasSolidGlobe && c.depth < 0.14) continue;
          /* Progressive zoom reveal: tier>=4 always, tier 3 at >=0.95x, tier 2 at >=1.45x, tier 1 at >=2.6x */
          if (tier < 2 && z < 2.35) continue;
          if (tier < 3 && z < 1.28) continue;
          const fontPx = tier >= 4 ? 11.4 : tier >= 3 ? 10.2 : tier >= 2 ? 9.3 : 8.6;
          const upLabel = p._upLabel || (p._upLabel = String(p.label).toUpperCase());
          ctx.font = `700 ${fontPx}px "Inter", "JetBrains Mono", system-ui, sans-serif`;
          if (p._cLblFont !== fontPx) {
            p._cLblFont = fontPx;
            p._cLblW = ctx.measureText(upLabel).width;
          }
          const tw = p._cLblW;
          const x0 = c.sx - tw * 0.5, y0 = c.sy - fontPx * 0.55;
          const x1 = c.sx + tw * 0.5, y1 = c.sy + fontPx * 0.55;
          if (boxHitsList(placedCountryBoxes, x0, y0, x1, y1, 5.0)) continue;
          placedCountryBoxes.push([x0, y0, x1, y1]);

          const tierAlpha = tier >= 4 ? 0.94 : tier >= 3 ? 0.88 : Math.min(0.88, 0.45 + (z - 1.2) * 0.35);
          ctx.save();
          ctx.globalAlpha = Math.min(1.0, (0.35 + c.depth * 0.95) * tierAlpha * pop);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.lineJoin = "round";
          ctx.lineWidth = 3.0;
          ctx.strokeStyle = isLight && !hasSolidGlobe ? "rgba(255,255,255,0.88)" : "rgba(4, 11, 24, 0.78)";
          ctx.strokeText(upLabel, c.sx, c.sy);
          ctx.fillStyle = isLight && !hasSolidGlobe ? "#0f172a" : (p.color || "#f1f5f9");
          ctx.fillText(upLabel, c.sx, c.sy);
          ctx.restore();
        }
      }

      /* Pass 1: Draw ALL glowing city/capital pins so dense regions sparkle naturally! */
      const drawMiniStar = (cx0, cy0, rOut, rIn) => {
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const ang = -Math.PI * 0.5 + (k * Math.PI) / 5;
          const rr = (k & 1) === 0 ? rOut : rIn;
          const px = cx0 + Math.cos(ang) * rr, py = cy0 + Math.sin(ang) * rr;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
      };
      for (const item of visPts) {
        const { p, c, isFront, pop, sz, col } = item;
        ctx.save();
        ctx.globalAlpha = (isFront ? 1.0 : 0.22) * pop;
        if (isFront && hasSolidGlobe) {
          /* Soft warm city-light halo */
          ctx.fillStyle = hexToRgba(col, 0.34);
          ctx.beginPath();
          ctx.arc(c.sx, c.sy, sz + 2.8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = col;
        ctx.strokeStyle = isLight ? "#ffffff" : "#070c16";
        ctx.lineWidth = 1.3;
        if (p.icon === "star") {
          const sr = isFront ? sz * 1.35 : sz * 1.05;
          drawMiniStar(c.sx, c.sy, sr, sr * 0.45);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(c.sx, c.sy, isFront ? sz * 0.88 : sz * 0.72, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          if (isFront) {
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(c.sx, c.sy, Math.max(1.1, sz * 0.34), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }

      /* Pass 2: Smart 4-direction collision-free city/capital label placement */
      ctx.font = '600 10.2px "JetBrains Mono", monospace';
      visPts.sort((a, b) => (b.sz - a.sz) || (b.c.depth - a.c.depth));
      const placedBoxes = placedCountryBoxes.slice();
      const pad = 2.5;
      const boxHits = (x0, y0, x1, y1) => boxHitsList(placedBoxes, x0, y0, x1, y1, pad);

      for (const item of visPts) {
        const { p, c, isFront, pop, sz, col } = item;
        if (p.showLabel === false || !p.label) continue;
        if (hasSolidGlobe && c.depth < 0.08 && visPts.length > 12) continue; /* hide cramped limb labels */
        if (p._lblStr !== p.label) {
          p._lblStr = p.label;
          p._lblW = ctx.measureText(p.label).width;
        }
        const tw = p._lblW;
        const bw = tw + 7, bh = 13.5;
        let chosen = null;
        if (isFront && visPts.length > 6) {
          const cands = [
            [c.sx + sz + 4, c.sy - bh * 0.5],           /* right */
            [c.sx - sz - 4 - bw, c.sy - bh * 0.5],      /* left */
            [c.sx - bw * 0.5, c.sy - sz - 3 - bh],      /* top */
            [c.sx - bw * 0.5, c.sy + sz + 3],           /* bottom */
          ];
          for (let k = 0; k < cands.length; k++) {
            const x0 = cands[k][0], y0 = cands[k][1];
            if (!boxHits(x0, y0, x0 + bw, y0 + bh)) {
              chosen = [x0, y0, x0 + bw, y0 + bh];
              break;
            }
          }
          if (!chosen) continue; /* skip colliding label; pin still sparkles cleanly! */
          placedBoxes.push(chosen);
        } else {
          const x0 = c.sx + sz + 4, y0 = c.sy - bh * 0.5;
          chosen = [x0, y0, x0 + bw, y0 + bh];
        }

        const [bx, by] = chosen;
        ctx.save();
        ctx.globalAlpha = (isFront ? Math.min(1.0, 0.45 + c.depth * 0.9) : 0.22) * pop;
        if (isFront) {
          ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.88)" : "rgba(7, 11, 20, 0.78)";
          ctx.strokeStyle = hexToRgba(col, 0.42);
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          if (typeof ctx.roundRect === "function") {
            ctx.roundRect(bx, by, bw, bh, 3.5);
          } else {
            ctx.rect(bx, by, bw, bh);
          }
          ctx.fill();
          ctx.stroke();
        }
        ctx.fillStyle = isFront ? (isLight ? "#0f172a" : "#f8fafc") : col;
        ctx.fillText(p.label, bx + 3.5, by + 10);
        ctx.restore();
      }
    }

    /* Live hover probe on the sphere */
    if (opts.probe && opts.probe.active && opts.probe.w) {
      const c = toCanvas(rotate3D(stereoProject(opts.probe.w.x, opts.probe.w.y)), cx, cy, R);
      if (!hasSolidGlobe || c.depth >= -0.04) {
        ctx.save();
        ctx.globalAlpha = c.depth >= -0.04 ? 1.0 : 0.35;
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = opts.probe.color || "#a78bfa";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.sx, c.sy, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function focusOnShapes(shapes, getPts) {
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const s of shapes || []) {
      if (!s.visible) continue;
      const pts = getPts ? getPts(s) : (s.boundary ? s.boundary.outPts : null);
      if (!pts) continue;
      const step = Math.max(1, Math.floor(pts.length / 40));
      for (let i = 0; i < pts.length; i += step) {
        const p = pts[i];
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const v = stereoProject(p.x, p.y);
        sx += v.x; sy += v.y; sz += v.z; cnt++;
      }
    }
    if (cnt === 0) {
      sphere.yaw = -0.58;
      sphere.pitch = 0.22;
      sphere.zoom = 1.0;
      return;
    }
    const len = Math.hypot(sx, sy, sz);
    if (len < 1e-4) return;
    const nx = sx / len, ny = sy / len, nz = sz / len;
    /* Orient camera so (nx, ny, nz) faces straight toward the viewer (x1 = 0, y1 > 0, depth maximized) */
    sphere.yaw = Math.atan2(nx, ny);
    sphere.pitch = Math.max(-1.42, Math.min(1.42, Math.asin(Math.max(-1, Math.min(1, nz)))));
    sphere.zoom = 1.05;
  }

  return {
    state: sphere,
    render,
    stereoProject,
    screenToComplex,
    projectToCanvas,
    focusOnShapes,
    reset() {
      sphere.yaw = -0.58;
      sphere.pitch = 0.22;
      sphere.zoom = 1.0;
    },
    zoomBy(factor) {
      sphere.zoom = Math.max(0.35, Math.min(48.0, sphere.zoom * factor));
    },
    onPointerDown(x, y) {
      sphere.orbiting = true;
      sphere.lastX = x;
      sphere.lastY = y;
    },
    onPointerMove(x, y) {
      if (!sphere.orbiting) return false;
      const dx = x - sphere.lastX;
      const dy = y - sphere.lastY;
      sphere.lastX = x;
      sphere.lastY = y;
      /* Scale orbit sensitivity gently when zoomed deep onto the globe for effortless fine panning! */
      const sens = 0.0085 / Math.max(1.0, Math.pow(sphere.zoom, 0.72));
      sphere.yaw -= dx * sens;
      sphere.pitch = Math.max(-1.48, Math.min(1.48, sphere.pitch + dy * sens));
      return true;
    },
    onPointerUp() {
      sphere.orbiting = false;
    },
    onWheel(deltaY) {
      const f = deltaY < 0 ? 1.14 : 1 / 1.14;
      sphere.zoom = Math.max(0.35, Math.min(48.0, sphere.zoom * f));
    },
  };
  }

  window.createRiemannSphere = createSphereRenderer;
  window.RiemannSphere = createSphereRenderer();
  window.RiemannSphereIn = createSphereRenderer();
})();
