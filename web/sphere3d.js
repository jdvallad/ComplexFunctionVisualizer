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

  function rotate3D(p) {
    const cy = Math.cos(sphere.yaw);
    const sy = Math.sin(sphere.yaw);
    const cp = Math.cos(sphere.pitch);
    const sp = Math.sin(sphere.pitch);

    /* Rotate around Z (yaw) so North Pole stays upright */
    const x1 = p.x * cy - p.y * sy;
    const y1 = p.x * sy + p.y * cy;
    const z1 = p.z;

    /* Tilt around X (pitch): screenY up, depth positive toward viewer */
    const screenY = z1 * cp - y1 * sp;
    const depth = y1 * cp + z1 * sp;
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
      if (chord > 0.14) {
        const steps = Math.min(20, Math.ceil(chord / 0.11));
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

    pts._chains3D = chains3;
    pts._chains3DClosed = Boolean(closed);
    pts._chains3DLen = pts.length;
    return chains3;
  }

  function projectCurveChains(pts, closed, cx, cy, R) {
    const chains3 = buildChains3D(pts, closed);
    if (chains3.length === 0) return [];
    const cyaw = Math.cos(sphere.yaw), syaw = Math.sin(sphere.yaw);
    const cp = Math.cos(sphere.pitch), sp = Math.sin(sphere.pitch);
    return chains3.map((chain) => {
      const out = new Array(chain.length);
      for (let i = 0; i < chain.length; i++) {
        const p = chain[i];
        const x1 = p.x * cyaw - p.y * syaw;
        const y1 = p.x * syaw + p.y * cyaw;
        const screenY = p.z * cp - y1 * sp;
        const depth = y1 * cp + p.z * sp;
        const persp = 3.8 / (3.8 - depth * 0.72);
        out[i] = {
          sx: cx + x1 * R * persp,
          sy: cy - screenY * R * persp,
          depth,
        };
      }
      return out;
    });
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

  function render(ctx, canvas, shapes, opts = {}) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 4 || h < 4) return;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const R = Math.min(w, h) * 0.38 * sphere.zoom;
    const rimR = R * 1.018;

    /* Deep space backdrop */
    ctx.fillStyle = "#080c14";
    ctx.fillRect(0, 0, w, h);

    /* Base dark sphere silhouette */
    ctx.fillStyle = "#0c1322";
    ctx.beginPath();
    ctx.arc(cx, cy, rimR, 0, Math.PI * 2);
    ctx.fill();

    /* Pre-project all visible shape boundaries and conformal meshes once */
    const prepared = [];
    for (const s of shapes || []) {
      if (!s.visible) continue;
      const pts = opts.getPts ? opts.getPts(s) : (s.boundary ? s.boundary.outPts : null);
      if (!pts || pts.length < 2) continue;
      const col = s.primaryColor || s.color || "#38bdf8";
      const lw = Number(s.lineWidth) || 2.3;
      const isHi = s.id === opts.selectedShapeId || s.id === opts.hoveredShapeId;
      const closed = opts.mode === "integral" ? false : Boolean(s.closed);
      const chains = projectCurveChains(pts, closed, cx, cy, R);

      const meshChains = [];
      if (opts.mode !== "integral" && opts.showMesh !== false && s.closed && s.mesh && s.mesh.length > 0) {
        for (const m of s.mesh) {
          if (m && m.outPts && m.outPts.length >= 2) {
            const mc = projectCurveChains(m.outPts, false, cx, cy, R);
            for (const c of mc) meshChains.push(c);
          }
        }
      }
      prepared.push({ shape: s, color: col, lw, isHi, chains, meshChains });
    }

    /* ================= PASS 1: BACK HEMISPHERE ================= */
    for (const lat of GRID.latitudes) drawWireArcPass(ctx, lat.pts, cx, cy, R, false, lat.back, lat.lw * 0.8);
    for (const mer of GRID.meridians) drawWireArcPass(ctx, mer.pts, cx, cy, R, false, mer.back, mer.lw * 0.8);

    for (const item of prepared) {
      if (item.meshChains.length > 0) {
        strokeHemisphereChains(ctx, item.meshChains, false, item.color, 0.9, 0.14, null);
      }
      strokeHemisphereChains(ctx, item.chains, false, item.color, Math.max(1.4, item.lw * 0.72), 0.36, [4, 4]);
    }

    /* ================= PASS 2: FROSTED GLASS SPHERE BODY ================= */
    ctx.save();
    const glassGrad = ctx.createRadialGradient(cx - R * 0.34, cy - R * 0.34, R * 0.08, cx, cy, rimR * 1.05);
    glassGrad.addColorStop(0, "rgba(56, 86, 136, 0.28)");
    glassGrad.addColorStop(0.55, "rgba(15, 23, 42, 0.36)");
    glassGrad.addColorStop(0.88, "rgba(8, 12, 22, 0.56)");
    glassGrad.addColorStop(1, "rgba(56, 189, 248, 0.14)");
    ctx.fillStyle = glassGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, rimR, 0, Math.PI * 2);
    ctx.fill();

    /* Crisp spherical rim glow */
    ctx.strokeStyle = "rgba(148, 163, 184, 0.34)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, rimR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    /* ================= PASS 3: FRONT HEMISPHERE ================= */
    for (const lat of GRID.latitudes) drawWireArcPass(ctx, lat.pts, cx, cy, R, true, lat.front, lat.lw);
    for (const mer of GRID.meridians) drawWireArcPass(ctx, mer.pts, cx, cy, R, true, mer.front, mer.lw);

    for (const item of prepared) {
      const dash =
        item.shape.lineStyle === "dashed" ? [7, 5] :
        item.shape.lineStyle === "dotted" ? [2, 4] : null;

      if (item.meshChains.length > 0) {
        strokeHemisphereChains(ctx, item.meshChains, true, item.color, 1.0, 0.30, null);
      }
      /* Outer soft glow */
      strokeHemisphereChains(ctx, item.chains, true, item.color, item.lw + (item.isHi ? 6 : 4), item.isHi ? 0.42 : 0.28, dash);
      /* Core bright curve */
      strokeHemisphereChains(ctx, item.chains, true, item.isHi ? "#ffffff" : item.color, item.isHi ? item.lw + 0.7 : item.lw, 1.0, dash);

      /* Direction arrow along front hemisphere if available */
      const mainChain = item.chains[0];
      if (mainChain && mainChain.length >= 6) {
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
        const col = p.color || "#34d399";
        const sz = Math.max(3.5, Number(p.size) || 4.5);
        ctx.save();
        ctx.globalAlpha = isFront ? 1.0 : 0.22;
        ctx.fillStyle = col;
        ctx.strokeStyle = "#080c14";
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
            const tw = ctx.measureText(p.label).width;
            ctx.fillStyle = "rgba(8, 12, 20, 0.78)";
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
          ctx.fillStyle = isFront ? "#f8fafc" : col;
          ctx.fillText(p.label, lx, ly);
        }
        ctx.restore();
      }
    }

    /* Live hover probe on the sphere */
    if (opts.probe && opts.probe.active && opts.probe.w) {
      const c = toCanvas(rotate3D(stereoProject(opts.probe.w.x, opts.probe.w.y)), cx, cy, R);
      ctx.save();
      ctx.globalAlpha = c.depth >= -0.04 ? 1.0 : 0.35;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#a78bfa";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.sx, c.sy, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
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

  window.RiemannSphere = {
    state: sphere,
    render,
    stereoProject,
    focusOnShapes,
    reset() {
      sphere.yaw = -0.58;
      sphere.pitch = 0.22;
      sphere.zoom = 1.0;
    },
    zoomBy(factor) {
      sphere.zoom = Math.max(0.55, Math.min(2.6, sphere.zoom * factor));
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
      sphere.yaw -= dx * 0.0085;
      sphere.pitch = Math.max(-1.48, Math.min(1.48, sphere.pitch + dy * 0.0085));
      return true;
    },
    onPointerUp() {
      sphere.orbiting = false;
    },
    onWheel(deltaY) {
      const f = deltaY < 0 ? 1.1 : 1 / 1.1;
      sphere.zoom = Math.max(0.55, Math.min(2.6, sphere.zoom * f));
    },
  };
})();
