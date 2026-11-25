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

  function cylProject(u, v) {
    if (!Number.isFinite(u) || !Number.isFinite(v)) return { x: 0, y: 1, z: 1.05 };
    const r = Math.hypot(u, v);
    const lon = Math.atan2(u, v);
    const z = Math.max(-1.05, Math.min(1.05, Math.log(Math.max(1e-4, Math.min(1e4, r))) / 2.45));
    return { x: Math.sin(lon), y: Math.cos(lon), z };
  }

  const PERSP_K = 0.72 / 3.8;
  const PERSP_ONE_MINUS_K2 = 1.0 - PERSP_K * PERSP_K;

  /* Precomputed 2048-entry atanh(z) lookup table for zero-Math.log 60 FPS Earth texture mapping */
  const ATANH_LUT_N = 2048;
  const ATANH_LUT_MAX = 0.992;
  const ATANH_LUT = new Float32Array(ATANH_LUT_N + 1);
  for (let i = 0; i <= ATANH_LUT_N; i++) {
    const z = ((2.0 * i) / ATANH_LUT_N - 1.0) * ATANH_LUT_MAX;
    ATANH_LUT[i] = 0.5 * Math.log((1.0 + z) / (1.0 - z));
  }
  const ATANH_LUT_SCALE = (0.5 * ATANH_LUT_N) / ATANH_LUT_MAX;
  const ATANH_LUT_HALF = 0.5 * ATANH_LUT_N;

  function screenToComplex(sx, sy, canvas, surface = "sphere") {
    const w = canvas.clientWidth || 600, h = canvas.clientHeight || 400;
    const cx = w * 0.5, cy = h * 0.5;
    const R = Math.min(w, h) * 0.38 * sphere.zoom;
    const u = (sx - cx) / Math.max(1, R);
    const v = (cy - sy) / Math.max(1, R);
    updateFrameTrig();
    if (surface === "cylinder") {
      if (Math.abs(u) > 1.0 || Math.abs(v) > 1.1) return null;
      const depth = Math.sqrt(Math.max(0, 1.0 - u * u));
      const wx = u * _cy + depth * _sy;
      const wy = -u * _sy + depth * _cy;
      const lon = Math.atan2(wx, wy);
      const r = Math.exp(v * 2.45);
      return { x: r * Math.sin(lon), y: r * Math.cos(lon) };
    }
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

  /* Zero-allocation horizon-clipped front-hemisphere polygon fill on S^2.
   * Caller clips ctx to rimR ONCE per frame around the entire fill pass! */
  function fillFrontPolygonOnSphere(ctx, chains3, cx, cy, R, rimR, color, fillAlpha, isOcean) {
    if (fillAlpha <= 0.001) return;
    if (isOcean) {
      if (fillAlpha >= 0.995) {
        /* Rich multi-tone bathymetry & equatorial ocean gradient so solid Earth globes look deeply textured! */
        const g = ctx.createRadialGradient(cx - R * 0.28, cy - R * 0.22, R * 0.06, cx, cy, rimR * 1.04);
        g.addColorStop(0.0, "#1273ba");
        g.addColorStop(0.45, color || "#0b4f8c");
        g.addColorStop(0.82, "#073462");
        g.addColorStop(1.0, "#041f3d");
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

      ctx.beginPath();
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
      ctx.closePath();
      ctx.fill("nonzero");
    }
  }

  let _texCanvas = null;
  let _texImgData = null;

  /* 60 FPS inverse-projected C11 domain/bathymetry texture mapper onto the 3D Riemann Sphere!
   * Uses exact perspective ray-sphere inverse, ATANH_LUT (zero Math.log), and 32-bit pixel writes! */
  function drawSphereColorField(ctx, cx, cy, R, rimR, cf, isAnimating = false) {
    if (!cf || !cf.pixels || !cf.tw || !cf.th) return;
    const op = Math.max(0, Math.min(1, Number(cf.opacity ?? 0.9)));
    if (op <= 0.005) return;
    const cw = ctx.canvas ? (ctx.canvas.clientWidth || 640) : 640;
    const ch = ctx.canvas ? (ctx.canvas.clientHeight || 480) : 480;
    /* Clip rasterization strictly to the visible viewport rectangle so zooming up to 22x stays 60 FPS & razor sharp! */
    const visL = Math.max(0, Math.floor(cx - rimR));
    const visT = Math.max(0, Math.floor(cy - rimR));
    const visR = Math.min(cw, Math.ceil(cx + rimR));
    const visB = Math.min(ch, Math.ceil(cy + rimR));
    const visW = visR - visL;
    const visH = visB - visT;
    if (visW < 4 || visH < 4) return;
    const maxEdge = (sphere.orbiting || isAnimating) ? 128 : 340;
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

  function renderCylinder(ctx, canvas, shapes, opts = {}) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w < 4 || h < 4) return;
    updateFrameTrig();
    const cx = w * 0.5, cy = h * 0.5;
    const R = Math.min(w * 0.34, h * 0.36) * sphere.zoom;
    const halfH = R * 1.05;
    const isLight = typeof document !== "undefined" && document.documentElement.dataset.theme === "light";

    ctx.fillStyle = isLight ? "#eaeff5" : "#080c14";
    ctx.fillRect(0, 0, w, h);

    const hasSolidOcean = (shapes || []).some((s) => s && s.visible && s.closed && (s.isOcean || /^global ocean/i.test(s.label || "")) && Number(s.opacity ?? 0.22) >= 0.85);

    /* Cylinder body clip & shaded tube backdrop */
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - R, cy - halfH, R * 2, halfH * 2);
    ctx.clip();

    const bodyGrad = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
    if (hasSolidOcean) {
      bodyGrad.addColorStop(0.0, "#042142");
      bodyGrad.addColorStop(0.28, "#0b5494");
      bodyGrad.addColorStop(0.50, "#1273ba");
      bodyGrad.addColorStop(0.76, "#094378");
      bodyGrad.addColorStop(1.0, "#031b36");
    } else if (isLight) {
      bodyGrad.addColorStop(0.0, "#cbd5e1");
      bodyGrad.addColorStop(0.5, "#f8fafc");
      bodyGrad.addColorStop(1.0, "#cbd5e1");
    } else {
      bodyGrad.addColorStop(0.0, "#0a101d");
      bodyGrad.addColorStop(0.5, "#111c33");
      bodyGrad.addColorStop(1.0, "#0a101d");
    }
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(cx - R, cy - halfH, R * 2, halfH * 2);

    /* Optional C11 color field texture wrapped smoothly around the front cylinder wall! */
    const cf = opts.colorField;
    if (cf && cf.pixels && cf.tw && cf.th) {
      const szW = Math.max(120, Math.min(240, Math.round(R * 1.3)));
      const szH = Math.max(120, Math.min(240, Math.round(halfH * 1.3)));
      if (!_texCanvas) _texCanvas = document.createElement("canvas");
      if (_texCanvas.width !== szW || _texCanvas.height !== szH) {
        _texCanvas.width = szW; _texCanvas.height = szH;
        _texImgData = _texCanvas.getContext("2d").createImageData(szW, szH);
      }
      const out = _texImgData.data, src = cf.pixels, tw = cf.tw, th = cf.th;
      const invHW = 0.5 / Math.max(1e-12, cf.halfW), invHH = 0.5 / Math.max(1e-12, cf.halfH);
      const aByte = Math.round(Math.max(0, Math.min(1, Number(cf.opacity ?? 0.9))) * 255);
      let ptr = 0;
      for (let py = 0; py < szH; py++) {
        const yn = 1.0 - (2.0 * (py + 0.5)) / szH;
        const yMerc = yn * 2.55;
        const rExp = Math.exp(yMerc);
        for (let px = 0; px < szW; px++) {
          const xn = (2.0 * (px + 0.5)) / szW - 1.0;
          const depth = Math.sqrt(Math.max(0, 1.0 - xn * xn));
          const wx = xn * _cy + depth * _sy;
          const wy = -xn * _sy + depth * _cy;
          const lon = Math.atan2(wx, wy);
          const u = cf.mapping === "mercator" ? lon : rExp * Math.sin(lon);
          const v = cf.mapping === "mercator" ? yMerc : rExp * Math.cos(lon);
          const ix = Math.max(0, Math.min(tw - 1, Math.floor(((u - cf.cx) * invHW + 0.5) * tw)));
          const iy = Math.max(0, Math.min(th - 1, Math.floor((0.5 - (v - cf.cy) * invHH) * th)));
          const si = (iy * tw + ix) * 4;
          out[ptr] = src[si]; out[ptr + 1] = src[si + 1]; out[ptr + 2] = src[si + 2];
          out[ptr + 3] = Math.round((src[si + 3] * aByte) / 255);
          ptr += 4;
        }
      }
      _texCanvas.getContext("2d").putImageData(_texImgData, 0, 0);
      ctx.drawImage(_texCanvas, cx - R, cy - halfH, R * 2, halfH * 2);
    }

    /* Cylinder latitude & meridian gridlines */
    ctx.strokeStyle = hasSolidOcean ? "rgba(186,230,253,0.20)" : (isLight ? "rgba(71,85,105,0.22)" : "rgba(148,163,184,0.20)");
    ctx.lineWidth = 1;
    for (let lat = -60; lat <= 60; lat += 30) {
      const ym = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / 2.45;
      const sy = cy - ym * halfH;
      ctx.beginPath(); ctx.moveTo(cx - R, sy); ctx.lineTo(cx + R, sy);
      ctx.lineWidth = lat === 0 ? 1.5 : 0.9;
      ctx.stroke();
    }
    for (let m = 0; m < 12; m++) {
      const a = (m / 12) * Math.PI * 2;
      const x1 = Math.sin(a) * _cy - Math.cos(a) * _sy;
      const d = Math.sin(a) * _sy + Math.cos(a) * _cy;
      if (d < 0) continue;
      const sx = cx + x1 * R;
      ctx.beginPath(); ctx.moveTo(sx, cy - halfH); ctx.lineTo(sx, cy + halfH);
      ctx.lineWidth = (m % 3 === 0) ? 1.2 : 0.85;
      ctx.stroke();
    }

    /* Project & draw front-facing polygons/curves onto the 3D cylinder */
    for (const s of shapes || []) {
      if (!s || !s.visible || s.isOcean || /^global ocean/i.test(s.label || "")) continue;
      const pts = opts.getPts ? opts.getPts(s) : (s.boundary ? s.boundary.outPts : null);
      if (!pts || pts.length < 2) continue;
      const closed = opts.mode === "integral" ? false : Boolean(s.closed);
      const op = s.opacity !== undefined ? Math.max(0, Math.min(1, Number(s.opacity))) : (closed ? 0.22 : 1.0);
      if (op <= 0.001) continue;
      const lw = s.lineWidth !== undefined ? Math.max(0, Number(s.lineWidth)) : 2.0;
      const col = themeColor(s.primaryColor || s.color || "#38bdf8", { onDarkSurface: hasSolidOcean, solidFill: closed && op >= 0.85 });

      /* Project each point onto cylinder; split segments wrapping behind the cylinder */
      const segs = [];
      let cur = [];
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i];
        if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.y)) { if (cur.length >= 2) segs.push(cur); cur = []; continue; }
        const c3 = cylProject(q.x, q.y);
        const x1 = c3.x * _cy - c3.y * _sy;
        const d = c3.x * _sy + c3.y * _cy;
        if (d >= -0.05) {
          const sp = { sx: cx + x1 * R, sy: cy - c3.z * halfH };
          if (cur.length > 0 && Math.abs(sp.sx - cur[cur.length - 1].sx) > R * 0.95) {
            if (cur.length >= 2) segs.push(cur);
            cur = [sp];
          } else {
            cur.push(sp);
          }
        } else {
          if (cur.length >= 2) segs.push(cur);
          cur = [];
        }
      }
      if (cur.length >= 2) segs.push(cur);

      for (const seg of segs) {
        ctx.beginPath();
        for (let i = 0; i < seg.length; i++) {
          if (i === 0) ctx.moveTo(seg[i].sx, seg[i].sy);
          else ctx.lineTo(seg[i].sx, seg[i].sy);
        }
        if (closed && seg.length >= 3) {
          ctx.closePath();
          ctx.fillStyle = op >= 0.995 ? col : hexToRgba(col, op, { onDarkSurface: hasSolidOcean });
          ctx.fill();
        }
        if (lw > 0) {
          ctx.strokeStyle = col;
          ctx.lineWidth = lw;
          ctx.stroke();
        }
      }
    }

    /* Cylinder rim highlight & shadow */
    const shade = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
    shade.addColorStop(0.0, "rgba(0,0,0,0.34)");
    shade.addColorStop(0.22, "rgba(255,255,255,0.08)");
    shade.addColorStop(0.55, "rgba(0,0,0,0.0)");
    shade.addColorStop(1.0, "rgba(0,0,0,0.38)");
    ctx.fillStyle = shade;
    ctx.fillRect(cx - R, cy - halfH, R * 2, halfH * 2);
    ctx.restore();

    /* Crisp cylinder border frame */
    ctx.save();
    ctx.strokeStyle = isLight ? "rgba(2, 132, 199, 0.55)" : "rgba(125, 211, 252, 0.55)";
    ctx.lineWidth = 1.6;
    ctx.strokeRect(cx - R, cy - halfH, R * 2, halfH * 2);

    /* Front-facing points/cities on the cylinder */
    if (opts.mode !== "integral" && Array.isArray(opts.points)) {
      ctx.font = '600 10px "JetBrains Mono", monospace';
      for (const p of opts.points) {
        if (!p || !p.visible || p.locked || !p.outPt) continue;
        const c3 = cylProject(p.outPt.x, p.outPt.y);
        const x1 = c3.x * _cy - c3.y * _sy;
        const d = c3.x * _sy + c3.y * _cy;
        if (d < 0.05) continue;
        const sx = cx + x1 * R, sy = cy - c3.z * halfH;
        ctx.fillStyle = p.color || "#fbbf24";
        ctx.beginPath(); ctx.arc(sx, sy, 3.6, 0, Math.PI * 2); ctx.fill();
        if (p.showLabel !== false && p.label) {
          ctx.fillStyle = isLight ? "#0f172a" : "#f8fafc";
          ctx.fillText(p.label, sx + 6, sy + 3);
        }
      }
    }
    ctx.restore();
  }

  function render(ctx, canvas, shapes, opts = {}) {
    if (opts && opts.surface === "cylinder") {
      renderCylinder(ctx, canvas, shapes, opts);
      return;
    }
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
    let hasSolidGlobe = Boolean(opts.colorField && opts.colorField.pixels && Number(opts.colorField.opacity ?? 0.9) >= 0.8);
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

    if (opts.colorField && opts.colorField.pixels) {
      drawSphereColorField(ctx, cx, cy, R, rimR, opts.colorField, Boolean(opts.isAnimating));
    }

    for (const lat of GRID.latitudes) drawWireArcPass(ctx, lat.pts, cx, cy, R, true, hasSolidGlobe ? "rgba(186,230,253,0.22)" : (isLight ? (lat.r === 1 ? "rgba(2,132,199,0.52)" : "rgba(71,85,105,0.28)") : lat.front), lat.lw);
    for (const mer of GRID.meridians) drawWireArcPass(ctx, mer.pts, cx, cy, R, true, hasSolidGlobe ? "rgba(186,230,253,0.18)" : (isLight ? "rgba(71,85,105,0.28)" : mer.front), mer.lw);

    for (const item of prepared) {
      if (item.op <= 0.001 || item.isOcean) continue;
      if (item.closed) {
        fillFrontPolygonOnSphere(ctx, item.chains3, cx, cy, R, rimR, item.color, item.op, false);
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
        if (item.lw > 0 && item.op < 0.85) {
          /* Outer soft glow for translucent/wireframe shapes */
          strokeHemisphereChains(ctx, item.chains, true, item.color, effLw + (item.isHi ? 6 : 4), (item.isHi ? 0.42 : 0.28) * item.strokeOp, dash);
        }
        /* Core bright curve (also renders crisp white coastline highlight on hovered fill-only Earth layers!) */
        strokeHemisphereChains(ctx, item.chains, true, item.isHi ? (isLight && !hasSolidGlobe ? "#0f172a" : "#ffffff") : item.color, item.isHi ? effLw + 0.8 : effLw, item.isHi ? 1.0 : item.strokeOp, dash);
      }

      /* Direction arrow along front hemisphere if available (skip when fill-only / zero stroke) */
      const mainChain = item.chains[0];
      if (item.lw > 0 && item.op < 0.85 && mainChain && mainChain.length >= 6) {
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

    /* Single combined 3D planetary sunlit shading, limb darkening & atmospheric rim + crisp outline (60 FPS!) */
    ctx.save();
    if (hasSolidGlobe) {
      const shadeGrad = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.32, R * 0.05, cx, cy, rimR * 1.01);
      shadeGrad.addColorStop(0.0, "rgba(255, 252, 240, 0.24)");
      shadeGrad.addColorStop(0.35, "rgba(255, 255, 255, 0.03)");
      shadeGrad.addColorStop(0.72, "rgba(4, 14, 30, 0.16)");
      shadeGrad.addColorStop(0.91, "rgba(2, 10, 26, 0.44)");
      shadeGrad.addColorStop(1.0, "rgba(56, 189, 248, 0.34)");
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

    /* Mapped non-landmark (unlocked) Domain Points & Labels on the 3D Riemann Sphere */
    if (opts.mode !== "integral" && Array.isArray(opts.points)) {
      ctx.font = '600 10.5px "JetBrains Mono", monospace';
      for (const p of opts.points) {
        if (!p || !p.visible || p.locked || !p.outPt) continue;
        if (!Number.isFinite(p.outPt.x) || !Number.isFinite(p.outPt.y)) continue;
        const c = toCanvas(rotate3D(stereoProject(p.outPt.x, p.outPt.y)), cx, cy, R);
        const isFront = c.depth >= -0.04;
        if (hasSolidGlobe && !isFront) continue;
        const col = p.color || "#34d399";
        const sz = Math.max(3.5, Number(p.size) || 4.5);
        const pop = (p.opacity !== undefined && p.opacity !== null && Number.isFinite(Number(p.opacity)))
          ? Math.max(0, Math.min(1, Number(p.opacity)))
          : 1.0;
        if (pop <= 0.001) continue;
        ctx.save();
        ctx.globalAlpha = (isFront ? 1.0 : 0.22) * pop;
        ctx.fillStyle = col;
        ctx.strokeStyle = isLight ? "#ffffff" : "#080c14";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(c.sx, c.sy, isFront ? sz : sz * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (isFront) {
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(c.sx, c.sy, Math.max(1.3, sz * 0.36), 0, Math.PI * 2);
          ctx.fill();
        }

        if (p.showLabel !== false && p.label) {
          const lx = c.sx + sz + 5;
          const ly = c.sy + 3.5;
          if (isFront) {
            if (p._lblStr !== p.label) {
              p._lblStr = p.label;
              p._lblW = ctx.measureText(p.label).width;
            }
            const tw = p._lblW;
            ctx.fillStyle = isLight ? "rgba(255, 255, 255, 0.86)" : "rgba(8, 12, 20, 0.78)";
            ctx.strokeStyle = hexToRgba(col, 0.45);
            ctx.lineWidth = 1;
            ctx.beginPath();
            if (typeof ctx.roundRect === "function") {
              ctx.roundRect(lx - 3, ly - 10.5, tw + 6, 14, 3.5);
            } else {
              ctx.rect(lx - 3, ly - 10.5, tw + 6, 14);
            }
            ctx.fill();
            ctx.stroke();
          }
          ctx.fillStyle = isFront ? (isLight ? "#0f172a" : "#f8fafc") : col;
          ctx.fillText(p.label, lx, ly);
        }
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
      sphere.zoom = Math.max(0.35, Math.min(22.0, sphere.zoom * factor));
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
      sphere.zoom = Math.max(0.35, Math.min(22.0, sphere.zoom * f));
    },
  };
  }

  window.createRiemannSphere = createSphereRenderer;
  window.RiemannSphere = createSphereRenderer();
  window.RiemannSphereIn = createSphereRenderer();
})();
