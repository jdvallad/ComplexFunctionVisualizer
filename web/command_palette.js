(() => {
  "use strict";

  /* =========================================================================
   * Command Palette (Ctrl+K), Brand -> New Project, & 60 FPS WebM Recorder
   * ========================================================================= */
  let _open = false;
  let _selIdx = 0;
  let _items = [];
  let _filtered = [];

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]));
  }

  function ensurePaletteModal() {
    let el = document.getElementById("cmd-palette-modal");
    if (el) return el;
    el = document.createElement("div");
    el.id = "cmd-palette-modal";
    el.className = "cmd-palette-backdrop hidden";
    el.innerHTML = `
      <div class="cmd-palette-box" role="dialog" aria-label="Command Palette">
        <div class="cmd-palette-head">
          <span class="cmd-palette-icon">⌘</span>
          <input id="cmd-palette-input" class="cmd-palette-input" type="text" placeholder="Search projects, tools, modes... (Esc to close)" autocomplete="off" spellcheck="false" />
          <kbd class="cmd-kbd">ESC</kbd>
        </div>
        <div id="cmd-palette-list" class="cmd-palette-list"></div>
        <div class="cmd-palette-foot">
          <span>↑↓ Navigate · Enter Open</span>
          <span>Ctrl+K / Cmd+K</span>
        </div>
      </div>`;
    el.addEventListener("click", (e) => { if (e.target === el) closePalette(); });
    document.body.appendChild(el);
    const inp = el.querySelector("#cmd-palette-input");
    inp.addEventListener("input", () => filterPalette(inp.value));
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); _selIdx = Math.min(_filtered.length - 1, _selIdx + 1); renderList(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); _selIdx = Math.max(0, _selIdx - 1); renderList(); }
      else if (e.key === "Enter") { e.preventDefault(); executeSelected(); }
      else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
    });
    return el;
  }

  function buildItems() {
    const ws = window.CFVWorkspace;
    const out = [
      { kind: "Mode", badge: "ℂ", title: "New Complex Project", sub: "Conformal maps, 3D Riemann Sphere, Domain Coloring & Residues", run: () => ws && ws.setMode("map") },
      { kind: "Mode", badge: "ℝ", title: "New Real Project", sub: "Explicit, Implicit, Parametric curves, ODE Chaos & Automata", run: () => ws && ws.setMode("real") },
      { kind: "Mode", badge: "∇", title: "New Vector Project", sub: "Vector Functions R²→R², Potentials R²→R, 2×2 Matrices & Anchored Vectors", run: () => ws && ws.setMode("vector") },
      { kind: "Action", badge: "✦", title: "Open GenAI Prompt Studio & Docs", sub: "Build full projects with any LLM or browse C11 Reference", run: () => document.getElementById("btn-open-docs")?.click() },
      { kind: "Action", badge: "▶", title: "Compile C11 Workspace", sub: "Hot-compile all expression cards (Ctrl+Enter)", run: () => ws && ws.compileWorkspace && ws.compileWorkspace(false, false) },
      { kind: "Action", badge: "⤒", title: "Import / Export Project JSON", sub: "Open JSON Project Terminal (cfv_project_v1)", run: () => document.getElementById("btn-top-json-project")?.click() },
      { kind: "Action", badge: "●", title: "Toggle 60 FPS WebM Recording", sub: "Record live workspace animation as .webm video", run: () => toggleWebMRecording() },
      { kind: "Action", badge: "☀", title: "Toggle Light / Dark Theme", sub: "Switch studio appearance", run: () => document.getElementById("btn-theme-toggle")?.click() },
    ];

    if (ws && ws.state && Array.isArray(ws.state.savedProjects)) {
      for (const p of ws.state.savedProjects) {
        const badge = p.mode === "real" ? "ℝ" : p.mode === "vector" ? "∇" : "ℂ";
        out.push({
          kind: "Saved",
          badge,
          title: p.name || p.id,
          sub: p.description || "My Saved Project",
          run: () => ws.guardNavigation && ws.loadSavedProject && ws.guardNavigation(() => ws.loadSavedProject(p.id)),
        });
      }
    }

    if (window.CFVExamples && Array.isArray(window.CFVExamples.list)) {
      for (const ex of window.CFVExamples.list) {
        const isVec = ex.mode === "vector";
        const isReal = ex.mode === "real";
        out.push({
          kind: isVec ? "Vector" : isReal ? "Real" : "Complex",
          badge: isVec ? "∇" : isReal ? "ℝ" : "ℂ",
          title: ex.title || ex.name || ex.id,
          sub: ex.subtitle || ex.desc || ex.summary || ex.badge || "",
          run: () => ws && ws.loadExampleById && ws.loadExampleById(ex.id),
        });
      }
    }
    return out;
  }

  function filterPalette(q) {
    const query = String(q || "").trim().toLowerCase();
    if (!query) {
      _filtered = _items.slice(0, 32);
    } else {
      const terms = query.split(/\s+/);
      _filtered = _items
        .filter((it) => terms.every((t) => `${it.title} ${it.sub} ${it.kind}`.toLowerCase().includes(t)))
        .slice(0, 36);
    }
    _selIdx = 0;
    renderList();
  }

  function renderList() {
    const list = document.getElementById("cmd-palette-list");
    if (!list) return;
    if (!_filtered.length) {
      list.innerHTML = `<div class="cmd-empty">No matching projects or commands.</div>`;
      return;
    }
    list.innerHTML = _filtered.map((it, i) => `
      <button type="button" class="cmd-item${i === _selIdx ? " active" : ""}" data-cmd-idx="${i}">
        <span class="cmd-badge">${escapeHtml(it.badge)}</span>
        <span class="cmd-main">
          <span class="cmd-title">${escapeHtml(it.title)}</span>
          <span class="cmd-sub">${escapeHtml(it.sub)}</span>
        </span>
        <span class="cmd-kind">${escapeHtml(it.kind)}</span>
      </button>`).join("");
    list.querySelectorAll(".cmd-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        _selIdx = Number(btn.dataset.cmdIdx);
        executeSelected();
      });
    });
    const active = list.querySelector(".cmd-item.active");
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  }

  function executeSelected() {
    const it = _filtered[_selIdx];
    closePalette();
    if (it && it.run) it.run();
  }

  function openPalette() {
    const el = ensurePaletteModal();
    _items = buildItems();
    _open = true;
    el.classList.remove("hidden");
    const inp = el.querySelector("#cmd-palette-input");
    inp.value = "";
    filterPalette("");
    setTimeout(() => inp.focus(), 10);
  }

  function closePalette() {
    const el = document.getElementById("cmd-palette-modal");
    if (el) el.classList.add("hidden");
    _open = false;
  }

  /* =========================================================================
   * 60 FPS WebM Animation Clip Recorder (MediaRecorder + Composited Canvas!)
   * ========================================================================= */
  let _recState = null;

  function getVisibleStageCanvases() {
    const ws = window.CFVWorkspace;
    const mode = ws && ws.getMode ? ws.getMode() : "map";
    if (mode === "real") {
      const c = document.getElementById("canvas-real");
      return c && c.width > 10 ? [c] : [];
    }
    if (mode === "vector") {
      const c = document.getElementById("canvas-vector");
      return c && c.width > 10 ? [c] : [];
    }
    const out = [];
    const cIn = document.getElementById("canvas-in");
    const cOut = document.getElementById("canvas-out");
    if (cIn && cIn.clientWidth > 10 && !document.getElementById("input-plane-card")?.classList.contains("hidden")) out.push(cIn);
    if (cOut && cOut.clientWidth > 10 && !document.getElementById("output-plane-card")?.classList.contains("hidden")) out.push(cOut);
    return out;
  }

  function updateRecButtonUI(recording, elapsedSec = 0) {
    const btn = document.getElementById("btn-record-webm");
    if (!btn) return;
    btn.classList.toggle("recording", recording);
    const lbl = btn.querySelector(".rec-label");
    if (lbl) lbl.textContent = recording ? `Stop (${Math.floor(elapsedSec)}s)` : "Rec";
  }

  function toggleWebMRecording() {
    if (_recState) {
      try { _recState.recorder.stop(); } catch (_) {}
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      alert("WebM MediaRecorder is not supported in this browser.");
      return;
    }
    const sources = getVisibleStageCanvases();
    if (!sources.length) return;

    const comp = document.createElement("canvas");
    const gap = sources.length > 1 ? 6 : 0;
    const totalW = sources.reduce((acc, c) => acc + c.width, 0) + gap;
    const maxH = Math.max(...sources.map((c) => c.height));
    comp.width = Math.min(2560, Math.max(320, totalW));
    comp.height = Math.min(1440, Math.max(240, maxH));
    const cctx = comp.getContext("2d");

    const stream = comp.captureStream(60);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : (MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "");
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 }) : new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunks.push(ev.data); };
    recorder.onstop = () => {
      if (_recState && _recState.raf) cancelAnimationFrame(_recState.raf);
      if (_recState && _recState.timer) clearInterval(_recState.timer);
      _recState = null;
      updateRecButtonUI(false);
      if (!chunks.length) return;
      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `conformal_${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
    };

    const t0 = Date.now();
    const pump = () => {
      if (!_recState) return;
      const srcs = getVisibleStageCanvases();
      cctx.fillStyle = "#080c14";
      cctx.fillRect(0, 0, comp.width, comp.height);
      let x = 0;
      const scale = Math.min(1, comp.width / Math.max(1, srcs.reduce((a, c) => a + c.width, 0) + gap));
      for (const s of srcs) {
        const dw = Math.round(s.width * scale);
        const dh = Math.round(s.height * scale);
        cctx.drawImage(s, x, Math.round((comp.height - dh) * 0.5), dw, dh);
        x += dw + gap;
      }
      _recState.raf = requestAnimationFrame(pump);
    };

    _recState = { recorder, raf: 0, timer: 0 };
    recorder.start(250);
    _recState.raf = requestAnimationFrame(pump);
    _recState.timer = setInterval(() => updateRecButtonUI(true, (Date.now() - t0) / 1000), 250);
    updateRecButtonUI(true, 0);
  }

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (_open) closePalette(); else openPalette();
    } else if (e.key === "Escape" && _open) {
      closePalette();
    }
  });

  function wireControls() {
    const recBtn = document.getElementById("btn-record-webm");
    if (recBtn) recBtn.addEventListener("click", toggleWebMRecording);
    const palBtn = document.getElementById("btn-cmd-palette");
    if (palBtn) palBtn.addEventListener("click", openPalette);
    /* Clicking Conformal icon / wordmark starts a clean New Project in the current mode */
    const brandBtn = document.getElementById("btn-main-menu");
    if (brandBtn) {
      brandBtn.addEventListener("click", () => {
        const ws = window.CFVWorkspace;
        if (!ws || !ws.openBlankWorkspace) return;
        const m = ws.getMode ? ws.getMode() : "map";
        if (ws.isBlankWorkspace && ws.isBlankWorkspace() && !ws.state.activeProjectId && ws.state.projectPresets.length === 0) return;
        if (ws.guardNavigation) ws.guardNavigation(() => ws.openBlankWorkspace(m, true));
        else ws.openBlankWorkspace(m, true);
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireControls);
  else wireControls();

  window.CFVCommandPalette = { open: openPalette, close: closePalette, toggleRecording: toggleWebMRecording };
})();
