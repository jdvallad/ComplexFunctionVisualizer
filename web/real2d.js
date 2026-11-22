(() => {
  "use strict";

  /*
   * Dedicated 2D Real-Valued Functions & Prime Explicit Formula Convergence Module
   * Exposed as window.Real2DController so app.js coordinates the top-level C <-> R toggle.
   */

  const SERIES_COLORS = {
    exact: "#f8fafc",      /* Crisp bright white for exact staircase / primary curve */
    baseline: "#fbbf24",   /* Dashed amber for Li(x) / y = x */
    k: [
      "#94a3b8", /* K = 0  (Slate / Riemann R(x)) */
      "#a78bfa", /* K = 5  (Violet) */
      "#fb7185", /* K = 20 (Rose) */
      "#38bdf8", /* K = 50 (Electric Cyan) */
      "#34d399", /* K = 150 (Bright Emerald) */
    ],
    liveK: "#fde047",      /* Luminous gold for the interactive K slider */
  };

  /* Small prime list for fast x-axis prime tick rendering up to 500 */
  const SMALL_PRIMES = [];
  (function buildPrimes() {
    for (let n = 2; n <= 500; n++) {
      let ok = true;
      for (let d = 2; d * d <= n; d++) {
        if (n % d === 0) {
          ok = false;
          break;
        }
      }
      if (ok) SMALL_PRIMES.push(n);
    }
  })();

  const rState = {
    active: false,
    initialized: false,
    functions: [],
    zeros: [],
    fnIndex: 0,

    view: { xmin: 1.8, xmax: 40.0, ymin: -0.8, ymax: 14.5 },

    /* Series visibility for active function */
    showExact: true,
    showBaseline: true,
    activeKs: new Set(),  /* Subset of default_ks enabled */
    showLiveK: false,
    liveK: 25,
    showErrorFill: true,
    showMarkers: true,

    /* Cached sampled curves from C backend */
    cache: null, /* { xs, exact, baseline, approx: [{k, ys}] } */
    fetchTimer: null,
    fetchReqId: 0,

    /* Animation state for sweeping K */
    animating: false,
    animRaf: null,
    animLastTs: 0,
    animAccum: 0,

    /* Interaction */
    pan: null,
    hoverX: null,
    hoverPx: null,

    /* 2D Lab Overlays: Calculus Toolkit + Solo Harmonic Wave */
    calc: {
      showDeriv: false,
      showTangent: false,
      showIntegral: false,
      a: 2.0,
      b: 20.0,
      integralVal: null,
      derivXs: null,
      derivYs: null,
      draggingGate: null, /* 'a' | 'b' | null */
    },
    soloWave: null, /* { index, gamma, xs, ys } */
  };

  /* DOM refs */
  const canvas = document.getElementById("canvas-real");
  const ctx = canvas.getContext("2d");
  const card = document.getElementById("real-plane-card");
  const fnSelect = document.getElementById("real-fn-select");
  const planeSub = document.getElementById("real-plane-sub");
  const seriesToggles = document.getElementById("real-series-toggles");
  const sliderDivider = document.getElementById("real-slider-divider");
  const sliderGroup = document.getElementById("real-slider-group");
  const btnLiveK = document.getElementById("real-btn-livek");
  const kSlider = document.getElementById("real-k-slider");
  const kReadout = document.getElementById("real-k-readout");
  const btnAnimate = document.getElementById("real-btn-animate");
  const iconPlay = document.getElementById("real-icon-play");
  const labelPlay = document.getElementById("real-label-play");
  const btnErrFill = document.getElementById("real-btn-errfill");
  const btnMarkers = document.getElementById("real-btn-markers");
  const presetsList = document.getElementById("real-presets-list");
  const legendX = document.getElementById("real-legend-x");
  const legendRows = document.getElementById("real-legend-rows");
  const statusNote = document.getElementById("real-status-note");

  /* Shared header refs */
  const fnFormula = document.getElementById("fn-formula");
  const readoutZ = document.getElementById("readout-z");
  const readoutW = document.getElementById("readout-w");
  const readoutMag = document.getElementById("readout-mag");

  function curFn() {
    if (rState.fnIndex === -1) {
      return {
        index: -1,
        id: "live_real_c",
        name: "Live C Real Function",
        formula: "user_real_fn(x)",
        description: "Hot-compiled native C function via clang + dlopen().",
        c_source: "",
        has_approx: false,
        has_baseline: false,
        is_step_exact: false,
        show_primes: false,
        show_zeros: false,
        max_k: 0,
        default_ks: [],
        k_unit: "",
        view: { xmin: -6, xmax: 6, ymin: -3, ymax: 3 },
      };
    }
    return rState.functions[rState.fnIndex] || null;
  }

  function niceStep(rawStep) {
    if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
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
    if (Math.abs(v) >= 10000 || Math.abs(v) < 0.005) return v.toExponential(1);
    return Number(v.toFixed(4)).toString();
  }

  function xToScreen(x) {
    const w = canvas.clientWidth;
    return ((x - rState.view.xmin) / (rState.view.xmax - rState.view.xmin)) * w;
  }

  function yToScreen(y) {
    const h = canvas.clientHeight;
    return h - ((y - rState.view.ymin) / (rState.view.ymax - rState.view.ymin)) * h;
  }

  function screenToX(sx) {
    const w = canvas.clientWidth;
    return rState.view.xmin + (sx / w) * (rState.view.xmax - rState.view.xmin);
  }

  function screenToY(sy) {
    const h = canvas.clientHeight;
    return rState.view.ymin + ((h - sy) / h) * (rState.view.ymax - rState.view.ymin);
  }

  function colorForK(fn, k) {
    if (rState.showLiveK && k === rState.liveK && !fn.default_ks.includes(k)) {
      return SERIES_COLORS.liveK;
    }
    const idx = fn.default_ks.indexOf(k);
    if (idx >= 0) return SERIES_COLORS.k[idx % SERIES_COLORS.k.length];
    return SERIES_COLORS.liveK;
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /* -------------------------------------------------------------------------
   * Backend Sampling
   * ------------------------------------------------------------------------- */

  function activeKList() {
    const fn = curFn();
    if (!fn || !fn.has_approx) return [];
    const list = [];
    for (const k of fn.default_ks) {
      if (rState.activeKs.has(k)) list.push(k);
    }
    if (rState.showLiveK && !list.includes(rState.liveK)) {
      list.push(rState.liveK);
    }
    return list;
  }

  function scheduleSample(immediate = false) {
    if (!rState.active) return;
    if (rState.fetchTimer) clearTimeout(rState.fetchTimer);
    if (immediate) {
      fetchSamples();
    } else {
      rState.fetchTimer = setTimeout(fetchSamples, 45);
    }
  }

  async function fetchSamples() {
    const fn = curFn();
    if (!fn || !rState.active) return;
    const reqId = ++rState.fetchReqId;

    const ks = activeKList();
    const w = canvas.clientWidth || 900;
    const maxK = ks.length > 0 ? Math.max(...ks) : 0;
    /* Keep samples crisp while staying super responsive during live K sweeps */
    const samples = rState.animating
      ? Math.min(420, Math.max(240, Math.round(w * 0.4)))
      : maxK >= 100
      ? Math.min(680, Math.max(420, Math.round(w * 0.65)))
      : Math.min(820, Math.max(480, Math.round(w * 0.78)));

    const res = await fetch("/api/real/sample", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fn: rState.fnIndex,
        xmin: rState.view.xmin,
        xmax: rState.view.xmax,
        samples,
        exact: rState.showExact,
        baseline: rState.showBaseline && fn.has_baseline,
        ks,
      }),
    });
    if (!res.ok || reqId !== rState.fetchReqId) return;
    const data = await res.json();
    if (reqId !== rState.fetchReqId) return;

    rState.cache = data;
    updateLegend();
    if (window.LabController) window.LabController.onRealSampled();
    requestRender();
  }

  /* -------------------------------------------------------------------------
   * Presets for 2D Real Functions
   * ------------------------------------------------------------------------- */

  function getRealPresets(fn) {
    if (!fn) return [];
    if (fn.id === "pi_explicit") {
      return [
        {
          name: "Convergence [2, 35] (All Lines)",
          run: () => {
            stopAnim();
            rState.showExact = true;
            rState.showBaseline = true;
            rState.activeKs = new Set([5, 20, 50, 150]);
            rState.showLiveK = false;
            rState.view = { xmin: 1.6, xmax: 36.0, ymin: -0.6, ymax: 13.5 };
            renderToolbar();
            scheduleSample(true);
          },
        },
        {
          name: "Zoom Prime Jumps [10, 35]",
          run: () => {
            stopAnim();
            rState.showExact = true;
            rState.showBaseline = true;
            rState.activeKs = new Set([5, 20, 50, 150]);
            rState.showLiveK = false;
            rState.view = { xmin: 9.5, xmax: 34.5, ymin: 3.2, ymax: 13.0 };
            renderToolbar();
            scheduleSample(true);
          },
        },
        {
          name: "Wide View [2, 100]",
          run: () => {
            stopAnim();
            rState.showExact = true;
            rState.showBaseline = true;
            rState.activeKs = new Set([0, 20, 150]);
            rState.showLiveK = false;
            rState.view = { xmin: 1.5, xmax: 102.0, ymin: -1.0, ymax: 32.0 };
            renderToolbar();
            scheduleSample(true);
          },
        },
        {
          name: "Deep Primes [2, 200]",
          run: () => {
            stopAnim();
            rState.showExact = true;
            rState.showBaseline = true;
            rState.activeKs = new Set([0, 50, 150]);
            rState.showLiveK = false;
            rState.view = { xmin: 1.5, xmax: 202.0, ymin: -2.0, ymax: 54.0 };
            renderToolbar();
            scheduleSample(true);
          },
        },
        {
          name: "Sweep K: 0 → 200 Animation",
          run: () => {
            rState.showExact = true;
            rState.showBaseline = true;
            rState.activeKs = new Set();
            rState.showLiveK = true;
            rState.liveK = 0;
            kSlider.value = "0";
            rState.view = { xmin: 1.6, xmax: 42.0, ymin: -0.8, ymax: 15.5 };
            renderToolbar();
            startAnim();
          },
        },
      ];
    }

    if (fn.id === "J_explicit" || fn.id === "psi_explicit") {
      return [
        {
          name: "All Convergence Lines [2, 40]",
          run: () => {
            stopAnim();
            rState.showExact = true;
            rState.showBaseline = true;
            rState.activeKs = new Set(fn.default_ks.slice(1));
            rState.showLiveK = false;
            rState.view = { ...fn.view };
            renderToolbar();
            scheduleSample(true);
          },
        },
        {
          name: "Wide View [2, 100]",
          run: () => {
            stopAnim();
            rState.showExact = true;
            rState.showBaseline = true;
            rState.activeKs = new Set([fn.default_ks[1], fn.default_ks[4]]);
            rState.showLiveK = false;
            rState.view = {
              xmin: 1.5,
              xmax: 102.0,
              ymin: -2.0,
              ymax: fn.id === "psi_explicit" ? 105.0 : 36.0,
            };
            renderToolbar();
            scheduleSample(true);
          },
        },
        {
          name: "Sweep K: 0 → 200",
          run: () => {
            rState.showExact = true;
            rState.showBaseline = true;
            rState.activeKs = new Set();
            rState.showLiveK = true;
            rState.liveK = 0;
            kSlider.value = "0";
            rState.view = { ...fn.view };
            renderToolbar();
            startAnim();
          },
        },
      ];
    }

    if (fn.id === "hardy_z") {
      return [
        {
          name: "First 12 Zeros [0, 60]",
          run: () => {
            rState.view = { xmin: 0.0, xmax: 60.0, ymin: -3.8, ymax: 4.2 };
            scheduleSample(true);
          },
        },
        {
          name: "Lehmer-Style Close Zeros [100, 145]",
          run: () => {
            rState.view = { xmin: 100.0, xmax: 145.0, ymin: -5.5, ymax: 5.5 };
            scheduleSample(true);
          },
        },
      ];
    }

    if (fn.id === "xi_real") {
      return [
        {
          name: "Symmetry View [-4, 5]",
          run: () => {
            rState.view = { xmin: -4.0, xmax: 5.0, ymin: 0.0, ymax: 4.5 };
            scheduleSample(true);
          },
        },
        {
          name: "Critical Strip Zoom [-0.5, 1.5]",
          run: () => {
            rState.view = { xmin: -0.5, xmax: 1.5, ymin: 0.48, ymax: 0.56 };
            scheduleSample(true);
          },
        },
      ];
    }

    if (fn.id === "fourier_square") {
      return [
        {
          name: "Gibbs Convergence [-2π, 2π]",
          run: () => {
            stopAnim();
            rState.showExact = true;
            rState.activeKs = new Set([1, 3, 9, 25, 75]);
            rState.showLiveK = false;
            rState.view = { xmin: -6.5, xmax: 6.5, ymin: -1.6, ymax: 1.6 };
            renderToolbar();
            scheduleSample(true);
          },
        },
        {
          name: "Zoom Gibbs Overshoot [0, π]",
          run: () => {
            stopAnim();
            rState.showExact = true;
            rState.activeKs = new Set([3, 9, 25, 75]);
            rState.showLiveK = false;
            rState.view = { xmin: -0.4, xmax: 3.5, ymin: -0.2, ymax: 1.4 };
            renderToolbar();
            scheduleSample(true);
          },
        },
      ];
    }

    return [
      {
        name: "Default View",
        run: () => {
          rState.view = { ...fn.view };
          scheduleSample(true);
        },
      },
    ];
  }

  /* -------------------------------------------------------------------------
   * Rendering
   * ------------------------------------------------------------------------- */

  let renderQueued = false;
  function requestRender() {
    if (!rState.active) return;
    if (!renderQueued) {
      renderQueued = true;
      requestAnimationFrame(renderFrame);
    }
  }

  function resize() {
    if (!rState.active) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const tw = Math.max(1, Math.round(rect.width * dpr));
    const th = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== tw || canvas.height !== th) {
      canvas.width = tw;
      canvas.height = th;
    }
    requestRender();
  }

  function sampleValueAtX(xs, ys, targetX) {
    if (!xs || !ys || xs.length < 2) return null;
    const xmin = xs[0];
    const xmax = xs[xs.length - 1];
    if (targetX < xmin || targetX > xmax) return null;
    const frac = ((targetX - xmin) / (xmax - xmin)) * (xs.length - 1);
    const i0 = Math.max(0, Math.min(xs.length - 2, Math.floor(frac)));
    const t = frac - i0;
    const y0 = ys[i0];
    const y1 = ys[i0 + 1];
    if (y0 === null || y1 === null) return y0 ?? y1;
    return y0 + (y1 - y0) * t;
  }

  function drawPolyline(xs, ys, color, lineWidth, dashed = false, isStep = false, glow = false) {
    if (!xs || !ys || xs.length < 2) return;
    const h = canvas.clientHeight;

    const trace = () => {
      ctx.beginPath();
      let penDown = false;
      let prevSx = 0;
      let prevSy = 0;
      for (let i = 0; i < xs.length; i++) {
        const y = ys[i];
        if (y === null || !Number.isFinite(y)) {
          penDown = false;
          continue;
        }
        const sx = xToScreen(xs[i]);
        const sy = Math.max(-h * 2, Math.min(h * 3, yToScreen(y)));
        if (!penDown) {
          ctx.moveTo(sx, sy);
          penDown = true;
        } else if (isStep) {
          ctx.lineTo(sx, prevSy);
          ctx.lineTo(sx, sy);
        } else {
          ctx.lineTo(sx, sy);
        }
        prevSx = sx;
        prevSy = sy;
      }
      void prevSx;
    };

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (dashed) ctx.setLineDash([6, 5]);

    if (glow) {
      trace();
      ctx.strokeStyle = hexToRgba(color, 0.28);
      ctx.lineWidth = lineWidth + 4.5;
      ctx.stroke();
    }

    trace();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.restore();
  }

  function drawErrorFill(xs, exactYs, approxYs, color) {
    if (!xs || !exactYs || !approxYs || xs.length < 2) return;
    ctx.save();
    ctx.fillStyle = hexToRgba(color, 0.14);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < xs.length; i++) {
      if (exactYs[i] === null || approxYs[i] === null) continue;
      const sx = xToScreen(xs[i]);
      const sy = yToScreen(approxYs[i]);
      if (!started) {
        ctx.moveTo(sx, sy);
        started = true;
      } else {
        ctx.lineTo(sx, sy);
      }
    }
    for (let i = xs.length - 1; i >= 0; i--) {
      if (exactYs[i] === null || approxYs[i] === null) continue;
      ctx.lineTo(xToScreen(xs[i]), yToScreen(exactYs[i]));
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function renderFrame() {
    renderQueued = false;
    if (!rState.active) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const fn = curFn();

    ctx.save();
    ctx.scale(dpr, dpr);

    /* Background */
    ctx.fillStyle = "#0a0e17";
    ctx.fillRect(0, 0, w, h);

    const xSpan = rState.view.xmax - rState.view.xmin;
    const ySpan = rState.view.ymax - rState.view.ymin;
    const xStep = niceStep((xSpan * 90) / Math.max(1, w));
    const yStep = niceStep((ySpan * 65) / Math.max(1, h));

    /* Minor grid */
    ctx.strokeStyle = "rgba(148, 163, 184, 0.04)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(rState.view.xmin / (xStep / 5)) * (xStep / 5); x <= rState.view.xmax; x += xStep / 5) {
      const sx = Math.round(xToScreen(x)) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    for (let y = Math.floor(rState.view.ymin / (yStep / 5)) * (yStep / 5); y <= rState.view.ymax; y += yStep / 5) {
      const sy = Math.round(yToScreen(y)) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();

    /* Major grid */
    ctx.strokeStyle = "rgba(148, 163, 184, 0.11)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(rState.view.xmin / xStep) * xStep; x <= rState.view.xmax; x += xStep) {
      const sx = Math.round(xToScreen(x)) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    for (let y = Math.floor(rState.view.ymin / yStep) * yStep; y <= rState.view.ymax; y += yStep) {
      const sy = Math.round(yToScreen(y)) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();

    /* Optional Prime Number / Riemann Zero vertical guides */
    if (rState.showMarkers && fn) {
      if (fn.show_primes && xSpan <= 115) {
        ctx.save();
        ctx.font = '10px "JetBrains Mono", monospace';
        const showLabels = xSpan <= 55;
        for (const p of SMALL_PRIMES) {
          if (p < rState.view.xmin || p > rState.view.xmax) continue;
          const sx = xToScreen(p);
          ctx.strokeStyle = "rgba(52, 211, 153, 0.13)";
          ctx.setLineDash([3, 4]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx, 0);
          ctx.lineTo(sx, h);
          ctx.stroke();
          if (showLabels) {
            ctx.fillStyle = "rgba(52, 211, 153, 0.7)";
            ctx.fillText(String(p), sx + 2, h - 38);
          }
        }
        ctx.restore();
      } else if (fn.show_zeros && rState.zeros.length > 0) {
        ctx.save();
        ctx.font = '10px "JetBrains Mono", monospace';
        for (let i = 0; i < rState.zeros.length; i++) {
          const g = rState.zeros[i];
          if (g < rState.view.xmin || g > rState.view.xmax) continue;
          const sx = xToScreen(g);
          ctx.strokeStyle = "rgba(251, 191, 36, 0.25)";
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(sx, 0);
          ctx.lineTo(sx, h);
          ctx.stroke();
          ctx.fillStyle = "rgba(251, 191, 36, 0.8)";
          ctx.fillText(`γ${i + 1}`, sx + 3, 56);
        }
        ctx.restore();
      }
    }

    /* Axes */
    const ox = xToScreen(0);
    const oy = yToScreen(0);
    ctx.strokeStyle = "rgba(203, 213, 225, 0.36)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    if (oy >= 0 && oy <= h) {
      ctx.moveTo(0, oy);
      ctx.lineTo(w, oy);
    }
    if (ox >= 0 && ox <= w) {
      ctx.moveTo(ox, 0);
      ctx.lineTo(ox, h);
    }
    ctx.stroke();

    /* Axis tick labels */
    ctx.fillStyle = "rgba(148, 163, 184, 0.7)";
    ctx.font = '10.5px "JetBrains Mono", monospace';
    const xLblY = Math.min(h - 14, Math.max(42, oy + 15));
    const yLblX = Math.min(w - 42, Math.max(10, ox + 6));
    for (let x = Math.floor(rState.view.xmin / xStep) * xStep; x <= rState.view.xmax; x += xStep) {
      const sx = xToScreen(x);
      if (sx > 24 && sx < w - 24) ctx.fillText(fmtTick(x), sx - 10, xLblY);
    }
    for (let y = Math.floor(rState.view.ymin / yStep) * yStep; y <= rState.view.ymax; y += yStep) {
      if (Math.abs(y) < yStep * 0.2) continue;
      const sy = yToScreen(y);
      if (sy > 42 && sy < h - 20) ctx.fillText(fmtTick(y), yLblX, sy + 3.5);
    }

    /* Draw cached curves */
    if (rState.cache && fn) {
      const { xs, exact, baseline, approx } = rState.cache;

      /* Optional shaded error band between exact and highest-K active curve */
      if (rState.showErrorFill && exact && approx && approx.length > 0) {
        const best = approx.reduce((a, b) => (b.k > a.k ? b : a), approx[0]);
        drawErrorFill(xs, exact, best.ys, colorForK(fn, best.k));
      }

      /* Baseline curve (e.g. Li(x)) */
      if (baseline) {
        drawPolyline(xs, baseline, SERIES_COLORS.baseline, 1.7, true, false, false);
      }

      /* Convergence family curves ordered low-K to high-K */
      if (approx && approx.length > 0) {
        const sorted = [...approx].sort((a, b) => a.k - b.k);
        for (const item of sorted) {
          const isLive = rState.showLiveK && item.k === rState.liveK;
          const color = isLive ? SERIES_COLORS.liveK : colorForK(fn, item.k);
          const isBest = item === sorted[sorted.length - 1];
          drawPolyline(xs, item.ys, color, isLive ? 2.6 : isBest ? 2.2 : 1.7, false, false, isLive || isBest);
        }
      }

      /* Exact reference curve (staircase or primary function) on top */
      if (exact) {
        /* Optional Definite Integral Shaded Area between gates [a, b] */
        if (rState.calc.showIntegral) {
          const lo = Math.min(rState.calc.a, rState.calc.b);
          const hi = Math.max(rState.calc.a, rState.calc.b);
          const zeroY = yToScreen(0);
          ctx.save();
          ctx.fillStyle = "rgba(52, 211, 153, 0.2)";
          ctx.beginPath();
          let started = false;
          let lastSx = 0;
          for (let i = 0; i < xs.length; i++) {
            if (xs[i] < lo || xs[i] > hi || exact[i] === null) continue;
            const sx = xToScreen(xs[i]);
            const sy = yToScreen(exact[i]);
            if (!started) {
              ctx.moveTo(sx, zeroY);
              ctx.lineTo(sx, sy);
              started = true;
            } else {
              ctx.lineTo(sx, sy);
            }
            lastSx = sx;
          }
          if (started) {
            ctx.lineTo(lastSx, zeroY);
            ctx.closePath();
            ctx.fill();
          }
          /* Draw draggable glowing gates a and b */
          for (const [label, gx] of [["a", rState.calc.a], ["b", rState.calc.b]]) {
            const sx = xToScreen(gx);
            ctx.strokeStyle = "#34d399";
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 3]);
            ctx.beginPath();
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, h);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#34d399";
            ctx.beginPath();
            ctx.roundRect(sx - 14, 48, 28, 20, 4);
            ctx.fill();
            ctx.fillStyle = "#061019";
            ctx.font = '700 11px "JetBrains Mono", monospace';
            ctx.fillText(label, sx - 3.5, 62);
          }
          ctx.restore();
        }

        drawPolyline(xs, exact, SERIES_COLORS.exact, fn.is_step_exact ? 2.2 : 2.5, false, fn.is_step_exact, true);
      }

      /* Optional Numerical Derivative f'(x) curve */
      if (rState.calc.showDeriv && rState.calc.derivXs && rState.calc.derivYs) {
        drawPolyline(rState.calc.derivXs, rState.calc.derivYs, "#fb7185", 1.8, false, false, false);
      }

      /* Optional Soloed Riemann Zero Harmonic Wave */
      if (rState.soloWave && rState.soloWave.xs && rState.soloWave.ys) {
        drawPolyline(rState.soloWave.xs, rState.soloWave.ys, "#fde047", 2.2, false, false, true);
      }

      /* Optional Live Tangent Line at hovered x */
      if (rState.calc.showTangent && rState.hoverX !== null && exact) {
        const y0 = sampleValueAtX(xs, exact, rState.hoverX);
        const hdx = Math.max(1e-3, (rState.view.xmax - rState.view.xmin) * 0.004);
        const yPlus = sampleValueAtX(xs, exact, rState.hoverX + hdx);
        const yMinus = sampleValueAtX(xs, exact, rState.hoverX - hdx);
        if (y0 !== null && yPlus !== null && yMinus !== null) {
          const slope = (yPlus - yMinus) / (2 * hdx);
          const span = (rState.view.xmax - rState.view.xmin) * 0.14;
          const p1 = { x: xToScreen(rState.hoverX - span), y: yToScreen(y0 - slope * span) };
          const p2 = { x: xToScreen(rState.hoverX + span), y: yToScreen(y0 + slope * span) };
          ctx.save();
          ctx.strokeStyle = "#fbbf24";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
          ctx.restore();
          const slopeEl = document.getElementById("calc-slope-val");
          if (slopeEl) slopeEl.textContent = slope.toFixed(5);
        }
      }

      /* Live hover vertical crosshair & curve intersection dots */
      if (rState.hoverX !== null && rState.hoverPx !== null) {
        const sx = rState.hoverPx;
        ctx.save();
        ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
        ctx.stroke();
        ctx.setLineDash([]);

        const dotAt = (ys, color) => {
          const val = sampleValueAtX(xs, ys, rState.hoverX);
          if (val === null || !Number.isFinite(val)) return;
          const sy = yToScreen(val);
          if (sy < -10 || sy > h + 10) return;
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sx, sy, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        };

        if (baseline) dotAt(baseline, SERIES_COLORS.baseline);
        if (approx) {
          for (const item of approx) {
            const isLive = rState.showLiveK && item.k === rState.liveK;
            dotAt(item.ys, isLive ? SERIES_COLORS.liveK : colorForK(fn, item.k));
          }
        }
        if (exact) dotAt(exact, SERIES_COLORS.exact);
        ctx.restore();
      }
    }

    ctx.restore();
  }

  /* -------------------------------------------------------------------------
   * Legend & Header Readouts
   * ------------------------------------------------------------------------- */

  function updateLegend() {
    const fn = curFn();
    if (!fn || !rState.active) return;

    const x = rState.hoverX;
    legendX.textContent = x !== null ? `x = ${x.toFixed(3)}` : "Hover graph";
    if (x !== null) {
      readoutZ.textContent = x.toFixed(4);
    }

    const rows = [];
    const c = rState.cache;

    let exactVal = null;
    if (rState.showExact) {
      exactVal = c && c.exact && x !== null ? sampleValueAtX(c.xs, c.exact, x) : null;
      rows.push({
        label: fn.has_approx ? `Exact ${fn.id === "pi_explicit" ? "π(x)" : fn.id === "J_explicit" ? "J(x)" : fn.id === "psi_explicit" ? "ψ(x)" : "f(x)"}` : fn.name,
        color: SERIES_COLORS.exact,
        val: exactVal,
      });
    }

    if (rState.showBaseline && fn.has_baseline) {
      const bVal = c && c.baseline && x !== null ? sampleValueAtX(c.xs, c.baseline, x) : null;
      rows.push({
        label: fn.baseline_label || "Baseline",
        color: SERIES_COLORS.baseline,
        val: bVal,
      });
    }

    if (c && c.approx) {
      const sorted = [...c.approx].sort((a, b) => a.k - b.k);
      for (const item of sorted) {
        const isLive = rState.showLiveK && item.k === rState.liveK;
        const val = x !== null ? sampleValueAtX(c.xs, item.ys, x) : null;
        rows.push({
          label: `${isLive ? "★ " : ""}K = ${item.k} ${fn.k_unit}`,
          color: isLive ? SERIES_COLORS.liveK : colorForK(fn, item.k),
          val,
        });
      }
    }

    legendRows.innerHTML = "";
    for (const r of rows) {
      const el = document.createElement("div");
      el.className = "real-legend-row";
      const valStr = r.val !== null && Number.isFinite(r.val) ? r.val.toFixed(4) : "—";
      el.innerHTML = `<span class="real-legend-name"><span class="real-legend-swatch" style="background:${r.color}"></span>${r.label}</span><span class="real-legend-val">${valStr}</span>`;
      legendRows.appendChild(el);
    }

    /* Update header readout strip */
    if (x !== null) {
      if (exactVal !== null && Number.isFinite(exactVal)) {
        readoutW.textContent = exactVal.toFixed(4);
      } else {
        readoutW.textContent = "—";
      }
      if (c && c.approx && c.approx.length > 0 && exactVal !== null) {
        const best = c.approx.reduce((a, b) => (b.k > a.k ? b : a), c.approx[0]);
        const bVal = sampleValueAtX(c.xs, best.ys, x);
        if (bVal !== null && Number.isFinite(bVal)) {
          readoutMag.textContent = `±${Math.abs(bVal - exactVal).toFixed(4)}`;
        }
      } else {
        readoutMag.textContent = "—";
      }
    }
  }

  /* -------------------------------------------------------------------------
   * Toolbar & Function Switching
   * ------------------------------------------------------------------------- */

  function renderToolbar() {
    const fn = curFn();
    if (!fn) return;

    seriesToggles.innerHTML = "";

    /* Exact pill */
    const makePill = (label, color, isActive, onClick) => {
      const btn = document.createElement("button");
      btn.className = "series-pill" + (isActive ? " active" : "");
      btn.style.setProperty("--pill-color", color);
      btn.innerHTML = `<span class="series-pill-dot"></span><span>${label}</span>`;
      btn.addEventListener("click", onClick);
      seriesToggles.appendChild(btn);
    };

    const exactLbl =
      fn.id === "pi_explicit"
        ? "Exact π(x)"
        : fn.id === "J_explicit"
        ? "Exact J(x)"
        : fn.id === "psi_explicit"
        ? "Exact ψ(x)"
        : "Exact f(x)";

    makePill(exactLbl, SERIES_COLORS.exact, rState.showExact, () => {
      rState.showExact = !rState.showExact;
      renderToolbar();
      scheduleSample(true);
    });

    if (fn.has_baseline) {
      makePill(fn.baseline_label || "Baseline", SERIES_COLORS.baseline, rState.showBaseline, () => {
        rState.showBaseline = !rState.showBaseline;
        renderToolbar();
        scheduleSample(true);
      });
    }

    if (fn.has_approx) {
      for (let i = 0; i < fn.default_ks.length; i++) {
        const k = fn.default_ks[i];
        const col = SERIES_COLORS.k[i % SERIES_COLORS.k.length];
        const lbl = k === 0 ? "K=0 (R(x))" : `K=${k}`;
        makePill(lbl, col, rState.activeKs.has(k), () => {
          if (rState.activeKs.has(k)) rState.activeKs.delete(k);
          else rState.activeKs.add(k);
          renderToolbar();
          scheduleSample(true);
        });
      }

      sliderDivider.classList.remove("hidden");
      sliderGroup.classList.remove("hidden");
      kSlider.max = String(fn.max_k);
      if (rState.liveK > fn.max_k) rState.liveK = fn.max_k;
      kSlider.value = String(rState.liveK);
      kReadout.textContent = `K = ${rState.liveK} ${fn.k_unit}`;
      btnLiveK.classList.toggle("active", rState.showLiveK);
    } else {
      sliderDivider.classList.add("hidden");
      sliderGroup.classList.add("hidden");
    }

    btnErrFill.classList.toggle("hidden", !fn.has_approx);
    btnMarkers.classList.toggle("hidden", !fn.show_primes && !fn.show_zeros);
  }

  function renderPresets() {
    const fn = curFn();
    presetsList.innerHTML = "";
    for (const p of getRealPresets(fn)) {
      const b = document.createElement("button");
      b.className = "preset-btn";
      b.textContent = p.name;
      b.addEventListener("click", () => p.run());
      presetsList.appendChild(b);
    }
  }

  function syncMeta() {
    const fn = curFn();
    if (!fn || !rState.active) return;
    fnFormula.textContent = `y = ${fn.formula}`;
    planeSub.textContent = fn.formula;
    statusNote.textContent = fn.has_approx
      ? `Explicit convergence up to K = ${fn.max_k} ${fn.k_unit} · Parallel C11 engine`
      : `Real-valued C11 function · Pan & scroll to explore`;
    if (window.LabController) window.LabController.onRealFunctionChange();
  }

  function selectFunction(idx) {
    stopAnim();
    rState.fnIndex = idx;
    const fn = curFn();
    if (!fn) return;
    rState.view = { ...fn.view };
    rState.showExact = true;
    rState.showBaseline = fn.has_baseline;
    rState.activeKs = new Set(fn.default_ks.filter((k) => k > 0 || fn.default_ks.length <= 3));
    if (fn.id === "pi_explicit") {
      rState.activeKs = new Set([5, 20, 50, 150]);
    }
    rState.showLiveK = false;
    rState.liveK = Math.min(25, fn.max_k || 25);
    syncMeta();
    renderToolbar();
    renderPresets();
    scheduleSample(true);
  }

  function autoFitY() {
    if (!rState.cache) return;
    let ymin = Infinity;
    let ymax = -Infinity;
    const scan = (arr) => {
      if (!arr) return;
      for (const v of arr) {
        if (v !== null && Number.isFinite(v) && Math.abs(v) < 1e6) {
          if (v < ymin) ymin = v;
          if (v > ymax) ymax = v;
        }
      }
    };
    scan(rState.cache.exact);
    scan(rState.cache.baseline);
    if (rState.cache.approx) {
      for (const a of rState.cache.approx) scan(a.ys);
    }
    if (!Number.isFinite(ymin) || !Number.isFinite(ymax)) return;
    const pad = Math.max(0.4, (ymax - ymin) * 0.12);
    rState.view.ymin = ymin - pad;
    rState.view.ymax = ymax + pad;
    requestRender();
  }

  /* -------------------------------------------------------------------------
   * Live K Sweep Animation
   * ------------------------------------------------------------------------- */

  function stopAnim() {
    rState.animating = false;
    if (rState.animRaf) cancelAnimationFrame(rState.animRaf);
    rState.animRaf = null;
    btnAnimate.classList.remove("playing");
    labelPlay.textContent = "Animate K";
    iconPlay.innerHTML = '<polygon points="6,4 20,12 6,20" />';
  }

  function startAnim() {
    const fn = curFn();
    if (!fn || !fn.has_approx) return;
    rState.showLiveK = true;
    btnLiveK.classList.add("active");
    rState.animating = true;
    rState.animLastTs = 0;
    rState.animAccum = 0;
    btnAnimate.classList.add("playing");
    labelPlay.textContent = "Pause";
    iconPlay.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';

    const tick = (ts) => {
      if (!rState.animating || !rState.active) return;
      if (rState.animLastTs > 0) {
        const dt = (ts - rState.animLastTs) / 1000;
        rState.animAccum += dt;
        /* Adaptive step: slow & mesmerizing for small K (0..25), brisker up to 200 */
        const interval = rState.liveK < 20 ? 0.16 : 0.09;
        if (rState.animAccum >= interval) {
          rState.animAccum = 0;
          const inc = rState.liveK < 15 ? 1 : rState.liveK < 60 ? 3 : 6;
          rState.liveK += inc;
          if (rState.liveK > fn.max_k) rState.liveK = 0;
          kSlider.value = String(rState.liveK);
          kReadout.textContent = `K = ${rState.liveK} ${fn.k_unit}`;
          fetchSamples();
        }
      }
      rState.animLastTs = ts;
      rState.animRaf = requestAnimationFrame(tick);
    };
    fetchSamples();
    rState.animRaf = requestAnimationFrame(tick);
  }

  /* -------------------------------------------------------------------------
   * Pointer Pan / Zoom & Controls
   * ------------------------------------------------------------------------- */

  function localPos(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const pos = localPos(e);
    if (rState.calc.showIntegral) {
      const sax = xToScreen(rState.calc.a);
      const sbx = xToScreen(rState.calc.b);
      if (Math.abs(pos.x - sax) <= 12) {
        rState.calc.draggingGate = "a";
        return;
      }
      if (Math.abs(pos.x - sbx) <= 12) {
        rState.calc.draggingGate = "b";
        return;
      }
    }
    rState.pan = {
      startX: pos.x,
      startY: pos.y,
      origView: { ...rState.view },
    };
    card.classList.add("panning");
  });

  canvas.addEventListener("pointermove", (e) => {
    const pos = localPos(e);
    if (rState.calc.draggingGate) {
      const wx = screenToX(pos.x);
      rState.calc[rState.calc.draggingGate] = wx;
      if (window.LabController) window.LabController.onIntegralGatesDragged(rState.calc.a, rState.calc.b);
      requestRender();
      return;
    }
    if (rState.pan) {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const ov = rState.pan.origView;
      const dxWorld = ((pos.x - rState.pan.startX) / w) * (ov.xmax - ov.xmin);
      const dyWorld = ((pos.y - rState.pan.startY) / h) * (ov.ymax - ov.ymin);
      rState.view.xmin = ov.xmin - dxWorld;
      rState.view.xmax = ov.xmax - dxWorld;
      rState.view.ymin = ov.ymin + dyWorld;
      rState.view.ymax = ov.ymax + dyWorld;
      requestRender();
      scheduleSample(false);
      return;
    }

    rState.hoverPx = pos.x;
    rState.hoverX = screenToX(pos.x);
    updateLegend();
    requestRender();
  });

  canvas.addEventListener("pointerup", () => {
    if (rState.calc.draggingGate) {
      rState.calc.draggingGate = null;
      if (window.LabController) window.LabController.refreshCalculus(true);
      return;
    }
    if (rState.pan) {
      rState.pan = null;
      card.classList.remove("panning");
      scheduleSample(true);
    }
  });

  canvas.addEventListener("pointerleave", () => {
    rState.hoverX = null;
    rState.hoverPx = null;
    updateLegend();
    requestRender();
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const pos = localPos(e);
      const factor = e.deltaY < 0 ? 1 / 1.16 : 1.16;
      const wx = screenToX(pos.x);
      const wy = screenToY(pos.y);

      if (!e.altKey) {
        rState.view.xmin = wx + (rState.view.xmin - wx) * factor;
        rState.view.xmax = wx + (rState.view.xmax - wx) * factor;
      }
      if (!e.shiftKey) {
        rState.view.ymin = wy + (rState.view.ymin - wy) * factor;
        rState.view.ymax = wy + (rState.view.ymax - wy) * factor;
      }
      requestRender();
      scheduleSample(false);
    },
    { passive: false }
  );

  fnSelect.addEventListener("change", () => {
    selectFunction(Number(fnSelect.value));
  });

  btnLiveK.addEventListener("click", () => {
    rState.showLiveK = !rState.showLiveK;
    if (!rState.showLiveK) stopAnim();
    btnLiveK.classList.toggle("active", rState.showLiveK);
    scheduleSample(true);
  });

  kSlider.addEventListener("input", () => {
    stopAnim();
    rState.liveK = Number(kSlider.value);
    if (!rState.showLiveK) {
      rState.showLiveK = true;
      btnLiveK.classList.add("active");
    }
    const fn = curFn();
    kReadout.textContent = `K = ${rState.liveK} ${fn ? fn.k_unit : ""}`;
    scheduleSample(false);
  });

  btnAnimate.addEventListener("click", () => {
    if (rState.animating) stopAnim();
    else startAnim();
  });

  btnErrFill.addEventListener("click", () => {
    rState.showErrorFill = !rState.showErrorFill;
    btnErrFill.classList.toggle("active", rState.showErrorFill);
    requestRender();
  });

  btnMarkers.addEventListener("click", () => {
    rState.showMarkers = !rState.showMarkers;
    btnMarkers.classList.toggle("active", rState.showMarkers);
    requestRender();
  });

  document.getElementById("real-autofit-y").addEventListener("click", autoFitY);
  document.getElementById("real-zoom-in").addEventListener("click", () => {
    const cx = 0.5 * (rState.view.xmin + rState.view.xmax);
    const cy = 0.5 * (rState.view.ymin + rState.view.ymax);
    const hw = 0.5 * (rState.view.xmax - rState.view.xmin) / 1.3;
    const hh = 0.5 * (rState.view.ymax - rState.view.ymin) / 1.3;
    rState.view = { xmin: cx - hw, xmax: cx + hw, ymin: cy - hh, ymax: cy + hh };
    scheduleSample(true);
  });
  document.getElementById("real-zoom-out").addEventListener("click", () => {
    const cx = 0.5 * (rState.view.xmin + rState.view.xmax);
    const cy = 0.5 * (rState.view.ymin + rState.view.ymax);
    const hw = 0.5 * (rState.view.xmax - rState.view.xmin) * 1.3;
    const hh = 0.5 * (rState.view.ymax - rState.view.ymin) * 1.3;
    rState.view = { xmin: cx - hw, xmax: cx + hw, ymin: cy - hh, ymax: cy + hh };
    scheduleSample(true);
  });
  document.getElementById("real-reset").addEventListener("click", () => {
    const fn = curFn();
    if (fn) {
      rState.view = { ...fn.view };
      scheduleSample(true);
    }
  });

  window.addEventListener("resize", () => {
    if (rState.active) resize();
  });

  /* -------------------------------------------------------------------------
   * Public Controller API for app.js
   * ------------------------------------------------------------------------- */

  window.Real2DController = {
    state: rState,
    canvas,
    resize,
    requestRender,
    scheduleSample,
    curFn,
    async activateLiveCustomFn() {
      let opt = fnSelect.querySelector('option[value="-1"]');
      if (!opt) {
        opt = document.createElement("option");
        opt.value = "-1";
        opt.textContent = "★ Live C Real Function";
        fnSelect.insertBefore(opt, fnSelect.firstChild);
      }
      fnSelect.value = "-1";
      selectFunction(-1);
    },
    async activate() {
      rState.active = true;
      if (!rState.initialized) {
        const res = await fetch("/api/real/functions");
        const data = await res.json();
        rState.functions = data.functions || [];
        rState.zeros = data.zeros || [];
        fnSelect.innerHTML = "";
        rState.functions.forEach((f, idx) => {
          const opt = document.createElement("option");
          opt.value = String(idx);
          opt.textContent = f.name;
          fnSelect.appendChild(opt);
        });
        rState.initialized = true;
        resize();
        selectFunction(0);
      } else {
        resize();
        syncMeta();
        renderToolbar();
        renderPresets();
        scheduleSample(true);
      }
    },
    deactivate() {
      stopAnim();
      rState.active = false;
    },
  };
})();
