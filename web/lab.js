(() => {
  "use strict";

  /*
   * Organized Slide-Over Drawers Controller:
   *  - Live C Code Editor & Clang Hot-Compiler (Complex & Real)
   *  - Complex Analysis Lab (Zero Hunter, Taylor Series & Disk, Dirichlet S_N & Homotopy)
   *  - 2D Real Analysis Lab (Prime Harmonics & Web Audio Synth, Calculus Toolkit)
   *  - High-Res 2x PNG Exporter & Shareable Bookmark URLs
   */

  const drawerEditor = document.getElementById("drawer-editor");
  const drawerLab = document.getElementById("drawer-lab");
  const exportPopover = document.getElementById("export-popover");
  const btnOpenEditor = document.getElementById("btn-open-editor");
  const btnOpenLab = document.getElementById("btn-open-lab");
  const btnOpenExport = document.getElementById("btn-open-export");
  const labActiveDot = document.getElementById("lab-active-dot");

  /* Editor refs */
  const editorSig = document.getElementById("editor-sig");
  const editorTextarea = document.getElementById("editor-textarea");
  const editorSnippets = document.getElementById("editor-snippets");
  const editorStatus = document.getElementById("editor-status");
  const editorCheatsheet = document.getElementById("editor-cheatsheet");
  const editorKindBadge = document.getElementById("editor-kind-badge");
  const editorDesc = document.getElementById("editor-desc");
  const editorTokenWrap = document.getElementById("editor-token-wrap");
  const editorTokenInput = document.getElementById("editor-token-input");
  const editorActions = document.getElementById("editor-actions");
  const btnCompileRun = document.getElementById("btn-compile-run");

  const serverCfg = { compile_enabled: true, compile_requires_token: false };
  fetch("/api/config")
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg) => {
      if (!cfg) return;
      serverCfg.compile_enabled = Boolean(cfg.compile_enabled);
      serverCfg.compile_requires_token = Boolean(cfg.compile_requires_token);
      if (!serverCfg.compile_enabled) {
        editorKindBadge.textContent = "Public Safe Mode · Read-Only";
        editorDesc.textContent =
          "Live C compilation is disabled on this public deployment to keep the server secure. Viewing built-in C11 source.";
        editorTextarea.readOnly = true;
        editorActions.classList.add("hidden");
      } else if (serverCfg.compile_requires_token) {
        editorKindBadge.textContent = "clang -O2 · Token-Protected";
        editorTokenWrap.classList.remove("hidden");
        const saved = sessionStorage.getItem("cfv_compile_token");
        if (saved) editorTokenInput.value = saved;
      }
    })
    .catch(() => {});

  /* Lab refs */
  const labHeading = document.getElementById("lab-heading");
  const complexLabTabs = document.getElementById("complex-lab-tabs");
  const realLabTabs = document.getElementById("real-lab-tabs");
  const zerosSummary = document.getElementById("zeros-summary");
  const zerosList = document.getElementById("zeros-list");
  const taylorEnable = document.getElementById("taylor-enable");
  const taylorX0 = document.getElementById("taylor-x0");
  const taylorY0 = document.getElementById("taylor-y0");
  const taylorDeg = document.getElementById("taylor-deg");
  const taylorDegVal = document.getElementById("taylor-deg-val");
  const taylorRadius = document.getElementById("taylor-radius");
  const taylorCoeffs = document.getElementById("taylor-coeffs");
  const btnTaylorPick = document.getElementById("btn-taylor-pick");

  const morphSlider = document.getElementById("morph-slider");
  const morphVal = document.getElementById("morph-val");
  const btnMorphAnim = document.getElementById("btn-morph-anim");
  const dirichletEnable = document.getElementById("dirichlet-enable");
  const dirichletN = document.getElementById("dirichlet-n");
  const dirichletNVal = document.getElementById("dirichlet-n-val");
  const btnDirichletDemo = document.getElementById("btn-dirichlet-demo");

  /* Real Lab refs */
  const harmonicsList = document.getElementById("harmonics-list");
  const btnAudioPlay = document.getElementById("btn-audio-play");
  const audioVoices = document.getElementById("audio-voices");
  const audioVoicesVal = document.getElementById("audio-voices-val");
  const audioVol = document.getElementById("audio-vol");
  const audioVolVal = document.getElementById("audio-vol-val");

  const calcDerivToggle = document.getElementById("calc-deriv-toggle");
  const calcTangentToggle = document.getElementById("calc-tangent-toggle");
  const calcIntToggle = document.getElementById("calc-int-toggle");
  const calcA = document.getElementById("calc-a");
  const calcB = document.getElementById("calc-b");
  const calcIntVal = document.getElementById("calc-int-val");
  const calcSlopeVal = document.getElementById("calc-slope-val");

  const COMPLEX_SNIPPETS = [
    {
      label: "Active Fn",
      code: () => {
        const app = window.ComplexApp;
        const f = app.state.functions[app.state.fnIndex];
        return f && f.c_source ? extractBody(f.c_source) : "    return c_zeta(z);";
      },
    },
    { label: "z³ − 1", code: () => "    return z * z * z - 1.0;" },
    { label: "ζ(z) · sin(z)", code: () => "    return c_zeta(z) * csin(z);" },
    { label: "e^z / (z² + 1)", code: () => "    return cexp(z) / (z * z + 1.0);" },
  ];

  const REAL_SNIPPETS = [
    {
      label: "Active Fn",
      code: () => {
        const f = window.Real2DController.curFn();
        return f && f.c_source ? extractBody(f.c_source) : "    return sin(x);";
      },
    },
    { label: "sin(x)/x", code: () => "    return fabs(x) < 1e-8 ? 1.0 : sin(x) / x;" },
    { label: "Z(x) Wave", code: () => "    return c_hardy_z(x);" },
    { label: "x² − 3cos(2x)", code: () => "    return 0.1 * x * x - 3.0 * cos(2.0 * x);" },
  ];

  function extractBody(cSource) {
    const start = cSource.indexOf("{");
    const end = cSource.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return cSource.slice(start + 1, end).replace(/^\n+|\n+$/g, "");
    }
    return cSource;
  }

  function resizeActiveCanvases() {
    requestAnimationFrame(() => {
      if (window.ComplexApp) window.ComplexApp.resizeCanvases();
      if (window.Real2DController && window.Real2DController.state.active) {
        window.Real2DController.resize();
      }
    });
  }

  /* -------------------------------------------------------------------------
   * Single-Drawer Management (Zero Clutter!)
   * ------------------------------------------------------------------------- */

  function closeDrawers() {
    drawerEditor.classList.add("hidden");
    drawerLab.classList.add("hidden");
    exportPopover.classList.add("hidden");
    btnOpenEditor.classList.remove("active");
    btnOpenLab.classList.remove("active");
    btnOpenExport.classList.remove("active");
    resizeActiveCanvases();
  }

  function openDrawer(which) {
    const wasOpen =
      (which === "editor" && !drawerEditor.classList.contains("hidden")) ||
      (which === "lab" && !drawerLab.classList.contains("hidden")) ||
      (which === "export" && !exportPopover.classList.contains("hidden"));
    closeDrawers();
    if (wasOpen) return;

    if (which === "editor") {
      syncEditorForDimension();
      drawerEditor.classList.remove("hidden");
      btnOpenEditor.classList.add("active");
    } else if (which === "lab") {
      syncLabForDimension();
      drawerLab.classList.remove("hidden");
      btnOpenLab.classList.add("active");
    } else if (which === "export") {
      exportPopover.classList.remove("hidden");
      btnOpenExport.classList.add("active");
      return;
    }
    resizeActiveCanvases();
  }

  function updateLabDot() {
    const app = window.ComplexApp;
    const real = window.Real2DController;
    const active =
      (app &&
        (app.state.lab.foundZeros.length > 0 ||
          app.state.lab.taylor.enabled ||
          app.state.lab.dirichlet.enabled ||
          app.state.lab.morphT < 0.99)) ||
      (real &&
        (real.state.calc.showDeriv ||
          real.state.calc.showTangent ||
          real.state.calc.showIntegral ||
          real.state.soloWave !== null ||
          audioPlaying));
    labActiveDot.classList.toggle("hidden", !active);
  }

  btnOpenEditor.addEventListener("click", () => openDrawer("editor"));
  btnOpenLab.addEventListener("click", () => openDrawer("lab"));
  btnOpenExport.addEventListener("click", () => openDrawer("export"));
  document.querySelectorAll("[data-close-drawer]").forEach((b) => b.addEventListener("click", closeDrawers));

  /* -------------------------------------------------------------------------
   * Drawer 1: Live C Compiler (clang -O2 -shared -fPIC + dlopen)
   * ------------------------------------------------------------------------- */

  function isRealDim() {
    return window.ComplexApp && window.ComplexApp.state.dim === "real";
  }

  function syncEditorForDimension() {
    const real = isRealDim();
    editorSig.textContent = real
      ? "double user_real_fn(double x) {"
      : "double complex user_fn(double complex z) {";
    editorCheatsheet.textContent = real
      ? "real_pi_exact(x), real_pi_explicit(x, K), real_li(x), real_J_explicit(x, K), c_hardy_z(x), creal(c_xi(c_make(x, 0))), sin, cos, exp, log, pow"
      : "c_zeta(z), c_xi(z), c_gamma(z), c_lgamma(z), c_ei(z), c_eta(z), c_zeta_deriv(z), c_make(re, im), cexp, clog, csin, ccos, cpow, csqrt";

    const list = real ? REAL_SNIPPETS : COMPLEX_SNIPPETS;
    editorSnippets.innerHTML = "";
    for (const sn of list) {
      const b = document.createElement("button");
      b.className = "snippet-btn";
      b.textContent = sn.label;
      b.addEventListener("click", () => {
        editorTextarea.value = sn.code();
        editorTextarea.focus();
      });
      editorSnippets.appendChild(b);
    }

    /* Populate with active function source when editor is empty or switched dimension */
    if (!editorTextarea.dataset.dim || editorTextarea.dataset.dim !== (real ? "real" : "complex")) {
      editorTextarea.value = list[0].code();
      editorTextarea.dataset.dim = real ? "real" : "complex";
      editorStatus.classList.add("hidden");
    }
  }

  editorTextarea.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const s = editorTextarea.selectionStart;
      const end = editorTextarea.selectionEnd;
      editorTextarea.value = editorTextarea.value.slice(0, s) + "    " + editorTextarea.value.slice(end);
      editorTextarea.selectionStart = editorTextarea.selectionEnd = s + 4;
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      compileLiveC();
    }
  });

  async function compileLiveC() {
    if (!serverCfg.compile_enabled) return;
    const real = isRealDim();
    const code = editorTextarea.value;
    btnCompileRun.disabled = true;
    btnCompileRun.textContent = "Compiling with clang…";

    const headers = { "Content-Type": "application/json" };
    if (serverCfg.compile_requires_token) {
      const tok = editorTokenInput.value.trim();
      if (tok) {
        sessionStorage.setItem("cfv_compile_token", tok);
        headers["X-Compile-Token"] = tok;
      }
    }

    try {
      const res = await fetch("/api/compile", {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: real ? "real" : "complex", code }),
      });
      const data = await res.json();
      editorStatus.classList.remove("hidden", "ok", "err");
      if (data.ok) {
        editorStatus.classList.add("ok");
        editorStatus.textContent = `✓ Compiled natively in ${data.elapsed_ms.toFixed(1)} ms · Active via dlopen()`;
        if (real) {
          await window.Real2DController.activateLiveCustomFn();
        } else {
          await window.ComplexApp.activateLiveCustomFn();
        }
      } else {
        editorStatus.classList.add("err");
        editorStatus.textContent = data.diagnostics || "Compilation failed.";
      }
    } finally {
      btnCompileRun.disabled = false;
      btnCompileRun.textContent = "Compile & Run with Clang";
    }
  }

  btnCompileRun.addEventListener("click", compileLiveC);

  /* -------------------------------------------------------------------------
   * Drawer 2: Contextual Analysis Lab Tabs
   * ------------------------------------------------------------------------- */

  function activateLabTab(tabName) {
    document.querySelectorAll(".drawer-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.labTab === tabName);
    });
    document.querySelectorAll(".lab-pane").forEach((p) => {
      p.classList.toggle("hidden", p.dataset.labPane !== tabName);
    });
    if (tabName === "harmonics" && isRealDim()) {
      refreshHarmonicsList();
    }
  }

  document.querySelectorAll(".drawer-tab").forEach((t) => {
    t.addEventListener("click", () => activateLabTab(t.dataset.labTab));
  });

  function syncLabForDimension() {
    const real = isRealDim();
    labHeading.textContent = real ? "2D Real Analysis Lab" : "Complex Analysis Lab";
    complexLabTabs.classList.toggle("hidden", real);
    realLabTabs.classList.toggle("hidden", !real);
    activateLabTab(real ? "harmonics" : "zeros");
  }

  /* ---- Complex Lab 1: Zero Hunter ---- */

  async function runZeroHunt(useSelectedShape) {
    const app = window.ComplexApp;
    const st = app.state;
    const payload = { fn: st.fnIndex };

    if (useSelectedShape) {
      const target =
        st.shapes.find((s) => s.id === st.selectedShapeId && s.closed) ||
        [...st.shapes].reverse().find((s) => s.closed);
      if (!target) {
        zerosSummary.textContent = "Draw or select a closed shape first (or use Hunt Viewport).";
        return;
      }
      const flat = [];
      for (const p of target.rawPts) flat.push(p.x, p.y);
      payload.points = flat;
    } else {
      const hw = (app.canvasIn.clientWidth * 0.5) / st.inView.scale;
      const hh = (app.canvasIn.clientHeight * 0.5) / st.inView.scale;
      payload.xmin = st.inView.cx - hw;
      payload.xmax = st.inView.cx + hw;
      payload.ymin = st.inView.cy - hh;
      payload.ymax = st.inView.cy + hh;
    }

    zerosSummary.textContent = "Hunting zeros in C…";
    const res = await fetch("/api/find_zeros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    const zeros = data.zeros || [];
    st.lab.foundZeros = zeros;
    zerosSummary.textContent =
      zeros.length > 0
        ? `Found ${zeros.length} zero${zeros.length === 1 ? "" : "s"} (click any row to center)`
        : "No zeros found in that region.";

    zerosList.innerHTML = "";
    zeros.forEach((z, idx) => {
      const row = document.createElement("button");
      row.className = "zero-item";
      const sign = z.y >= 0 ? "+" : "−";
      row.innerHTML = `<span>Z${idx + 1}: ${z.x.toFixed(6)} ${sign} ${Math.abs(z.y).toFixed(6)}i</span><span class="zero-res">|f|=${z.res.toExponential(1)}</span>`;
      row.addEventListener("click", () => {
        app.setInputView(z.x, z.y, 2.5);
      });
      zerosList.appendChild(row);
    });
    updateLabDot();
    app.requestRender();
  }

  document.getElementById("btn-hunt-shape").addEventListener("click", () => runZeroHunt(true));
  document.getElementById("btn-hunt-view").addEventListener("click", () => runZeroHunt(false));
  document.getElementById("btn-hunt-clear").addEventListener("click", () => {
    window.ComplexApp.state.lab.foundZeros = [];
    zerosList.innerHTML = "";
    zerosSummary.textContent = "Pins cleared.";
    updateLabDot();
    window.ComplexApp.requestRender();
  });

  /* ---- Complex Lab 2: Taylor Series & Disk of Convergence ---- */

  let taylorTimer = null;

  async function fetchTaylor() {
    const app = window.ComplexApp;
    const tay = app.state.lab.taylor;
    if (!tay.enabled) return;

    const res = await fetch("/api/taylor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fn: app.state.fnIndex,
        x0: tay.x0,
        y0: tay.y0,
        degree: tay.degree,
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.valid) {
      taylorRadius.textContent = "Singularity at z₀!";
      taylorCoeffs.textContent = "Move z₀ away from pole.";
      tay.coeffs = [];
      app.requestRender();
      return;
    }
    tay.radius = data.radius;
    tay.coeffs = data.coeffs || [];
    taylorRadius.textContent = data.radius >= 99 ? "∞ (entire)" : data.radius.toFixed(5);

    taylorCoeffs.innerHTML = "";
    const showN = Math.min(6, Math.floor(tay.coeffs.length / 2));
    for (let k = 0; k < showN; k++) {
      const re = tay.coeffs[2 * k];
      const im = tay.coeffs[2 * k + 1];
      const sign = im >= 0 ? "+" : "−";
      const row = document.createElement("div");
      row.className = "coeff-row";
      row.innerHTML = `<span>a<sub>${k}</sub></span><span>${re.toFixed(4)} ${sign} ${Math.abs(im).toFixed(4)}i</span>`;
      taylorCoeffs.appendChild(row);
    }
    app.requestRender();
  }

  taylorEnable.addEventListener("change", () => {
    const tay = window.ComplexApp.state.lab.taylor;
    tay.enabled = taylorEnable.checked;
    if (tay.enabled) fetchTaylor();
    else window.ComplexApp.requestRender();
    updateLabDot();
  });

  function syncTaylorInputs() {
    const tay = window.ComplexApp.state.lab.taylor;
    tay.x0 = parseFloat(taylorX0.value) || 0;
    tay.y0 = parseFloat(taylorY0.value) || 0;
    tay.degree = parseInt(taylorDeg.value, 10) || 8;
    taylorDegVal.textContent = String(tay.degree);
    if (tay.enabled) fetchTaylor();
  }

  taylorX0.addEventListener("change", syncTaylorInputs);
  taylorY0.addEventListener("change", syncTaylorInputs);
  taylorDeg.addEventListener("input", () => {
    taylorDegVal.textContent = taylorDeg.value;
    window.ComplexApp.state.lab.taylor.degree = parseInt(taylorDeg.value, 10);
    if (window.ComplexApp.state.lab.taylor.enabled) {
      if (taylorTimer) clearTimeout(taylorTimer);
      taylorTimer = setTimeout(fetchTaylor, 40);
    }
  });

  btnTaylorPick.addEventListener("click", () => {
    const tay = window.ComplexApp.state.lab.taylor;
    tay.enabled = true;
    taylorEnable.checked = true;
    tay.picking = true;
    btnTaylorPick.textContent = "Now click anywhere on Input Plane…";
    updateLabDot();
  });

  /* ---- Complex Lab 3: Homotopy Morph & Dirichlet Partial Sums ---- */

  let morphRaf = null;

  morphSlider.addEventListener("input", () => {
    const t = parseInt(morphSlider.value, 10) / 100;
    window.ComplexApp.state.lab.morphT = t;
    morphVal.textContent = t.toFixed(2);
    updateLabDot();
    window.ComplexApp.requestRender();
  });

  btnMorphAnim.addEventListener("click", () => {
    if (morphRaf) {
      cancelAnimationFrame(morphRaf);
      morphRaf = null;
      btnMorphAnim.textContent = "Animate Identity → f(z)";
      return;
    }
    btnMorphAnim.textContent = "Stop Morph";
    let t0 = performance.now();
    const step = (ts) => {
      const phase = ((ts - t0) / 3600) % 2.0;
      const t = phase <= 1.0 ? phase : 2.0 - phase;
      window.ComplexApp.state.lab.morphT = t;
      morphSlider.value = String(Math.round(t * 100));
      morphVal.textContent = t.toFixed(2);
      window.ComplexApp.requestRender();
      morphRaf = requestAnimationFrame(step);
    };
    morphRaf = requestAnimationFrame(step);
  });

  let dirTimer = null;
  dirichletEnable.addEventListener("change", () => {
    window.ComplexApp.state.lab.dirichlet.enabled = dirichletEnable.checked;
    updateLabDot();
    window.ComplexApp.refreshDirichletOverlays();
  });

  dirichletN.addEventListener("input", () => {
    const n = parseInt(dirichletN.value, 10);
    dirichletNVal.textContent = String(n);
    window.ComplexApp.state.lab.dirichlet.n = n;
    if (window.ComplexApp.state.lab.dirichlet.enabled) {
      if (dirTimer) clearTimeout(dirTimer);
      dirTimer = setTimeout(() => window.ComplexApp.refreshDirichletOverlays(), 45);
    }
  });

  btnDirichletDemo.addEventListener("click", async () => {
    const app = window.ComplexApp;
    app.selectFunctionById("zeta");
    if (app.state.mode !== "map") await app.setMode("map", false);
    app.clearShapes();
    app.setInputView(1.0, 4.0, 5.0);
    app.setOutputView(1.0, 0.0, 4.5);
    dirichletEnable.checked = true;
    app.state.lab.dirichlet.enabled = true;
    await app.commitShape({
      kind: "rect",
      label: "Box crossing Re(s)=1 wall",
      rawPts: app.makeRectPoints(0.4, 1.5, 2.2, 6.0),
      closed: true,
      color: "#38bdf8",
      autoColor: false,
    });
    updateLabDot();
    await app.refreshDirichletOverlays();
  });

  /* -------------------------------------------------------------------------
   * 2D Real Lab 1: Prime Harmonics & Web Audio Synthesizer
   * ------------------------------------------------------------------------- */

  let audioCtx = null;
  let audioGain = null;
  let audioOscs = [];
  let audioPlaying = false;

  const FIRST_GAMMAS = [
    14.1347, 21.0220, 25.0109, 30.4249, 32.9351, 37.5862, 40.9187, 43.3271,
    48.0052, 49.7738, 52.9703, 56.4462, 59.3470, 60.8318, 65.1125, 67.0798,
    69.5464, 72.0672, 75.7047, 77.1448, 79.3374, 82.9104, 84.7355, 87.4253,
  ];

  function stopPrimeAudio() {
    for (const o of audioOscs) {
      try { o.stop(); } catch (_) {}
    }
    audioOscs = [];
    audioPlaying = false;
    btnAudioPlay.textContent = "Play Music of the Primes";
    btnAudioPlay.classList.remove("playing");
    updateLabDot();
  }

  function startPrimeAudio() {
    stopPrimeAudio();
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    if (!audioCtx) audioCtx = new AudioCtor();
    if (audioCtx.state === "suspended") audioCtx.resume();

    const master = audioCtx.createGain();
    const vol = (parseInt(audioVol.value, 10) / 100) * 0.28;
    master.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    master.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), audioCtx.currentTime + 0.35);
    master.connect(audioCtx.destination);
    audioGain = master;

    const count = parseInt(audioVoices.value, 10);
    /* Scale gamma_1 = 14.1347 -> ~180 Hz warm drone; higher zeros scale proportionally */
    const baseScale = 13.0;
    for (let i = 0; i < count && i < FIRST_GAMMAS.length; i++) {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.frequency.value = FIRST_GAMMAS[i] * baseScale;
      /* Natural 1 / gamma_k amplitude decay matching Riemann's explicit formula! */
      g.gain.value = (14.1347 / FIRST_GAMMAS[i]) * (1.0 / Math.sqrt(count));
      osc.connect(g);
      g.connect(master);
      osc.start();
      audioOscs.push(osc);
    }

    audioPlaying = true;
    btnAudioPlay.textContent = "Stop Audio Synth";
    btnAudioPlay.classList.add("playing");
    updateLabDot();
  }

  btnAudioPlay.addEventListener("click", () => {
    if (audioPlaying) stopPrimeAudio();
    else startPrimeAudio();
  });

  audioVoices.addEventListener("input", () => {
    audioVoicesVal.textContent = audioVoices.value;
    if (audioPlaying) startPrimeAudio();
  });

  audioVol.addEventListener("input", () => {
    audioVolVal.textContent = `${audioVol.value}%`;
    if (audioGain && audioCtx) {
      audioGain.gain.setTargetAtTime((parseInt(audioVol.value, 10) / 100) * 0.28, audioCtx.currentTime, 0.05);
    }
  });

  async function refreshHarmonicsList() {
    const r = window.Real2DController;
    if (!r || !r.state.active) return;
    const xmin = Math.max(1.4, r.state.view.xmin);
    const xmax = Math.max(xmin + 2.0, r.state.view.xmax);

    const res = await fetch("/api/real/harmonics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xmin, xmax, samples: 180, count: 8 }),
    });
    if (!res.ok) return;
    const data = await res.json();

    harmonicsList.innerHTML = "";
    for (const w of data.waves || []) {
      const isSolo = r.state.soloWave && r.state.soloWave.index === w.index;
      const item = document.createElement("div");
      item.className = "harmonic-item" + (isSolo ? " active" : "");

      const head = document.createElement("div");
      head.className = "harmonic-head";
      head.innerHTML = `<span>Zero #${w.index} · γ = ${w.gamma.toFixed(4)}</span><span style="color:#fbbf24">${isSolo ? "SOLO" : "Overlay"}</span>`;
      item.appendChild(head);

      const spark = document.createElement("canvas");
      spark.className = "harmonic-spark";
      spark.width = 280;
      spark.height = 26;
      const sctx = spark.getContext("2d");
      let maxAbs = 0.05;
      for (const y of w.ys) if (y !== null && Math.abs(y) > maxAbs) maxAbs = Math.abs(y);
      sctx.strokeStyle = isSolo ? "#fde047" : "#38bdf8";
      sctx.lineWidth = 1.4;
      sctx.beginPath();
      w.ys.forEach((y, i) => {
        const px = (i / (w.ys.length - 1)) * spark.width;
        const py = spark.height * 0.5 - ((y || 0) / maxAbs) * (spark.height * 0.42);
        if (i === 0) sctx.moveTo(px, py);
        else sctx.lineTo(px, py);
      });
      sctx.stroke();
      item.appendChild(spark);

      item.addEventListener("click", () => {
        if (r.state.soloWave && r.state.soloWave.index === w.index) {
          r.state.soloWave = null;
        } else {
          r.state.soloWave = { index: w.index, gamma: w.gamma, xs: data.xs, ys: w.ys };
        }
        updateLabDot();
        refreshHarmonicsList();
        r.requestRender();
      });

      harmonicsList.appendChild(item);
    }
  }

  /* -------------------------------------------------------------------------
   * 2D Real Lab 2: Calculus Toolkit (Derivative f'(x), Tangent, ∫[a, b])
   * ------------------------------------------------------------------------- */

  let calcTimer = null;

  async function refreshCalculus(immediate = false) {
    const r = window.Real2DController;
    if (!r || !r.state.active) return;
    if (!r.state.calc.showDeriv && !r.state.calc.showIntegral) {
      r.state.calc.derivXs = null;
      r.state.calc.derivYs = null;
      calcIntVal.textContent = "—";
      r.requestRender();
      return;
    }

    const run = async () => {
      const res = await fetch("/api/real/calculus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fn: r.state.fnIndex,
          xmin: r.state.view.xmin,
          xmax: r.state.view.xmax,
          samples: 360,
          a: r.state.calc.a,
          b: r.state.calc.b,
          deriv: r.state.calc.showDeriv,
          integral: r.state.calc.showIntegral,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      r.state.calc.derivXs = data.xs || null;
      r.state.calc.derivYs = data.deriv || null;
      r.state.calc.integralVal = data.integral;
      if (r.state.calc.showIntegral) {
        calcIntVal.textContent = Number(data.integral).toFixed(6);
      }
      r.requestRender();
    };

    if (calcTimer) clearTimeout(calcTimer);
    if (immediate) await run();
    else calcTimer = setTimeout(run, 55);
  }

  calcDerivToggle.addEventListener("change", () => {
    window.Real2DController.state.calc.showDeriv = calcDerivToggle.checked;
    updateLabDot();
    refreshCalculus(true);
  });

  calcTangentToggle.addEventListener("change", () => {
    window.Real2DController.state.calc.showTangent = calcTangentToggle.checked;
    if (!calcTangentToggle.checked) calcSlopeVal.textContent = "—";
    updateLabDot();
    window.Real2DController.requestRender();
  });

  calcIntToggle.addEventListener("change", () => {
    const c = window.Real2DController.state.calc;
    c.showIntegral = calcIntToggle.checked;
    c.a = parseFloat(calcA.value) || 2.0;
    c.b = parseFloat(calcB.value) || 20.0;
    updateLabDot();
    refreshCalculus(true);
  });

  function syncCalcBounds() {
    const c = window.Real2DController.state.calc;
    c.a = parseFloat(calcA.value) || 0;
    c.b = parseFloat(calcB.value) || 1;
    if (c.showIntegral) refreshCalculus(true);
  }
  calcA.addEventListener("change", syncCalcBounds);
  calcB.addEventListener("change", syncCalcBounds);

  /* -------------------------------------------------------------------------
   * Feature 8: High-Res 2x PNG Export & Bookmark URLs
   * ------------------------------------------------------------------------- */

  document.getElementById("btn-export-png").addEventListener("click", () => {
    const app = window.ComplexApp;
    const isReal = isRealDim();
    const outCanvas = document.createElement("canvas");
    const pad = 28;
    const hdrH = 64;

    if (isReal) {
      const src = window.Real2DController.canvas;
      outCanvas.width = src.width + pad * 2;
      outCanvas.height = src.height + hdrH + pad * 2;
      const g = outCanvas.getContext("2d");
      g.fillStyle = "#070a10";
      g.fillRect(0, 0, outCanvas.width, outCanvas.height);
      g.drawImage(src, pad, hdrH + pad);
      g.fillStyle = "#e8eef8";
      g.font = '600 26px "Inter", sans-serif';
      g.fillText(`2D Real Visualizer — ${document.getElementById("fn-formula").textContent}`, pad, 46);
    } else {
      const c1 = app.canvasIn;
      const c2 = app.canvasOut;
      const gap = 20;
      outCanvas.width = c1.width + c2.width + gap + pad * 2;
      outCanvas.height = Math.max(c1.height, c2.height) + hdrH + pad * 2;
      const g = outCanvas.getContext("2d");
      g.fillStyle = "#070a10";
      g.fillRect(0, 0, outCanvas.width, outCanvas.height);
      g.drawImage(c1, pad, hdrH + pad);
      g.drawImage(c2, pad + c1.width + gap, hdrH + pad);
      g.fillStyle = "#e8eef8";
      g.font = '600 26px "Inter", sans-serif';
      const title =
        app.state.mode === "integral" ? "Complex Contour Integral" : "Complex Function Visualizer";
      g.fillText(`${title} — ${document.getElementById("fn-formula").textContent}`, pad, 46);
    }

    const link = document.createElement("a");
    link.download = `visualizer-${isReal ? "real2d" : app.state.mode}-${Date.now()}.png`;
    link.href = outCanvas.toDataURL("image/png");
    link.click();
    closeDrawers();
  });

  document.getElementById("btn-copy-bookmark").addEventListener("click", async () => {
    const app = window.ComplexApp;
    const params = new URLSearchParams();
    if (isRealDim()) {
      const r = window.Real2DController.state;
      params.set("dim", "real");
      params.set("fn", String(r.fnIndex));
      params.set("xmin", r.view.xmin.toFixed(3));
      params.set("xmax", r.view.xmax.toFixed(3));
      params.set("ymin", r.view.ymin.toFixed(3));
      params.set("ymax", r.view.ymax.toFixed(3));
    } else {
      params.set("dim", "complex");
      params.set("mode", app.state.mode);
      params.set("fn", String(app.state.fnIndex));
      params.set("cx", app.state.inView.cx.toFixed(3));
      params.set("cy", app.state.inView.cy.toFixed(3));
    }
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", `?${params.toString()}`);
    try {
      await navigator.clipboard.writeText(url);
      document.getElementById("bookmark-status").textContent = "Copied to clipboard!";
    } catch (_) {
      document.getElementById("bookmark-status").textContent = "Updated URL bar!";
    }
    setTimeout(() => {
      document.getElementById("bookmark-status").textContent = "Saves view & mode";
    }, 2200);
  });

  /* Restore bookmarked query params if present */
  setTimeout(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.has("xmin") && isRealDim() && window.Real2DController.state.active) {
      const r = window.Real2DController.state;
      r.view.xmin = parseFloat(p.get("xmin")) || r.view.xmin;
      r.view.xmax = parseFloat(p.get("xmax")) || r.view.xmax;
      r.view.ymin = parseFloat(p.get("ymin")) || r.view.ymin;
      r.view.ymax = parseFloat(p.get("ymax")) || r.view.ymax;
      window.Real2DController.scheduleSample(true);
    }
  }, 450);

  /* Public Hooks called by app.js & real2d.js */
  window.LabController = {
    closeDrawers,
    refreshCalculus,
    onDimensionChange() {
      stopPrimeAudio();
      if (!drawerEditor.classList.contains("hidden")) syncEditorForDimension();
      if (!drawerLab.classList.contains("hidden")) syncLabForDimension();
      updateLabDot();
    },
    onComplexFunctionChange() {
      if (window.ComplexApp.state.lab.taylor.enabled) fetchTaylor();
      if (!drawerEditor.classList.contains("hidden") && !isRealDim()) {
        editorTextarea.dataset.dim = "";
        syncEditorForDimension();
      }
    },
    onRealFunctionChange() {
      if (!drawerEditor.classList.contains("hidden") && isRealDim()) {
        editorTextarea.dataset.dim = "";
        syncEditorForDimension();
      }
      refreshCalculus(true);
    },
    onRealSampled() {
      if (!drawerLab.classList.contains("hidden") && isRealDim()) {
        const activeTab = document.querySelector("#real-lab-tabs .drawer-tab.active");
        if (activeTab && activeTab.dataset.labTab === "harmonics") {
          refreshHarmonicsList();
        }
      }
      if (window.Real2DController.state.calc.showDeriv || window.Real2DController.state.calc.showIntegral) {
        refreshCalculus(false);
      }
    },
    setTaylorCenter(x, y) {
      const tay = window.ComplexApp.state.lab.taylor;
      tay.x0 = x;
      tay.y0 = y;
      taylorX0.value = x.toFixed(3);
      taylorY0.value = y.toFixed(3);
      btnTaylorPick.textContent = "Click Input Plane to Place z₀";
      fetchTaylor();
    },
    onTaylorDragMove(x, y) {
      taylorX0.value = x.toFixed(3);
      taylorY0.value = y.toFixed(3);
      if (taylorTimer) clearTimeout(taylorTimer);
      taylorTimer = setTimeout(fetchTaylor, 45);
    },
    onIntegralGatesDragged(a, b) {
      calcA.value = a.toFixed(2);
      calcB.value = b.toFixed(2);
      refreshCalculus(false);
    },
  };
})();
