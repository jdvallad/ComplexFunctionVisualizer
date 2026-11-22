(() => {
  "use strict";

  /*
   * Interactive 3D Riemann Sphere Stereographic Projection Renderer
   * Maps complex numbers w = u + iv onto the unit sphere S^2:
   *   X = 2u / (r^2 + 1),  Y = 2v / (r^2 + 1),  Z = (r^2 - 1) / (r^2 + 1)
   * South Pole (0, 0, -1) = 0,  Equator Z = 0 = unit circle |w| = 1,  North Pole (0, 0, +1) = infinity.
   */

  const sphere = {
    enabled: false,
    yaw: -0.65,
    pitch: 0.42,
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

    /* Tilt around X (pitch): screen X = x1, screen Y = -(z1*cp - y1*sp), depth = y1*cp + z1*sp */
    const screenY = z1 * cp - y1 * sp;
    const depth = y1 * cp + z1 * sp;
    return { x: x1, y: screenY, depth };
  }

  function toCanvas(rot, cx, cy, R) {
    /* Subtle perspective foreshortening */
    const persp = 3.6 / (3.6 - rot.depth * 0.7);
    return {
      sx: cx + rot.x * R * persp,
      sy: cy - rot.y * R * persp,
      depth: rot.depth,
    };
  }

  function drawWireArc(ctx, pts3, cx, cy, R, frontColor, backColor, lineWidth) {
    const proj = pts3.map((p) => toCanvas(rotate3D(p), cx, cy, R));
    for (let i = 0; i < proj.length - 1; i++) {
      const a = proj[i];
      const b = proj[i + 1];
      const front = 0.5 * (a.depth + b.depth) >= -0.05;
      ctx.strokeStyle = front ? frontColor : backColor;
      ctx.lineWidth = front ? lineWidth : lineWidth * 0.7;
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }
  }

  function drawCurveOnSphere(ctx, pts, color, closed, cx, cy, R, playPhase, playing, isHighlighted) {
    if (!pts || pts.length < 2) return;

    const mapped = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const p3 = p ? stereoProject(p.x, p.y) : { x: 0, y: 0, z: 1 };
      mapped.push(toCanvas(rotate3D(p3), cx, cy, R));
    }
    if (closed && mapped.length >= 3) {
      mapped.push(mapped[0]);
    }

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    /* Back-hemisphere segments (dimmed dashed depth cue) */
    for (let i = 0; i < mapped.length - 1; i++) {
      const a = mapped[i];
      const b = mapped[i + 1];
      const avgD = 0.5 * (a.depth + b.depth);
      if (avgD < -0.04) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.24;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }
    }

    /* Front-hemisphere segments (crisp + glowing) */
    for (let i = 0; i < mapped.length - 1; i++) {
      const a = mapped[i];
      const b = mapped[i + 1];
      const avgD = 0.5 * (a.depth + b.depth);
      if (avgD >= -0.04) {
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = color;
        ctx.lineWidth = isHighlighted ? 8 : 6;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();

        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = isHighlighted ? "#ffffff" : color;
        ctx.lineWidth = isHighlighted ? 2.7 : 2.3;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }
    }

    /* Animated comet */
    if (playing && mapped.length > 1) {
      const idx = Math.floor(playPhase * (mapped.length - 1)) % mapped.length;
      const m = mapped[idx];
      ctx.globalAlpha = m.depth >= -0.05 ? 1.0 : 0.35;
      const g = ctx.createRadialGradient(m.sx, m.sy, 0, m.sx, m.sy, 14);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.4, color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(m.sx, m.sy, 14, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function render(ctx, canvas, shapes, opts) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const R = Math.min(w, h) * 0.38 * sphere.zoom;

    /* Deep space backdrop */
    ctx.fillStyle = "#080c14";
    ctx.fillRect(0, 0, w, h);

    /* Subtle dark luminous sphere body */
    const bodyGrad = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R * 1.08);
    bodyGrad.addColorStop(0, "rgba(30, 41, 68, 0.58)");
    bodyGrad.addColorStop(0.7, "rgba(13, 19, 33, 0.72)");
    bodyGrad.addColorStop(1, "rgba(6, 9, 16, 0.95)");
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.02, 0, Math.PI * 2);
    ctx.fill();

    /* Outer rim glow */
    ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.02, 0, Math.PI * 2);
    ctx.stroke();

    /* Latitude rings: |w| = 0.5, 1 (equator), 2 */
    const latitudes = [
      { r: 0.5, front: "rgba(148,163,184,0.16)", back: "rgba(148,163,184,0.06)", lw: 1 },
      { r: 1.0, front: "rgba(56,189,248,0.34)", back: "rgba(56,189,248,0.10)", lw: 1.4 },
      { r: 2.0, front: "rgba(148,163,184,0.16)", back: "rgba(148,163,184,0.06)", lw: 1 },
    ];
    for (const lat of latitudes) {
      const ring = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        ring.push(stereoProject(lat.r * Math.cos(a), lat.r * Math.sin(a)));
      }
      drawWireArc(ctx, ring, cx, cy, R, lat.front, lat.back, lat.lw);
    }

    /* Meridians (real axis, imaginary axis, and 45-deg diagonals) */
    for (let m = 0; m < 8; m++) {
      const ang = (m / 8) * Math.PI;
      const isAxis = m === 0 || m === 4;
      const arc = [];
      for (let i = 0; i <= 64; i++) {
        const phi = -Math.PI * 0.5 + (i / 64) * Math.PI;
        arc.push({
          x: Math.cos(phi) * Math.cos(ang),
          y: Math.cos(phi) * Math.sin(ang),
          z: Math.sin(phi),
        });
      }
      drawWireArc(
        ctx,
        arc,
        cx,
        cy,
        R,
        isAxis ? "rgba(203,213,225,0.28)" : "rgba(148,163,184,0.11)",
        "rgba(148,163,184,0.045)",
        isAxis ? 1.2 : 0.9
      );
    }

    /* Landmark poles on sphere: North Pole = infinity, South Pole = 0, +1, +i */
    const markers = [
      { p: { x: 0, y: 0, z: 1 }, label: "∞ (North Pole)", color: "#fb7185" },
      { p: { x: 0, y: 0, z: -1 }, label: "0 (South Pole)", color: "#34d399" },
      { p: { x: 1, y: 0, z: 0 }, label: "+1", color: "#94a3b8" },
      { p: { x: 0, y: 1, z: 0 }, label: "+i", color: "#94a3b8" },
    ];
    ctx.font = '10.5px "JetBrains Mono", monospace';
    for (const mk of markers) {
      const c = toCanvas(rotate3D(mk.p), cx, cy, R);
      ctx.save();
      ctx.globalAlpha = c.depth >= -0.05 ? 0.95 : 0.3;
      ctx.fillStyle = mk.color;
      ctx.beginPath();
      ctx.arc(c.sx, c.sy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(mk.label, c.sx + 7, c.sy + 3);
      ctx.restore();
    }

    /* Mapped shapes on the Riemann Sphere */
    for (const s of shapes) {
      if (!s.visible) continue;
      const pts = opts.getPts ? opts.getPts(s) : s.boundary ? s.boundary.outPts : null;
      if (!pts) continue;
      const isHi = s.id === opts.selectedShapeId || s.id === opts.hoveredShapeId;
      drawCurveOnSphere(ctx, pts, s.color, s.closed, cx, cy, R, opts.playPhase, opts.playing, isHi);
    }

    /* Live hover probe on the sphere */
    if (opts.probe && opts.probe.active && opts.probe.w) {
      const c = toCanvas(rotate3D(stereoProject(opts.probe.w.x, opts.probe.w.y)), cx, cy, R);
      ctx.save();
      ctx.globalAlpha = c.depth >= -0.05 ? 1 : 0.35;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#a78bfa";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.sx, c.sy, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    /* Subtle orbit hint */
    ctx.fillStyle = "rgba(148, 163, 184, 0.55)";
    ctx.font = '11px "Inter", sans-serif';
    ctx.fillText("Drag to orbit 3D Riemann Sphere · Scroll to zoom", 14, h - 14);
  }

  window.RiemannSphere = {
    state: sphere,
    render,
    reset() {
      sphere.yaw = -0.65;
      sphere.pitch = 0.42;
      sphere.zoom = 1.0;
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
      sphere.yaw += dx * 0.0085;
      sphere.pitch = Math.max(-1.48, Math.min(1.48, sphere.pitch + dy * 0.0085));
      return true;
    },
    onPointerUp() {
      sphere.orbiting = false;
    },
    onWheel(deltaY) {
      const f = deltaY < 0 ? 1.1 : 1 / 1.1;
      sphere.zoom = Math.max(0.55, Math.min(2.4, sphere.zoom * f));
    },
  };
})();
