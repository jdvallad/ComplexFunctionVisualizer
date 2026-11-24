(() => {
  "use strict";

  /*
   * Desmos-Style Project -> Presets Workspace Controller
   * Mental Model:
   *  - Everything is a Project (built-in Examples are built-in Projects; users can save Custom Projects).
   *  - A Project owns 0 or more Presets. Saving a Project saves all its cards, landmarks, and Presets!
   *  - Loading a saved Project with 0 Presets opens with everything enabled and the default viewport.
   *  - You are ONLY in a Preset if you loaded it and haven't made structural/content edits
   *    (panning, zooming, scrubbing/playing sliders do NOT break out of a Preset!).
   *  - Any real edit transitions cleanly into an Unsaved Project (with unsaved-progress guard on switch).
   *  - AI Studio Replace starts a fresh Unsaved Project with 0 Presets.
   *  - 2D Real natively supports y=f(x), x=c, x=g(y), implicit LHS=RHS, and continuous parametric
   *    curves `(x(t), y(t)) for t in [a, b]` and multi-line `parametric [a, b]:` blocks!
   */

  const COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#fb923c", "#f8fafc", "#2dd4bf"];
  const ICONS = [
    { id: "dot", glyph: "●", label: "Dot" },
    { id: "ring", glyph: "○", label: "Ring" },
    { id: "cross", glyph: "✕", label: "Cross" },
    { id: "diamond", glyph: "◆", label: "Diamond" },
    { id: "star", glyph: "★", label: "Star" },
  ];
  const LINE_STYLES = [
    { id: "solid", label: "Solid" },
    { id: "dashed", label: "Dashed" },
    { id: "dotted", label: "Dotted" },
  ];
  const USER_PROJECTS_KEY = "cfv_user_projects_v1";
  const LIBRARY_META_KEY = "cfv_library_meta_v1";
  const LIBRARY_META_ID = "_cfv_library_meta";

  const state = {
    mode: "map", /* "map" | "integral" | "real" */
    activeProjectId: null,       /* null | built-in example id | custom "proj_..." id */
    activeProjectName: "New Project",
    activeProjectDescription: "",
    activeProjectIsCustom: false,
    activeProjectFolder: "my",   /* "my" | "examples" | custom folder id */
    sourceExampleId: null,       /* tracks origin example so inherited presets remain loadable */
    projectPresets: [],          /* Presets belonging ONLY to the current project */
    activePresetId: null,        /* Set ONLY while unmodified in a loaded preset */
    savedProjects: [],           /* Repo-backed (projects/*.json) + localStorage user projects */
    libraryMeta: { folders: [], exampleRenames: {}, deletedExamples: [] },
    folderCollapsed: { my: false, examples: false },
    pendingDelete: null,

    splitPct: 50,
    savedSidebarWidth: 372,
    sidebarCollapsed: false,
    inputHidden: false,
    outputHidden: false,
    realHidden: false,
    cards: [],                   /* fn & slider cards */
    nextCardId: 1,
    primaryCardId: null,

    settingsTarget: null,

    serverCfg: { compile_enabled: true, compile_requires_token: false },
    compiledKind: null,
    dirty: false,
    compiling: false,

    hasUnsavedWork: false,
    pendingNavAction: null,

    urlSyncTimer: null,
    restoringState: false,

    sliderRaf: null,
    sliderLastTs: 0,
  };

  /* DOM refs */
  const sidebar = document.getElementById("expr-sidebar");
  const miniSliderSidebar = document.getElementById("mini-slider-sidebar");
  const miniSlidersList = document.getElementById("mini-sliders-list");
  const miniSlidersCount = document.getElementById("mini-sliders-count");
  const btnToggleSidebar = document.getElementById("btn-toggle-sidebar");
  const btnShowSidebar = document.getElementById("btn-show-sidebar");
  const stageColumn = document.getElementById("stage-column");
  const complexDrawDock = document.getElementById("complex-draw-dock");
  const realPolyDockEl = document.getElementById("real-poly-dock");
  const panelRestoreBar = document.getElementById("panel-restore-bar");
  const bottomRestoreSep = document.getElementById("bottom-restore-sep");
  const btnShowInput = document.getElementById("btn-show-input");
  const btnShowOutput = document.getElementById("btn-show-output");
  const btnShowReal = document.getElementById("btn-show-real");
  const btnHideInput = document.getElementById("btn-hide-input");
  const btnHideOutput = document.getElementById("btn-hide-output");
  const btnHideReal = document.getElementById("btn-hide-real");
  const fnTabLabel = document.getElementById("fn-tab-label");
  const fnTabCount = document.getElementById("fn-tab-count");
  const fnCardsEl = document.getElementById("fn-cards");
  const domainSectionLabel = document.getElementById("domain-section-label");
  const domainTabCount = document.getElementById("domain-tab-count");
  const domainQuickAdds = document.getElementById("domain-quick-adds");
  const domainCardsEl = document.getElementById("domain-cards");
  const btnFnLibrary = document.getElementById("btn-fn-library");
  const fnLibraryDropdown = document.getElementById("fn-library-dropdown");
  const fnLibTitle = document.getElementById("fn-lib-title");
  const fnLibSearch = document.getElementById("fn-lib-search");
  const fnLibCats = document.getElementById("fn-lib-cats");
  const fnLibList = document.getElementById("fn-lib-list");
  const btnFnGuide = document.getElementById("btn-fn-guide");
  const fnSyntaxGuide = document.getElementById("fn-syntax-guide");

  const projectDescBar = document.getElementById("project-desc-bar");
  const btnToggleDesc = document.getElementById("btn-toggle-desc");
  const projectDescPreview = document.getElementById("project-desc-preview");
  const projectDescEditor = document.getElementById("project-desc-editor");
  const projectDescInput = document.getElementById("project-desc-input");

  const btnToggleTheme = document.getElementById("btn-toggle-theme");
  const themeIconSun = document.getElementById("theme-icon-sun");
  const themeIconMoon = document.getElementById("theme-icon-moon");
  const themeToggleLabel = document.getElementById("theme-toggle-label");

  const btnNewProject = document.getElementById("btn-new-project");
  const btnSaveProject = document.getElementById("btn-save-project");
  const btnSaveAsProject = document.getElementById("btn-save-as-project");
  const btnTopRenameProject = document.getElementById("btn-top-rename-project");
  const btnTopJsonProject = document.getElementById("btn-top-json-project");
  const btnTopDeleteProject = document.getElementById("btn-top-delete-project");
  const btnNewFolder = document.getElementById("btn-new-folder");
  const newFolderForm = document.getElementById("new-folder-form");
  const newFolderName = document.getElementById("new-folder-name");
  const btnConfirmNewFolder = document.getElementById("btn-confirm-new-folder");
  const btnCancelNewFolder = document.getElementById("btn-cancel-new-folder");
  const btnImportProject = document.getElementById("btn-import-project");
  const btnExportProject = document.getElementById("btn-export-project");
  const saveProjectForm = document.getElementById("save-project-form");
  const saveProjectName = document.getElementById("save-project-name");
  const saveProjectFolder = document.getElementById("save-project-folder");
  const btnSaveAddFolder = document.getElementById("btn-save-add-folder");
  const saveNewFolderRow = document.getElementById("save-new-folder-row");
  const saveNewFolderInput = document.getElementById("save-new-folder-input");
  const btnSaveConfirmFolder = document.getElementById("btn-save-confirm-folder");
  const btnSaveCancelFolder = document.getElementById("btn-save-cancel-folder");
  const saveProjectDesc = document.getElementById("save-project-desc");
  const btnConfirmSaveProject = document.getElementById("btn-confirm-save-project");
  const btnCancelSaveProject = document.getElementById("btn-cancel-save-project");

  const deleteProjectModal = document.getElementById("delete-project-modal");
  const deleteProjectSub = document.getElementById("delete-project-sub");
  const deleteProjectMsg = document.getElementById("delete-project-msg");
  const btnConfirmDeleteProject = document.getElementById("btn-confirm-delete-project");
  const btnCancelDeleteProject = document.getElementById("btn-cancel-delete-project");
  const btnCloseDeleteModal = document.getElementById("btn-close-delete-modal");

  const presetBar = document.getElementById("preset-bar");
  const presetBarList = document.getElementById("preset-bar-list");
  const btnSavePreset = document.getElementById("btn-save-preset");
  const savePresetForm = document.getElementById("save-preset-form");
  const savePresetName = document.getElementById("save-preset-name");
  const btnConfirmSavePreset = document.getElementById("btn-confirm-save-preset");
  const btnCancelSavePreset = document.getElementById("btn-cancel-save-preset");

  const unsavedModal = document.getElementById("unsaved-modal");
  const unsavedPresetName = document.getElementById("unsaved-preset-name");
  const btnUnsavedSave = document.getElementById("btn-unsaved-save");
  const btnUnsavedDiscard = document.getElementById("btn-unsaved-discard");
  const btnUnsavedCancel = document.getElementById("btn-unsaved-cancel");
  const btnCloseUnsaved = document.getElementById("btn-close-unsaved");

  const btnExamples = document.getElementById("btn-examples");
  const activeExampleName = document.getElementById("active-example-name");
  const examplesDropdown = document.getElementById("examples-dropdown");
  const examplesList = document.getElementById("examples-list");
  const ddModeBadge = document.getElementById("dd-mode-badge");
  const projectFilterInput = document.getElementById("project-filter-input");

  const compileStatusText = document.getElementById("compile-status-text");
  const compileDiag = document.getElementById("compile-diag");
  const btnCompileAll = document.getElementById("btn-compile-all");
  const tokenBar = document.getElementById("sidebar-token-bar");
  const tokenInput = document.getElementById("sidebar-token-input");

  const stageComplex = document.getElementById("stage-complex");
  const stageReal = document.getElementById("stage-real");
  const inputPlaneCard = document.getElementById("input-plane-card");
  const outputPlaneCard = document.getElementById("output-plane-card");
  const planesSplitter = document.getElementById("planes-splitter");
  const sidebarSplitter = document.getElementById("sidebar-splitter");

  const readoutInLabel = document.getElementById("readout-in-label");
  const readoutOutLabel = document.getElementById("readout-out-label");
  const readoutIn = document.getElementById("readout-in");
  const readoutOut = document.getElementById("readout-out");

  const itemSettingsPopover = document.getElementById("item-settings-popover");
  const itemSettingsTitle = document.getElementById("item-settings-title");
  const itemSettingsBody = document.getElementById("item-settings-body");

  const toolsPopover = document.getElementById("tools-popover");
  const btnOpenTools = document.getElementById("btn-open-tools");
  const toolsTitle = document.getElementById("tools-popover-title");
  const toolsComplexBody = document.getElementById("tools-complex-body");
  const toolsRealBody = document.getElementById("tools-real-body");
  const toolsActiveDot = document.getElementById("tools-active-dot");

  /* Global Viewport & Camera Variables readable & dynamically writable from formulas/sliders */
  const VIEWPORT_GLOBALS = new Set([
    "sphere_yaw", "sphere_pitch", "sphere_zoom",
    "in_cx", "in_cy", "in_r",
    "out_cx", "out_cy", "out_r",
    "real_xmin", "real_xmax", "real_ymin", "real_ymax",
  ]);

  function getViewportGlobals() {
    const g = {
      sphere_yaw: -0.58, sphere_pitch: 0.22, sphere_zoom: 1.0,
      in_cx: 0, in_cy: 0, in_r: 4,
      out_cx: 0, out_cy: 0, out_r: 4,
      real_xmin: -8, real_xmax: 8, real_ymin: -6, real_ymax: 6,
    };
    if (window.RiemannSphere && window.RiemannSphere.state) {
      g.sphere_yaw = Number(window.RiemannSphere.state.yaw) || 0;
      g.sphere_pitch = Number(window.RiemannSphere.state.pitch) || 0;
      g.sphere_zoom = Number(window.RiemannSphere.state.zoom) || 1;
    }
    if (window.CFVComplex && typeof window.CFVComplex.getViewBounds === "function") {
      Object.assign(g, window.CFVComplex.getViewBounds());
    }
    if (window.CFVReal && window.CFVReal.state && window.CFVReal.state.view) {
      const rv = window.CFVReal.state.view;
      g.real_xmin = rv.xmin; g.real_xmax = rv.xmax;
      g.real_ymin = rv.ymin; g.real_ymax = rv.ymax;
    }
    return g;
  }

  function applyViewportGlobals(vp) {
    if (!vp) return { changed: false, realBoundsChanged: false };
    let changed = false;
    let realBoundsChanged = false;
    if (window.RiemannSphere && window.RiemannSphere.state) {
      const sp = window.RiemannSphere.state;
      if (vp.sphere_yaw !== undefined && Number.isFinite(vp.sphere_yaw)) { sp.yaw = vp.sphere_yaw; changed = true; }
      if (vp.sphere_pitch !== undefined && Number.isFinite(vp.sphere_pitch)) {
        sp.pitch = Math.max(-1.48, Math.min(1.48, vp.sphere_pitch));
        changed = true;
      }
      if (vp.sphere_zoom !== undefined && Number.isFinite(vp.sphere_zoom)) {
        sp.zoom = Math.max(0.45, Math.min(3.0, vp.sphere_zoom));
        changed = true;
      }
    }
    if (!isRealMode() && window.CFVComplex && typeof window.CFVComplex.setViewportValues === "function") {
      if (window.CFVComplex.setViewportValues(vp)) changed = true;
    }
    if (isRealMode() && window.CFVReal && window.CFVReal.state) {
      const rv = window.CFVReal.state.view;
      const nX0 = vp.real_xmin !== undefined && Number.isFinite(vp.real_xmin) ? vp.real_xmin : rv.xmin;
      const nX1 = vp.real_xmax !== undefined && Number.isFinite(vp.real_xmax) ? vp.real_xmax : rv.xmax;
      const nY0 = vp.real_ymin !== undefined && Number.isFinite(vp.real_ymin) ? vp.real_ymin : rv.ymin;
      const nY1 = vp.real_ymax !== undefined && Number.isFinite(vp.real_ymax) ? vp.real_ymax : rv.ymax;
      if (nX1 > nX0 + 1e-4 && nY1 > nY0 + 1e-4 && (nX0 !== rv.xmin || nX1 !== rv.xmax || nY0 !== rv.ymin || nY1 !== rv.ymax)) {
        rv.xmin = nX0; rv.xmax = nX1; rv.ymin = nY0; rv.ymax = nY1;
        changed = true;
        realBoundsChanged = true;
      }
    }
    return { changed, realBoundsChanged };
  }

  function isRealMode() { return state.mode === "real"; }
  function fnCards() { return state.cards.filter((c) => c.kind === "fn"); }
  function sliderCards() { return state.cards.filter((c) => c.kind === "slider"); }
  function varCards() { return state.cards.filter((c) => c.kind === "var"); }
  function paramCards() { return state.cards.filter((c) => c.kind === "slider" || c.kind === "var"); }
  function getImplicitViewportParamNames() {
    const explicit = new Set(paramCards().map((s) => s.name));
    const extra = [];
    for (const c of fnCards()) {
      const code = String(c.code || "");
      for (const vg of VIEWPORT_GLOBALS) {
        if (!explicit.has(vg) && !extra.includes(vg) && new RegExp(`\\b${vg}\\b`).test(code)) {
          extra.push(vg);
        }
      }
    }
    return extra;
  }
  function getParamNames() {
    return [...paramCards().map((s) => s.name), ...getImplicitViewportParamNames()].slice(0, 16);
  }
  function getParamValues() {
    const vg = getViewportGlobals();
    const explicit = paramCards().map((s) => Number(s.value) || 0);
    const extra = getImplicitViewportParamNames().map((nm) => Number(vg[nm]) || 0);
    return [...explicit, ...extra].slice(0, 16);
  }
  function getParamMap() {
    const m = getViewportGlobals();
    for (const s of paramCards()) m[s.name] = Number(s.value) || 0;
    return m;
  }

  /* Check whether changing `changedNames` requires C11 server recompute vs pure 60fps viewport render! */
  function paramsRequireServerRecompute(changedNames) {
    const affected = new Set(changedNames || []);
    if (affected.size === 0) return true;
    /* Propagate through dependent var cards */
    for (const v of varCards()) {
      const expr = String(v.expr || "");
      for (const nm of Array.from(affected)) {
        if (new RegExp(`\\b${nm}\\b`).test(expr)) {
          affected.add(v.name);
          break;
        }
      }
    }
    let touchesViewport = false;
    let touchesRealBounds = false;
    for (const nm of affected) {
      if (VIEWPORT_GLOBALS.has(nm)) {
        touchesViewport = true;
        if (nm.startsWith("real_")) touchesRealBounds = true;
      }
    }
    if (!touchesViewport) return true;
    if (touchesRealBounds) return true;
    /* Check if any active C card or formula-driven domain shape references any affected identifier */
    const activeFns = isRealMode()
      ? fnCards().filter((c) => c.visible !== false)
      : fnCards();
    for (const c of activeFns) {
      const code = String(c.code || "");
      for (const nm of affected) {
        if (new RegExp(`\\b${nm}\\b`).test(code)) return true;
      }
    }
    if (!isRealMode() && window.CFVComplex && window.CFVComplex.state) {
      for (const s of window.CFVComplex.state.shapes || []) {
        if (!s.formula) continue;
        const fStr = Object.values(s.formula).join(" ");
        for (const nm of affected) {
          if (new RegExp(`\\b${nm}\\b`).test(fStr)) return true;
        }
      }
    }
    return false;
  }

  /* Evaluate computed Variable cards (kind: "var") as functions of Sliders, Viewport Globals & earlier Variables */
  function resolveVariables(updateDom = true, applyViewport = true) {
    const ev = window.CFVComplex && window.CFVComplex.evalParamExpr;
    const m = getViewportGlobals();
    const vpUpdates = {};
    for (const s of sliderCards()) {
      const val = Number(s.value) || 0;
      m[s.name] = val;
      if (VIEWPORT_GLOBALS.has(s.name)) vpUpdates[s.name] = val;
    }
    const vars = varCards();
    if (ev) {
      for (const v of vars) {
        if (v.expr && String(v.expr).trim()) {
          const val = ev(v.expr, m);
          if (Number.isFinite(val)) v.value = val;
        }
        const nv = Number(v.value) || 0;
        m[v.name] = nv;
        if (VIEWPORT_GLOBALS.has(v.name)) vpUpdates[v.name] = nv;
      }
    }
    let vpRes = { changed: false, realBoundsChanged: false };
    if (applyViewport && Object.keys(vpUpdates).length > 0) {
      vpRes = applyViewportGlobals(vpUpdates);
    }
    if (updateDom && fnCardsEl) {
      for (const s of sliderCards()) {
        const vStr = String(s.value);
        const bStr = Number(s.value.toFixed(4)).toString();
        if (s._rangeEl && s._rangeEl.value !== vStr) s._rangeEl.value = vStr;
        if (s._valBadgeEl && s._valBadgeEl.textContent !== bStr) s._valBadgeEl.textContent = bStr;
        if (s._miniRangeEl && s._miniRangeEl.value !== vStr) s._miniRangeEl.value = vStr;
        if (s._miniValBadgeEl && s._miniValBadgeEl.textContent !== bStr) s._miniValBadgeEl.textContent = bStr;
      }
      for (const v of vars) {
        const pStr = Number.isFinite(v.value) ? `= ${Number(v.value.toFixed(4))}` : "= ?";
        if (v._valPillEl && v._valPillEl.textContent !== pStr) v._valPillEl.textContent = pStr;
        if (v._miniValPillEl && v._miniValPillEl.textContent !== pStr) v._miniValPillEl.textContent = pStr;
      }
    }
    return vpRes;
  }

  function isBlankWorkspace() {
    if (state.cards.length > 0) return false;
    if (isRealMode()) {
      return (
        window.CFVReal.state.points.length === 0 &&
        window.CFVReal.state.lines.length === 0 &&
        (window.CFVReal.state.polygons || []).length === 0
      );
    }
    return (
      window.CFVComplex.state.shapes.length === 0 &&
      window.CFVComplex.state.points.length === 0 &&
      window.CFVComplex.state.lines.length === 0
    );
  }

  function isInSavedProject() {
    return Boolean(state.activeProjectIsCustom && state.activeProjectId);
  }

  function hasUnsavedChanges() {
    return Boolean(state.hasUnsavedWork) && (!isBlankWorkspace() || state.projectPresets.length > 0);
  }

  function updateProjectHeaderUI() {
    const dirty = hasUnsavedChanges();
    const inSaved = isInSavedProject();
    if (activeExampleName) {
      if (isBlankWorkspace() && !state.activeProjectId && state.projectPresets.length === 0) {
        activeExampleName.textContent = "New Project";
      } else {
        const baseName = state.activeProjectName || "Unsaved Project";
        activeExampleName.textContent = dirty ? `${baseName} •` : baseName;
      }
    }
    if (btnSaveProject) {
      btnSaveProject.disabled = !inSaved;
      btnSaveProject.setAttribute("aria-disabled", String(!inSaved));
      btnSaveProject.classList.toggle("unsaved", inSaved && dirty);
      if (!btnSaveProject.classList.contains("saved-flash")) {
        btnSaveProject.textContent = inSaved ? (dirty ? "Save*" : "Save") : "Save";
      }
      btnSaveProject.title = inSaved
        ? `Save changes directly to "${state.activeProjectName}" (Ctrl+S)`
        : "Save is only available inside an already-saved project (use Save As to create a new saved project)";
    }
    if (btnSaveAsProject) {
      btnSaveAsProject.classList.toggle("unsaved", !inSaved && dirty);
      btnSaveAsProject.textContent = "Save As";
    }
    if (btnTopRenameProject) {
      const canRename = Boolean(state.activeProjectId || !isBlankWorkspace());
      btnTopRenameProject.disabled = !canRename;
      btnTopRenameProject.title = state.activeProjectId
        ? `Rename "${state.activeProjectName}"`
        : "Set project name";
    }
    if (btnTopDeleteProject) {
      const canDel = Boolean(state.activeProjectId);
      btnTopDeleteProject.disabled = !canDel;
      btnTopDeleteProject.setAttribute("aria-disabled", String(!canDel));
      btnTopDeleteProject.title = canDel
        ? `Delete "${state.activeProjectName}"`
        : "Open a saved or example project to delete it";
    }
  }

  /* -------------------------------------------------------------------------
   * Pure-JS UTF-8 <-> Base64URL Codec (for Live Persistent URL State #s=...)
   * ------------------------------------------------------------------------- */

  const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const B64_REV = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i++) B64_REV[B64_CHARS.charCodeAt(i)] = i;

  function utf8Encode(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      let cp = str.charCodeAt(i);
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
        const lo = str.charCodeAt(++i);
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
      }
      if (cp < 0x80) bytes.push(cp);
      else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
    return bytes;
  }

  function utf8Decode(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length;) {
      const b0 = bytes[i++];
      if (b0 < 0x80) { out += String.fromCharCode(b0); continue; }
      if ((b0 & 0xe0) === 0xc0) {
        const b1 = bytes[i++] & 0x3f;
        out += String.fromCharCode(((b0 & 0x1f) << 6) | b1);
      } else if ((b0 & 0xf0) === 0xe0) {
        const b1 = bytes[i++] & 0x3f, b2 = bytes[i++] & 0x3f;
        out += String.fromCharCode(((b0 & 0x0f) << 12) | (b1 << 6) | b2);
      } else {
        const b1 = bytes[i++] & 0x3f, b2 = bytes[i++] & 0x3f, b3 = bytes[i++] & 0x3f;
        let cp = ((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3;
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      }
    }
    return out;
  }

  function encodeStateB64(obj) {
    const bytes = utf8Encode(JSON.stringify(obj));
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const has1 = i + 1 < bytes.length;
      const has2 = i + 2 < bytes.length;
      const b1 = has1 ? bytes[i + 1] : 0;
      const b2 = has2 ? bytes[i + 2] : 0;
      const tri = (b0 << 16) | (b1 << 8) | b2;
      out += B64_CHARS[(tri >> 18) & 63];
      out += B64_CHARS[(tri >> 12) & 63];
      if (has1) out += B64_CHARS[(tri >> 6) & 63];
      if (has2) out += B64_CHARS[tri & 63];
    }
    return out;
  }

  function decodeStateB64(b64) {
    try {
      const clean = (b64 || "").replace(/=+$/, "");
      if (!clean) return null;
      const bytes = [];
      for (let i = 0; i < clean.length; i += 4) {
        const c0 = clean.charCodeAt(i), c1 = clean.charCodeAt(i + 1);
        const c2 = i + 2 < clean.length ? clean.charCodeAt(i + 2) : -1;
        const c3 = i + 3 < clean.length ? clean.charCodeAt(i + 3) : -1;
        const v0 = c0 < 128 ? B64_REV[c0] : -1;
        const v1 = c1 < 128 ? B64_REV[c1] : -1;
        if (v0 < 0 || v1 < 0) return null;
        const v2 = c2 >= 0 && c2 < 128 ? B64_REV[c2] : 0;
        const v3 = c3 >= 0 && c3 < 128 ? B64_REV[c3] : 0;
        const tri = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;
        bytes.push((tri >> 16) & 255);
        if (c2 >= 0) bytes.push((tri >> 8) & 255);
        if (c3 >= 0) bytes.push(tri & 255);
      }
      return JSON.parse(utf8Decode(bytes));
    } catch (_) {
      return null;
    }
  }

  /* -------------------------------------------------------------------------
   * 2D Real Smart Curve / Parametric / Relation Parser
   * Supports:
   *  1. Multi-line parametric: `parametric [t0, t1]: <C body setting px, py>`
   *  2. Single-line parametric: `(x_expr(t), y_expr(t))` or `(...) for t in [t0, t1]`
   *  3. Vertical lines: `x = c` / `x = r`
   *  4. Inverted curves: `x = g(y)`
   *  5. Implicit relations: `LHS = RHS` -> F(x, y) = 0
   *  6. Standard functions: `y = f(x)` or bare expression / C body
   * ------------------------------------------------------------------------- */

  function parseBoundVal(raw, fallback) {
    const s = String(raw || "").trim().replace(/\bM_PI\b|\bpi\b|\bPI\b/g, String(Math.PI));
    if (!s) return fallback;
    if (/^[0-9eE.+\-*/()\s]+$/.test(s)) {
      try {
        const v = Function(`"use strict"; return (${s});`)();
        if (Number.isFinite(v)) return v;
      } catch (_) {}
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : fallback;
  }

  function splitTopLevelTuple(inside) {
    let depth = 0;
    let commaIdx = -1;
    for (let i = 0; i < inside.length; i++) {
      const ch = inside[i];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
      else if (ch === "," && depth === 0) {
        if (commaIdx !== -1) return null; /* more than 2 tuple elements */
        commaIdx = i;
      }
    }
    if (commaIdx === -1 || depth !== 0) return null;
    const xExpr = inside.slice(0, commaIdx).trim();
    const yExpr = inside.slice(commaIdx + 1).trim();
    if (!xExpr || !yExpr) return null;
    return [xExpr, yExpr];
  }

  function findSingleEquals(expr) {
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] !== "=") continue;
      const prev = i > 0 ? expr[i - 1] : "";
      const next = i + 1 < expr.length ? expr[i + 1] : "";
      if (prev === "=" || prev === "!" || prev === "<" || prev === ">" || next === "=") continue;
      return i;
    }
    return -1;
  }

  function analyzeRealCode(rawCode) {
    const trimmed = (rawCode || "").trim();
    if (!trimmed) return { realKind: "fn", cCode: "0.0", badge: null };

    /* 1. Multi-line `parametric [t0, t1]: <body>` */
    const pm = trimmed.match(/^parametric(?:\s*\[\s*([^,\]]+)\s*,\s*([^\]]+)\s*\])?\s*:\s*([\s\S]+)$/i);
    if (pm) {
      const tMin = parseBoundVal(pm[1], 0.0);
      const tMax = parseBoundVal(pm[2], Math.PI * 2);
      const body = pm[3].trim();
      const cCode = `double t = x; (void)t;\ndouble px = NAN, py = NAN;\n${body}\nreturn (y < 0.5) ? px : py;`;
      return { realKind: "parametric", cCode, tMin, tMax: tMax > tMin ? tMax : tMin + Math.PI * 2, badge: "param" };
    }

    /* 2. Single-line `(x(t), y(t))` or `(x(t), y(t)) for t in [t0, t1]` */
    if (trimmed.startsWith("(") && !trimmed.includes(";") && !trimmed.includes("{")) {
      let depth = 0, closeIdx = -1;
      for (let i = 0; i < trimmed.length; i++) {
        if (trimmed[i] === "(") depth++;
        else if (trimmed[i] === ")") {
          depth--;
          if (depth === 0) { closeIdx = i; break; }
        }
      }
      if (closeIdx > 2) {
        const tuple = splitTopLevelTuple(trimmed.slice(1, closeIdx));
        const rest = trimmed.slice(closeIdx + 1).trim();
        if (tuple && (!rest || /^(?:for\s+t\s+in\s+)?\[\s*[^,\]]+\s*,\s*[^\]]+\s*\]$/i.test(rest))) {
          let tMin = 0.0, tMax = Math.PI * 2;
          const bm = rest.match(/\[\s*([^,\]]+)\s*,\s*([^\]]+)\s*\]/);
          if (bm) {
            tMin = parseBoundVal(bm[1], 0.0);
            tMax = parseBoundVal(bm[2], Math.PI * 2);
          }
          const cCode = `double t = x; (void)t;\nreturn (y < 0.5) ? (${tuple[0]}) : (${tuple[1]});`;
          return { realKind: "parametric", cCode, tMin, tMax: tMax > tMin ? tMax : tMin + Math.PI * 2, badge: "param" };
        }
      }
    }

    /* Multi-statement C blocks stay standard y = f(x) */
    if (/\breturn\b/.test(trimmed) || trimmed.includes(";") || trimmed.includes("{")) {
      return { realKind: "fn", cCode: trimmed, badge: null };
    }

    const eqIdx = findSingleEquals(trimmed);
    if (eqIdx === -1) return { realKind: "fn", cCode: trimmed, badge: null };
    const lhs = trimmed.slice(0, eqIdx).trim();
    const rhs = trimmed.slice(eqIdx + 1).trim();
    if (!lhs || !rhs) return { realKind: "fn", cCode: trimmed, badge: null };

    if (lhs === "y" && !/\by\b/.test(rhs)) {
      return { realKind: "fn", cCode: rhs, badge: null };
    }
    if (lhs === "x" && !/\bx\b/.test(rhs)) {
      if (/\by\b/.test(rhs)) {
        return { realKind: "x_of_y", cCode: rhs.replace(/\by\b/g, "x"), badge: "x=g(y)" };
      }
      return { realKind: "vertical", cCode: rhs, badge: "x=c" };
    }
    return { realKind: "implicit", cCode: `((${lhs}) - (${rhs}))`, badge: "F(x,y)=0" };
  }

  function isWorkspaceCompiled(kind) {
    return state.compiledKind === kind && state.serverCfg.compile_enabled;
  }

  /* Single Active Graphed Function + Auxiliary Helpers (Map & Integral Modes) */
  function getActiveComplexCard() {
    const fns = fnCards();
    if (fns.length === 0) return null;
    const chosen = fns.find((c) => c.id === state.primaryCardId) || fns[0];
    state.primaryCardId = chosen.id;
    return chosen;
  }

  function getPrimaryComplexTarget() {
    const chosen = getActiveComplexCard();
    if (!chosen) return null;
    const pmap = getParamMap();
    if (isWorkspaceCompiled("complex")) {
      const slot = typeof chosen.slot === "number" ? chosen.slot : Math.max(0, fnCards().indexOf(chosen));
      return { slot, params: getParamValues() };
    }
    if (chosen.builtin && chosen.builtin.dirichlet) {
      return { dirichlet: true, n: Math.round(pmap.N || 20) };
    }
    return { fn: chosen.builtin && chosen.builtin.fn !== undefined ? chosen.builtin.fn : 0 };
  }

  function getVisibleComplexTargets() {
    const chosen = getActiveComplexCard();
    if (!chosen) return [];
    return [
      {
        cardId: chosen.id,
        color: chosen.color,
        lineWidth: Number(chosen.lineWidth) || 2.2,
        lineStyle: chosen.lineStyle || "solid",
        target: getPrimaryComplexTarget(),
      },
    ];
  }

  function getVisibleRealCards() {
    return fnCards().filter((c) => c.visible);
  }

  /* -------------------------------------------------------------------------
   * Unsaved Project Confirmation Guard
   * ------------------------------------------------------------------------- */

  function closeUnsavedModal() {
    state.pendingNavAction = null;
    if (unsavedModal) unsavedModal.classList.add("hidden");
  }

  function defaultProjectName() {
    if (state.activeProjectIsCustom && state.activeProjectName) return state.activeProjectName;
    const modeName = state.mode === "real" ? "2D Real" : state.mode === "integral" ? "Integral" : "Complex Map";
    return `My ${modeName} Project`;
  }

  function guardNavigation(actionFn) {
    if (!hasUnsavedChanges()) {
      actionFn();
      return;
    }
    state.pendingNavAction = actionFn;
    if (unsavedPresetName) unsavedPresetName.value = defaultProjectName();
    if (unsavedModal) unsavedModal.classList.remove("hidden");
    if (unsavedPresetName && unsavedPresetName.focus) unsavedPresetName.focus();
  }

  if (btnUnsavedSave) {
    btnUnsavedSave.addEventListener("click", () => {
      const nm = (unsavedPresetName && unsavedPresetName.value.trim()) || defaultProjectName();
      saveCurrentProject(nm);
      const fn = state.pendingNavAction;
      closeUnsavedModal();
      if (fn) fn();
    });
  }
  if (btnUnsavedDiscard) {
    btnUnsavedDiscard.addEventListener("click", () => {
      state.hasUnsavedWork = false;
      const fn = state.pendingNavAction;
      closeUnsavedModal();
      if (fn) fn();
    });
  }
  if (btnUnsavedCancel) btnUnsavedCancel.addEventListener("click", closeUnsavedModal);
  if (btnCloseUnsaved) btnCloseUnsaved.addEventListener("click", closeUnsavedModal);
  if (unsavedModal) {
    unsavedModal.addEventListener("click", (e) => {
      if (e.target === unsavedModal) closeUnsavedModal();
    });
  }
  if (unsavedPresetName) {
    unsavedPresetName.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); btnUnsavedSave.click(); }
      else if (e.key === "Escape") { e.preventDefault(); closeUnsavedModal(); }
    });
  }

  window.addEventListener("beforeunload", (e) => {
    if (hasUnsavedChanges()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  /* -------------------------------------------------------------------------
   * Snapshots, Projects Storage (Project -> Presets[]), & Live URL (#s=...)
   * ------------------------------------------------------------------------- */

  function normLineWidthWs(v, fallback = 2.2) {
    if (v === undefined || v === null || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, n) : fallback;
  }

  function normOpacityWs(v, fallback = 1.0) {
    if (v === undefined || v === null || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
  }

  function encodeJsonForHash(obj) {
    return encodeURIComponent(JSON.stringify(obj))
      .replace(/%7B/g, "{")
      .replace(/%7D/g, "}")
      .replace(/%5B/g, "[")
      .replace(/%5D/g, "]")
      .replace(/%3A/g, ":")
      .replace(/%2C/g, ",");
  }

  function buildWorkspaceSnapshot() {
    const fns = fnCards();
    const primaryIdx = Math.max(0, fns.findIndex((c) => c.id === state.primaryCardId));
    return {
      v: 1,
      m: state.mode,
      nm: state.activeProjectName || "",
      desc: state.activeProjectDescription || "",
      ex: (!state.activeProjectIsCustom && state.activeProjectId) ? state.activeProjectId : "",
      pr: state.activePresetId || "",
      sp: isRealMode() ? undefined : Math.round(state.splitPct * 10) / 10,
      pi: primaryIdx,
      fn: fns.map((c) => ({
        t: c.title || "",
        cd: c.code || "",
        col: c.color || "#38bdf8",
        w: normLineWidthWs(c.lineWidth, 2.2),
        op: normOpacityWs(c.opacity, 1.0),
        st: c.lineStyle || "solid",
        stp: c.step ? 1 : 0,
        lk: c.locked ? 1 : 0,
        v: c.visible !== false ? 1 : 0,
        b: c.builtin || undefined,
      })),
      sl: sliderCards().map((s) => ({
        n: s.name,
        l: s.label || "",
        val: Number(s.value) || 0,
        mn: Number(s.min) || 0,
        mx: Number(s.max) || 10,
        st: Number(s.step) || 0.1,
        sp: Number(s.speed) || 1.0,
      })),
      vr: varCards().map((v) => ({
        n: v.name,
        l: v.label || "",
        ex: String(v.expr || "0"),
      })),
      c: isRealMode()
        ? (window.CFVReal && window.CFVReal.exportSnapshot ? window.CFVReal.exportSnapshot() : null)
        : (window.CFVComplex && window.CFVComplex.exportSnapshot ? window.CFVComplex.exportSnapshot() : null),
    };
  }

  function syncUrl(push = false, withStateHash = false) {
    const base = state.mode === "real" ? "/real" : state.mode === "integral" ? "/integral" : "/map";
    const qs = new URLSearchParams();
    if (!state.activeProjectIsCustom && state.activeProjectId && !withStateHash) {
      qs.set("ex", state.activeProjectId);
      if (state.activePresetId) qs.set("preset", state.activePresetId);
    }
    const queryStr = qs.toString();
    let hashStr = "";
    if (withStateHash) {
      const readable = snapshotToReadableState(buildWorkspaceSnapshot());
      if (readable) {
        const urlObj = {
          format: "cfv_project_v1",
          ...(state.activeProjectName ? { name: state.activeProjectName } : {}),
          ...(state.activeProjectDescription ? { description: state.activeProjectDescription } : {}),
          ...readable,
        };
        const encoded = encodeJsonForHash(urlObj);
        if (encoded && encoded.length <= 48000) {
          hashStr = "#json=" + encoded;
        }
      }
    }
    const targetUrl = `${base}${queryStr ? "?" + queryStr : ""}${hashStr}`;
    const curUrl = window.location.pathname + window.location.search + (window.location.hash || "");
    if (curUrl !== targetUrl) {
      const histState = { proj: state.activeProjectId, preset: state.activePresetId, customHash: withStateHash };
      if (push) window.history.pushState(histState, "", targetUrl);
      else window.history.replaceState(histState, "", targetUrl);
    }
  }

  function notifyStateChanged(immediate = false, markDirty = true) {
    if (state.restoringState) return;

    if (markDirty) {
      /* Any structural/content edit exits any active preset & transitions built-in example -> Unsaved Project
         WITHOUT wiping the current project's presets! */
      const wasInPreset = state.activePresetId !== null;
      const wasBuiltIn = Boolean(state.activeProjectId && !state.activeProjectIsCustom);
      state.activePresetId = null;

      if (wasBuiltIn) {
        state.activeProjectId = null;
        state.activeProjectName = "Unsaved Project";
      } else if (!state.activeProjectId) {
        state.activeProjectName = isBlankWorkspace() && state.projectPresets.length === 0 ? "New Project" : "Unsaved Project";
      }

      state.hasUnsavedWork = !isBlankWorkspace() || state.projectPresets.length > 0;
      updateProjectHeaderUI();
      if (wasInPreset || wasBuiltIn) {
        renderPresetBar();
        renderExamplesMenu();
      }
    }

    if (isBlankWorkspace() && !state.activeProjectId && state.projectPresets.length === 0) {
      syncUrl(false, false);
      return;
    }
    /* Scrubbing/panning/zooming inside an unmodified stock example keeps the clean preset URL! */
    if (!markDirty && !state.hasUnsavedWork && !state.activeProjectIsCustom) {
      return;
    }
    /* Never run expensive Base64 snapshot serialization + history.replaceState while a slider is playing or scrubbing! */
    if (!markDirty && (!immediate || isAnySliderPlaying())) {
      return;
    }

    if (state.urlSyncTimer) {
      clearTimeout(state.urlSyncTimer);
      state.urlSyncTimer = null;
    }
    if (immediate) {
      syncUrl(false, true);
    } else {
      state.urlSyncTimer = setTimeout(() => {
        state.urlSyncTimer = null;
        if (!state.restoringState) syncUrl(false, true);
      }, 150);
    }
  }

  function parseUrlStateHash() {
    const h = window.location.hash || "";
    if (h.startsWith("#json=")) {
      try {
        const raw = decodeURIComponent(h.slice(6));
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object") {
          const snap = readableStateToSnapshot(obj);
          if (snap && snap.v === 1 && Array.isArray(snap.fn)) {
            if (obj.name) snap.nm = String(obj.name);
            if (obj.description) snap.desc = String(obj.description);
            return snap;
          }
        }
      } catch (_) {
        return null;
      }
    }
    if (h.startsWith("#s=")) {
      const snap = decodeStateB64(h.slice(3));
      if (!snap || snap.v !== 1 || !Array.isArray(snap.fn)) return null;
      return snap;
    }
    return null;
  }

  function parseUrlRoute() {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const exParam = params.get("ex");
    const presetParam = params.get("preset");
    const modeFromPath = path === "/real" ? "real" : path === "/integral" ? "integral" : "map";

    if (exParam) {
      const ex = window.CFVExamples.list.find((e) => e.id === exParam);
      if (ex) {
        const pr =
          (presetParam && ex.presets && ex.presets.find((p) => p.id === presetParam)) ||
          (ex.presets && ex.presets[0]) ||
          null;
        return { kind: "example", ex, preset: pr };
      }
    }
    return { kind: "blank", mode: modeFromPath };
  }

  /* -------------------------------------------------------------------------
   * Full Project JSON (cfv_project_v1) <-> Snapshot Converters & Repo Storage
   * ------------------------------------------------------------------------- */

  function makePrimitivePtsForSnapshot(sh, pm) {
    const ev = (window.CFVComplex && window.CFVComplex.evalParamExpr) || ((x) => Number(x) || 0);
    if (sh.formula && typeof sh.formula === "object") {
      const f = sh.formula;
      const fk = f.kind || sh.kind || "circle";
      if (fk === "line") {
        const x0 = ev(f.x0 ?? -1, pm), y0 = ev(f.y0 ?? 0, pm), x1 = ev(f.x1 ?? 1, pm), y1 = ev(f.y1 ?? 0, pm);
        return { pts: [{ x: x0, y: y0 }, { x: x1, y: y1 }], closed: false };
      }
      if (fk === "rect") {
        const x0 = ev(f.x0 ?? -1, pm), y0 = ev(f.y0 ?? -1, pm), x1 = ev(f.x1 ?? 1, pm), y1 = ev(f.y1 ?? 1, pm);
        return { pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], closed: true };
      }
      if (fk === "arc") {
        const cx = ev(f.cx ?? 0, pm), cy = ev(f.cy ?? 0, pm), r = Math.max(0.02, ev(f.r ?? 1, pm));
        const a0 = ev(f.a0 ?? 0, pm), a1 = ev(f.a1 ?? Math.PI, pm);
        const pts = [];
        for (let i = 0; i <= 48; i++) {
          const a = a0 + (a1 - a0) * (i / 48);
          pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        }
        return { pts, closed: false };
      }
      if (fk === "parametric") {
        const u0 = ev(f.u0 ?? 0, pm), u1 = ev(f.u1 ?? Math.PI * 2, pm);
        const pts = [];
        for (let i = 0; i <= 64; i++) {
          const u = u0 + (u1 - u0) * (i / 64);
          pts.push({ x: ev(f.xExpr ?? "cos(u)", pm, u), y: ev(f.yExpr ?? "sin(u)", pm, u) });
        }
        return { pts, closed: Boolean(f.closed ?? sh.closed) };
      }
      const cx = ev(f.cx ?? 0, pm), cy = ev(f.cy ?? 0, pm), r = Math.max(0.02, ev(f.r ?? 1, pm));
      const pts = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
      return { pts, closed: true };
    }
    if (Array.isArray(sh.rawPts) && sh.rawPts.length >= 2) {
      return {
        pts: sh.rawPts.map((p) => (Array.isArray(p) ? { x: Number(p[0]) || 0, y: Number(p[1]) || 0 } : { x: Number(p.x) || 0, y: Number(p.y) || 0 })),
        closed: sh.closed !== undefined ? Boolean(sh.closed) : true,
      };
    }
    if (Array.isArray(sh.points) && sh.points.length >= 2) {
      return {
        pts: sh.points.map((p) => (Array.isArray(p) ? { x: Number(p[0]) || 0, y: Number(p[1]) || 0 } : { x: Number(p.x) || 0, y: Number(p.y) || 0 })),
        closed: sh.closed !== undefined ? Boolean(sh.closed) : true,
      };
    }
    const kind = sh.kind || "circle";
    if (kind === "rect") {
      const x0 = Number(sh.x0 ?? -1), y0 = Number(sh.y0 ?? -1), x1 = Number(sh.x1 ?? 1), y1 = Number(sh.y1 ?? 1);
      return { pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], closed: true };
    }
    if (kind === "line") {
      const x0 = Number(sh.x0 ?? -1), y0 = Number(sh.y0 ?? 0), x1 = Number(sh.x1 ?? 1), y1 = Number(sh.y1 ?? 0);
      const pts = [];
      for (let i = 0; i <= 32; i++) {
        const t = i / 32;
        pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
      }
      return { pts, closed: Boolean(sh.closed) };
    }
    if (kind === "arc") {
      const cx = Number(sh.cx ?? 0), cy = Number(sh.cy ?? 0), r = Math.max(0.02, Number(sh.r ?? 1));
      const a0 = Number(sh.a0 ?? 0), a1 = Number(sh.a1 ?? Math.PI);
      const pts = [];
      for (let i = 0; i <= 48; i++) {
        const a = a0 + (a1 - a0) * (i / 48);
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
      return { pts, closed: Boolean(sh.closed) };
    }
    const cx = Number(sh.cx ?? 0), cy = Number(sh.cy ?? 0), r = Math.max(0.02, Number(sh.r ?? 1));
    const pts = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return { pts, closed: sh.closed !== undefined ? Boolean(sh.closed) : true };
  }

  function snapshotToReadableState(snap) {
    if (!snap) return null;
    if (snap.format === "cfv_project_v1" || Array.isArray(snap.cards)) {
      return JSON.parse(JSON.stringify(snap));
    }
    const mode = snap.m === "real" || snap.m === "integral" ? snap.m : "map";
    const pi = typeof snap.pi === "number" ? snap.pi : 0;
    const out = {
      mode,
      ...(snap.desc ? { description: snap.desc } : {}),
      splitPct: mode === "real" ? undefined : (typeof snap.sp === "number" ? snap.sp : 50),
      cards: (snap.fn || []).map((c, idx) => ({
        title: c.t || `Function ${idx + 1}`,
        code: c.cd || "",
        color: c.col || COLORS[idx % COLORS.length],
        lineWidth: normLineWidthWs(c.w, 2.2),
        opacity: normOpacityWs(c.op, 1.0),
        lineStyle: c.st || "solid",
        step: Boolean(c.stp),
        locked: Boolean(c.lk),
        visible: c.v !== 0,
        active: mode === "real" ? (c.v !== 0) : (idx === pi),
      })),
      sliders: (snap.sl || []).map((s) => ({
        name: s.n || "a",
        label: s.l || "",
        value: Number(s.val ?? 0),
        min: Number(s.mn ?? 0),
        max: Number(s.mx ?? 10),
        step: Number(s.st ?? 0.1),
        speed: Number(s.sp ?? 1.0),
      })),
      vars: (snap.vr || []).map((v) => ({
        name: v.n || "R",
        label: v.l || "",
        expr: String(v.ex ?? "0"),
      })),
    };
    const c = snap.c || {};
    if (mode === "real") {
      out.points = (c.pt || []).map((p) => ({
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
        label: p.l || "",
        icon: p.i || "diamond",
        color: p.c || "#34d399",
        size: Number(p.s) || 5,
        opacity: normOpacityWs(p.op, 1.0),
        locked: Boolean(p.lk),
        visible: p.v !== 0,
        showLabel: p.sl !== 0,
      }));
      out.lines = (c.ln || []).map((ln) => ({
        orientation: ln.o === "h" ? "horizontal" : "vertical",
        value: Number(ln.val) || 0,
        label: ln.l || "",
        color: ln.c || "#fbbf24",
        lineWidth: normLineWidthWs(ln.w, 1.5),
        opacity: normOpacityWs(ln.op, 1.0),
        lineStyle: ln.st || "dashed",
        locked: Boolean(ln.lk),
        visible: ln.v !== 0,
        showLabel: ln.sl !== 0,
      }));
      if (Array.isArray(c.lo) && c.lo.length > 0) out.layerOrder = [...c.lo];
      if (Array.isArray(c.pg) && c.pg.length >= 2) {
        const cells = [];
        for (let i = 0; i + 1 < c.pg.length; i += 2) cells.push([c.pg[i], c.pg[i + 1]]);
        out.seedCells = cells;
      }
      const vw = Array.isArray(c.vw) && c.vw.length >= 4 ? c.vw : [-10, 10, -10, 10];
      out.viewport = {
        view: { xmin: Number(vw[0]), xmax: Number(vw[1]), ymin: Number(vw[2]), ymax: Number(vw[3]) },
        squareAspect: c.sq !== undefined ? Boolean(c.sq) : true,
        showPrimes: Boolean(c.sp),
        showZeros: Boolean(c.sz),
      };
    } else {
      out.shapes = (c.sh || []).map((s) => {
        const item = {
          kind: s.k || "freehand",
          label: s.l || "Shape",
          color: s.c || "#38bdf8",
          lineWidth: normLineWidthWs(s.w, 2.2),
          opacity: normOpacityWs(s.op, 1.0),
          lineStyle: s.st || "solid",
          locked: Boolean(s.lk),
          closed: Boolean(s.cl),
          visible: s.v !== 0,
        };
        if (s.f) {
          item.formula = { ...s.f };
        } else {
          const rawPts = [];
          const flat = Array.isArray(s.p) ? s.p : [];
          for (let i = 0; i + 1 < flat.length; i += 2) {
            rawPts.push({ x: Number(flat[i]), y: Number(flat[i + 1]) });
          }
          item.rawPts = rawPts;
        }
        return item;
      });
      out.points = (c.pt || []).map((p) => ({
        x: Number(p.x) || 0,
        y: Number(p.y) || 0,
        label: p.l || "",
        icon: p.i || "dot",
        color: p.c || "#34d399",
        size: Number(p.s) || 5,
        opacity: normOpacityWs(p.op, 1.0),
        locked: Boolean(p.lk),
        visible: p.v !== 0,
        showLabel: p.sl !== 0,
      }));
      out.lines = (c.ln || []).map((ln) => ({
        orientation: ln.o === "h" ? "horizontal" : "vertical",
        value: Number(ln.val) || 0,
        label: ln.l || "",
        color: ln.c || "#fbbf24",
        lineWidth: normLineWidthWs(ln.w, 1.5),
        opacity: normOpacityWs(ln.op, 1.0),
        lineStyle: ln.st || "dashed",
        locked: Boolean(ln.lk),
        visible: ln.v !== 0,
        showLabel: ln.sl !== 0,
      }));
      if (Array.isArray(c.lo) && c.lo.length > 0) out.layerOrder = [...c.lo];
      const iv = Array.isArray(c.iv) && c.iv.length >= 3 ? c.iv : [0, 0, 4];
      const ov = Array.isArray(c.ov) && c.ov.length >= 3 ? c.ov : [0, 0, 4];
      const spv = Array.isArray(c.spv) && c.spv.length >= 3 ? c.spv : [-0.58, 0.22, 1.0];
      out.viewport = {
        inView: { cx: Number(iv[0]), cy: Number(iv[1]), r: Number(iv[2]) },
        outView: { cx: Number(ov[0]), cy: Number(ov[1]), r: Number(ov[2]) },
        inSquare: c.isq !== undefined ? Boolean(c.isq) : true,
        outSquare: c.osq !== undefined ? Boolean(c.osq) : true,
        showSphere: c.proj === "sphere" || Boolean(c.sph),
        projection: c.proj || (c.sph ? "sphere" : "planar"),
        ...(c.pexpr ? { projectionExpr: c.pexpr } : {}),
        sphereView: { yaw: Number(spv[0]), pitch: Number(spv[1]), zoom: Number(spv[2]) },
        ...(c.dom ? { showDomain: true, domainScheme: c.dscm || "classic", domainOpacity: normOpacityWs(c.dop, 0.72) } : {}),
      };
    }
    return out;
  }

  function readableStateToSnapshot(obj, baseObj = null) {
    if (!obj) return null;
    if (obj.v === 1 && Array.isArray(obj.fn)) {
      return JSON.parse(JSON.stringify(obj));
    }
    if (obj.snapshot && obj.snapshot.v === 1 && Array.isArray(obj.snapshot.fn)) {
      return JSON.parse(JSON.stringify(obj.snapshot));
    }
    if (obj.baseState && obj.baseState.v === 1 && !Array.isArray(obj.cards)) {
      return JSON.parse(JSON.stringify(obj.baseState));
    }

    const base = baseObj && baseObj.baseState && !Array.isArray(baseObj.cards)
      ? snapshotToReadableState(baseObj.baseState)
      : (baseObj || {});
    const mode =
      obj.mode === "real" || obj.mode === "integral" || obj.mode === "map"
        ? obj.mode
        : (base.mode === "real" || base.mode === "integral" || base.mode === "map" ? base.mode : state.mode);

    const rawCards = Array.isArray(obj.cards) ? obj.cards : (Array.isArray(base.cards) ? base.cards : []);
    const visIdx = Array.isArray(obj.visibleFnIndices) ? obj.visibleFnIndices : null;
    let primaryIdx = 0;
    const fn = rawCards.map((c, idx) => {
      const isObj = typeof c === "object" && c !== null;
      const code = typeof c === "string" ? c : (c.code || (mode === "real" ? "sin(x)" : "c_zeta(s)"));
      if (isObj && c.active === true) primaryIdx = idx;
      const vis = visIdx ? visIdx.includes(idx) : (isObj && c.visible !== undefined ? Boolean(c.visible) : true);
      return {
        t: (isObj && c.title) ? c.title : `Function ${idx + 1}`,
        cd: code,
        col: (isObj && c.color) ? c.color : COLORS[idx % COLORS.length],
        w: isObj ? normLineWidthWs(c.lineWidth, 2.2) : 2.2,
        op: isObj ? normOpacityWs(c.opacity, 1.0) : 1.0,
        st: (isObj && c.lineStyle) || "solid",
        stp: isObj && c.step ? 1 : 0,
        lk: isObj && c.locked ? 1 : 0,
        v: vis ? 1 : 0,
        b: (isObj && c.builtin) || undefined,
      };
    });

    const rawSliders = Array.isArray(obj.sliders) ? obj.sliders : (Array.isArray(base.sliders) ? base.sliders : []);
    const rawVars = Array.isArray(obj.vars) ? obj.vars : (Array.isArray(base.vars) ? base.vars : []);
    const sliderOverrides = obj.sliderValues && typeof obj.sliderValues === "object" ? obj.sliderValues : {};
    const sl = [];
    const vr = [];
    const pm = getViewportGlobals();

    for (const s of rawSliders) {
      const name = String(s.name || "a").replace(/[^a-zA-Z0-9_]/g, "") || "a";
      if (s.expr !== undefined && s.min === undefined) {
        vr.push({ n: name, l: s.label || "", ex: String(s.expr) });
      } else {
        const mn = Number(s.min ?? 0);
        const mx = Number(s.max ?? 10);
        let val = Object.prototype.hasOwnProperty.call(sliderOverrides, name)
          ? Number(sliderOverrides[name])
          : Number(s.value ?? 1);
        if (obj.startSlider === name) val = mn;
        sl.push({
          n: name,
          l: s.label || "parameter",
          val,
          mn,
          mx,
          st: Number(s.step ?? 0.1),
          sp: Number(s.speed ?? 1.0),
        });
        pm[name] = val;
      }
    }
    const ev = (window.CFVComplex && window.CFVComplex.evalParamExpr) || ((x) => Number(x) || 0);
    for (const v of rawVars) {
      const name = String(v.name || "R").replace(/[^a-zA-Z0-9_]/g, "") || "R";
      const expr = Object.prototype.hasOwnProperty.call(sliderOverrides, name)
        ? String(sliderOverrides[name])
        : String(v.expr ?? v.value ?? "0");
      vr.push({ n: name, l: v.label || "", ex: expr });
      const val = ev(expr, pm);
      if (Number.isFinite(val)) pm[name] = val;
    }

    const vpObj = {
      ...(base.viewport || {}),
      ...(obj.viewport || {}),
    };
    if (obj.inView || base.inView) vpObj.inView = obj.inView || vpObj.inView || base.inView;
    if (obj.outView || base.outView) vpObj.outView = obj.outView || vpObj.outView || base.outView;
    if (obj.inSquare !== undefined) vpObj.inSquare = obj.inSquare;
    if (obj.outSquare !== undefined) vpObj.outSquare = obj.outSquare;
    if (obj.showSphere !== undefined) vpObj.showSphere = obj.showSphere;
    if (obj.sphereView || base.sphereView) vpObj.sphereView = obj.sphereView || vpObj.sphereView || base.sphereView;
    if (obj.view || base.view) vpObj.view = obj.view || vpObj.view || base.view;
    if (obj.squareAspect !== undefined) vpObj.squareAspect = obj.squareAspect;
    if (obj.showPrimes !== undefined) vpObj.showPrimes = obj.showPrimes;
    if (obj.showZeros !== undefined) vpObj.showZeros = obj.showZeros;

    const rawPts = Array.isArray(obj.points) ? obj.points : (Array.isArray(base.points) ? base.points : []);
    const rawLns = Array.isArray(obj.lines) ? obj.lines : (Array.isArray(base.lines) ? base.lines : []);
    const pt = rawPts.map((p) => ({
      x: Number(p.x) || 0,
      y: Number(p.y) || 0,
      l: p.label || "",
      i: p.icon || (mode === "real" ? "diamond" : "dot"),
      c: p.color || "#34d399",
      s: Number(p.size) || 5,
      op: normOpacityWs(p.opacity ?? p.op, 1.0),
      lk: p.locked ? 1 : 0,
      v: p.visible !== false ? 1 : 0,
      sl: p.showLabel !== false ? 1 : 0,
    }));
    const ln = rawLns.map((l) => ({
      o: l.orientation === "horizontal" || l.o === "h" ? "h" : "v",
      val: Number(l.value ?? l.val ?? 0),
      l: l.label || "",
      c: l.color || "#fbbf24",
      w: normLineWidthWs(l.lineWidth ?? l.w, 1.5),
      op: normOpacityWs(l.opacity ?? l.op, 1.0),
      st: l.lineStyle || l.st || "dashed",
      lk: l.locked ? 1 : 0,
      v: l.visible !== false ? 1 : 0,
      sl: l.showLabel !== false ? 1 : 0,
    }));

    const layerRefs = Array.isArray(obj.layerOrder) ? obj.layerOrder : (Array.isArray(base.layerOrder) ? base.layerOrder : undefined);

    let cSnap = null;
    if (mode === "real") {
      const vwObj = vpObj.view || { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
      const vw = Array.isArray(vwObj)
        ? [Number(vwObj[0]), Number(vwObj[1]), Number(vwObj[2]), Number(vwObj[3])]
        : [Number(vwObj.xmin ?? -10), Number(vwObj.xmax ?? 10), Number(vwObj.ymin ?? -10), Number(vwObj.ymax ?? 10)];
      cSnap = {
        vw,
        sq: vpObj.squareAspect !== undefined ? (vpObj.squareAspect ? 1 : 0) : 1,
        sp: vpObj.showPrimes ? 1 : 0,
        sz: vpObj.showZeros ? 1 : 0,
        ...(layerRefs ? { lo: [...layerRefs] } : {}),
        pt,
        ln,
      };
      const rawCells = obj.seedCells ?? obj.polygons ?? base.seedCells ?? base.polygons;
      if (obj.fillGrid) {
        const r = Math.min(60, Math.max(4, Math.round(Number(pm.R) || 32)));
        const pg = [];
        for (let y = -r; y < r; y++) {
          for (let x = -r; x < r; x++) pg.push(x, y);
        }
        cSnap.pg = pg;
      } else if (Array.isArray(rawCells) && rawCells.length > 0) {
        const pg = [];
        if (typeof rawCells[0] === "number") {
          for (let i = 0; i + 1 < rawCells.length; i += 2) pg.push(Math.round(rawCells[i]), Math.round(rawCells[i + 1]));
        } else {
          for (const cell of rawCells) {
            const gx = Math.round(Number(Array.isArray(cell) ? cell[0] : (cell.gx ?? cell.x)));
            const gy = Math.round(Number(Array.isArray(cell) ? cell[1] : (cell.gy ?? cell.y)));
            if (Number.isFinite(gx) && Number.isFinite(gy)) pg.push(gx, gy);
          }
        }
        if (pg.length >= 2) cSnap.pg = pg;
      }
    } else {
      const ivObj = vpObj.inView || { cx: 0, cy: 0, r: 4 };
      const ovObj = vpObj.outView || { cx: 0, cy: 0, r: 4 };
      const spvObj = vpObj.sphereView || { yaw: -0.58, pitch: 0.22, zoom: 1.0 };
      const iv = Array.isArray(ivObj) ? ivObj : [Number(ivObj.cx ?? 0), Number(ivObj.cy ?? 0), Number(ivObj.r ?? 4)];
      const ov = Array.isArray(ovObj) ? ovObj : [Number(ovObj.cx ?? 0), Number(ovObj.cy ?? 0), Number(ovObj.r ?? 4)];
      const spv = Array.isArray(spvObj) ? spvObj : [Number(spvObj.yaw ?? -0.58), Number(spvObj.pitch ?? 0.22), Number(spvObj.zoom ?? 1.0)];
      const rawShapes = Array.isArray(obj.shapes) ? obj.shapes : (Array.isArray(base.shapes) ? base.shapes : []);
      const sh = rawShapes.map((s, idx) => {
        const built = makePrimitivePtsForSnapshot(s, pm);
        const flat = [];
        for (const p of built.pts) flat.push(Math.round(p.x * 10000) / 10000, Math.round(p.y * 10000) / 10000);
        const rec = {
          k: s.kind || (s.formula && s.formula.kind) || "circle",
          l: s.label || s.kind || `Shape ${idx + 1}`,
          c: s.color || COLORS[idx % COLORS.length],
          w: normLineWidthWs(s.lineWidth, 2.2),
          op: normOpacityWs(s.opacity ?? s.op, 1.0),
          st: s.lineStyle || "solid",
          lk: s.locked ? 1 : 0,
          cl: built.closed ? 1 : 0,
          v: s.visible !== false ? 1 : 0,
          p: flat,
        };
        if (s.formula) rec.f = { ...s.formula };
        return rec;
      });
      const projMode = vpObj.projection || obj.projection || (vpObj.showSphere ? "sphere" : "planar");
      const projExpr = vpObj.projectionExpr || obj.projectionExpr || "";
      const showDom = vpObj.showDomain !== undefined ? Boolean(vpObj.showDomain) : Boolean(obj.showDomain);
      const domScheme = vpObj.domainScheme || obj.domainScheme || "classic";
      const domOp = normOpacityWs(vpObj.domainOpacity ?? obj.domainOpacity, domScheme === "classic" ? 0.72 : 1.0);
      cSnap = {
        iv,
        ov,
        isq: vpObj.inSquare !== undefined ? (vpObj.inSquare ? 1 : 0) : 1,
        osq: vpObj.outSquare !== undefined ? (vpObj.outSquare ? 1 : 0) : 1,
        sph: projMode === "sphere" || vpObj.showSphere ? 1 : 0,
        proj: projMode,
        ...(projExpr ? { pexpr: projExpr } : {}),
        spv,
        ...(showDom ? { dom: 1, dscm: domScheme, dop: domOp } : {}),
        ...(layerRefs ? { lo: [...layerRefs] } : {}),
        sh,
        pt,
        ln,
      };
    }

    return {
      v: 1,
      m: mode,
      desc: String(obj.description ?? base.description ?? ""),
      ex: "",
      pr: obj.id || "",
      sp: mode === "real" ? undefined : (Number(obj.splitPct ?? base.splitPct) || 50),
      pi: primaryIdx,
      fn,
      sl,
      vr,
      c: cSnap,
    };
  }

  function exportFullProjectObject(customName = null) {
    const snap = buildWorkspaceSnapshot();
    const readable = snapshotToReadableState(snap);
    const ex = (!state.activeProjectIsCustom && state.activeProjectId && window.CFVExamples)
      ? window.CFVExamples.byId(state.activeProjectId)
      : null;
    const projName = (customName && customName.trim()) ||
      (state.activeProjectName && state.activeProjectName !== "New Project" && state.activeProjectName !== "Unsaved Project"
        ? state.activeProjectName
        : defaultProjectName());
    const projId = (state.activeProjectIsCustom && state.activeProjectId)
      ? state.activeProjectId
      : ("proj_" + Date.now() + "_" + Math.floor(Math.random() * 1000));

    const presetsOut = (state.projectPresets || []).map((p, idx) => {
      if (p.snapshot) {
        const rs = snapshotToReadableState(p.snapshot);
        return {
          id: p.id || `preset_${idx + 1}`,
          name: p.name || `Preset ${idx + 1}`,
          ...(p.startSlider ? { startSlider: p.startSlider } : {}),
          ...rs,
        };
      }
      if (p.builtinPreset) {
        const bp = p.builtinPreset;
        const pr = {
          id: p.id || bp.id || `preset_${idx + 1}`,
          name: p.name || bp.name || `Preset ${idx + 1}`,
        };
        if (bp.sliderValues) pr.sliderValues = { ...bp.sliderValues };
        if (bp.startSlider) pr.startSlider = bp.startSlider;
        if (Array.isArray(bp.visibleFnIndices)) pr.visibleFnIndices = [...bp.visibleFnIndices];
        if (state.mode === "real") {
          pr.viewport = {
            view: bp.view ? { ...bp.view } : { ...readable.viewport.view },
            squareAspect: bp.squareAspect !== undefined ? Boolean(bp.squareAspect) : true,
          };
          if (Array.isArray(bp.polygons)) pr.seedCells = bp.polygons.map((c) => [c[0], c[1]]);
          if (bp.fillGrid) pr.fillGrid = true;
        } else {
          pr.viewport = {
            inView: bp.inView ? { ...bp.inView } : { ...readable.viewport.inView },
            outView: bp.outView ? { ...bp.outView } : { ...readable.viewport.outView },
            inSquare: bp.inSquare !== undefined ? Boolean(bp.inSquare) : true,
            outSquare: bp.outSquare !== undefined ? Boolean(bp.outSquare) : true,
            showSphere: bp.showSphere !== undefined ? Boolean(bp.showSphere) : Boolean(ex && ex.defaultSphere),
            sphereView: bp.sphereView ? { ...bp.sphereView } : { ...readable.viewport.sphereView },
          };
          if (Array.isArray(bp.shapes)) pr.shapes = JSON.parse(JSON.stringify(bp.shapes));
        }
        if (Array.isArray(bp.points)) pr.points = JSON.parse(JSON.stringify(bp.points));
        if (Array.isArray(bp.lines)) pr.lines = JSON.parse(JSON.stringify(bp.lines));
        return pr;
      }
      return { id: p.id || `preset_${idx + 1}`, name: p.name || `Preset ${idx + 1}` };
    });

    return {
      format: "cfv_project_v1",
      id: projId,
      name: projName,
      folder: state.activeProjectFolder || "my",
      subtitle: (ex && ex.subtitle) || `${readable.cards.length} card${readable.cards.length === 1 ? "" : "s"} · ${presetsOut.length} preset${presetsOut.length === 1 ? "" : "s"}`,
      description: state.activeProjectDescription || (ex && ex.description) || "",
      mode: readable.mode,
      ...(readable.splitPct !== undefined ? { splitPct: readable.splitPct } : {}),
      cards: readable.cards,
      sliders: readable.sliders,
      vars: readable.vars,
      ...(readable.shapes ? { shapes: readable.shapes } : {}),
      ...(readable.seedCells ? { seedCells: readable.seedCells } : {}),
      points: readable.points || [],
      lines: readable.lines || [],
      ...(readable.layerOrder ? { layerOrder: readable.layerOrder } : {}),
      viewport: readable.viewport,
      presets: presetsOut,
    };
  }

  function exportProjectJSON(customName = null) {
    return JSON.stringify(exportFullProjectObject(customName), null, 2);
  }

  /* -------------------------------------------------------------------------
   * Library Metadata (Custom Folders, Example Renames & Deleted Examples)
   * Persisted to localStorage AND projects/_cfv_library_meta.json!
   * ------------------------------------------------------------------------- */

  function normalizeLibraryMeta(raw) {
    const folders = Array.isArray(raw && raw.folders)
      ? raw.folders
          .filter((f) => f && f.id && f.name && f.id !== "my" && f.id !== "examples")
          .map((f) => ({
            id: String(f.id),
            name: String(f.name).trim(),
            mode: f.mode === "real" || f.mode === "integral" ? f.mode : "map",
          }))
      : [];
    const exampleRenames = raw && raw.exampleRenames && typeof raw.exampleRenames === "object"
      ? { ...raw.exampleRenames }
      : {};
    const deletedExamples = Array.isArray(raw && raw.deletedExamples)
      ? Array.from(new Set(raw.deletedExamples.map(String)))
      : [];
    return { folders, exampleRenames, deletedExamples };
  }

  function loadLibraryMeta() {
    try {
      const raw = window.localStorage && window.localStorage.getItem(LIBRARY_META_KEY);
      if (raw) state.libraryMeta = normalizeLibraryMeta(JSON.parse(raw));
    } catch (_) {}
    return state.libraryMeta;
  }

  function saveLibraryMeta(persistToServer = true) {
    state.libraryMeta = normalizeLibraryMeta(state.libraryMeta);
    try {
      if (window.localStorage) {
        window.localStorage.setItem(LIBRARY_META_KEY, JSON.stringify(state.libraryMeta));
      }
    } catch (_) {}
    if (persistToServer) {
      const payload = {
        format: "cfv_library_meta_v1",
        id: LIBRARY_META_ID,
        ...state.libraryMeta,
      };
      try {
        fetch("/api/projects/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload, null, 2),
        }).catch(() => {});
      } catch (_) {}
    }
  }

  function getModeDisplayName(mode = state.mode) {
    return mode === "real" ? "2D Real" : mode === "integral" ? "Contour Integral" : "Complex Map";
  }

  function getFoldersForMode(mode = state.mode) {
    const custom = (state.libraryMeta.folders || []).filter((f) => f.mode === mode);
    return [
      { id: "my", name: "My Saved Projects", builtin: true, mode },
      ...custom.map((f) => ({ ...f, builtin: false })),
      { id: "examples", name: `Example ${getModeDisplayName(mode)} Projects`, builtin: true, mode },
    ];
  }

  function createFolder(name, mode = state.mode) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return null;
    const f = {
      id: "folder_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      name: trimmed,
      mode,
    };
    state.libraryMeta.folders.push(f);
    state.folderCollapsed[f.id] = false;
    saveLibraryMeta(true);
    renderExamplesMenu();
    return f;
  }

  function renameFolder(folderId, newName) {
    const trimmed = String(newName || "").trim();
    if (!folderId || !trimmed) return null;
    const f = (state.libraryMeta.folders || []).find((x) => x.id === folderId);
    if (!f) return null;
    f.name = trimmed;
    saveLibraryMeta(true);
    renderExamplesMenu();
    return f;
  }

  function deleteFolder(folderId) {
    if (!folderId || folderId === "my" || folderId === "examples") return;
    state.libraryMeta.folders = (state.libraryMeta.folders || []).filter((x) => x.id !== folderId);
    const list = [...loadSavedProjects()];
    let moved = false;
    for (const p of list) {
      if (p.folder === folderId) {
        p.folder = "my";
        persistProjectToRepo(p);
        moved = true;
      }
    }
    if (moved) writeSavedProjects(list);
    if (state.activeProjectFolder === folderId) state.activeProjectFolder = "my";
    saveLibraryMeta(true);
    renderExamplesMenu();
  }

  function getExampleDisplayName(ex) {
    if (!ex) return "";
    const custom = state.libraryMeta && state.libraryMeta.exampleRenames && state.libraryMeta.exampleRenames[ex.id];
    return (custom && String(custom).trim()) || ex.title;
  }

  function isExampleDeleted(exId) {
    return Boolean(
      state.libraryMeta &&
      Array.isArray(state.libraryMeta.deletedExamples) &&
      state.libraryMeta.deletedExamples.includes(exId)
    );
  }

  function renameBuiltInExample(exId, newName) {
    const trimmed = String(newName || "").trim();
    if (!exId || !trimmed) return false;
    state.libraryMeta.exampleRenames[exId] = trimmed;
    saveLibraryMeta(true);
    if (!state.activeProjectIsCustom && state.activeProjectId === exId) {
      state.activeProjectName = trimmed;
      updateProjectHeaderUI();
    }
    renderExamplesMenu();
    return true;
  }

  function deleteBuiltInExample(exId) {
    if (!exId) return false;
    if (!state.libraryMeta.deletedExamples.includes(exId)) {
      state.libraryMeta.deletedExamples.push(exId);
    }
    saveLibraryMeta(true);
    if (!state.activeProjectIsCustom && state.activeProjectId === exId) {
      state.activeProjectId = null;
      state.activeProjectIsCustom = false;
      state.activeProjectName = "Unsaved Project";
      state.hasUnsavedWork = !isBlankWorkspace();
      updateProjectHeaderUI();
    }
    renderExamplesMenu();
    return true;
  }

  function exampleToProjectObject(ex) {
    if (!ex) return null;
    const displayName = getExampleDisplayName(ex);
    const mode = ex.mode === "real" || ex.mode === "integral" ? ex.mode : "map";
    const firstPreset = (ex.presets && ex.presets[0]) || null;
    const baseVp = mode === "real"
      ? {
          view: (firstPreset && firstPreset.view) || ex.defaultView || { xmin: -10, xmax: 10, ymin: -10, ymax: 10 },
          squareAspect: (firstPreset && firstPreset.squareAspect !== undefined)
            ? Boolean(firstPreset.squareAspect)
            : (ex.squareAspect !== undefined ? Boolean(ex.squareAspect) : true),
        }
      : {
          inView: (firstPreset && firstPreset.inView) || ex.defaultInView || { cx: 0, cy: 0, r: 4 },
          outView: (firstPreset && firstPreset.outView) || ex.defaultOutView || { cx: 0, cy: 0, r: 4 },
          inSquare: (firstPreset && firstPreset.inSquare !== undefined) ? Boolean(firstPreset.inSquare) : true,
          outSquare: (firstPreset && firstPreset.outSquare !== undefined) ? Boolean(firstPreset.outSquare) : true,
          showSphere: (firstPreset && firstPreset.showSphere !== undefined) ? Boolean(firstPreset.showSphere) : Boolean(ex.defaultSphere),
          sphereView: (firstPreset && firstPreset.sphereView) || ex.defaultSphereView || { yaw: -0.58, pitch: 0.22, zoom: 1.0 },
        };
    const presetsOut = (ex.presets || []).map((bp, idx) => {
      const pr = { id: bp.id || `preset_${idx + 1}`, name: bp.name || `Preset ${idx + 1}` };
      if (bp.sliderValues) pr.sliderValues = { ...bp.sliderValues };
      if (bp.startSlider) pr.startSlider = bp.startSlider;
      if (Array.isArray(bp.visibleFnIndices)) pr.visibleFnIndices = [...bp.visibleFnIndices];
      if (mode === "real") {
        pr.viewport = {
          view: bp.view ? { ...bp.view } : { ...baseVp.view },
          squareAspect: bp.squareAspect !== undefined ? Boolean(bp.squareAspect) : baseVp.squareAspect,
        };
        if (Array.isArray(bp.polygons)) pr.seedCells = bp.polygons.map((c) => [c[0], c[1]]);
        if (bp.fillGrid) pr.fillGrid = true;
      } else {
        pr.viewport = {
          inView: bp.inView ? { ...bp.inView } : { ...baseVp.inView },
          outView: bp.outView ? { ...bp.outView } : { ...baseVp.outView },
          inSquare: bp.inSquare !== undefined ? Boolean(bp.inSquare) : baseVp.inSquare,
          outSquare: bp.outSquare !== undefined ? Boolean(bp.outSquare) : baseVp.outSquare,
          showSphere: bp.showSphere !== undefined ? Boolean(bp.showSphere) : baseVp.showSphere,
          sphereView: bp.sphereView ? { ...bp.sphereView } : { ...baseVp.sphereView },
        };
        if (Array.isArray(bp.shapes)) pr.shapes = JSON.parse(JSON.stringify(bp.shapes));
      }
      if (Array.isArray(bp.points)) pr.points = JSON.parse(JSON.stringify(bp.points));
      if (Array.isArray(bp.lines)) pr.lines = JSON.parse(JSON.stringify(bp.lines));
      return pr;
    });
    const out = {
      format: "cfv_project_v1",
      id: ex.id,
      name: displayName,
      folder: "examples",
      subtitle: ex.subtitle || "",
      mode,
      cards: JSON.parse(JSON.stringify(ex.fnCards || [])),
      sliders: JSON.parse(JSON.stringify(ex.sliders || [])),
      vars: JSON.parse(JSON.stringify(ex.vars || [])),
      points: JSON.parse(JSON.stringify((firstPreset && firstPreset.points) || ex.defaultPoints || [])),
      lines: JSON.parse(JSON.stringify((firstPreset && firstPreset.lines) || ex.defaultLines || [])),
      viewport: baseVp,
      presets: presetsOut,
    };
    if (mode === "real") {
      if (firstPreset && Array.isArray(firstPreset.polygons)) {
        out.seedCells = firstPreset.polygons.map((c) => [c[0], c[1]]);
      }
    } else {
      out.shapes = JSON.parse(JSON.stringify((firstPreset && firstPreset.shapes) || ex.defaultShapes || []));
    }
    return out;
  }

  /* Delete Project Confirmation Screen (#delete-project-modal) */
  function closeDeleteModal() {
    state.pendingDelete = null;
    if (deleteProjectModal) deleteProjectModal.classList.add("hidden");
  }

  function requestDeleteProject(target) {
    if (!target || !target.id) return;
    state.pendingDelete = target;
    const nm = target.name || "this project";
    if (deleteProjectSub) {
      deleteProjectSub.textContent = target.kind === "example"
        ? "This will remove the example project from your library."
        : "This will permanently delete the saved project file from projects/.";
    }
    if (deleteProjectMsg) {
      deleteProjectMsg.innerHTML = "";
      deleteProjectMsg.appendChild(document.createTextNode("Are you sure you want to delete "));
      const stEl = document.createElement("strong");
      stEl.textContent = `"${nm}"`;
      deleteProjectMsg.appendChild(stEl);
      deleteProjectMsg.appendChild(document.createTextNode("? This action cannot be undone."));
    }
    if (deleteProjectModal) deleteProjectModal.classList.remove("hidden");
  }

  function confirmPendingDelete() {
    const target = state.pendingDelete;
    closeDeleteModal();
    if (!target || !target.id) return false;
    if (target.kind === "example") {
      return deleteBuiltInExample(target.id);
    }
    deleteSavedProject(target.id);
    return true;
  }

  function isLibraryMetaRecord(rawProj) {
    return Boolean(rawProj && (rawProj.id === LIBRARY_META_ID || rawProj.format === "cfv_library_meta_v1"));
  }

  function normalizeStoredProject(rawProj) {
    if (!rawProj || typeof rawProj !== "object" || isLibraryMetaRecord(rawProj)) return null;
    const id = String(rawProj.id || ("proj_" + Date.now() + "_" + Math.floor(Math.random() * 1000)));
    const name = String(rawProj.name || rawProj.title || "Saved Project").trim();
    const mode = rawProj.mode === "real" || rawProj.mode === "integral" ? rawProj.mode : "map";
    const folder = typeof rawProj.folder === "string" && rawProj.folder.trim() ? rawProj.folder.trim() : "my";
    const baseState = readableStateToSnapshot(rawProj);
    const presets = (rawProj.presets || []).map((p, idx) => ({
      id: p.id || `pr_${idx + 1}`,
      name: p.name || `Preset ${idx + 1}`,
      isCustom: true,
      startSlider: p.startSlider || (p.builtinPreset && p.builtinPreset.startSlider) || null,
      snapshot: p.snapshot && p.snapshot.v === 1 ? p.snapshot : readableStateToSnapshot(p, rawProj),
      builtinPreset: p.builtinPreset || null,
      sourceExampleId: p.sourceExampleId || rawProj.sourceExampleId || null,
    }));
    const readableBase = snapshotToReadableState(baseState) || {};
    return {
      format: "cfv_project_v1",
      id,
      name,
      folder,
      subtitle: rawProj.subtitle || `${(readableBase.cards || []).length} cards · ${presets.length} presets`,
      description: String(rawProj.description || ""),
      mode,
      isCustom: true,
      sourceExampleId: rawProj.sourceExampleId || null,
      ...(readableBase.splitPct !== undefined ? { splitPct: readableBase.splitPct } : {}),
      cards: readableBase.cards || [],
      sliders: readableBase.sliders || [],
      vars: readableBase.vars || [],
      ...(readableBase.shapes ? { shapes: readableBase.shapes } : {}),
      ...(readableBase.seedCells ? { seedCells: readableBase.seedCells } : {}),
      points: readableBase.points || [],
      lines: readableBase.lines || [],
      ...(readableBase.layerOrder ? { layerOrder: readableBase.layerOrder } : {}),
      viewport: readableBase.viewport || {},
      baseState,
      presets,
    };
  }

  function loadLocalProjectsCache() {
    try {
      const raw = window.localStorage && window.localStorage.getItem(USER_PROJECTS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.map(normalizeStoredProject).filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  function loadSavedProjects() {
    if (!state.savedProjects || state.savedProjects.length === 0) {
      state.savedProjects = loadLocalProjectsCache();
    }
    return state.savedProjects;
  }

  function writeSavedProjects(list) {
    const normalized = (list || []).map(normalizeStoredProject).filter(Boolean);
    state.savedProjects = normalized;
    try {
      if (window.localStorage) window.localStorage.setItem(USER_PROJECTS_KEY, JSON.stringify(normalized));
    } catch (_) {}
  }

  function persistProjectToRepo(projObj) {
    if (!projObj || !projObj.id) return;
    /* Build a clean, human-readable cfv_project_v1 JSON file for projects/<id>.json */
    const cleanFileObj = {
      format: "cfv_project_v1",
      id: projObj.id,
      name: projObj.name,
      folder: projObj.folder || "my",
      subtitle: projObj.subtitle || "",
      description: projObj.description || "",
      mode: projObj.mode,
      ...(projObj.splitPct !== undefined ? { splitPct: projObj.splitPct } : {}),
      cards: projObj.cards || [],
      sliders: projObj.sliders || [],
      vars: projObj.vars || [],
      ...(projObj.shapes ? { shapes: projObj.shapes } : {}),
      ...(projObj.seedCells ? { seedCells: projObj.seedCells } : {}),
      points: projObj.points || [],
      lines: projObj.lines || [],
      ...(projObj.layerOrder ? { layerOrder: projObj.layerOrder } : {}),
      viewport: projObj.viewport || {},
      presets: (projObj.presets || []).map((p, idx) => {
        const rs = p.snapshot ? snapshotToReadableState(p.snapshot) : null;
        return {
          id: p.id || `pr_${idx + 1}`,
          name: p.name || `Preset ${idx + 1}`,
          ...(p.startSlider ? { startSlider: p.startSlider } : {}),
          ...(rs || {}),
        };
      }),
    };
    try {
      fetch("/api/projects/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanFileObj, null, 2),
      }).catch(() => {});
    } catch (_) {}
  }

  function deleteProjectFromRepo(projId) {
    if (!projId) return;
    try {
      fetch("/api/projects/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: projId }),
      }).catch(() => {});
    } catch (_) {}
  }

  async function syncProjectsWithServer() {
    loadLibraryMeta();
    const localList = loadLocalProjectsCache();
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) {
        state.savedProjects = localList;
        return;
      }
      const data = await res.json();
      const rawItems = Array.isArray(data.projects) ? data.projects : [];
      const metaRec = rawItems.find(isLibraryMetaRecord);
      if (metaRec) {
        const srvMeta = normalizeLibraryMeta(metaRec);
        const fMap = new Map();
        for (const f of [...(state.libraryMeta.folders || []), ...srvMeta.folders]) fMap.set(f.id, f);
        state.libraryMeta = {
          folders: Array.from(fMap.values()),
          exampleRenames: { ...(state.libraryMeta.exampleRenames || {}), ...srvMeta.exampleRenames },
          deletedExamples: Array.from(new Set([...(state.libraryMeta.deletedExamples || []), ...srvMeta.deletedExamples])),
        };
        saveLibraryMeta(false);
      }
      const serverProjects = rawItems
        .filter((item) => !isLibraryMetaRecord(item))
        .map(normalizeStoredProject)
        .filter(Boolean);
      const byId = new Map();
      for (const sp of serverProjects) byId.set(sp.id, sp);
      for (const lp of localList) {
        if (!byId.has(lp.id)) {
          byId.set(lp.id, lp);
          persistProjectToRepo(lp);
        }
      }
      writeSavedProjects(Array.from(byId.values()));
      renderExamplesMenu();
    } catch (_) {
      state.savedProjects = localList;
    }
  }

  function serializeProjectPresets(presets, parentProj = null) {
    return (presets || [])
      .filter((p) => p.snapshot || p.builtinPreset || p.cards || p.viewport || p.sliderValues)
      .map((p) => ({
        id: p.id,
        name: p.name,
        isCustom: true,
        startSlider: p.startSlider || (p.builtinPreset && p.builtinPreset.startSlider) || null,
        snapshot: p.snapshot || (p.builtinPreset ? null : readableStateToSnapshot(p, parentProj)),
        builtinPreset: p.builtinPreset || null,
        sourceExampleId: p.sourceExampleId || state.sourceExampleId || null,
      }));
  }

  function saveCurrentProject(name, opts = {}) {
    const forceNew = Boolean(opts && opts.forceNew);
    const inSaved = isInSavedProject();
    const rawName = (name !== undefined && name !== null && String(name).trim())
      ? String(name).trim()
      : (inSaved ? state.activeProjectName : "");
    const trimmed = (rawName || "").trim();
    if (!trimmed) return null;

    const list = [...loadSavedProjects()];
    const fullObj = exportFullProjectObject(trimmed);
    const baseState = buildWorkspaceSnapshot();
    const presetsCopy = serializeProjectPresets(state.projectPresets, fullObj);

    let entry = null;
    if (!forceNew && inSaved) {
      const existing = list.find((p) => p.id === state.activeProjectId);
      if (existing) {
        const folderId = (opts && opts.folder) || existing.folder || state.activeProjectFolder || "my";
        Object.assign(existing, fullObj, {
          id: existing.id,
          name: trimmed,
          folder: folderId,
          mode: state.mode,
          isCustom: true,
          baseState,
          presets: presetsCopy,
          sourceExampleId: state.sourceExampleId || existing.sourceExampleId || null,
        });
        entry = existing;
      }
    }
    if (!entry) {
      const newId = "proj_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
      const folderId = (opts && opts.folder) || state.activeProjectFolder || "my";
      entry = normalizeStoredProject({
        ...fullObj,
        id: newId,
        name: trimmed,
        folder: folderId,
        mode: state.mode,
        isCustom: true,
        sourceExampleId: state.sourceExampleId || null,
        baseState,
        presets: presetsCopy,
      });
      list.push(entry);
    }

    writeSavedProjects(list);
    persistProjectToRepo(entry);
    state.activeProjectId = entry.id;
    state.activeProjectName = entry.name;
    state.activeProjectIsCustom = true;
    state.activeProjectFolder = entry.folder || "my";
    state.projectPresets = entry.presets.map((p) => ({ ...p }));
    state.hasUnsavedWork = false;
    updateProjectHeaderUI();
    renderExamplesMenu();
    renderPresetBar();
    syncUrl(false, true);
    return entry;
  }

  function saveCurrentProjectInPlace() {
    if (!isInSavedProject()) return null;
    /* If currently inside a custom preset, also update that preset's snapshot when saving in-place! */
    if (state.activePresetId) {
      const pr = state.projectPresets.find((p) => p.id === state.activePresetId && p.isCustom);
      if (pr) pr.snapshot = buildWorkspaceSnapshot();
    }
    const saved = saveCurrentProject(state.activeProjectName, { forceNew: false });
    if (saved && btnSaveProject) {
      btnSaveProject.classList.add("saved-flash");
      btnSaveProject.textContent = "✓ Saved";
      setTimeout(() => {
        btnSaveProject.classList.remove("saved-flash");
        updateProjectHeaderUI();
      }, 1100);
    }
    return saved;
  }

  function renameSavedProject(projId, newName) {
    const trimmed = (newName || "").trim();
    if (!projId || !trimmed) return null;
    const list = [...loadSavedProjects()];
    const proj = list.find((p) => p.id === projId);
    if (!proj) return null;
    proj.name = trimmed;
    writeSavedProjects(list);
    persistProjectToRepo(proj);
    if (state.activeProjectIsCustom && state.activeProjectId === projId) {
      state.activeProjectName = trimmed;
      updateProjectHeaderUI();
    }
    renderExamplesMenu();
    return proj;
  }

  function updatePresetInCurrentProject(presetId) {
    const pr = state.projectPresets.find((p) => p.id === presetId);
    if (!pr) return null;
    pr.snapshot = buildWorkspaceSnapshot();
    pr.builtinPreset = null;
    pr.isCustom = true;
    state.activePresetId = pr.id;
    if (isInSavedProject()) {
      const list = [...loadSavedProjects()];
      const proj = list.find((p) => p.id === state.activeProjectId);
      if (proj) {
        proj.presets = serializeProjectPresets(state.projectPresets, proj);
        writeSavedProjects(list);
        persistProjectToRepo(proj);
      }
      state.hasUnsavedWork = false;
    } else {
      state.hasUnsavedWork = true;
    }
    updateProjectHeaderUI();
    renderPresetBar();
    renderExamplesMenu();
    syncUrl(false, true);
    return pr;
  }

  function deleteSavedProject(projId) {
    const list = loadSavedProjects().filter((p) => p.id !== projId);
    writeSavedProjects(list);
    deleteProjectFromRepo(projId);
    if (state.activeProjectIsCustom && state.activeProjectId === projId) {
      state.activeProjectId = null;
      state.activeProjectIsCustom = false;
      state.activeProjectName = "Unsaved Project";
      state.hasUnsavedWork = !isBlankWorkspace();
      updateProjectHeaderUI();
    }
    renderExamplesMenu();
  }

  function addPresetToCurrentProject(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    const snap = buildWorkspaceSnapshot();
    const newPr = {
      id: "pr_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      name: trimmed,
      isCustom: true,
      snapshot: snap,
    };
    state.projectPresets.push(newPr);
    state.activePresetId = newPr.id;

    if (state.activeProjectIsCustom && state.activeProjectId) {
      const list = [...loadSavedProjects()];
      const proj = list.find((p) => p.id === state.activeProjectId);
      if (proj) {
        proj.presets = serializeProjectPresets(state.projectPresets, proj);
        writeSavedProjects(list);
        persistProjectToRepo(proj);
      }
      state.hasUnsavedWork = false;
    } else {
      /* Inside an unsaved or built-in project: adding a preset makes it an unsaved custom project! */
      if (state.activeProjectId && !state.activeProjectIsCustom) {
        state.activeProjectId = null;
        state.activeProjectName = "Unsaved Project";
      }
      state.hasUnsavedWork = true;
    }

    updateProjectHeaderUI();
    renderPresetBar();
    renderExamplesMenu();
    syncUrl(false, true);
    return newPr;
  }

  function removePresetFromCurrentProject(presetId) {
    state.projectPresets = state.projectPresets.filter((p) => p.id !== presetId);
    if (state.activePresetId === presetId) state.activePresetId = null;
    if (state.activeProjectIsCustom && state.activeProjectId) {
      const list = [...loadSavedProjects()];
      const proj = list.find((p) => p.id === state.activeProjectId);
      if (proj) {
        proj.presets = serializeProjectPresets(state.projectPresets, proj);
        writeSavedProjects(list);
        persistProjectToRepo(proj);
      }
    } else {
      state.hasUnsavedWork = !isBlankWorkspace() || state.projectPresets.length > 0;
    }
    updateProjectHeaderUI();
    renderPresetBar();
    renderExamplesMenu();
  }

  async function loadSavedProject(projId, pushHistory = true) {
    const proj = loadSavedProjects().find((p) => p.id === projId);
    if (!proj) return false;

    const hasPresets = Array.isArray(proj.presets) && proj.presets.length > 0;
    const firstPr = hasPresets ? proj.presets[0] : null;
    let targetSnap = (firstPr && firstPr.snapshot) ? firstPr.snapshot : (proj.baseState || readableStateToSnapshot(proj));
    if (!targetSnap) return false;

    /* If saved with NO presets: enable everything! */
    if (!hasPresets) {
      targetSnap = JSON.parse(JSON.stringify(targetSnap));
      if (Array.isArray(targetSnap.fn)) {
        for (const f of targetSnap.fn) f.v = 1;
      }
      if (targetSnap.c) {
        for (const sh of targetSnap.c.sh || []) sh.v = 1;
        for (const pt of targetSnap.c.pt || []) pt.v = 1;
        for (const ln of targetSnap.c.ln || []) ln.v = 1;
      }
    }

    state.activeProjectId = proj.id;
    state.activeProjectName = proj.name;
    state.activeProjectIsCustom = true;
    state.activeProjectFolder = proj.folder || "my";
    state.sourceExampleId = proj.sourceExampleId || null;
    state.projectPresets = (proj.presets || []).map((p) => ({
      ...p,
      isCustom: true,
      snapshot: p.snapshot || readableStateToSnapshot(p, proj),
    }));
    const presetId = hasPresets ? firstPr.id : null;

    const ok = await restoreWorkspaceSnapshot(targetSnap, pushHistory, {
      projectId: proj.id,
      projectName: proj.name,
      projectDescription: proj.description || "",
      isCustomProject: true,
      sourceExampleId: proj.sourceExampleId || null,
      presets: state.projectPresets,
      activePresetId: presetId,
    });
    if (ok && firstPr) {
      if (!firstPr.snapshot && firstPr.builtinPreset) {
        const ex = window.CFVExamples.byId(firstPr.sourceExampleId || proj.sourceExampleId);
        if (ex) await applyBuiltInPreset(ex, firstPr.builtinPreset, false);
      } else if (firstPr.startSlider) {
        const sl = sliderCards().find((s) => s.name === firstPr.startSlider);
        if (sl) {
          sl.value = sl.min;
          sl.playing = true;
          renderFnCards();
          ensureSliderLoop();
        }
      }
    }
    return ok;
  }

  async function restoreWorkspaceSnapshot(snap, pushHistory = false, meta = null) {
    if (!snap || snap.v !== 1) return false;
    state.restoringState = true;
    try {
      closeItemSettings();
      closeExamplesDropdown();
      const targetMode = snap.m === "real" || snap.m === "integral" ? snap.m : "map";

      if (meta) {
        state.activeProjectId = meta.projectId ?? null;
        state.activeProjectName = meta.projectName || "Unsaved Project";
        state.activeProjectDescription = meta.projectDescription !== undefined ? String(meta.projectDescription || "") : String(snap.desc || "");
        state.activeProjectIsCustom = Boolean(meta.isCustomProject);
        if (meta.sourceExampleId !== undefined) state.sourceExampleId = meta.sourceExampleId;
        if (Array.isArray(meta.presets)) state.projectPresets = meta.presets;
        state.activePresetId = meta.activePresetId ?? null;
      } else {
        state.activeProjectId = null;
        state.activeProjectName = snap.nm || "Shared Project";
        state.activeProjectDescription = String(snap.desc || "");
        state.activeProjectIsCustom = false;
        state.sourceExampleId = null;
        state.projectPresets = [];
        state.activePresetId = null;
      }
      syncDescriptionUI();
      state.hasUnsavedWork = false;

      for (const s of sliderCards()) s.playing = false;
      if (window.CFVReal && typeof window.CFVReal.stopAudio === "function") window.CFVReal.stopAudio();

      setModeUI(targetMode);
      if (targetMode !== "real" && typeof snap.sp === "number") {
        applySplitPct(snap.sp, true);
      }

      const fns = (snap.fn || []).map((c, idx) => ({
        id: state.nextCardId++,
        kind: "fn",
        title: c.t || `Function ${idx + 1}`,
        code: c.cd || (targetMode === "real" ? "sin(x)" : "c_zeta(s)"),
        color: c.col || COLORS[idx % COLORS.length],
        lineWidth: normLineWidthWs(c.w, 2.2),
        opacity: normOpacityWs(c.op, 1.0),
        lineStyle: c.st || "solid",
        step: Boolean(c.stp),
        locked: Boolean(c.lk),
        visible: c.v !== 0,
        builtin: c.b || (targetMode === "real" ? { fn: 0, kind: "exact" } : { fn: 0 }),
      }));
      const sls = [];
      const vrs = [];
      for (const s of snap.sl || []) {
        if (s.ex) {
          vrs.push({
            id: state.nextCardId++,
            kind: "var",
            name: s.n || "R",
            label: s.l || "",
            expr: String(s.ex),
            value: Number(s.val ?? 0),
          });
        } else {
          sls.push({
            id: state.nextCardId++,
            kind: "slider",
            name: s.n || "a",
            label: s.l || "parameter",
            value: Number(s.val ?? 1),
            min: Number(s.mn ?? 0),
            max: Number(s.mx ?? 10),
            step: Number(s.st ?? 0.1),
            speed: Number(s.sp ?? 1.0),
            playing: false,
          });
        }
      }
      for (const v of snap.vr || []) {
        vrs.push({
          id: state.nextCardId++,
          kind: "var",
          name: v.n || "R",
          label: v.l || "",
          expr: String(v.ex || "0"),
          value: 0,
        });
      }
      state.cards = [...fns, ...sls, ...vrs];
      resolveVariables(false);
      const pi = typeof snap.pi === "number" && snap.pi >= 0 && snap.pi < fns.length ? snap.pi : 0;
      state.primaryCardId = fns[pi] ? fns[pi].id : null;

      updateProjectHeaderUI();
      renderFnCards();
      renderExamplesMenu();
      renderPresetBar();

      const comp = await compileWorkspace(true, true);
      state.lastCompileResult = comp;

      if (targetMode === "real") {
        if (snap.c) window.CFVReal.restoreSnapshot(snap.c);
        else window.CFVReal.scheduleSample(true);
        resolveVariables(true, true);
      } else {
        window.CFVComplex.setMode(targetMode);
        if (snap.c) await window.CFVComplex.restoreSnapshot(snap.c);
        else await window.CFVComplex.recomputeAll(1.0);
        resolveVariables(true, true);
      }
      renderDomainCards();
      syncUrl(pushHistory, true);
      return true;
    } finally {
      state.restoringState = false;
    }
  }

  /* -------------------------------------------------------------------------
   * Draggable Split-Pane Divider (Input Plane vs Output Plane)
   * ------------------------------------------------------------------------- */

  function applySplitPct(pct, skipUrlSync = false) {
    const clamped = Math.max(20, Math.min(80, Number(pct) || 50));
    state.splitPct = clamped;
    if (inputPlaneCard && outputPlaneCard && !state.inputHidden && !state.outputHidden) {
      inputPlaneCard.style.flex = `0 0 ${clamped}%`;
      outputPlaneCard.style.flex = "1 1 0%";
    }
    if (!isRealMode() && window.CFVComplex) {
      window.CFVComplex.resize();
    }
    if (!skipUrlSync) notifyStateChanged(false, false);
  }

  if (planesSplitter && stageComplex) {
    let splitting = false;
    planesSplitter.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      splitting = true;
      planesSplitter.classList.add("dragging");
      if (planesSplitter.setPointerCapture) planesSplitter.setPointerCapture(e.pointerId);
    });
    planesSplitter.addEventListener("pointermove", (e) => {
      if (!splitting) return;
      const rect = stageComplex.getBoundingClientRect();
      if (!rect || rect.width < 100) return;
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      applySplitPct(pct, true);
    });
    planesSplitter.addEventListener("pointerup", () => {
      if (!splitting) return;
      splitting = false;
      planesSplitter.classList.remove("dragging");
      notifyStateChanged(true, false);
    });
    planesSplitter.addEventListener("dblclick", () => {
      applySplitPct(50, false);
      notifyStateChanged(true, false);
    });
  }

  /* -------------------------------------------------------------------------
   * Draggable Left Card Sidebar Resizer (Double-click resets to 372px)
   * ------------------------------------------------------------------------- */

  const SIDEBAR_WIDTH_KEY = "cfv_sidebar_width_v1";

  function areAllDisplayPanelsHidden() {
    return isRealMode() ? Boolean(state.realHidden) : Boolean(state.inputHidden && state.outputHidden);
  }

  function applySidebarWidth(px, persist = false) {
    if (!sidebar) return;
    const maxW = Math.min(760, Math.max(420, Math.floor((window.innerWidth || 1280) * 0.62)));
    const clamped = Math.round(Math.max(260, Math.min(maxW, Number(px) || 372)));
    state.savedSidebarWidth = clamped;
    if (!areAllDisplayPanelsHidden()) {
      sidebar.style.width = `${clamped}px`;
    }
    if (persist) {
      try { if (window.localStorage) window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped)); } catch (_) {}
    }
    if (window.CFVComplex) window.CFVComplex.resize();
    if (window.CFVReal) window.CFVReal.resize();
  }

  function applyLayoutVisibility() {
    const isReal = isRealMode();
    const allDisplaysHidden = areAllDisplayPanelsHidden();
    const sidebarHidden = Boolean(state.sidebarCollapsed);

    if (stageColumn) stageColumn.classList.toggle("hidden", allDisplaysHidden);

    if (sidebar) {
      if (sidebarHidden) {
        /* Sidebar closed: hide full sidebar (even if all display panels are hidden; mini sliders rail persists!) */
        sidebar.classList.add("hidden");
        sidebar.classList.remove("sidebar-full-width");
      } else if (allDisplaysHidden) {
        /* Both display panels hidden & sidebar open: expand sidebar to fill the empty space */
        sidebar.classList.remove("hidden");
        sidebar.classList.add("sidebar-full-width");
        sidebar.style.width = "";
      } else {
        sidebar.classList.remove("hidden");
        sidebar.classList.remove("sidebar-full-width");
        sidebar.style.width = `${state.savedSidebarWidth || 372}px`;
      }
    }
    if (sidebarSplitter) {
      sidebarSplitter.classList.toggle("hidden", allDisplaysHidden || sidebarHidden);
    }
    if (miniSliderSidebar) {
      /* Persistent mini sliders rail ALWAYS stays visible whenever the sidebar is closed (including when all panels are closed!) */
      miniSliderSidebar.classList.toggle("hidden", !sidebarHidden);
      miniSliderSidebar.classList.toggle("mini-sidebar-solo", sidebarHidden && allDisplaysHidden);
    }
    if (btnToggleSidebar) {
      /* Always allow closing the sidebar via × */
      btnToggleSidebar.classList.remove("hidden");
    }

    if (!isReal) {
      const hideIn = Boolean(state.inputHidden);
      const hideOut = Boolean(state.outputHidden);
      if (inputPlaneCard) {
        inputPlaneCard.classList.toggle("hidden", hideIn);
        if (!hideIn && hideOut) inputPlaneCard.style.flex = "1 1 100%";
        else if (!hideIn && !hideOut) inputPlaneCard.style.flex = `0 0 ${state.splitPct}%`;
      }
      if (outputPlaneCard) {
        outputPlaneCard.classList.toggle("hidden", hideOut);
        if (!hideOut && hideIn) outputPlaneCard.style.flex = "1 1 100%";
        else if (!hideOut && !hideIn) outputPlaneCard.style.flex = "1 1 0%";
      }
      if (planesSplitter) {
        planesSplitter.classList.toggle("hidden", hideIn || hideOut);
      }
    }

    if (complexDrawDock) complexDrawDock.classList.toggle("hidden", isReal);
    if (!isReal && realPolyDockEl) realPolyDockEl.classList.add("hidden");

    const showSidebarPill = sidebarHidden;
    const showInPill = !isReal && Boolean(state.inputHidden);
    const showOutPill = !isReal && Boolean(state.outputHidden);
    const showRealPill = isReal && Boolean(state.realHidden);
    if (btnShowSidebar) btnShowSidebar.classList.toggle("hidden", !showSidebarPill);
    if (btnShowInput) btnShowInput.classList.toggle("hidden", !showInPill);
    if (btnShowOutput) btnShowOutput.classList.toggle("hidden", !showOutPill);
    if (btnShowReal) btnShowReal.classList.toggle("hidden", !showRealPill);
    const anyRestore = Boolean(showSidebarPill || showInPill || showOutPill || showRealPill);
    if (panelRestoreBar) {
      panelRestoreBar.classList.toggle("hidden", !anyRestore);
    }
    if (bottomRestoreSep) {
      bottomRestoreSep.classList.toggle("hidden", !anyRestore);
    }

    requestAnimationFrame(() => {
      if (window.CFVComplex) window.CFVComplex.resize();
      if (window.CFVReal) window.CFVReal.resize();
    });
  }

  function setSidebarCollapsed(collapsed) {
    state.sidebarCollapsed = Boolean(collapsed);
    closeItemSettings();
    closeExamplesDropdown();
    applyLayoutVisibility();
  }

  function setPanelVisibility(panel, visible) {
    if (panel === "input") state.inputHidden = !visible;
    else if (panel === "output") state.outputHidden = !visible;
    else if (panel === "real") state.realHidden = !visible;
    applyLayoutVisibility();
  }

  try {
    const savedW = window.localStorage && Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
    if (savedW >= 260) applySidebarWidth(savedW, false);
  } catch (_) {}

  if (sidebarSplitter && sidebar) {
    let sbDragging = false;
    sidebarSplitter.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      sbDragging = true;
      sidebarSplitter.classList.add("dragging");
      if (sidebarSplitter.setPointerCapture) sidebarSplitter.setPointerCapture(e.pointerId);
    });
    sidebarSplitter.addEventListener("pointermove", (e) => {
      if (!sbDragging) return;
      const rect = sidebar.getBoundingClientRect();
      applySidebarWidth(e.clientX - rect.left, false);
    });
    const endSbDrag = () => {
      if (!sbDragging) return;
      sbDragging = false;
      sidebarSplitter.classList.remove("dragging");
      const curW = parseFloat(sidebar.style.width) || sidebar.clientWidth || 372;
      applySidebarWidth(curW, true);
    };
    sidebarSplitter.addEventListener("pointerup", endSbDrag);
    sidebarSplitter.addEventListener("pointercancel", endSbDrag);
    sidebarSplitter.addEventListener("dblclick", () => applySidebarWidth(372, true));
  }

  /* -------------------------------------------------------------------------
   * 3 Collapsible Vertical Sidebar Tabs
   * ------------------------------------------------------------------------- */

  function wireVerticalTabs() {
    document.querySelectorAll(".vtab-hdr").forEach((hdr) => {
      const toggle = () => {
        const sec = hdr.closest ? hdr.closest(".vtab-section") : hdr.parentElement;
        if (!sec) return;
        const collapsed = sec.classList.toggle("collapsed");
        hdr.setAttribute("aria-expanded", String(!collapsed));
      };
      hdr.addEventListener("click", (ev) => {
        if (ev.target && ev.target.closest && ev.target.closest(".domain-quick-adds")) return;
        if (ev.target && ev.target.tagName === "BUTTON") return;
        toggle();
      });
      hdr.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          toggle();
        }
      });
    });
  }

  /* -------------------------------------------------------------------------
   * Compilation via /api/workspace/compile (with 0ms LRU Cache!)
   * ------------------------------------------------------------------------- */

  function setStatus(kind, text, diag = "") {
    compileStatusText.className = "compile-status " + kind;
    compileStatusText.textContent = text;
    if (diag) {
      compileDiag.textContent = diag;
      compileDiag.classList.remove("hidden");
    } else {
      compileDiag.classList.add("hidden");
    }
  }

  async function compileWorkspace(silentIfDisabled = false, skipRefresh = false) {
    const fns = fnCards();
    const realMode = isRealMode();
    const compiledCodes = [];

    fns.forEach((c, i) => {
      c.slot = i;
      if (realMode) {
        const parsed = analyzeRealCode(c.code);
        c.realKind = parsed.realKind;
        c.compiledCode = parsed.cCode;
        c.relationBadge = parsed.badge;
        c.tMin = parsed.tMin;
        c.tMax = parsed.tMax;
        compiledCodes.push(parsed.cCode);
      } else {
        c.realKind = "fn";
        c.compiledCode = c.code;
        c.relationBadge = null;
        compiledCodes.push(c.code);
      }
    });

    if (!state.serverCfg.compile_enabled) {
      state.compiledKind = null;
      if (!silentIfDisabled) setStatus("ok", "Public Safe Mode · Precompiled C11");
      if (!skipRefresh) refreshActiveStage(false);
      return { ok: true, message: "Public Safe Mode (precompiled C11)" };
    }

    if (fns.length === 0) {
      state.compiledKind = null;
      setStatus("ok", "Blank · Click + Fn or pick a Project");
      if (!skipRefresh) refreshActiveStage(false);
      return { ok: true, message: "No function cards to compile." };
    }

    state.compiling = true;
    btnCompileAll.disabled = true;
    setStatus("dirty", "Compiling C11…");

    const headers = { "Content-Type": "application/json" };
    if (state.serverCfg.compile_requires_token) {
      const tok = tokenInput.value.trim();
      if (tok) {
        sessionStorage.setItem("cfv_compile_token", tok);
        headers["X-Compile-Token"] = tok;
      }
    }

    const kind = realMode ? "real" : "complex";
    try {
      const res = await fetch("/api/workspace/compile", {
        method: "POST",
        headers,
        body: JSON.stringify({
          kind,
          cards: compiledCodes,
          param_names: getParamNames(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        state.compiledKind = kind;
        state.dirty = false;
        const msStr = data.elapsed_ms < 2 ? "cached (0ms)" : `${data.elapsed_ms.toFixed(0)}ms`;
        const msg = `Compiled ${fns.length} card${fns.length === 1 ? "" : "s"} · ${msStr}`;
        setStatus("ok", `✓ ${msg}`);
        if (!skipRefresh) {
          refreshActiveStage(false);
          notifyStateChanged(true, true);
        }
        return { ok: true, message: msg };
      } else {
        const diag = data.diagnostics || "Compilation failed";
        setStatus("err", "Compile error (click to inspect)", diag);
        return { ok: false, message: diag };
      }
    } catch (err) {
      setStatus("err", "Server unreachable", String(err));
      return { ok: false, message: String(err) };
    } finally {
      state.compiling = false;
      btnCompileAll.disabled = false;
    }
  }

  function refreshActiveStage(fastSlider = false) {
    if (isRealMode()) {
      /* During slider animation use immediate single-flight fetch (no artificial debounce lag!) */
      window.CFVReal.scheduleSample(true);
    } else {
      window.CFVComplex.recomputeAll(fastSlider ? 1.35 : 1.0, Boolean(fastSlider));
    }
  }

  /* -------------------------------------------------------------------------
   * TAB 1: Function(s) / Parametric Curves / Auxiliary Helpers & Sliders
   * ------------------------------------------------------------------------- */

  function renderFnCards() {
    fnCardsEl.innerHTML = "";
    if (fnTabCount) fnTabCount.textContent = String(state.cards.length);
    const readOnly = !state.serverCfg.compile_enabled;
    const realMode = isRealMode();
    if (!realMode) getActiveComplexCard();

    if (state.cards.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:12px;font-size:11.5px;color:#64748b;line-height:1.5;";
      empty.textContent = realMode
        ? "Blank 2D Real project — click + Fn to enter (x(t), y(t)), LHS=RHS, x=c, or y=f(x), or pick a Project above."
        : "Blank project — click + Fn to write a C11 function f(z), or pick a Project above.";
      fnCardsEl.appendChild(empty);
      renderMiniSliders();
      return;
    }

    let dragFnFromIdx = -1;
    let fnSeq = 0;
    state.cards.forEach((c, idx) => {
      const isActiveComplex = !realMode && c.kind === "fn" && c.id === state.primaryCardId;
      const isAuxComplex = !realMode && c.kind === "fn" && c.id !== state.primaryCardId;

      const row = document.createElement("div");
      row.className =
        "expr-card" +
        (isActiveComplex ? " active-primary" : "") +
        (isAuxComplex ? " aux-card" : "") +
        (c.locked ? " locked-item" : "");
      row.draggable = true;
      row.addEventListener("dragstart", (ev) => {
        if (ev.target && (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA" || ev.target.tagName === "SELECT")) {
          ev.preventDefault();
          return;
        }
        dragFnFromIdx = idx;
        row.classList.add("dragging-card");
        if (ev.dataTransfer) { ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", String(idx)); }
      });
      row.addEventListener("dragover", (ev) => {
        if (dragFnFromIdx < 0 || dragFnFromIdx === idx) return;
        ev.preventDefault();
        const rect = row.getBoundingClientRect();
        const before = ev.clientY < rect.top + rect.height * 0.5;
        row.classList.toggle("drop-before", before);
        row.classList.toggle("drop-after", !before);
      });
      row.addEventListener("dragleave", () => {
        row.classList.remove("drop-before", "drop-after");
      });
      row.addEventListener("drop", (ev) => {
        ev.preventDefault();
        row.classList.remove("drop-before", "drop-after");
        if (dragFnFromIdx < 0 || dragFnFromIdx === idx) return;
        const rect = row.getBoundingClientRect();
        const before = ev.clientY < rect.top + rect.height * 0.5;
        let toIdx = before ? idx : idx + 1;
        if (dragFnFromIdx < toIdx) toIdx--;
        if (toIdx !== dragFnFromIdx) {
          const [moved] = state.cards.splice(dragFnFromIdx, 1);
          state.cards.splice(toIdx, 0, moved);
          dragFnFromIdx = -1;
          renderFnCards();
          compileWorkspace(true, false);
          notifyStateChanged(true, true);
        }
      });
      row.addEventListener("dragend", () => {
        dragFnFromIdx = -1;
        row.classList.remove("dragging-card", "drop-before", "drop-after");
      });

      const gutter = document.createElement("div");
      gutter.className = "expr-gutter";
      const grip = document.createElement("span");
      grip.className = "drag-grip";
      grip.textContent = "⋮⋮";
      grip.title = "Drag to reorder card";
      gutter.appendChild(grip);
      const num = document.createElement("span");
      num.className = "expr-num";
      num.textContent = String(idx + 1);
      gutter.appendChild(num);

      if (c.kind === "fn") {
        const dot = document.createElement("button");
        const dotOn = realMode ? c.visible : isActiveComplex;
        dot.className = "expr-vis-dot" + (dotOn ? "" : " off");
        dot.style.setProperty("--card-color", c.color);
        dot.title = realMode
          ? "Click to show/hide curve · Shift+click for style settings"
          : (isActiveComplex ? "Active graphed function · Shift+click for style settings" : "Click to graph this function (instead of auxiliary)");
        dot.addEventListener("click", (ev) => {
          if (ev.shiftKey) { openItemSettings("fn", c.id, dot); return; }
          if (realMode) {
            c.visible = !c.visible;
          } else {
            state.primaryCardId = c.id;
          }
          renderFnCards();
          refreshActiveStage(false);
          notifyStateChanged(true, true);
        });
        gutter.appendChild(dot);
      }
      row.appendChild(gutter);

      const body = document.createElement("div");
      body.className = "expr-body";

      if (c.kind === "fn") {
        fnSeq++;
        const fnNum = fnSeq;
        const head = document.createElement("div");
        head.className = "expr-head";

        const parsed = realMode ? analyzeRealCode(c.code) : { badge: null };
        const fnTag = document.createElement("span");
        fnTag.className = "expr-fn-tag";
        if (parsed.badge) {
          fnTag.textContent = parsed.badge;
          fnTag.style.color = parsed.badge === "param" ? "#34d399" : "#fb7185";
          fnTag.style.background = parsed.badge === "param" ? "rgba(52,211,153,0.14)" : "rgba(251,113,133,0.14)";
        } else {
          fnTag.textContent = realMode ? `f${fnNum}(x)` : `f${fnNum}(z)`;
        }
        fnTag.title = realMode
          ? "Supports parametric (x(t), y(t)), y=f(x), vertical x=c, x=g(y), and implicit LHS=RHS"
          : `Callable in other cards as f${fnNum}(z)`;
        head.appendChild(fnTag);

        const titleIn = document.createElement("input");
        titleIn.className = "expr-title-input";
        titleIn.value = c.title || `Function ${fnNum}`;
        titleIn.disabled = Boolean(c.locked);
        titleIn.addEventListener("input", () => {
          c.title = titleIn.value;
          notifyStateChanged(false, true);
        });
        head.appendChild(titleIn);

        if (!realMode) {
          const actBtn = document.createElement("button");
          actBtn.className = "active-fn-btn" + (isActiveComplex ? " graphed" : "");
          actBtn.textContent = isActiveComplex ? "★ Graphed" : "Aux";
          actBtn.title = isActiveComplex
            ? "Currently graphed function (only 1 active in Map/Integral mode)"
            : `Auxiliary helper callable as f${fnNum}(z) — click to graph this function instead`;
          actBtn.addEventListener("click", () => {
            if (state.primaryCardId === c.id) return;
            state.primaryCardId = c.id;
            renderFnCards();
            refreshActiveStage(false);
            notifyStateChanged(true, true);
          });
          head.appendChild(actBtn);
        }

        const lockBtn = document.createElement("button");
        lockBtn.className = "expr-mini-btn" + (c.locked ? " locked" : "");
        lockBtn.textContent = c.locked ? "🔒" : "🔓";
        lockBtn.title = c.locked ? "Unlock card" : "Lock card";
        lockBtn.addEventListener("click", () => {
          c.locked = !c.locked;
          renderFnCards();
          refreshSettingsIfTarget("fn", c.id);
          notifyStateChanged(true, true);
        });
        head.appendChild(lockBtn);

        const gearBtn = document.createElement("button");
        gearBtn.className = "expr-mini-btn";
        gearBtn.dataset.settingsTrigger = "1";
        gearBtn.textContent = "⚙";
        gearBtn.title = "Style settings (color, thickness, dash, lock)";
        gearBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openItemSettings("fn", c.id, gearBtn);
        });
        head.appendChild(gearBtn);

        if (!c.locked) {
          const delBtn = document.createElement("button");
          delBtn.className = "expr-mini-btn";
          delBtn.textContent = "×";
          delBtn.title = "Remove card";
          delBtn.addEventListener("click", () => {
            state.cards = state.cards.filter((q) => q.id !== c.id);
            if (state.primaryCardId === c.id) {
              const rem = fnCards();
              state.primaryCardId = rem[0] ? rem[0].id : null;
            }
            closeItemSettings();
            renderFnCards();
            compileWorkspace(true, false);
            notifyStateChanged(true, true);
          });
          head.appendChild(delBtn);
        }
        body.appendChild(head);

        const codeArea = document.createElement("textarea");
        codeArea.className = "expr-code";
        codeArea.spellcheck = false;
        codeArea.readOnly = readOnly || Boolean(c.locked);
        codeArea.value = c.code;
        codeArea.rows = Math.min(8, Math.max(1, c.code.split("\n").length));
        codeArea.placeholder = realMode
          ? "(cos(t), sin(t)) for t in [0, 2*pi]  |  x*x+y*y = 16  |  x = 5  |  sin(x)"
          : "e.g. c_zeta(s)  |  f1(z) + 1.0";
        codeArea.addEventListener("input", () => {
          c.code = codeArea.value;
          codeArea.rows = Math.min(8, Math.max(1, c.code.split("\n").length));
          if (realMode) {
            const p = analyzeRealCode(c.code);
            fnTag.textContent = p.badge || `f${fnNum}(x)`;
            fnTag.style.color = p.badge === "param" ? "#34d399" : p.badge ? "#fb7185" : "";
            fnTag.style.background = p.badge === "param" ? "rgba(52,211,153,0.14)" : p.badge ? "rgba(251,113,133,0.14)" : "";
          }
          state.dirty = true;
          setStatus("dirty", "Edited · Press Ctrl+Enter or Compile");
          notifyStateChanged(false, true);
        });
        codeArea.addEventListener("keydown", (e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            const s = codeArea.selectionStart, end = codeArea.selectionEnd;
            codeArea.value = codeArea.value.slice(0, s) + "    " + codeArea.value.slice(end);
            codeArea.selectionStart = codeArea.selectionEnd = s + 4;
            c.code = codeArea.value;
          } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            compileWorkspace(false, false);
          }
        });
        body.appendChild(codeArea);
      } else if (c.kind === "var") {
        /* Computed Variable Card (e.g. R = 2.2 + 18*t*t) */
        const vrow = document.createElement("div");
        vrow.className = "var-card-row";

        const vTag = document.createElement("span");
        const isVpVar = VIEWPORT_GLOBALS.has(c.name);
        vTag.className = "var-tag" + (isVpVar ? " vp-var" : "");
        vTag.textContent = isVpVar ? "view" : "var";
        vTag.title = isVpVar
          ? "Global Viewport / Camera Variable — updates viewport directly at 60 FPS!"
          : "Computed Variable";
        vrow.appendChild(vTag);

        const nameIn = document.createElement("input");
        nameIn.className = "slider-name-input";
        nameIn.value = c.name;
        nameIn.title = "Variable name (use sphere_yaw, sphere_pitch, sphere_zoom, in_cx/cy/r, out_cx/cy/r, real_xmin/xmax/ymin/ymax to control viewports!)";
        nameIn.addEventListener("change", () => {
          c.name = nameIn.value.replace(/[^a-zA-Z0-9_]/g, "") || "R";
          nameIn.value = c.name;
          renderFnCards();
          resolveVariables(true);
          compileWorkspace(true, false);
          notifyStateChanged(true, true);
        });
        vrow.appendChild(nameIn);

        const eq = document.createElement("span");
        eq.style.color = "#64748b";
        eq.textContent = "=";
        vrow.appendChild(eq);

        const exprIn = document.createElement("input");
        exprIn.className = "var-expr-input";
        exprIn.type = "text";
        exprIn.spellcheck = false;
        exprIn.value = String(c.expr || "");
        exprIn.placeholder = "e.g. 2.2 + 18*t*t or -0.58 + spin";
        exprIn.title = "Expression referencing sliders, viewport globals & earlier variables";
        c._exprEl = exprIn;
        exprIn.addEventListener("input", () => {
          c.expr = exprIn.value;
          if (c._miniExprEl && c._miniExprEl.value !== exprIn.value) c._miniExprEl.value = exprIn.value;
          resolveVariables(true);
          if (isRealMode() && (c.name === "R" || c.name === "W" || c.name === "H") && window.CFVReal && window.CFVReal.getActiveGridDims) {
            window.CFVReal.getActiveGridDims();
            renderDomainCards();
          }
          if (paramsRequireServerRecompute([c.name])) {
            refreshActiveStage(true);
          } else if (isRealMode()) {
            window.CFVReal.requestRender();
          } else {
            window.CFVComplex.requestRender();
          }
          notifyStateChanged(false, true);
        });
        vrow.appendChild(exprIn);

        const valPill = document.createElement("span");
        valPill.className = "var-val-pill";
        valPill.textContent = Number.isFinite(c.value) ? `= ${Number(c.value.toFixed(4))}` : "= ?";
        c._valPillEl = valPill;
        vrow.appendChild(valPill);

        const delBtn = document.createElement("button");
        delBtn.className = "expr-mini-btn";
        delBtn.textContent = "×";
        delBtn.title = "Delete variable";
        delBtn.addEventListener("click", () => {
          state.cards = state.cards.filter((q) => q.id !== c.id);
          renderFnCards();
          compileWorkspace(true, false);
          notifyStateChanged(true, true);
        });
        vrow.appendChild(delBtn);
        body.appendChild(vrow);

        if (c.label) {
          const sub = document.createElement("div");
          sub.className = "var-sub-label";
          sub.textContent = c.label;
          body.appendChild(sub);
        }
      } else {
        /* Independent Desmos Parameter Slider Card */
        const top = document.createElement("div");
        top.className = "slider-card-top";

        const nameIn = document.createElement("input");
        nameIn.className = "slider-name-input";
        nameIn.value = c.name;
        nameIn.title = "C variable name usable in all expression cards";
        nameIn.addEventListener("change", () => {
          c.name = nameIn.value.replace(/[^a-zA-Z0-9_]/g, "") || "a";
          nameIn.value = c.name;
          resolveVariables(true);
          compileWorkspace(true, false);
          notifyStateChanged(true, true);
        });
        top.appendChild(nameIn);

        const eq = document.createElement("span");
        eq.style.color = "#64748b";
        eq.textContent = "=";
        top.appendChild(eq);

        const valBadge = document.createElement("span");
        valBadge.className = "slider-val-badge";
        valBadge.textContent = Number(c.value.toFixed(4)).toString();
        c._valBadgeEl = valBadge;
        top.appendChild(valBadge);

        const lbl = document.createElement("span");
        lbl.className = "slider-label-muted";
        lbl.textContent = c.label || "";
        top.appendChild(lbl);

        const delBtn = document.createElement("button");
        delBtn.className = "expr-mini-btn";
        delBtn.textContent = "×";
        delBtn.addEventListener("click", () => {
          c.playing = false;
          state.cards = state.cards.filter((q) => q.id !== c.id);
          renderFnCards();
          compileWorkspace(true, false);
          notifyStateChanged(true, true);
        });
        top.appendChild(delBtn);
        body.appendChild(top);

        const ctrl = document.createElement("div");
        ctrl.className = "slider-controls-row";

        const playBtn = document.createElement("button");
        playBtn.className = "slider-play-btn" + (c.playing ? " playing" : "");
        playBtn.textContent = c.playing ? "❚❚" : "▶";
        playBtn.title = "Animate slider live (does not leave active preset)";
        c._playBtnEl = playBtn;
        playBtn.addEventListener("click", () => {
          c.playing = !c.playing;
          c._playAcc = 0;
          syncSliderPlayUI(c);
          if (!c.playing) {
            refreshActiveStage(false);
            notifyStateChanged(true, false);
          }
          ensureSliderLoop();
        });
        ctrl.appendChild(playBtn);

        const speedSel = document.createElement("select");
        speedSel.className = "slider-speed-select";
        speedSel.title = "Slider playback / scrub animation speed";
        c._speedSelEl = speedSel;
        const curSpd = Number(c.speed) || 1.0;
        for (const [val, txt] of [
          [0.1, "0.1×"],
          [0.25, "0.25×"],
          [0.5, "0.5×"],
          [1.0, "1×"],
          [2.0, "2×"],
          [4.0, "4×"],
        ]) {
          const opt = document.createElement("option");
          opt.value = String(val);
          opt.textContent = txt;
          if (Math.abs(curSpd - val) < 0.01) opt.selected = true;
          speedSel.appendChild(opt);
        }
        speedSel.addEventListener("change", () => {
          c.speed = Number(speedSel.value) || 1.0;
          if (c._miniSpeedSelEl && c._miniSpeedSelEl.value !== String(c.speed)) {
            c._miniSpeedSelEl.value = String(c.speed);
          }
          notifyStateChanged(false, false);
        });
        ctrl.appendChild(speedSel);

        const range = document.createElement("input");
        range.type = "range";
        range.className = "slider-range";
        range.min = String(c.min);
        range.max = String(c.max);
        range.step = String(c.step);
        range.value = String(c.value);
        c._rangeEl = range;
        /* Scrubbing sliders stays cleanly inside the active preset (markDirty = false)! */
        range.addEventListener("input", () => {
          c.value = Number(range.value);
          valBadge.textContent = Number(c.value.toFixed(4)).toString();
          resolveVariables(true);
          if (isRealMode() && (c.name === "R" || c.name === "W" || c.name === "H") && window.CFVReal && window.CFVReal.getActiveGridDims) {
            window.CFVReal.getActiveGridDims();
            renderDomainCards();
          }
          if (paramsRequireServerRecompute([c.name])) {
            refreshActiveStage(true);
          } else if (isRealMode()) {
            window.CFVReal.requestRender();
          } else {
            window.CFVComplex.requestRender();
          }
          notifyStateChanged(false, false);
        });
        range.addEventListener("change", () => {
          resolveVariables(true);
          if (isRealMode() && (c.name === "R" || c.name === "W" || c.name === "H") && window.CFVReal && window.CFVReal.getActiveGridDims) {
            window.CFVReal.getActiveGridDims();
            renderDomainCards();
          }
          if (paramsRequireServerRecompute([c.name])) {
            refreshActiveStage(false);
          } else if (isRealMode()) {
            window.CFVReal.requestRender();
          } else {
            window.CFVComplex.requestRender();
          }
          notifyStateChanged(true, false);
        });
        ctrl.appendChild(range);
        body.appendChild(ctrl);

        const bounds = document.createElement("div");
        bounds.className = "slider-bounds-row";
        bounds.innerHTML = `<span>min</span>`;
        const minIn = document.createElement("input");
        minIn.className = "slider-bound-in"; minIn.type = "number"; minIn.value = String(c.min);
        minIn.addEventListener("change", () => { c.min = parseFloat(minIn.value) || 0; range.min = String(c.min); if (c._miniRangeEl) c._miniRangeEl.min = String(c.min); notifyStateChanged(false, true); });
        const stepIn = document.createElement("input");
        stepIn.className = "slider-bound-in"; stepIn.type = "number"; stepIn.value = String(c.step); stepIn.title = "step";
        stepIn.addEventListener("change", () => { c.step = Math.max(1e-4, parseFloat(stepIn.value) || 0.1); range.step = String(c.step); if (c._miniRangeEl) c._miniRangeEl.step = String(c.step); notifyStateChanged(false, true); });
        const maxIn = document.createElement("input");
        maxIn.className = "slider-bound-in"; maxIn.type = "number"; maxIn.value = String(c.max);
        maxIn.addEventListener("change", () => { c.max = parseFloat(maxIn.value) || 10; range.max = String(c.max); if (c._miniRangeEl) c._miniRangeEl.max = String(c.max); notifyStateChanged(false, true); });
        bounds.appendChild(minIn);
        const stLbl = document.createElement("span"); stLbl.textContent = "step"; bounds.appendChild(stLbl);
        bounds.appendChild(stepIn);
        const mxLbl = document.createElement("span"); mxLbl.textContent = "max"; bounds.appendChild(mxLbl);
        bounds.appendChild(maxIn);
        body.appendChild(bounds);
      }

      row.appendChild(body);
      fnCardsEl.appendChild(row);
    });
    renderMiniSliders();
  }

  function syncSliderPlayUI(c) {
    if (c._playBtnEl) {
      c._playBtnEl.classList.toggle("playing", Boolean(c.playing));
      c._playBtnEl.textContent = c.playing ? "❚❚" : "▶";
    }
    if (c._miniPlayBtnEl) {
      c._miniPlayBtnEl.classList.toggle("playing", Boolean(c.playing));
      c._miniPlayBtnEl.textContent = c.playing ? "❚❚" : "▶";
    }
  }

  /* Persistent Mini Sliders & Variables Sidebar (Shown whenever main sidebar is closed!) */
  function renderMiniSliders() {
    if (!miniSlidersList) return;
    miniSlidersList.innerHTML = "";
    const sliders = sliderCards();
    const vars = varCards();
    if (miniSlidersCount) miniSlidersCount.textContent = String(sliders.length + vars.length);

    if (sliders.length === 0 && vars.length === 0) {
      const empty = document.createElement("div");
      empty.className = "mini-sliders-empty";
      empty.textContent = "No sliders or variables in this project.";
      miniSlidersList.appendChild(empty);
      return;
    }

    for (const c of sliders) {
      const card = document.createElement("div");
      card.className = "mini-slider-card";

      const top = document.createElement("div");
      top.className = "mini-slider-top";

      const nm = document.createElement("span");
      nm.className = "mini-slider-name";
      nm.textContent = c.name;
      top.appendChild(nm);

      const eq = document.createElement("span");
      eq.className = "mini-slider-eq";
      eq.textContent = "=";
      top.appendChild(eq);

      const valBadge = document.createElement("span");
      valBadge.className = "mini-slider-val";
      valBadge.textContent = Number(c.value.toFixed(4)).toString();
      c._miniValBadgeEl = valBadge;
      top.appendChild(valBadge);

      if (c.label) {
        const lbl = document.createElement("span");
        lbl.className = "mini-slider-lbl";
        lbl.textContent = c.label;
        lbl.title = c.label;
        top.appendChild(lbl);
      }
      card.appendChild(top);

      const ctrl = document.createElement("div");
      ctrl.className = "mini-slider-ctrl";

      const playBtn = document.createElement("button");
      playBtn.className = "slider-play-btn" + (c.playing ? " playing" : "");
      playBtn.textContent = c.playing ? "❚❚" : "▶";
      playBtn.title = "Animate slider live";
      c._miniPlayBtnEl = playBtn;
      playBtn.addEventListener("click", () => {
        c.playing = !c.playing;
        c._playAcc = 0;
        syncSliderPlayUI(c);
        if (!c.playing) {
          refreshActiveStage(false);
          notifyStateChanged(true, false);
        }
        ensureSliderLoop();
      });
      ctrl.appendChild(playBtn);

      const speedSel = document.createElement("select");
      speedSel.className = "slider-speed-select";
      speedSel.title = "Slider speed";
      c._miniSpeedSelEl = speedSel;
      const curSpd = Number(c.speed) || 1.0;
      for (const [val, txt] of [
        [0.1, "0.1×"],
        [0.25, "0.25×"],
        [0.5, "0.5×"],
        [1.0, "1×"],
        [2.0, "2×"],
        [4.0, "4×"],
      ]) {
        const opt = document.createElement("option");
        opt.value = String(val);
        opt.textContent = txt;
        if (Math.abs(curSpd - val) < 0.01) opt.selected = true;
        speedSel.appendChild(opt);
      }
      speedSel.addEventListener("change", () => {
        c.speed = Number(speedSel.value) || 1.0;
        if (c._speedSelEl && c._speedSelEl.value !== String(c.speed)) {
          c._speedSelEl.value = String(c.speed);
        }
        notifyStateChanged(false, false);
      });
      ctrl.appendChild(speedSel);

      const range = document.createElement("input");
      range.type = "range";
      range.className = "slider-range";
      range.min = String(c.min);
      range.max = String(c.max);
      range.step = String(c.step);
      range.value = String(c.value);
      c._miniRangeEl = range;
      range.addEventListener("input", () => {
        c.value = Number(range.value);
        resolveVariables(true);
        if (isRealMode() && (c.name === "R" || c.name === "W" || c.name === "H") && window.CFVReal && window.CFVReal.getActiveGridDims) {
          window.CFVReal.getActiveGridDims();
          renderDomainCards();
        }
        if (paramsRequireServerRecompute([c.name])) {
          refreshActiveStage(true);
        } else if (isRealMode()) {
          window.CFVReal.requestRender();
        } else {
          window.CFVComplex.requestRender();
        }
        notifyStateChanged(false, false);
      });
      range.addEventListener("change", () => {
        resolveVariables(true);
        if (isRealMode() && (c.name === "R" || c.name === "W" || c.name === "H") && window.CFVReal && window.CFVReal.getActiveGridDims) {
          window.CFVReal.getActiveGridDims();
          renderDomainCards();
        }
        if (paramsRequireServerRecompute([c.name])) {
          refreshActiveStage(false);
        } else if (isRealMode()) {
          window.CFVReal.requestRender();
        } else {
          window.CFVComplex.requestRender();
        }
        notifyStateChanged(true, false);
      });
      ctrl.appendChild(range);
      card.appendChild(ctrl);

      miniSlidersList.appendChild(card);
    }

    if (vars.length > 0) {
      if (sliders.length > 0) {
        const div = document.createElement("div");
        div.className = "mini-rail-divider";
        div.textContent = "Variables";
        miniSlidersList.appendChild(div);
      }
      for (const v of vars) {
        const card = document.createElement("div");
        card.className = "mini-var-card";

        const top = document.createElement("div");
        top.className = "mini-var-top";

        const isVpVar = VIEWPORT_GLOBALS.has(v.name);
        const tag = document.createElement("span");
        tag.className = "var-tag" + (isVpVar ? " vp-var" : "");
        tag.textContent = isVpVar ? "view" : "var";
        top.appendChild(tag);

        const nm = document.createElement("span");
        nm.className = "mini-var-name";
        nm.textContent = v.name;
        nm.title = v.label ? `${v.name} — ${v.label}` : v.name;
        top.appendChild(nm);

        const valPill = document.createElement("span");
        valPill.className = "var-val-pill";
        valPill.textContent = Number.isFinite(v.value) ? `= ${Number(v.value.toFixed(4))}` : "= ?";
        v._miniValPillEl = valPill;
        top.appendChild(valPill);
        card.appendChild(top);

        const exprIn = document.createElement("input");
        exprIn.type = "text";
        exprIn.className = "var-expr-input mini-var-expr";
        exprIn.spellcheck = false;
        exprIn.value = String(v.expr || "");
        exprIn.title = `Expression for ${v.name}`;
        v._miniExprEl = exprIn;
        exprIn.addEventListener("input", () => {
          v.expr = exprIn.value;
          if (v._exprEl && v._exprEl.value !== exprIn.value) v._exprEl.value = exprIn.value;
          resolveVariables(true);
          if (isRealMode() && (v.name === "R" || v.name === "W" || v.name === "H") && window.CFVReal && window.CFVReal.getActiveGridDims) {
            window.CFVReal.getActiveGridDims();
            renderDomainCards();
          }
          if (paramsRequireServerRecompute([v.name])) {
            refreshActiveStage(true);
          } else if (isRealMode()) {
            window.CFVReal.requestRender();
          } else {
            window.CFVComplex.requestRender();
          }
          notifyStateChanged(false, true);
        });
        card.appendChild(exprIn);

        miniSlidersList.appendChild(card);
      }
    }
  }

  /* -------------------------------------------------------------------------
   * TAB 2 (Unlocked Domain Shapes) & TAB 3 (Locked Landmarks)
   * ------------------------------------------------------------------------- */

  function iconGlyph(iconId) {
    const f = ICONS.find((i) => i.id === iconId);
    return f ? f.glyph : "●";
  }

  function formatShapeBadge(s) {
    if (state.mode === "integral") {
      if (!s.integral) return { text: "…", neg: false };
      if (s.integral.singular) return { text: "pole!", neg: true };
      if (s.closed) {
        const r = s.integral.div2pii;
        const txt = `÷2πi = ${window.CFVComplex.fmtCompact(r.x, r.y)}`;
        return { text: txt, neg: r.x < -1e-4 };
      }
      return { text: `∫ = ${window.CFVComplex.fmtCompact(s.integral.total.x, s.integral.total.y)}`, neg: false };
    }
    if (s.closed && s.winding !== null && s.winding !== undefined) {
      return { text: `W=${s.winding > 0 ? "+" : ""}${s.winding}`, neg: s.winding < 0 };
    }
    return null;
  }

  function buildShapeCard(s, seqNum) {
    const selected = window.CFVComplex.isShapeSelected
      ? window.CFVComplex.isShapeSelected(s.id)
      : s.id === window.CFVComplex.state.selectedShapeId;
    const row = document.createElement("div");
    row.className = "expr-card" + (selected ? " selected-item" : "") + (s.locked ? " locked-item" : "");
    row.addEventListener("click", (ev) => {
      if (ev.target.tagName === "INPUT" || ev.target.tagName === "BUTTON" || ev.target.tagName === "SELECT") return;
      if (ev.shiftKey) window.CFVComplex.selectShape(s.id, { range: true });
      else if (ev.ctrlKey || ev.metaKey) window.CFVComplex.selectShape(s.id, { toggle: true });
      else window.CFVComplex.selectShape(s.id);
    });

    const gutter = document.createElement("div");
    gutter.className = "expr-gutter";
    const num = document.createElement("span");
    num.className = "expr-num";
    num.textContent = String(seqNum);
    gutter.appendChild(num);

    const dot = document.createElement("button");
    dot.className = "expr-vis-dot" + (s.visible ? "" : " off");
    dot.style.setProperty("--card-color", s.color);
    dot.title = "Show/hide shape · Shift+click for style settings";
    dot.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (ev.shiftKey) { openItemSettings("shape", s.id, dot); return; }
      s.visible = !s.visible;
      window.CFVComplex.updateIntegralPanel();
      window.CFVComplex.requestRender();
      renderDomainCards();
      notifyStateChanged(true, true);
    });
    gutter.appendChild(dot);
    row.appendChild(gutter);

    const body = document.createElement("div");
    body.className = "expr-body";

    const head = document.createElement("div");
    head.className = "expr-head";

    const tag = document.createElement("span");
    tag.className = "expr-fn-tag";
    tag.style.color = "#34d399";
    tag.style.background = "rgba(52,211,153,0.12)";
    tag.textContent = s.kind === "freehand" ? (s.closed ? "Loop" : "Path") : s.kind[0].toUpperCase() + s.kind.slice(1);
    head.appendChild(tag);

    const titleIn = document.createElement("input");
    titleIn.className = "expr-title-input";
    titleIn.value = s.label || "Shape";
    titleIn.disabled = Boolean(s.locked);
    titleIn.addEventListener("input", () => {
      s.label = titleIn.value;
      window.CFVComplex.updateIntegralPanel();
      notifyStateChanged(false, true);
    });
    head.appendChild(titleIn);

    if (!s.locked) {
      const fxBtn = document.createElement("button");
      fxBtn.className = "expr-mini-btn fx-btn" + (s.formula ? " active" : "");
      fxBtn.textContent = "fx";
      fxBtn.title = s.formula ? "Detach variable formula (make static)" : "Bind to slider variables (R, r, eps, pi…)";
      fxBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        if (s.formula) {
          s.formula = null;
        } else {
          s.formula = window.CFVComplex.createDefaultFormulaForShape(s);
          await window.CFVComplex.rebuildShapeFromFormula(s);
        }
        renderDomainCards();
        notifyStateChanged(true, true);
      });
      head.appendChild(fxBtn);
    }

    const lockBtn = document.createElement("button");
    lockBtn.className = "expr-mini-btn" + (s.locked ? " locked" : "");
    lockBtn.textContent = s.locked ? "🔒" : "🔓";
    lockBtn.title = s.locked ? "Unlock element" : "Lock element";
    lockBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      s.locked = !s.locked;
      renderDomainCards();
      refreshSettingsIfTarget("shape", s.id);
      window.CFVComplex.requestRender();
      notifyStateChanged(true, true);
    });
    if (s.locked) {
      const lkPill = document.createElement("span");
      lkPill.className = "locked-pill-badge";
      lkPill.textContent = "Locked";
      head.appendChild(lkPill);
    }
    head.appendChild(lockBtn);

    const gearBtn = document.createElement("button");
    gearBtn.className = "expr-mini-btn";
    gearBtn.dataset.settingsTrigger = "1";
    gearBtn.textContent = "⚙";
    gearBtn.title = "Shape style settings";
    gearBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openItemSettings("shape", s.id, gearBtn);
    });
    head.appendChild(gearBtn);

    if (!s.locked) {
      const delBtn = document.createElement("button");
      delBtn.className = "expr-mini-btn";
      delBtn.textContent = "×";
      delBtn.title = "Delete shape";
      delBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeItemSettings();
        window.CFVComplex.deleteShape(s.id);
      });
      head.appendChild(delBtn);
    }
    body.appendChild(head);

    const meta = document.createElement("div");
    meta.className = "shape-meta-row";
    const leftMeta = document.createElement("span");
    leftMeta.textContent = `${s.closed ? "Closed" : "Open"}${s.locked ? " · Locked" : ""}`;
    meta.appendChild(leftMeta);

    const badge = formatShapeBadge(s);
    if (badge) {
      const pill = document.createElement("span");
      pill.className = "shape-val-pill" + (badge.neg ? " neg" : "");
      pill.dataset.shapeBadge = String(s.id);
      pill.textContent = badge.text;
      meta.appendChild(pill);
    }
    body.appendChild(meta);

    if (s.formula) {
      const f = s.formula;
      const grid = document.createElement("div");
      grid.className = "shape-formula-grid";

      const kindField = document.createElement("label");
      kindField.className = "formula-field wide";
      const kindLbl = document.createElement("span");
      kindLbl.textContent = "type";
      const kindSel = document.createElement("select");
      kindSel.className = "formula-in";
      kindSel.disabled = Boolean(s.locked);
      for (const [val, lbl] of [
        ["arc", "Arc (cx, cy, r, a0, a1)"],
        ["line", "Line (x0, y0 → x1, y1)"],
        ["circle", "Circle (cx, cy, r)"],
        ["rect", "Rect (x0, y0 → x1, y1)"],
        ["parametric", "Parametric (x(u), y(u))"],
      ]) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = lbl;
        if (f.kind === val) opt.selected = true;
        kindSel.appendChild(opt);
      }
      kindSel.addEventListener("change", async () => {
        const nk = kindSel.value;
        s.kind = nk === "parametric" ? "path" : nk;
        if (nk === "arc") s.formula = { kind: "arc", cx: f.cx ?? "0", cy: f.cy ?? "0", r: f.r ?? "R", a0: f.a0 ?? "0", a1: f.a1 ?? "pi" };
        else if (nk === "circle") s.formula = { kind: "circle", cx: f.cx ?? "0", cy: f.cy ?? "0", r: f.r ?? "1" };
        else if (nk === "line") s.formula = { kind: "line", x0: f.x0 ?? "-1", y0: f.y0 ?? "0", x1: f.x1 ?? "1", y1: f.y1 ?? "0" };
        else if (nk === "rect") s.formula = { kind: "rect", x0: f.x0 ?? "-1", y0: f.y0 ?? "-1", x1: f.x1 ?? "1", y1: f.y1 ?? "1" };
        else s.formula = { kind: "parametric", xExpr: f.xExpr ?? "cos(u)", yExpr: f.yExpr ?? "sin(u)", u0: f.u0 ?? "0", u1: f.u1 ?? "2*pi", closed: Boolean(s.closed) };
        await window.CFVComplex.rebuildShapeFromFormula(s);
        renderDomainCards();
        notifyStateChanged(true, true);
      });
      kindField.appendChild(kindLbl);
      kindField.appendChild(kindSel);
      grid.appendChild(kindField);

      const fieldsByKind = {
        circle: [["cx", "cx", false], ["cy", "cy", false], ["r", "r", true]],
        arc: [["cx", "cx", false], ["cy", "cy", false], ["r", "r", true], ["a0", "θ₀", false], ["a1", "θ₁", false]],
        line: [["x0", "x₀", false], ["y0", "y₀", false], ["x1", "x₁", false], ["y1", "y₁", false]],
        rect: [["x0", "x₀", false], ["y0", "y₀", false], ["x1", "x₁", false], ["y1", "y₁", false]],
        parametric: [["xExpr", "x(u)", true], ["yExpr", "y(u)", true], ["u0", "u₀", false], ["u1", "u₁", false]],
      };
      const specs = fieldsByKind[f.kind] || fieldsByKind.circle;
      for (const [key, lbl, wide] of specs) {
        const fld = document.createElement("label");
        fld.className = "formula-field" + (wide ? " wide" : "");
        const sp = document.createElement("span");
        sp.textContent = lbl;
        const inp = document.createElement("input");
        inp.className = "formula-in";
        inp.type = "text";
        inp.spellcheck = false;
        inp.value = String(f[key] ?? "");
        inp.disabled = Boolean(s.locked);
        inp.addEventListener("input", () => {
          s.formula[key] = inp.value;
          window.CFVComplex.rebuildShapeFromFormula(s);
          notifyStateChanged(false, true);
        });
        fld.appendChild(sp);
        fld.appendChild(inp);
        grid.appendChild(fld);
      }
      body.appendChild(grid);
    }

    row.appendChild(body);
    return row;
  }

  function buildGuideLineCard(ln, seqNum, isReal) {
    const selected = isReal
      ? ln.id === window.CFVReal.state.selectedLineId
      : ln.id === window.CFVComplex.state.selectedLineId;

    const row = document.createElement("div");
    row.className = "expr-card" + (selected ? " selected-item" : "") + (ln.locked ? " locked-item" : "");
    row.addEventListener("click", (ev) => {
      if (ev.target.tagName === "INPUT" || ev.target.tagName === "BUTTON") return;
      if (isReal) window.CFVReal.selectGuideLine(ln.id);
      else window.CFVComplex.selectGuideLine(ln.id);
    });

    const gutter = document.createElement("div");
    gutter.className = "expr-gutter";
    const num = document.createElement("span");
    num.className = "expr-num";
    num.textContent = String(seqNum);
    gutter.appendChild(num);

    const dot = document.createElement("button");
    dot.className = "expr-vis-dot" + (ln.visible ? "" : " off");
    dot.style.setProperty("--card-color", ln.color);
    dot.style.display = "grid";
    dot.style.placeItems = "center";
    dot.style.fontSize = "11px";
    dot.style.color = ln.visible ? "#061019" : ln.color;
    dot.textContent = ln.orientation === "horizontal" ? "―" : "│";
    dot.title = "Show/hide guide line · Shift+click for settings";
    dot.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (ev.shiftKey) { openItemSettings("guide_line", ln.id, dot); return; }
      ln.visible = !ln.visible;
      if (isReal) window.CFVReal.requestRender();
      else window.CFVComplex.requestRender();
      renderDomainCards();
      notifyStateChanged(true, true);
    });
    gutter.appendChild(dot);
    row.appendChild(gutter);

    const body = document.createElement("div");
    body.className = "expr-body";

    const head = document.createElement("div");
    head.className = "expr-head";

    const tag = document.createElement("span");
    tag.className = "expr-fn-tag";
    tag.style.color = "#38bdf8";
    tag.style.background = "rgba(56,189,248,0.12)";
    tag.textContent = "Line";
    head.appendChild(tag);

    const titleIn = document.createElement("input");
    titleIn.className = "expr-title-input";
    titleIn.value = ln.label || "";
    titleIn.placeholder = "Guide label";
    titleIn.disabled = Boolean(ln.locked);
    titleIn.addEventListener("input", () => {
      ln.label = titleIn.value;
      if (isReal) window.CFVReal.requestRender();
      else window.CFVComplex.requestRender();
      notifyStateChanged(false, true);
    });
    head.appendChild(titleIn);

    const lockBtn = document.createElement("button");
    lockBtn.className = "expr-mini-btn" + (ln.locked ? " locked" : "");
    lockBtn.textContent = ln.locked ? "🔒" : "🔓";
    lockBtn.title = ln.locked ? "Unlock guide line" : "Lock guide line";
    lockBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      ln.locked = !ln.locked;
      renderDomainCards();
      refreshSettingsIfTarget("guide_line", ln.id);
      notifyStateChanged(true, true);
    });
    if (ln.locked) {
      const lkPill = document.createElement("span");
      lkPill.className = "locked-pill-badge";
      lkPill.textContent = "Locked";
      head.appendChild(lkPill);
    }
    head.appendChild(lockBtn);

    const gearBtn = document.createElement("button");
    gearBtn.className = "expr-mini-btn";
    gearBtn.dataset.settingsTrigger = "1";
    gearBtn.textContent = "⚙";
    gearBtn.title = "Landmark line settings";
    gearBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openItemSettings("guide_line", ln.id, gearBtn);
    });
    head.appendChild(gearBtn);

    if (!ln.locked) {
      const delBtn = document.createElement("button");
      delBtn.className = "expr-mini-btn";
      delBtn.textContent = "×";
      delBtn.title = "Delete landmark line";
      delBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeItemSettings();
        if (isReal) window.CFVReal.deleteGuideLine(ln.id);
        else window.CFVComplex.deleteGuideLine(ln.id);
      });
      head.appendChild(delBtn);
    }
    body.appendChild(head);

    const valRow = document.createElement("div");
    valRow.className = "point-coords-row";

    const axisBtn = document.createElement("button");
    axisBtn.className = "guide-axis-btn";
    axisBtn.textContent =
      ln.orientation === "horizontal"
        ? (isReal ? "y =" : "Im =")
        : (isReal ? "x =" : "Re =");
    axisBtn.title = "Click to toggle Vertical / Horizontal";
    axisBtn.disabled = Boolean(ln.locked);
    axisBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      ln.orientation = ln.orientation === "horizontal" ? "vertical" : "horizontal";
      renderDomainCards();
      if (isReal) window.CFVReal.requestRender();
      else window.CFVComplex.requestRender();
      notifyStateChanged(true, true);
    });
    valRow.appendChild(axisBtn);

    const valIn = document.createElement("input");
    valIn.type = "number";
    valIn.step = "0.1";
    valIn.className = "coord-in";
    valIn.style.width = "96px";
    valIn.dataset.lineId = String(ln.id);
    valIn.value = Number(ln.value.toFixed(4)).toString();
    valIn.disabled = Boolean(ln.locked);
    valIn.addEventListener("input", () => {
      const v = parseFloat(valIn.value);
      if (!Number.isFinite(v)) return;
      ln.value = v;
      if (isReal) window.CFVReal.requestRender();
      else window.CFVComplex.requestRender();
      notifyStateChanged(false, true);
    });
    valRow.appendChild(valIn);

    if (state.mode === "integral") {
      const note = document.createElement("span");
      note.style.cssText = "margin-left:auto;font-size:9.5px;color:#64748b;";
      note.textContent = "guide only";
      valRow.appendChild(note);
    }
    body.appendChild(valRow);
    row.appendChild(body);
    return row;
  }

  function buildPointCard(p, seqNum, isReal) {
    const selected = isReal
      ? p.id === window.CFVReal.state.selectedPointId
      : (window.CFVComplex.isPointSelected
          ? window.CFVComplex.isPointSelected(p.id)
          : p.id === window.CFVComplex.state.selectedPointId);

    const row = document.createElement("div");
    row.className = "expr-card" + (selected ? " selected-item" : "") + (p.locked ? " locked-item" : "");
    row.addEventListener("click", (ev) => {
      if (ev.target.tagName === "INPUT" || ev.target.tagName === "BUTTON") return;
      if (isReal) window.CFVReal.selectPoint(p.id);
      else if (ev.ctrlKey || ev.metaKey || ev.shiftKey) window.CFVComplex.selectPoint(p.id, { toggle: true });
      else window.CFVComplex.selectPoint(p.id);
    });

    const gutter = document.createElement("div");
    gutter.className = "expr-gutter";
    const num = document.createElement("span");
    num.className = "expr-num";
    num.textContent = String(seqNum);
    gutter.appendChild(num);

    const dot = document.createElement("button");
    dot.className = "expr-vis-dot" + (p.visible ? "" : " off");
    dot.style.setProperty("--card-color", p.color);
    dot.style.display = "grid";
    dot.style.placeItems = "center";
    dot.style.fontSize = "10px";
    dot.style.color = p.visible ? "#061019" : p.color;
    dot.textContent = iconGlyph(p.icon);
    dot.title = "Show/hide point · Shift+click for style settings";
    dot.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (ev.shiftKey) { openItemSettings("point", p.id, dot); return; }
      p.visible = !p.visible;
      if (isReal) window.CFVReal.requestRender();
      else window.CFVComplex.recomputePoints();
      renderDomainCards();
      notifyStateChanged(true, true);
    });
    gutter.appendChild(dot);
    row.appendChild(gutter);

    const body = document.createElement("div");
    body.className = "expr-body";

    const head = document.createElement("div");
    head.className = "expr-head";

    const tag = document.createElement("span");
    tag.className = "expr-fn-tag";
    tag.style.color = "#fbbf24";
    tag.style.background = "rgba(251,191,36,0.12)";
    tag.textContent = "Pt";
    head.appendChild(tag);

    const titleIn = document.createElement("input");
    titleIn.className = "expr-title-input";
    titleIn.value = p.label || "";
    titleIn.placeholder = "Label";
    titleIn.disabled = Boolean(p.locked);
    titleIn.addEventListener("input", () => {
      p.label = titleIn.value;
      if (isReal) window.CFVReal.requestRender();
      else window.CFVComplex.requestRender();
      notifyStateChanged(false, true);
    });
    head.appendChild(titleIn);

    const lockBtn = document.createElement("button");
    lockBtn.className = "expr-mini-btn" + (p.locked ? " locked" : "");
    lockBtn.textContent = p.locked ? "🔒" : "🔓";
    lockBtn.title = p.locked ? "Unlock point (maps to output)" : "Lock point (pinned to input plane)";
    lockBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      p.locked = !p.locked;
      renderDomainCards();
      refreshSettingsIfTarget("point", p.id);
      if (!isReal) window.CFVComplex.requestRender();
      notifyStateChanged(true, true);
    });
    if (p.locked) {
      const lkPill = document.createElement("span");
      lkPill.className = "locked-pill-badge";
      lkPill.textContent = "Locked";
      head.appendChild(lkPill);
    }
    head.appendChild(lockBtn);

    const gearBtn = document.createElement("button");
    gearBtn.className = "expr-mini-btn";
    gearBtn.dataset.settingsTrigger = "1";
    gearBtn.textContent = "⚙";
    gearBtn.title = "Point settings (color, size, icon, label, lock)";
    gearBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openItemSettings("point", p.id, gearBtn);
    });
    head.appendChild(gearBtn);

    if (!p.locked) {
      const delBtn = document.createElement("button");
      delBtn.className = "expr-mini-btn";
      delBtn.textContent = "×";
      delBtn.title = "Delete point";
      delBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeItemSettings();
        if (isReal) window.CFVReal.deletePoint(p.id);
        else window.CFVComplex.deletePoint(p.id);
      });
      head.appendChild(delBtn);
    }
    body.appendChild(head);

    const coords = document.createElement("div");
    coords.className = "point-coords-row";
    const lblX = document.createElement("span");
    lblX.textContent = isReal ? "x:" : "Re:";
    const xIn = document.createElement("input");
    xIn.type = "number";
    xIn.step = "0.1";
    xIn.className = "coord-in";
    xIn.dataset.ptId = String(p.id);
    xIn.dataset.axis = "x";
    xIn.value = Number(p.x.toFixed(4)).toString();
    xIn.disabled = Boolean(p.locked);
    xIn.addEventListener("input", () => {
      const v = parseFloat(xIn.value);
      if (!Number.isFinite(v)) return;
      p.x = v;
      if (isReal) window.CFVReal.requestRender();
      else window.CFVComplex.recomputePoints();
      notifyStateChanged(false, true);
    });

    const lblY = document.createElement("span");
    lblY.textContent = isReal ? "y:" : "Im:";
    const yIn = document.createElement("input");
    yIn.type = "number";
    yIn.step = "0.1";
    yIn.className = "coord-in";
    yIn.dataset.ptId = String(p.id);
    yIn.dataset.axis = "y";
    yIn.value = Number(p.y.toFixed(4)).toString();
    yIn.disabled = Boolean(p.locked);
    yIn.addEventListener("input", () => {
      const v = parseFloat(yIn.value);
      if (!Number.isFinite(v)) return;
      p.y = v;
      if (isReal) window.CFVReal.requestRender();
      else window.CFVComplex.recomputePoints();
      notifyStateChanged(false, true);
    });

    coords.appendChild(lblX);
    coords.appendChild(xIn);
    coords.appendChild(lblY);
    coords.appendChild(yIn);
    body.appendChild(coords);
    row.appendChild(body);
    return row;
  }

  function renderDomainCards() {
    domainCardsEl.innerHTML = "";
    const isReal = isRealMode();
    const ordered = isReal
      ? (window.CFVReal && window.CFVReal.getOrderedElements ? window.CFVReal.getOrderedElements() : [])
      : (window.CFVComplex && window.CFVComplex.getOrderedElements ? window.CFVComplex.getOrderedElements() : []);

    const realPolys = isReal && window.CFVReal && window.CFVReal.state ? (window.CFVReal.state.polygons || []) : [];
    const domainTotal = ordered.length + (realPolys.length > 0 ? 1 : 0);
    if (domainTabCount) domainTabCount.textContent = String(realPolys.length > 0 ? realPolys.length + ordered.length : ordered.length);

    if (domainTotal === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:12px;font-size:11.5px;color:#64748b;line-height:1.45;";
      empty.textContent = isReal
        ? "Click + Pt or + Line above to add points or guide lines. Drag cards to reorder layers."
        : "Draw shapes on the input plane, or click + Circle / + Arc / + Rect / + Seg / + Pt / + Line. Drag cards to reorder layers.";
      domainCardsEl.appendChild(empty);
      return;
    }

    let seq = 1;
    if (isReal && realPolys.length > 0) {
      const selCnt = window.CFVReal.state.selectedPolyIds ? window.CFVReal.state.selectedPolyIds.size : 0;
      const dims = window.CFVReal.getActiveGridDims ? window.CFVReal.getActiveGridDims() : { r: 32, w: 64, h: 64, centered: true };
      const dimLbl = dims.centered ? `[±${dims.r}]² · ${dims.w}×${dims.h}` : `${dims.w}×${dims.h}`;
      const fillLbl = dims.centered ? `Fill [±${dims.r}]²` : `Fill ${dims.w}×${dims.h}`;
      const pCard = document.createElement("div");
      pCard.className = "expr-card real-poly-summary-card";
      pCard.innerHTML = `
        <div class="expr-gutter"><span class="expr-num">${seq++}</span></div>
        <div class="expr-body">
          <div class="expr-head">
            <span class="expr-fn-tag" style="color:#34d399;background:rgba(52,211,153,0.14)">Grid</span>
            <span style="font-size:11.5px;font-weight:600;color:var(--text-primary)">${realPolys.length} Cells (${dimLbl})</span>
            <span style="margin-left:auto;font-size:10px;color:${selCnt > 0 ? "var(--accent)" : "var(--text-muted)"}">${selCnt} sel</span>
          </div>
          <div class="poly-summary-actions">
            <button class="hud-btn" data-pact="all">Select All</button>
            <button class="hud-btn" data-pact="inv">Invert</button>
            <button class="hud-btn danger-btn" data-pact="del">Delete Sel</button>
            <button class="hud-btn" data-pact="fill">${fillLbl}</button>
            <button class="hud-btn" data-pact="clear">Clear</button>
          </div>
        </div>`;
      pCard.querySelector('[data-pact="all"]').addEventListener("click", () => window.CFVReal.selectAllPolygons());
      pCard.querySelector('[data-pact="inv"]').addEventListener("click", () => window.CFVReal.invertPolygonSelection());
      pCard.querySelector('[data-pact="del"]').addEventListener("click", () => window.CFVReal.deleteSelectedPolygons());
      pCard.querySelector('[data-pact="fill"]').addEventListener("click", () => window.CFVReal.fillGridPolygons());
      pCard.querySelector('[data-pact="clear"]').addEventListener("click", () => window.CFVReal.clearPolygons());
      domainCardsEl.appendChild(pCard);
    }

    let dragElFrom = -1;
    ordered.forEach((el, idx) => {
      const card =
        el.kind === "shape" ? buildShapeCard(el.item, seq++) :
        el.kind === "guide_line" ? buildGuideLineCard(el.item, seq++, isReal) :
        buildPointCard(el.item, seq++, isReal);

      const gutter = card.querySelector(".expr-gutter");
      if (gutter) {
        const grip = document.createElement("span");
        grip.className = "drag-grip";
        grip.textContent = "⋮⋮";
        grip.title = "Drag to reorder layer (top = back, bottom = front)";
        gutter.insertBefore(grip, gutter.firstChild);
      }

      card.draggable = true;
      card.addEventListener("dragstart", (ev) => {
        if (ev.target && (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA" || ev.target.tagName === "SELECT")) {
          ev.preventDefault();
          return;
        }
        dragElFrom = idx;
        card.classList.add("dragging-card");
        if (ev.dataTransfer) { ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", String(idx)); }
      });
      card.addEventListener("dragover", (ev) => {
        if (dragElFrom < 0 || dragElFrom === idx) return;
        ev.preventDefault();
        const rect = card.getBoundingClientRect();
        const before = ev.clientY < rect.top + rect.height * 0.5;
        card.classList.toggle("drop-before", before);
        card.classList.toggle("drop-after", !before);
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("drop-before", "drop-after");
      });
      card.addEventListener("drop", (ev) => {
        ev.preventDefault();
        card.classList.remove("drop-before", "drop-after");
        if (dragElFrom < 0 || dragElFrom === idx) return;
        const rect = card.getBoundingClientRect();
        const before = ev.clientY < rect.top + rect.height * 0.5;
        let toIdx = before ? idx : idx + 1;
        if (dragElFrom < toIdx) toIdx--;
        const fromIdx = dragElFrom;
        dragElFrom = -1;
        if (toIdx !== fromIdx) {
          if (isReal && window.CFVReal.reorderElement) window.CFVReal.reorderElement(fromIdx, toIdx);
          else if (!isReal && window.CFVComplex.reorderElement) window.CFVComplex.reorderElement(fromIdx, toIdx);
        }
      });
      card.addEventListener("dragend", () => {
        dragElFrom = -1;
        card.classList.remove("dragging-card", "drop-before", "drop-after");
      });
      domainCardsEl.appendChild(card);
    });
  }

  function syncPointCoords(pt) {
    const xin = sidebar.querySelector(`input.coord-in[data-pt-id="${pt.id}"][data-axis="x"]`);
    const yin = sidebar.querySelector(`input.coord-in[data-pt-id="${pt.id}"][data-axis="y"]`);
    if (xin) xin.value = Number(pt.x.toFixed(4)).toString();
    if (yin) yin.value = Number(pt.y.toFixed(4)).toString();
  }

  function syncGuideLine(ln) {
    const vin = sidebar.querySelector(`input.coord-in[data-line-id="${ln.id}"]`);
    if (vin) vin.value = Number(ln.value.toFixed(4)).toString();
  }

  function syncShapeBadges() {
    for (const s of window.CFVComplex.state.shapes) {
      const el = sidebar.querySelector(`[data-shape-badge="${s.id}"]`);
      if (!el) continue;
      const b = formatShapeBadge(s);
      if (b) {
        el.textContent = b.text;
        el.classList.toggle("neg", b.neg);
      }
    }
  }

  /* -------------------------------------------------------------------------
   * Per-Item Style Settings Popover (#item-settings-popover)
   * ------------------------------------------------------------------------- */

  function findSettingsItem(kind, id) {
    if (kind === "fn") return state.cards.find((c) => c.id === id);
    if (kind === "shape") return window.CFVComplex.state.shapes.find((s) => s.id === id);
    if (kind === "point") {
      const list = isRealMode() ? window.CFVReal.state.points : window.CFVComplex.state.points;
      return list.find((p) => p.id === id);
    }
    if (kind === "guide_line") {
      const list = isRealMode() ? window.CFVReal.state.lines : window.CFVComplex.state.lines;
      return list.find((l) => l.id === id);
    }
    return null;
  }

  function closeItemSettings() {
    state.settingsTarget = null;
    itemSettingsPopover.classList.add("hidden");
  }

  function refreshSettingsIfTarget(kind, id) {
    if (state.settingsTarget && state.settingsTarget.kind === kind && state.settingsTarget.id === id) {
      renderItemSettings();
    }
  }

  function openItemSettingsAt(kind, id, clientX, clientY) {
    state.settingsTarget = { kind, id };
    renderItemSettings();
    itemSettingsPopover.classList.remove("hidden");
    const popW = itemSettingsPopover.offsetWidth || 268;
    const popH = itemSettingsPopover.offsetHeight || 340;
    const left = Math.max(10, Math.min((window.innerWidth || 1200) - popW - 12, clientX + 8));
    const top = Math.max(52, Math.min((window.innerHeight || 800) - popH - 14, clientY - 12));
    itemSettingsPopover.style.left = `${left}px`;
    itemSettingsPopover.style.top = `${top}px`;
  }

  function openItemSettings(kind, id, anchorEl) {
    if (
      !itemSettingsPopover.classList.contains("hidden") &&
      state.settingsTarget &&
      state.settingsTarget.kind === kind &&
      state.settingsTarget.id === id
    ) {
      closeItemSettings();
      return;
    }
    state.settingsTarget = { kind, id };
    renderItemSettings();
    itemSettingsPopover.classList.remove("hidden");

    if (anchorEl && anchorEl.getBoundingClientRect) {
      const rect = anchorEl.getBoundingClientRect();
      const popH = itemSettingsPopover.offsetHeight || 320;
      const top = Math.max(54, Math.min((window.innerHeight || 800) - popH - 14, rect.top - 10));
      const left = Math.min((window.innerWidth || 1200) - 280, Math.max(12, sidebar.getBoundingClientRect().right + 8));
      itemSettingsPopover.style.top = `${top}px`;
      itemSettingsPopover.style.left = `${left}px`;
    }
  }

  function renderItemSettings() {
    if (!state.settingsTarget) return;
    const { kind, id } = state.settingsTarget;
    const item = findSettingsItem(kind, id);
    if (!item) { closeItemSettings(); return; }

    itemSettingsTitle.textContent =
      kind === "fn" ? "Curve / Function Style" :
      kind === "shape" ? "Shape / Contour Properties" :
      kind === "guide_line" ? "Guide Line Properties" : "Point Properties";
    itemSettingsBody.innerHTML = "";

    const repaint = (recalc = false) => {
      if (kind === "fn") {
        renderFnCards();
        if (isRealMode()) window.CFVReal.scheduleSample(true);
        else if (recalc) window.CFVComplex.recomputeAll(1.0);
        else window.CFVComplex.requestRender();
      } else if (kind === "shape") {
        renderDomainCards();
        window.CFVComplex.updateIntegralPanel();
        window.CFVComplex.requestRender();
      } else {
        renderDomainCards();
        if (isRealMode()) window.CFVReal.requestRender();
        else window.CFVComplex.requestRender();
      }
      notifyStateChanged(true, true);
    };

    const colorSec = document.createElement("div");
    colorSec.className = "tools-section";
    colorSec.innerHTML = `<div class="tools-sec-label">Color &amp; Opacity</div>`;
    const grid = document.createElement("div");
    grid.className = "swatch-grid";
    for (const hex of COLORS) {
      const sw = document.createElement("button");
      sw.className = "swatch-btn" + ((item.color || "").toLowerCase() === hex.toLowerCase() ? " active" : "");
      sw.style.background = hex;
      sw.addEventListener("click", () => {
        item.color = hex;
        repaint(kind === "fn" && !isRealMode());
        renderItemSettings();
      });
      grid.appendChild(sw);
    }
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = item.color && item.color.length === 7 ? item.color : "#38bdf8";
    picker.title = "Custom color";
    picker.style.cssText = "width:24px;height:24px;border:none;background:transparent;cursor:pointer;padding:0;";
    picker.addEventListener("input", () => {
      item.color = picker.value;
      repaint(kind === "fn" && !isRealMode());
    });
    grid.appendChild(picker);
    colorSec.appendChild(grid);

    /* Opacity Slider (applies to both Input Space & Output Space!) */
    const opRow = document.createElement("div");
    opRow.className = "slider-row";
    opRow.style.marginTop = "6px";
    opRow.innerHTML = `<span>Opacity</span>`;
    const curOp = normOpacityWs(item.opacity, 1.0);
    const opRange = document.createElement("input");
    opRange.type = "range"; opRange.min = "0"; opRange.max = "1"; opRange.step = "0.05";
    opRange.value = String(curOp);
    const opVal = document.createElement("code");
    opVal.textContent = `${Math.round(curOp * 100)}%`;
    opRange.addEventListener("input", () => {
      item.opacity = normOpacityWs(opRange.value, 1.0);
      opVal.textContent = `${Math.round(item.opacity * 100)}%`;
      repaint(false);
    });
    opRow.appendChild(opRange); opRow.appendChild(opVal);
    colorSec.appendChild(opRow);
    itemSettingsBody.appendChild(colorSec);

    if (kind === "point") {
      const szSec = document.createElement("div");
      szSec.className = "tools-section";
      szSec.innerHTML = `<div class="tools-sec-label">Point Size &amp; Icon</div>`;
      const szRow = document.createElement("div");
      szRow.className = "slider-row";
      szRow.innerHTML = `<span>Size</span>`;
      const szRange = document.createElement("input");
      szRange.type = "range"; szRange.min = "2"; szRange.max = "14"; szRange.step = "0.5";
      szRange.value = String(item.size || 5);
      const szVal = document.createElement("code");
      szVal.textContent = String(item.size || 5);
      szRange.addEventListener("input", () => {
        item.size = parseFloat(szRange.value);
        szVal.textContent = String(item.size);
        repaint();
      });
      szRow.appendChild(szRange); szRow.appendChild(szVal);
      szSec.appendChild(szRow);

      const iconRow = document.createElement("div");
      iconRow.className = "style-btn-row";
      for (const ic of ICONS) {
        const b = document.createElement("button");
        b.className = "style-opt-btn" + ((item.icon || "dot") === ic.id ? " active" : "");
        b.textContent = ic.glyph;
        b.title = ic.label;
        b.addEventListener("click", () => {
          item.icon = ic.id;
          repaint();
          renderItemSettings();
        });
        iconRow.appendChild(b);
      }
      szSec.appendChild(iconRow);

      const lblToggle = document.createElement("label");
      lblToggle.className = "toggle-row";
      lblToggle.style.marginTop = "4px";
      lblToggle.innerHTML = `<span>Show label on graph</span>`;
      const lblCb = document.createElement("input");
      lblCb.type = "checkbox";
      lblCb.checked = item.showLabel !== false;
      lblCb.addEventListener("change", () => { item.showLabel = lblCb.checked; repaint(); });
      lblToggle.appendChild(lblCb);
      szSec.appendChild(lblToggle);
      itemSettingsBody.appendChild(szSec);
    } else {
      const lnSec = document.createElement("div");
      lnSec.className = "tools-section";
      lnSec.innerHTML = `<div class="tools-sec-label">Stroke &amp; Line Style (0 = No Outline)</div>`;

      const lwRow = document.createElement("div");
      lwRow.className = "slider-row";
      lwRow.innerHTML = `<span>Width</span>`;
      const curLw = normLineWidthWs(item.lineWidth, 2.2);
      const lwRange = document.createElement("input");
      lwRange.type = "range"; lwRange.min = "0"; lwRange.max = "6"; lwRange.step = "0.2";
      lwRange.value = String(curLw);
      const lwVal = document.createElement("code");
      lwVal.textContent = curLw.toFixed(1);
      lwRange.addEventListener("input", () => {
        item.lineWidth = normLineWidthWs(lwRange.value, 2.2);
        lwVal.textContent = item.lineWidth.toFixed(1);
        repaint(kind === "fn" && !isRealMode());
      });
      lwRow.appendChild(lwRange); lwRow.appendChild(lwVal);
      lnSec.appendChild(lwRow);

      const stRow = document.createElement("div");
      stRow.className = "style-btn-row";
      const curStyle = item.lineStyle || "solid";
      for (const ls of LINE_STYLES) {
        const b = document.createElement("button");
        b.className = "style-opt-btn" + (curStyle === ls.id ? " active" : "");
        b.textContent = ls.label;
        b.addEventListener("click", () => {
          item.lineStyle = ls.id;
          repaint(kind === "fn" && !isRealMode());
          renderItemSettings();
        });
        stRow.appendChild(b);
      }
      lnSec.appendChild(stRow);

      if (kind === "guide_line") {
        const orRow = document.createElement("div");
        orRow.className = "style-btn-row";
        orRow.style.marginTop = "4px";
        for (const [oid, lbl] of [["vertical", isRealMode() ? "Vertical (x=c)" : "Vertical (Re=c)"], ["horizontal", isRealMode() ? "Horizontal (y=c)" : "Horizontal (Im=c)"]]) {
          const b = document.createElement("button");
          b.className = "style-opt-btn" + ((item.orientation || "vertical") === oid ? " active" : "");
          b.textContent = lbl;
          b.addEventListener("click", () => {
            item.orientation = oid;
            repaint();
            renderItemSettings();
          });
          orRow.appendChild(b);
        }
        lnSec.appendChild(orRow);

        const lblToggle = document.createElement("label");
        lblToggle.className = "toggle-row";
        lblToggle.style.marginTop = "4px";
        lblToggle.innerHTML = `<span>Show label on graph</span>`;
        const lblCb = document.createElement("input");
        lblCb.type = "checkbox";
        lblCb.checked = item.showLabel !== false;
        lblCb.addEventListener("change", () => { item.showLabel = lblCb.checked; repaint(); });
        lblToggle.appendChild(lblCb);
        lnSec.appendChild(lblToggle);
      }

      if (kind === "fn" && isRealMode()) {
        const stepRow = document.createElement("label");
        stepRow.className = "toggle-row";
        stepRow.style.marginTop = "4px";
        stepRow.innerHTML = `<span>Staircase Step Curve</span>`;
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = Boolean(item.step);
        cb.addEventListener("change", () => { item.step = cb.checked; repaint(); });
        stepRow.appendChild(cb);
        lnSec.appendChild(stepRow);
      }

      if (kind === "shape") {
        const actRow = document.createElement("div");
        actRow.className = "btn-row";
        actRow.style.marginTop = "4px";
        if (item.rawPts.length >= 3) {
          const clBtn = document.createElement("button");
          clBtn.className = "btn-subtle flex-1";
          clBtn.textContent = item.closed ? "Open Path" : "Close Loop";
          clBtn.addEventListener("click", async () => {
            await window.CFVComplex.toggleCloseShape(item.id);
            renderItemSettings();
          });
          actRow.appendChild(clBtn);
        }
        const revBtn = document.createElement("button");
        revBtn.className = "btn-subtle flex-1";
        revBtn.textContent = "Reverse ⇄";
        revBtn.addEventListener("click", async () => {
          await window.CFVComplex.reverseShape(item.id);
          renderItemSettings();
        });
        actRow.appendChild(revBtn);
        lnSec.appendChild(actRow);
      }
      itemSettingsBody.appendChild(lnSec);
    }

    if (kind === "shape" || kind === "point" || kind === "guide_line") {
      const laySec = document.createElement("div");
      laySec.className = "tools-section";
      laySec.innerHTML = `<div class="tools-sec-label">Layer Order</div>`;
      const lRow = document.createElement("div");
      lRow.className = "layer-move-row";
      const moveFn = (act) => {
        if (isRealMode() && window.CFVReal.moveElementLayer) window.CFVReal.moveElementLayer(kind, id, act);
        else if (!isRealMode() && window.CFVComplex.moveElementLayer) window.CFVComplex.moveElementLayer(kind, id, act);
      };
      for (const [act, lbl, title] of [
        ["back", "⇤ Back", "Send to Back (drawn first)"],
        ["backward", "↑ Back", "Send Backward one layer"],
        ["forward", "↓ Front", "Bring Forward one layer"],
        ["front", "Front ⇥", "Bring to Front (drawn on top)"],
      ]) {
        const b = document.createElement("button");
        b.className = "style-opt-btn";
        b.textContent = lbl;
        b.title = title;
        b.addEventListener("click", () => moveFn(act));
        lRow.appendChild(b);
      }
      laySec.appendChild(lRow);
      itemSettingsBody.appendChild(laySec);
    }

    const lockSec = document.createElement("div");
    lockSec.className = "tools-section";
    const lockRow = document.createElement("label");
    lockRow.className = "toggle-row";
    lockRow.innerHTML = `<span>🔒 Lock element</span>`;
    const lockCb = document.createElement("input");
    lockCb.type = "checkbox";
    lockCb.checked = Boolean(item.locked);
    lockCb.addEventListener("change", () => {
      item.locked = lockCb.checked;
      repaint();
      renderItemSettings();
    });
    lockRow.appendChild(lockCb);
    lockSec.appendChild(lockRow);

    if (!item.locked) {
      const delBtn = document.createElement("button");
      delBtn.className = "btn-danger full-btn";
      delBtn.style.marginTop = "6px";
      delBtn.textContent = "Delete Element";
      delBtn.addEventListener("click", () => {
        closeItemSettings();
        if (kind === "fn") {
          state.cards = state.cards.filter((q) => q.id !== id);
          if (state.primaryCardId === id) { const rem = fnCards(); state.primaryCardId = rem[0] ? rem[0].id : null; }
          renderFnCards(); compileWorkspace(true, false); notifyStateChanged(true, true);
        } else if (kind === "shape") window.CFVComplex.deleteShape(id);
        else if (kind === "point") { if (isRealMode()) window.CFVReal.deletePoint(id); else window.CFVComplex.deletePoint(id); }
        else if (kind === "guide_line") { if (isRealMode()) window.CFVReal.deleteGuideLine(id); else window.CFVComplex.deleteGuideLine(id); }
      });
      lockSec.appendChild(delBtn);
    }
    itemSettingsBody.appendChild(lockSec);
  }

  function closeNewFolderForm() {
    if (newFolderForm) newFolderForm.classList.add("hidden");
  }

  function closeExamplesDropdown() {
    if (examplesDropdown) examplesDropdown.classList.add("hidden");
    if (btnExamples) btnExamples.setAttribute("aria-expanded", "false");
    closeNewFolderForm();
  }

  document.getElementById("btn-close-item-settings").addEventListener("click", closeItemSettings);
  document.addEventListener("pointerdown", (ev) => {
    if (!itemSettingsPopover.classList.contains("hidden")) {
      const isTrigger = ev.target && ev.target.closest && ev.target.closest('[data-settings-trigger="1"]');
      if (!isTrigger && !itemSettingsPopover.contains(ev.target)) closeItemSettings();
    }
    if (examplesDropdown && !examplesDropdown.classList.contains("hidden")) {
      const inWrap = ev.target && ev.target.closest && ev.target.closest(".sidebar-examples-wrap");
      if (!inWrap) closeExamplesDropdown();
    }
    if (saveProjectForm && !saveProjectForm.classList.contains("hidden")) {
      const inProjBar = ev.target && ev.target.closest && ev.target.closest(".topbar-project-bar");
      if (!inProjBar) closeSaveProjectForm();
    }
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeItemSettings();
      closeExamplesDropdown();
      closeFnLibraryDropdown();
      closeUnsavedModal();
      closeDeleteModal();
      closeSaveProjectForm();
      closeSavePresetForm();
    }
  });

  /* -------------------------------------------------------------------------
   * Frame-Paced Live Slider Animation Loop (Never Starves or Drops Frames!)
   * ------------------------------------------------------------------------- */

  function isAnySliderPlaying() { return sliderCards().some((s) => s.playing); }

  function ensureSliderLoop() {
    if (!isAnySliderPlaying()) {
      if (state.sliderRaf) cancelAnimationFrame(state.sliderRaf);
      state.sliderRaf = null;
      state.sliderLastTs = 0;
      return;
    }
    if (state.sliderRaf) return;
    const tick = (ts) => {
      if (!isAnySliderPlaying()) { state.sliderRaf = null; return; }
      if (state.sliderLastTs > 0) {
        const dt = Math.min(0.08, (ts - state.sliderLastTs) / 1000);
        const playingSliders = sliderCards().filter((s) => s.playing);
        const needsServer = paramsRequireServerRecompute(playingSliders.map((s) => s.name));
        const busy = needsServer && (
          isRealMode()
            ? (window.CFVReal && window.CFVReal.isFetchBusy && window.CFVReal.isFetchBusy())
            : (window.CFVComplex && window.CFVComplex.isFetchBusy && window.CFVComplex.isFetchBusy())
        );
        let anyStepped = false;
        for (const s of playingSliders) {
          const spd = Math.max(0.05, Number(s.speed) || 1.0);
          const span = Math.max(1e-6, s.max - s.min);
          if (s.step >= 1) {
            /* Integer sliders (e.g. Generation G, Zero count K): 6 steps/sec at 1x speed */
            const rate = 6.0 * s.step * spd;
            s._playAcc = (Number(s._playAcc) || 0) + dt * rate;
            if (s._playAcc >= s.step && !busy) {
              const nSteps = Math.floor(s._playAcc / s.step);
              s._playAcc -= nSteps * s.step;
              s.value = Math.round(s.value + nSteps * s.step);
              if (s.value > s.max) s.value = s.min;
              anyStepped = true;
            }
          } else {
            /* Continuous sliders: smooth 60 FPS advancement on every frame! */
            const delta = (span / 18.0) * dt * spd;
            s.value += delta;
            if (s.value > s.max) s.value = s.min;
            anyStepped = true;
          }
        }
        if (anyStepped) {
          resolveVariables(true);
          if (needsServer) {
            refreshActiveStage(true);
          } else if (isRealMode()) {
            window.CFVReal.requestRender();
          } else {
            window.CFVComplex.requestRender();
          }
        }
      }
      state.sliderLastTs = ts;
      state.sliderRaf = requestAnimationFrame(tick);
    };
    state.sliderRaf = requestAnimationFrame(tick);
  }

  /* -------------------------------------------------------------------------
   * Full Project JSON & Multi-Card AI Bundle Importer
   * Supports full cfv_project_v1 JSON (with project name, viewport, seedCells/polygons, and presets[])
   * as well as multi-card AI bundles and C snippets.
   * ------------------------------------------------------------------------- */

  async function importAIBundle(bundle, replace = true, opts = {}) {
    if (!bundle) return { ok: false, message: "Empty project JSON." };
    closeItemSettings();

    if (replace) {
      const proj = normalizeStoredProject({
        ...bundle,
        mode:
          bundle.mode === "real" || bundle.mode === "integral" || bundle.mode === "map"
            ? bundle.mode
            : state.mode,
        name: bundle.name || bundle.title || "Imported Project",
      });
      if (!proj) return { ok: false, message: "Invalid project JSON object." };

      const hasPresets = Array.isArray(proj.presets) && proj.presets.length > 0;
      const firstPr = hasPresets ? proj.presets[0] : null;
      const targetSnap = (firstPr && firstPr.snapshot) ? firstPr.snapshot : proj.baseState;

      await restoreWorkspaceSnapshot(targetSnap, true, {
        projectId: opts.saveToRepo ? proj.id : null,
        projectName: proj.name || "Imported Project",
        isCustomProject: Boolean(opts.saveToRepo),
        sourceExampleId: null,
        presets: proj.presets,
        activePresetId: firstPr ? firstPr.id : null,
      });

      if (firstPr && firstPr.startSlider) {
        const sl = sliderCards().find((s) => s.name === firstPr.startSlider);
        if (sl) {
          sl.value = sl.min;
          sl.playing = true;
          renderFnCards();
          ensureSliderLoop();
        }
      }

      if (opts.saveToRepo) {
        saveCurrentProject(proj.name || defaultProjectName());
      } else {
        state.hasUnsavedWork = !isBlankWorkspace() || state.projectPresets.length > 0;
        updateProjectHeaderUI();
        renderExamplesMenu();
        renderPresetBar();
      }
      return state.lastCompileResult || { ok: true, message: "Imported full project." };
    }

    /* Append mode: add cards, sliders, vars, shapes, points, lines to current workspace */
    const baseFnCount = fnCards().length;
    let explicitActiveId = null;
    let lastAddedFnId = null;

    (bundle.cards || []).forEach((c, idx) => {
      const code = typeof c === "string" ? c : c.code || (isRealMode() ? "sin(x)" : "c_zeta(s)");
      const card = {
        id: state.nextCardId++,
        kind: "fn",
        title: (typeof c === "object" && c.title) ? c.title : `AI Card ${baseFnCount + idx + 1}`,
        code,
        color: (typeof c === "object" && c.color) ? c.color : COLORS[(baseFnCount + idx) % COLORS.length],
        lineWidth: (typeof c === "object" && Number(c.lineWidth)) || 2.2,
        lineStyle: (typeof c === "object" && c.lineStyle) || "solid",
        step: Boolean(typeof c === "object" && c.step),
        locked: Boolean(typeof c === "object" && c.locked),
        visible: typeof c === "object" && c.visible !== undefined ? Boolean(c.visible) : true,
        builtin: isRealMode() ? { fn: 0, kind: "exact" } : { fn: 0 },
      };
      state.cards.push(card);
      lastAddedFnId = card.id;
      if (typeof c === "object" && c.active === true) {
        explicitActiveId = card.id;
      }
    });

    if (!isRealMode()) {
      if (explicitActiveId !== null) state.primaryCardId = explicitActiveId;
      else if (!state.primaryCardId) state.primaryCardId = lastAddedFnId || (fnCards()[0] ? fnCards()[0].id : null);
    } else if (!state.primaryCardId && lastAddedFnId) {
      state.primaryCardId = lastAddedFnId;
    }

    const existingParams = new Set(getParamNames());
    (bundle.sliders || []).forEach((s) => {
      const name = String(s.name || "a").replace(/[^a-zA-Z0-9_]/g, "") || "a";
      if (existingParams.has(name)) return;
      existingParams.add(name);
      if (s.expr) {
        state.cards.push({
          id: state.nextCardId++,
          kind: "var",
          name,
          label: s.label || "",
          expr: String(s.expr),
          value: Number(s.value ?? 0),
        });
      } else {
        state.cards.push({
          id: state.nextCardId++,
          kind: "slider",
          name,
          label: s.label || "parameter",
          value: Number(s.value ?? 1),
          min: Number(s.min ?? 0),
          max: Number(s.max ?? 10),
          step: Number(s.step ?? 0.1),
          speed: Number(s.speed ?? 1.0),
          playing: false,
        });
      }
    });
    (bundle.vars || []).forEach((v) => {
      const name = String(v.name || "R").replace(/[^a-zA-Z0-9_]/g, "") || "R";
      if (existingParams.has(name)) return;
      existingParams.add(name);
      state.cards.push({
        id: state.nextCardId++,
        kind: "var",
        name,
        label: v.label || "",
        expr: String(v.expr ?? "0"),
        value: 0,
      });
    });

    resolveVariables(false);
    renderFnCards();
    const comp = await compileWorkspace(true, true);

    if (isRealMode()) {
      for (const p of bundle.points || []) window.CFVReal.addPoint(p, true);
      for (const l of bundle.lines || []) window.CFVReal.addGuideLine(l, true);
      const rawCells = bundle.seedCells || bundle.polygons;
      if (Array.isArray(rawCells) && rawCells.length > 0 && window.CFVReal.setPolygonsFromCells) {
        await window.CFVReal.setPolygonsFromCells(rawCells);
      }
      const vw = (bundle.viewport && bundle.viewport.view) || bundle.view;
      if (vw) window.CFVReal.setViewBounds(vw);
      else window.CFVReal.scheduleSample(true);
    } else {
      const iv = (bundle.viewport && bundle.viewport.inView) || bundle.inView;
      const ov = (bundle.viewport && bundle.viewport.outView) || bundle.outView;
      if (iv || ov) window.CFVComplex.setViewBounds(iv, ov);
      if (bundle.shapes && bundle.shapes.length > 0) window.CFVComplex.addBundleShapes(bundle.shapes, false);
      for (const p of bundle.points || []) await window.CFVComplex.addPoint(p, true);
      for (const l of bundle.lines || []) window.CFVComplex.addGuideLine(l, true);
      await window.CFVComplex.recomputeAll(1.0);
    }

    renderDomainCards();
    renderExamplesMenu();
    renderPresetBar();
    notifyStateChanged(true, true);
    return comp;
  }

  /* -------------------------------------------------------------------------
   * Blank Project, Projects Dropdown & Current Project's Presets Bar
   * ------------------------------------------------------------------------- */

  function openBlankWorkspace(mode, pushHistory = true) {
    state.restoringState = true;
    try {
      closeItemSettings();
      closeExamplesDropdown();
      closeSaveProjectForm();
      closeSavePresetForm();

      state.activeProjectId = null;
      state.activeProjectName = "New Project";
      state.activeProjectDescription = "";
      syncDescriptionUI();
      state.activeProjectIsCustom = false;
      state.activeProjectFolder = "my";
      state.sourceExampleId = null;
      state.projectPresets = [];
      state.activePresetId = null;
      state.hasUnsavedWork = false;
      state.compiledKind = null;
      state.dirty = false;

      for (const s of sliderCards()) s.playing = false;
      if (window.CFVReal && typeof window.CFVReal.stopAudio === "function") {
        window.CFVReal.stopAudio();
      }

      setModeUI(mode);
      state.cards = [];
      state.primaryCardId = null;

      if (mode === "real") {
        window.CFVReal.clearToBlank();
      } else {
        window.CFVComplex.setMode(mode);
        window.CFVComplex.clearToBlank();
      }

      setStatus("ok", "Blank · Click + Fn or pick a Project");
      updateProjectHeaderUI();
      renderFnCards();
      renderDomainCards();
      renderExamplesMenu();
      renderPresetBar();
      syncUrl(pushHistory, false);
    } finally {
      state.restoringState = false;
    }
  }

  function renderPresetBar() {
    presetBarList.innerHTML = "";
    presetBar.classList.remove("hidden");

    if (state.projectPresets.length === 0) {
      const hint = document.createElement("span");
      hint.className = "preset-empty-hint";
      hint.textContent = "No presets in this project yet";
      presetBarList.appendChild(hint);
      return;
    }

    for (const pr of state.projectPresets) {
      const isAct = pr.id === state.activePresetId;
      const btn = document.createElement("button");
      btn.className = "preset-pill" + (pr.isCustom ? " custom-pill" : "") + (isAct ? " active" : "");

      const lbl = document.createElement("span");
      lbl.textContent = pr.isCustom ? `★ ${pr.name}` : pr.name;
      btn.appendChild(lbl);

      if (pr.isCustom) {
        const upd = document.createElement("span");
        upd.className = "preset-pill-upd";
        upd.textContent = "↻";
        upd.title = "Overwrite this preset with current workspace view & state";
        upd.addEventListener("click", (ev) => {
          ev.stopPropagation();
          updatePresetInCurrentProject(pr.id);
        });
        btn.appendChild(upd);

        const del = document.createElement("span");
        del.className = "preset-pill-del";
        del.textContent = "×";
        del.title = "Remove preset from project";
        del.addEventListener("click", (ev) => {
          ev.stopPropagation();
          removePresetFromCurrentProject(pr.id);
        });
        btn.appendChild(del);
      }

      btn.addEventListener("click", async () => {
        if (isAct && !hasUnsavedChanges()) return;
        /* Switching presets inside the SAME project never prompts to save! */
        if (pr.snapshot) {
          await restoreWorkspaceSnapshot(pr.snapshot, true, {
            projectId: state.activeProjectId,
            projectName: state.activeProjectName,
            isCustomProject: state.activeProjectIsCustom,
            sourceExampleId: state.sourceExampleId,
            presets: state.projectPresets,
            activePresetId: pr.id,
          });
          if (pr.startSlider) {
            const sl = sliderCards().find((s) => s.name === pr.startSlider);
            if (sl) {
              sl.value = sl.min;
              sl.playing = true;
              renderFnCards();
              ensureSliderLoop();
            }
          }
        } else if (pr.builtinPreset) {
          const ex = window.CFVExamples.byId(pr.sourceExampleId || state.sourceExampleId || state.activeProjectId);
          if (ex) applyBuiltInPreset(ex, pr.builtinPreset, true);
        }
      });
      presetBarList.appendChild(btn);
    }
  }

  async function applyBuiltInPreset(ex, preset, pushHistory = true) {
    if (!ex || !preset) return;
    state.restoringState = true;
    try {
      state.activePresetId = preset.id;
      state.hasUnsavedWork = false;
      updateProjectHeaderUI();
      renderPresetBar();
      syncUrl(pushHistory, false);

      for (const s of sliderCards()) s.playing = false;

      /* Reset sliders & variables to example defaults, then apply preset.sliderValues */
      const exSliders = ex.sliders || [];
      for (const sc of sliderCards()) {
        const def = exSliders.find((d) => d.name === sc.name);
        if (def !== undefined) sc.value = def.value;
        if (preset.sliderValues && Object.prototype.hasOwnProperty.call(preset.sliderValues, sc.name)) {
          sc.value = Number(preset.sliderValues[sc.name]);
        }
      }
      const exVars = ex.vars || [];
      for (const vc of varCards()) {
        const def = exVars.find((d) => d.name === vc.name);
        if (def !== undefined) vc.expr = def.expr || "";
      }
      if (preset.startSlider) {
        const sl = sliderCards().find((s) => s.name === preset.startSlider);
        if (sl) { sl.value = sl.min; sl.playing = true; }
      }
      resolveVariables(false);

      if (ex.mode === "real") {
        if (Array.isArray(preset.visibleFnIndices)) {
          const fns = fnCards();
          fns.forEach((c, idx) => { c.visible = preset.visibleFnIndices.includes(idx); });
        }
        renderFnCards();
        await window.CFVReal.loadExampleAndPreset(ex, preset);
        resolveVariables(true, true);
        if (preset.startSlider) ensureSliderLoop();
      } else {
        renderFnCards();
        await window.CFVComplex.loadExampleAndPreset(ex, preset);
        resolveVariables(true, true);
        window.CFVComplex.requestRender();
        if (preset.startSlider) ensureSliderLoop();
      }
    } finally {
      state.restoringState = false;
    }
  }

  function openProjectImportExport(action = "import", customJsonStr = null) {
    closeExamplesDropdown();
    const modal = document.getElementById("docs-modal");
    if (!modal) return;
    modal.classList.remove("hidden");
    const termTab = document.querySelector('[data-docs-tab="terminal"]');
    if (termTab) termTab.click();
    if (action === "export") {
      const jsonStr = customJsonStr || exportProjectJSON();
      if (window.CFVDocs && typeof window.CFVDocs.loadJsonIntoTerminal === "function") {
        window.CFVDocs.loadJsonIntoTerminal(
          jsonStr,
          "Exported Full Project JSON (cfv_project_v1). Click Copy JSON or Download .json!"
        );
      } else {
        const termIn = document.getElementById("ai-terminal-input");
        if (termIn) termIn.value = jsonStr;
      }
    } else {
      const termIn = document.getElementById("ai-terminal-input");
      if (termIn && termIn.focus) termIn.focus();
    }
  }

  /* Standardized Project Row used uniformly for ALL projects (saved & built-in examples) */
  function buildProjectRow({ title, badge, subtitle, description, isActive, onSelect, onRename, onExportJson, onDelete }) {
    const wrap = document.createElement("div");
    wrap.className = "ex-item-row";

    const b = document.createElement("button");
    b.className = "ex-item" + (isActive ? " active" : "");
    if (description) b.title = description;

    const top = document.createElement("div");
    top.className = "ex-item-top";
    const tSpan = document.createElement("span");
    tSpan.className = "ex-item-title";
    tSpan.textContent = title;
    const bSpan = document.createElement("span");
    bSpan.className = "ex-item-badge";
    bSpan.textContent = badge;
    top.appendChild(tSpan);
    top.appendChild(bSpan);
    b.appendChild(top);

    const sSpan = document.createElement("span");
    sSpan.className = "ex-item-sub";
    sSpan.textContent = subtitle || "";
    b.appendChild(sSpan);

    if (description && description.trim() && description.trim() !== (subtitle || "").trim()) {
      const dSpan = document.createElement("span");
      dSpan.className = "ex-item-desc";
      dSpan.textContent = description.trim();
      b.appendChild(dSpan);
    }

    b.addEventListener("click", onSelect);
    wrap.appendChild(b);

    const renBtn = document.createElement("button");
    renBtn.className = "ex-proj-export";
    renBtn.textContent = "✎";
    renBtn.title = "Rename project";
    renBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onRename();
    });
    wrap.appendChild(renBtn);

    const expBtn = document.createElement("button");
    expBtn.className = "ex-proj-export";
    expBtn.textContent = "JSON";
    expBtn.title = "Export project as JSON";
    expBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onExportJson();
    });
    wrap.appendChild(expBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "ex-proj-del";
    delBtn.textContent = "×";
    delBtn.title = "Delete project";
    delBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onDelete();
    });
    wrap.appendChild(delBtn);

    return wrap;
  }

  function renderSavedProjectRow(proj) {
    const isCur = state.activeProjectIsCustom && state.activeProjectId === proj.id;
    const pCnt = (proj.presets || []).length;
    const cCnt = (proj.cards || []).length;
    const subTxt = proj.subtitle || `${cCnt} card${cCnt === 1 ? "" : "s"} · saved in projects/${proj.id}.json`;
    return buildProjectRow({
      title: proj.name,
      badge: pCnt === 0 ? "Default view" : `${pCnt} preset${pCnt === 1 ? "" : "s"}`,
      subtitle: subTxt,
      description: proj.description || "",
      isActive: isCur,
      onSelect: () => {
        closeExamplesDropdown();
        guardNavigation(() => loadSavedProject(proj.id, true));
      },
      onRename: () => {
        const nextName = typeof window.prompt === "function"
          ? window.prompt("Rename project:", proj.name)
          : null;
        if (nextName && nextName.trim()) renameSavedProject(proj.id, nextName.trim());
      },
      onExportJson: () => {
        const cleanCopy = { ...proj };
        delete cleanCopy.baseState;
        delete cleanCopy.isCustom;
        openProjectImportExport("export", JSON.stringify(cleanCopy, null, 2));
      },
      onDelete: () => {
        requestDeleteProject({ kind: "saved", id: proj.id, name: proj.name });
      },
    });
  }

  function renderBuiltInExampleRow(ex) {
    const dispName = getExampleDisplayName(ex);
    const isCur = !state.activeProjectIsCustom && ex.id === state.activeProjectId;
    const pCnt = (ex.presets || []).length;
    return buildProjectRow({
      title: dispName,
      badge: `${pCnt} preset${pCnt === 1 ? "" : "s"}`,
      subtitle: ex.subtitle || "",
      description: ex.description || "",
      isActive: isCur,
      onSelect: () => {
        closeExamplesDropdown();
        guardNavigation(() => loadExample(ex.id, null, true));
      },
      onRename: () => {
        const nextName = typeof window.prompt === "function"
          ? window.prompt("Rename project:", dispName)
          : null;
        if (nextName && nextName.trim()) renameBuiltInExample(ex.id, nextName.trim());
      },
      onExportJson: () => {
        const obj = exampleToProjectObject(ex);
        openProjectImportExport("export", JSON.stringify(obj, null, 2));
      },
      onDelete: () => {
        requestDeleteProject({ kind: "example", id: ex.id, name: dispName });
      },
    });
  }

  function renderExamplesMenu() {
    examplesList.innerHTML = "";
    const modeTitle = getModeDisplayName(state.mode);
    if (ddModeBadge) ddModeBadge.textContent = modeTitle;
    const filterQ = (projectFilterInput && projectFilterInput.value ? projectFilterInput.value : "").trim().toLowerCase();

    const folders = getFoldersForMode(state.mode);
    const knownFolderIds = new Set(folders.map((f) => f.id));
    const allSaved = loadSavedProjects().filter((p) => p.mode === state.mode);
    const allBuiltIn = window.CFVExamples.forMode(state.mode).filter((ex) => !isExampleDeleted(ex.id));

    for (const folder of folders) {
      const folderSaved = allSaved.filter((p) => {
        const pf = p.folder && knownFolderIds.has(p.folder) ? p.folder : "my";
        return pf === folder.id;
      });
      const matchedSaved = filterQ
        ? folderSaved.filter((p) =>
            (p.name || "").toLowerCase().includes(filterQ) ||
            (p.subtitle || "").toLowerCase().includes(filterQ) ||
            folder.name.toLowerCase().includes(filterQ)
          )
        : folderSaved;

      const folderBuiltIn = folder.id === "examples"
        ? (filterQ
            ? allBuiltIn.filter((ex) =>
                getExampleDisplayName(ex).toLowerCase().includes(filterQ) ||
                (ex.subtitle || "").toLowerCase().includes(filterQ) ||
                folder.name.toLowerCase().includes(filterQ)
              )
            : allBuiltIn)
        : [];

      const totalItems = matchedSaved.length + folderBuiltIn.length;
      const collapsed = !filterQ && Boolean(state.folderCollapsed && state.folderCollapsed[folder.id]);

      const folderEl = document.createElement("div");
      folderEl.className = "proj-folder" + (collapsed ? " collapsed" : "");

      const hdrWrap = document.createElement("div");
      hdrWrap.className =
        "proj-folder-hdr-wrap" +
        (folder.id === "my" ? " my-projects-wrap" : !folder.builtin ? " custom-folder-wrap" : "");

      const hdrBtn = document.createElement("button");
      hdrBtn.className = "proj-folder-hdr" + (folder.id === "my" ? " my-projects-hdr" : "");
      hdrBtn.setAttribute("aria-expanded", String(!collapsed));

      const iconSpan = document.createElement("span");
      iconSpan.className = "proj-folder-icon";
      iconSpan.textContent = collapsed ? "📁" : "📂";
      hdrBtn.appendChild(iconSpan);

      const titleSpan = document.createElement("span");
      titleSpan.className = "proj-folder-title";
      titleSpan.textContent = folder.name;
      hdrBtn.appendChild(titleSpan);

      if (folder.id === "my") {
        const pathSpan = document.createElement("span");
        pathSpan.className = "proj-folder-path";
        pathSpan.textContent = "projects/";
        hdrBtn.appendChild(pathSpan);
      }

      const cntSpan = document.createElement("span");
      cntSpan.className = "proj-folder-count";
      cntSpan.textContent = String(totalItems);
      hdrBtn.appendChild(cntSpan);

      const chevSpan = document.createElement("span");
      chevSpan.className = "proj-folder-chev";
      chevSpan.textContent = "▾";
      hdrBtn.appendChild(chevSpan);

      hdrBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        state.folderCollapsed[folder.id] = !state.folderCollapsed[folder.id];
        renderExamplesMenu();
      });
      hdrWrap.appendChild(hdrBtn);

      if (!folder.builtin) {
        const acts = document.createElement("div");
        acts.className = "proj-folder-hdr-actions";

        const fRen = document.createElement("button");
        fRen.className = "proj-folder-act-btn";
        fRen.textContent = "✎";
        fRen.title = `Rename folder "${folder.name}"`;
        fRen.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const nextName = typeof window.prompt === "function"
            ? window.prompt("Rename folder:", folder.name)
            : null;
          if (nextName && nextName.trim()) renameFolder(folder.id, nextName.trim());
        });
        acts.appendChild(fRen);

        const fDel = document.createElement("button");
        fDel.className = "proj-folder-act-btn danger";
        fDel.textContent = "×";
        fDel.title = `Delete folder "${folder.name}" (moves its projects to My Saved Projects)`;
        fDel.addEventListener("click", (ev) => {
          ev.stopPropagation();
          deleteFolder(folder.id);
        });
        acts.appendChild(fDel);

        hdrWrap.appendChild(acts);
      }
      folderEl.appendChild(hdrWrap);

      const bodyEl = document.createElement("div");
      bodyEl.className = "proj-folder-body";
      if (totalItems === 0) {
        const empty = document.createElement("div");
        empty.className = "proj-folder-empty";
        empty.textContent = filterQ
          ? `No projects in "${folder.name}" matched "${filterQ}".`
          : (folder.id === "my"
              ? "No saved projects here yet. Click Save As or ⤒ Import JSON to store projects in projects/."
              : `No projects in "${folder.name}" yet. Choose this folder in Save As.`);
        bodyEl.appendChild(empty);
      } else {
        for (const proj of matchedSaved) bodyEl.appendChild(renderSavedProjectRow(proj));
        for (const ex of folderBuiltIn) bodyEl.appendChild(renderBuiltInExampleRow(ex));
      }
      folderEl.appendChild(bodyEl);
      examplesList.appendChild(folderEl);
    }
  }

  async function loadExample(exampleId, presetId = null, pushHistory = true) {
    state.restoringState = true;
    try {
      closeItemSettings();
      closeExamplesDropdown();
      closeSaveProjectForm();
      closeSavePresetForm();

      const ex = window.CFVExamples.byId(exampleId);
      const preset = (presetId && ex.presets && ex.presets.find((p) => p.id === presetId)) || (ex.presets && ex.presets[0]) || null;

      state.activeProjectId = ex.id;
      const customRename = state.libraryMeta && state.libraryMeta.exampleRenames && state.libraryMeta.exampleRenames[ex.id];
      state.activeProjectName = customRename ? customRename : ex.title.split("—")[0].trim();
      state.activeProjectDescription = ex.description || ex.subtitle || "";
      syncDescriptionUI();
      state.activeProjectIsCustom = false;
      state.activeProjectFolder = "examples";
      state.sourceExampleId = ex.id;
      state.projectPresets = (ex.presets || []).map((p) => ({
        id: p.id,
        name: p.name,
        isCustom: false,
        builtinPreset: p,
        sourceExampleId: ex.id,
      }));
      state.activePresetId = preset ? preset.id : null;
      state.hasUnsavedWork = false;

      for (const s of sliderCards()) s.playing = false;
      if (window.CFVReal && typeof window.CFVReal.stopAudio === "function") {
        window.CFVReal.stopAudio();
      }

      setModeUI(ex.mode);

      const fns = (ex.fnCards || []).map((c) => ({
        ...c,
        kind: "fn",
        id: state.nextCardId++,
        lineWidth: c.lineWidth || 2.2,
        lineStyle: c.lineStyle || (c.dashed ? "dashed" : "solid"),
        locked: Boolean(c.locked),
        visible: c.visible !== undefined ? Boolean(c.visible) : true,
      }));
      const sls = (ex.sliders || []).map((s) => {
        const override = preset && preset.sliderValues && Object.prototype.hasOwnProperty.call(preset.sliderValues, s.name)
          ? Number(preset.sliderValues[s.name])
          : s.value;
        return {
          ...s,
          value: override,
          kind: "slider",
          id: state.nextCardId++,
          playing: false,
        };
      });
      const vrs = (ex.vars || []).map((v) => ({
        ...v,
        kind: "var",
        id: state.nextCardId++,
        expr: String(v.expr ?? "0"),
        value: 0,
      }));
      state.cards = [...fns, ...sls, ...vrs];
      if (preset && preset.startSlider) {
        const sl = sliderCards().find((s) => s.name === preset.startSlider);
        if (sl) { sl.value = sl.min; sl.playing = true; }
      }
      resolveVariables(false);
      const explicitAct = fns.find((c) => c.active === true);
      state.primaryCardId = explicitAct ? explicitAct.id : (fns[0] ? fns[0].id : null);

      updateProjectHeaderUI();
      renderFnCards();
      renderExamplesMenu();
      renderPresetBar();
      syncUrl(pushHistory, false);

      await compileWorkspace(true, true);

      if (ex.mode === "real") {
        if (preset && Array.isArray(preset.visibleFnIndices)) {
          fnCards().forEach((c, idx) => { c.visible = preset.visibleFnIndices.includes(idx); });
          renderFnCards();
        }
        await window.CFVReal.loadExampleAndPreset(ex, preset);
        resolveVariables(true, true);
        if (preset && preset.startSlider) ensureSliderLoop();
      } else {
        window.CFVComplex.setMode(ex.mode);
        await window.CFVComplex.loadExampleAndPreset(ex, preset);
        resolveVariables(true, true);
        window.CFVComplex.requestRender();
        if (preset && preset.startSlider) ensureSliderLoop();
      }
    } finally {
      state.restoringState = false;
    }
  }

  function setModeUI(mode) {
    state.mode = mode;
    const isReal = mode === "real";

    document.querySelectorAll(".ws-btn").forEach((b) => {
      const a = b.dataset.wsMode === mode;
      b.classList.toggle("active", a);
      b.setAttribute("aria-selected", String(a));
    });

    if (fnTabLabel) {
      fnTabLabel.textContent =
        mode === "real" ? "2D Real Curves & Relations" : mode === "integral" ? "Integrand f(z) & Aux" : "Function w = f(z) & Aux";
    }
    if (domainSectionLabel) {
      domainSectionLabel.textContent = "Elements & Layers";
    }
    closeFnLibraryDropdown();
    if (fnSyntaxGuide && !fnSyntaxGuide.classList.contains("hidden") && window.CFVFunctionLibrary) {
      fnSyntaxGuide.innerHTML = window.CFVFunctionLibrary.renderSyntaxGuideHtml(mode);
    }
    if (domainQuickAdds && domainQuickAdds.querySelectorAll) {
      domainQuickAdds.querySelectorAll(".complex-only-add").forEach((el) => {
        el.classList.toggle("hidden", isReal);
      });
    }

    stageComplex.classList.toggle("hidden", isReal);
    stageReal.classList.toggle("hidden", !isReal);
    toolsComplexBody.classList.toggle("hidden", isReal);
    toolsRealBody.classList.toggle("hidden", !isReal);
    toolsTitle.textContent = isReal ? "2D Real Analysis Tools" : "Complex Analysis Tools";

    readoutInLabel.textContent = isReal ? "x" : "z";
    readoutOutLabel.textContent = isReal ? "y" : "f(z)";
    readoutIn.textContent = "—";
    readoutOut.textContent = "—";

    window.CFVComplex.state.active = !isReal;
    window.CFVReal.state.active = isReal;

    applyLayoutVisibility();
    if (isReal) window.CFVReal.resize();
    else {
      applySplitPct(state.splitPct, true);
      window.CFVComplex.resize();
    }
    requestAnimationFrame(() => {
      if (isReal) window.CFVReal.resize();
      else window.CFVComplex.resize();
    });
  }

  /* -------------------------------------------------------------------------
   * Adding Functions, Sliders, Shapes, Points & Landmark Lines
   * ------------------------------------------------------------------------- */

  function addFunctionCard(code, title) {
    const fnCount = fnCards().length;
    const card = {
      id: state.nextCardId++,
      kind: "fn",
      title: title || (isRealMode() ? `Curve ${fnCount + 1}` : fnCount === 0 ? "Function f(z)" : `Helper f${fnCount + 1}(z)`),
      code: code || (isRealMode() ? "sin(x)" : fnCount === 0 ? "c_zeta(s)" : `f${fnCount}(z)`),
      color: COLORS[fnCount % COLORS.length],
      lineWidth: 2.2,
      lineStyle: "solid",
      locked: false,
      visible: true,
      step: false,
      builtin: isRealMode() ? { fn: 0, kind: "exact" } : { fn: 0 },
    };
    state.cards.push(card);
    if (!state.primaryCardId) state.primaryCardId = card.id;
    renderFnCards();
    compileWorkspace(false, false);
    notifyStateChanged(true, true);
  }

  function addSliderCard() {
    const used = new Set(getParamNames());
    const candidates = isRealMode() ? ["K", "r", "a", "b", "w", "N", "t", "c"] : ["N", "t", "a", "b", "c", "K"];
    const name = candidates.find((n) => !used.has(n)) || `p${sliderCards().length + 1}`;
    const isInt = name === "K" || name === "N";
    state.cards.push({
      id: state.nextCardId++,
      kind: "slider",
      name,
      label: "parameter",
      value: isInt ? 20 : 1.0,
      min: isInt ? 0 : -5.0,
      max: isInt ? 150 : 5.0,
      step: isInt ? 1 : 0.05,
      playing: false,
    });
    renderFnCards();
    compileWorkspace(true, false);
    notifyStateChanged(true, true);
  }

  function addVariableCard() {
    const used = new Set(getParamNames());
    const candidates = ["R", "r", "eps", "w", "h", "d", "u", "v"];
    const name = candidates.find((n) => !used.has(n)) || `v${varCards().length + 1}`;
    const firstSlider = sliderCards()[0];
    const expr = firstSlider ? `2.0 * ${firstSlider.name}` : "1.0";
    state.cards.push({
      id: state.nextCardId++,
      kind: "var",
      name,
      label: "",
      expr,
      value: 0,
    });
    resolveVariables(false);
    renderFnCards();
    compileWorkspace(true, false);
    notifyStateChanged(true, true);
  }

  function addDomainPoint() {
    if (isRealMode()) window.CFVReal.addPoint({});
    else window.CFVComplex.addPoint({});
  }

  function addDomainGuideLine() {
    if (isRealMode()) window.CFVReal.addGuideLine({});
    else window.CFVComplex.addGuideLine({});
  }

  /* -------------------------------------------------------------------------
   * Inline Project Saver (Save in-place vs Save As new project) & Preset Saver Forms
   * ------------------------------------------------------------------------- */

  function populateSaveFolderSelect(selectedFolderId = null) {
    if (!saveProjectFolder) return;
    saveProjectFolder.innerHTML = "";
    const folders = getFoldersForMode(state.mode);
    const chosen = selectedFolderId || state.activeProjectFolder || "my";
    for (const f of folders) {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.name;
      if (f.id === chosen) opt.selected = true;
      saveProjectFolder.appendChild(opt);
    }
  }

  function openSaveProjectForm() {
    if (!saveProjectForm) return;
    closeExamplesDropdown();
    populateSaveFolderSelect(state.activeProjectFolder || "my");
    if (saveNewFolderRow) saveNewFolderRow.classList.add("hidden");
    if (saveProjectDesc) saveProjectDesc.value = state.activeProjectDescription || "";
    saveProjectForm.classList.remove("hidden");
    if (saveProjectName) {
      if (isInSavedProject()) {
        saveProjectName.value = `${state.activeProjectName} (Copy)`;
      } else if (state.activeProjectName && state.activeProjectName !== "New Project" && state.activeProjectName !== "Unsaved Project") {
        saveProjectName.value = `${state.activeProjectName} (Custom)`;
      } else {
        saveProjectName.value = "";
      }
      saveProjectName.focus();
      if (saveProjectName.select) saveProjectName.select();
    }
  }
  function closeSaveProjectForm() {
    if (saveProjectForm) saveProjectForm.classList.add("hidden");
    if (saveNewFolderRow) saveNewFolderRow.classList.add("hidden");
  }

  /* Add Folder button directly inside Save As popover */
  if (btnSaveAddFolder && saveNewFolderRow) {
    btnSaveAddFolder.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const opening = saveNewFolderRow.classList.contains("hidden");
      saveNewFolderRow.classList.toggle("hidden", !opening);
      if (opening && saveNewFolderInput) {
        saveNewFolderInput.value = "";
        saveNewFolderInput.focus();
      }
    });
  }
  if (btnSaveCancelFolder && saveNewFolderRow) {
    btnSaveCancelFolder.addEventListener("click", (ev) => {
      ev.stopPropagation();
      saveNewFolderRow.classList.add("hidden");
    });
  }
  if (btnSaveConfirmFolder) {
    btnSaveConfirmFolder.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const nm = saveNewFolderInput && saveNewFolderInput.value ? saveNewFolderInput.value.trim() : "";
      if (!nm) { if (saveNewFolderInput) saveNewFolderInput.focus(); return; }
      const f = createFolder(nm, state.mode);
      if (f) populateSaveFolderSelect(f.id);
      if (saveNewFolderRow) saveNewFolderRow.classList.add("hidden");
    });
  }
  if (saveNewFolderInput) {
    saveNewFolderInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); if (btnSaveConfirmFolder) btnSaveConfirmFolder.click(); }
      else if (e.key === "Escape") { e.preventDefault(); if (saveNewFolderRow) saveNewFolderRow.classList.add("hidden"); }
    });
  }

  /* Collapsible Project Description Strip */
  function syncDescriptionUI() {
    const desc = (state.activeProjectDescription || "").trim();
    if (projectDescPreview) {
      projectDescPreview.textContent = desc || "Add project description…";
      projectDescPreview.title = desc || "Click to add a project description";
    }
    if (projectDescInput && document.activeElement !== projectDescInput) {
      projectDescInput.value = state.activeProjectDescription || "";
    }
  }
  if (btnToggleDesc && projectDescBar && projectDescEditor) {
    btnToggleDesc.addEventListener("click", () => {
      const opening = projectDescEditor.classList.contains("hidden");
      projectDescEditor.classList.toggle("hidden", !opening);
      projectDescBar.classList.toggle("open", opening);
      btnToggleDesc.setAttribute("aria-expanded", String(opening));
      if (opening && projectDescInput) projectDescInput.focus();
    });
  }
  if (projectDescInput) {
    projectDescInput.addEventListener("input", () => {
      state.activeProjectDescription = projectDescInput.value;
      syncDescriptionUI();
      notifyStateChanged(false, true);
    });
  }

  /* Prewritten Function Library Dropdown (Strictly separated Complex vs 2D Real) */
  let fnLibSelectedCat = "All";
  function closeFnLibraryDropdown() {
    if (fnLibraryDropdown) fnLibraryDropdown.classList.add("hidden");
  }
  function renderFnLibraryMenu() {
    if (!fnLibList || !fnLibCats || !window.CFVFunctionLibrary) return;
    const items = window.CFVFunctionLibrary.getForMode(state.mode);
    if (fnLibTitle) {
      fnLibTitle.textContent = isRealMode()
        ? "2D Real Function & Curve Library"
        : "Complex Analysis Function Library";
    }
    const cats = ["All", ...Array.from(new Set(items.map((x) => x.cat)))];
    if (!cats.includes(fnLibSelectedCat)) fnLibSelectedCat = "All";

    fnLibCats.innerHTML = "";
    for (const cat of cats) {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "fn-lib-cat-pill" + (cat === fnLibSelectedCat ? " active" : "");
      pill.textContent = cat;
      pill.addEventListener("click", (ev) => {
        ev.stopPropagation();
        fnLibSelectedCat = cat;
        renderFnLibraryMenu();
      });
      fnLibCats.appendChild(pill);
    }

    const q = (fnLibSearch && fnLibSearch.value ? fnLibSearch.value : "").trim().toLowerCase();
    const filtered = items.filter((it) => {
      if (fnLibSelectedCat !== "All" && it.cat !== fnLibSelectedCat) return false;
      if (!q) return true;
      return (
        it.name.toLowerCase().includes(q) ||
        it.expr.toLowerCase().includes(q) ||
        it.desc.toLowerCase().includes(q) ||
        it.cat.toLowerCase().includes(q)
      );
    });

    fnLibList.innerHTML = "";
    if (filtered.length === 0) {
      const emp = document.createElement("div");
      emp.className = "proj-folder-empty";
      emp.textContent = "No matching functions in this mode.";
      fnLibList.appendChild(emp);
      return;
    }
    for (const it of filtered) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fn-lib-item";
      btn.innerHTML = `
        <div class="fn-lib-item-top">
          <span class="fn-lib-item-name"></span>
          <span class="fn-lib-item-cat"></span>
        </div>
        <div class="fn-lib-item-code"></div>
        <div class="fn-lib-item-desc"></div>
      `;
      btn.querySelector(".fn-lib-item-name").textContent = it.name;
      btn.querySelector(".fn-lib-item-cat").textContent = it.cat;
      btn.querySelector(".fn-lib-item-code").textContent = it.expr.replace(/\s+/g, " ");
      btn.querySelector(".fn-lib-item-desc").textContent = it.desc;
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeFnLibraryDropdown();
        addFunctionCard(it.expr, it.name);
        if (!isRealMode()) {
          const fns = fnCards();
          const added = fns[fns.length - 1];
          if (added) {
            state.primaryCardId = added.id;
            renderFnCards();
            compileWorkspace(false, false);
          }
        }
      });
      fnLibList.appendChild(btn);
    }
  }
  if (btnFnLibrary && fnLibraryDropdown) {
    btnFnLibrary.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const opening = fnLibraryDropdown.classList.contains("hidden");
      if (!opening) { closeFnLibraryDropdown(); return; }
      fnLibSelectedCat = "All";
      if (fnLibSearch) fnLibSearch.value = "";
      renderFnLibraryMenu();
      fnLibraryDropdown.classList.remove("hidden");
      const r = btnFnLibrary.getBoundingClientRect();
      const left = Math.min((window.innerWidth || 1200) - 352, Math.max(10, r.left));
      const top = Math.min((window.innerHeight || 800) - 452, r.bottom + 6);
      fnLibraryDropdown.style.left = `${left}px`;
      fnLibraryDropdown.style.top = `${top}px`;
      if (fnLibSearch) fnLibSearch.focus();
    });
  }
  if (fnLibSearch) {
    fnLibSearch.addEventListener("click", (ev) => ev.stopPropagation());
    fnLibSearch.addEventListener("input", renderFnLibraryMenu);
  }
  if (btnFnGuide && fnSyntaxGuide) {
    btnFnGuide.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const opening = fnSyntaxGuide.classList.contains("hidden");
      if (opening && window.CFVFunctionLibrary) {
        fnSyntaxGuide.innerHTML = window.CFVFunctionLibrary.renderSyntaxGuideHtml(state.mode);
      }
      fnSyntaxGuide.classList.toggle("hidden", !opening);
      btnFnGuide.classList.toggle("active", opening);
    });
  }

  /* Light / Dark Theme Toggle */
  const THEME_KEY = "cfv_theme_v1";
  function applyTheme(theme, persist = false) {
    const isLight = theme === "light";
    document.documentElement.dataset.theme = isLight ? "light" : "dark";
    if (themeIconSun) themeIconSun.classList.toggle("hidden", isLight);
    if (themeIconMoon) themeIconMoon.classList.toggle("hidden", !isLight);
    if (themeToggleLabel) themeToggleLabel.textContent = isLight ? "Dark" : "Light";
    if (persist) {
      try { if (window.localStorage) window.localStorage.setItem(THEME_KEY, isLight ? "light" : "dark"); } catch (_) {}
    }
    if (window.CFVComplex) window.CFVComplex.requestRender();
    if (window.CFVReal) window.CFVReal.requestRender();
  }
  try {
    const savedTheme = window.localStorage && window.localStorage.getItem(THEME_KEY);
    if (savedTheme === "light" || savedTheme === "dark") applyTheme(savedTheme, false);
    else applyTheme("dark", false);
  } catch (_) {}
  if (btnToggleTheme) {
    btnToggleTheme.addEventListener("click", () => {
      const curLight = document.documentElement.dataset.theme === "light";
      applyTheme(curLight ? "dark" : "light", true);
    });
  }

  document.addEventListener("pointerdown", (ev) => {
    if (fnLibraryDropdown && !fnLibraryDropdown.classList.contains("hidden")) {
      if (!fnLibraryDropdown.contains(ev.target) && ev.target !== btnFnLibrary) closeFnLibraryDropdown();
    }
  });

  function openSavePresetForm() {
    if (btnSavePreset) btnSavePreset.classList.add("hidden");
    if (savePresetForm) savePresetForm.classList.remove("hidden");
    if (savePresetName) { savePresetName.value = ""; savePresetName.focus(); }
  }
  function closeSavePresetForm() {
    if (savePresetForm) savePresetForm.classList.add("hidden");
    if (btnSavePreset) btnSavePreset.classList.remove("hidden");
  }

  /* Save button: only enabled inside a saved project; saves directly in-place to current project! */
  if (btnSaveProject) {
    btnSaveProject.addEventListener("click", () => {
      if (!isInSavedProject()) return;
      closeSaveProjectForm();
      saveCurrentProjectInPlace();
    });
  }
  /* Save As button: always available; prompts for name + folder (including Examples!) and creates a NEW saved project */
  if (btnSaveAsProject) {
    btnSaveAsProject.addEventListener("click", openSaveProjectForm);
  }
  /* Topbar Rename, JSON, and Delete Project buttons */
  if (btnTopRenameProject) {
    btnTopRenameProject.addEventListener("click", () => {
      const curName = state.activeProjectName || defaultProjectName();
      const nextName = typeof window.prompt === "function"
        ? window.prompt("Rename project:", curName)
        : null;
      if (!nextName || !nextName.trim()) return;
      const trimmed = nextName.trim();
      if (isInSavedProject()) {
        renameSavedProject(state.activeProjectId, trimmed);
      } else if (state.activeProjectId) {
        renameBuiltInExample(state.activeProjectId, trimmed);
      } else {
        state.activeProjectName = trimmed;
        updateProjectHeaderUI();
      }
    });
  }
  if (btnTopJsonProject) {
    btnTopJsonProject.addEventListener("click", () => openProjectImportExport("export"));
  }
  if (btnTopDeleteProject) {
    btnTopDeleteProject.addEventListener("click", () => {
      if (!state.activeProjectId) return;
      requestDeleteProject({
        kind: state.activeProjectIsCustom ? "saved" : "example",
        id: state.activeProjectId,
        name: state.activeProjectName || state.activeProjectId,
      });
    });
  }

  /* Create New Folder inline form inside Project Library dropdown */
  if (btnNewFolder) {
    btnNewFolder.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!newFolderForm) return;
      const opening = newFolderForm.classList.contains("hidden");
      newFolderForm.classList.toggle("hidden", !opening);
      if (opening && newFolderName) {
        newFolderName.value = "";
        newFolderName.focus();
      }
    });
  }
  if (btnCancelNewFolder) {
    btnCancelNewFolder.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeNewFolderForm();
    });
  }
  if (btnConfirmNewFolder) {
    btnConfirmNewFolder.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const nm = newFolderName && newFolderName.value ? newFolderName.value.trim() : "";
      if (!nm) { if (newFolderName) newFolderName.focus(); return; }
      createFolder(nm, state.mode);
      closeNewFolderForm();
    });
  }
  if (newFolderName) {
    newFolderName.addEventListener("click", (ev) => ev.stopPropagation());
    newFolderName.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); if (btnConfirmNewFolder) btnConfirmNewFolder.click(); }
      else if (e.key === "Escape") { e.preventDefault(); closeNewFolderForm(); }
    });
  }

  /* Delete Project Confirmation Modal wiring */
  if (btnConfirmDeleteProject) btnConfirmDeleteProject.addEventListener("click", confirmPendingDelete);
  if (btnCancelDeleteProject) btnCancelDeleteProject.addEventListener("click", closeDeleteModal);
  if (btnCloseDeleteModal) btnCloseDeleteModal.addEventListener("click", closeDeleteModal);
  if (deleteProjectModal) {
    deleteProjectModal.addEventListener("click", (e) => {
      if (e.target === deleteProjectModal) closeDeleteModal();
    });
  }

  if (btnImportProject) btnImportProject.addEventListener("click", () => openProjectImportExport("import"));
  if (btnExportProject) btnExportProject.addEventListener("click", () => openProjectImportExport("export"));
  if (btnCancelSaveProject) btnCancelSaveProject.addEventListener("click", closeSaveProjectForm);
  if (btnConfirmSaveProject) {
    btnConfirmSaveProject.addEventListener("click", () => {
      const nm = (saveProjectName && saveProjectName.value.trim()) || defaultProjectName();
      const folderId = (saveProjectFolder && saveProjectFolder.value) || state.activeProjectFolder || "my";
      if (saveProjectDesc) {
        state.activeProjectDescription = saveProjectDesc.value.trim();
        syncDescriptionUI();
      }
      saveCurrentProject(nm, { forceNew: true, folder: folderId });
      closeSaveProjectForm();
    });
  }
  if (saveProjectName) {
    saveProjectName.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); btnConfirmSaveProject.click(); }
      else if (e.key === "Escape") { e.preventDefault(); closeSaveProjectForm(); }
    });
  }

  /* Global Ctrl+S (Save in-place if in saved project, else Save As) & Ctrl+Shift+S (Save As) */
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      if (e.shiftKey || !isInSavedProject()) {
        openSaveProjectForm();
      } else {
        saveCurrentProjectInPlace();
      }
    }
  });

  if (btnSavePreset) btnSavePreset.addEventListener("click", openSavePresetForm);
  if (btnCancelSavePreset) btnCancelSavePreset.addEventListener("click", closeSavePresetForm);
  if (btnConfirmSavePreset) {
    btnConfirmSavePreset.addEventListener("click", () => {
      const nm = savePresetName.value.trim();
      if (!nm) { savePresetName.focus(); return; }
      addPresetToCurrentProject(nm);
      closeSavePresetForm();
    });
  }
  if (savePresetName) {
    savePresetName.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); btnConfirmSavePreset.click(); }
      else if (e.key === "Escape") { e.preventDefault(); closeSavePresetForm(); }
    });
  }

  /* -------------------------------------------------------------------------
   * Wire Header, Sidebar, Tools Popover & PNG Export
   * ------------------------------------------------------------------------- */

  wireVerticalTabs();

  if (btnToggleSidebar) {
    btnToggleSidebar.addEventListener("click", () => setSidebarCollapsed(true));
  }
  if (btnShowSidebar) {
    btnShowSidebar.addEventListener("click", () => setSidebarCollapsed(false));
  }
  if (btnHideInput) btnHideInput.addEventListener("click", () => setPanelVisibility("input", false));
  if (btnShowInput) btnShowInput.addEventListener("click", () => setPanelVisibility("input", true));
  if (btnHideOutput) btnHideOutput.addEventListener("click", () => setPanelVisibility("output", false));
  if (btnShowOutput) btnShowOutput.addEventListener("click", () => setPanelVisibility("output", true));
  if (btnHideReal) btnHideReal.addEventListener("click", () => setPanelVisibility("real", false));
  if (btnShowReal) btnShowReal.addEventListener("click", () => setPanelVisibility("real", true));

  /* + Button to the left of Examples opens a New Blank Project */
  if (btnNewProject) {
    btnNewProject.addEventListener("click", () => {
      if (isBlankWorkspace() && !state.activeProjectId && state.projectPresets.length === 0) return;
      guardNavigation(() => openBlankWorkspace(state.mode, true));
    });
  }

  /* Clicking Map / Integral / 2D Real opens a BLANK Project in that mode */
  document.querySelectorAll(".ws-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const m = b.dataset.wsMode;
      if (m === state.mode && isBlankWorkspace() && !state.activeProjectId && state.projectPresets.length === 0) return;
      guardNavigation(() => openBlankWorkspace(m, true));
    });
  });

  btnExamples.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (projectFilterInput) projectFilterInput.value = "";
    renderExamplesMenu();
    const opening = examplesDropdown.classList.contains("hidden");
    examplesDropdown.classList.toggle("hidden", !opening);
    btnExamples.setAttribute("aria-expanded", String(opening));
    if (opening && projectFilterInput && projectFilterInput.focus) {
      setTimeout(() => projectFilterInput.focus(), 20);
    }
  });
  if (projectFilterInput) {
    projectFilterInput.addEventListener("input", () => renderExamplesMenu());
    projectFilterInput.addEventListener("click", (ev) => ev.stopPropagation());
  }

  document.getElementById("btn-add-fn").addEventListener("click", () => addFunctionCard());
  document.getElementById("btn-add-slider").addEventListener("click", addSliderCard);
  const btnAddVar = document.getElementById("btn-add-var");
  if (btnAddVar) btnAddVar.addEventListener("click", addVariableCard);
  document.getElementById("btn-add-point").addEventListener("click", addDomainPoint);
  document.getElementById("btn-add-guide").addEventListener("click", addDomainGuideLine);
  document.getElementById("btn-quick-circle").addEventListener("click", () => window.CFVComplex.addQuickShape("circle"));
  const btnQuickArc = document.getElementById("btn-quick-arc");
  if (btnQuickArc) btnQuickArc.addEventListener("click", () => window.CFVComplex.addQuickShape("arc"));
  document.getElementById("btn-quick-rect").addEventListener("click", () => window.CFVComplex.addQuickShape("rect"));
  document.getElementById("btn-quick-line").addEventListener("click", () => window.CFVComplex.addQuickShape("line"));
  btnCompileAll.addEventListener("click", () => compileWorkspace(false, false));

  /* Browser Back/Forward URL Restoration */
  window.addEventListener("popstate", () => {
    const hashSnap = parseUrlStateHash();
    if (hashSnap) {
      restoreWorkspaceSnapshot(hashSnap, false);
      return;
    }
    const route = parseUrlRoute();
    if (route.kind === "example") {
      loadExample(route.ex.id, route.preset ? route.preset.id : null, false);
    } else {
      openBlankWorkspace(route.mode, false);
    }
  });

  /* Tools Popover */
  function updateToolsDot() {
    const c = window.CFVComplex.state, r = window.CFVReal.state;
    const on = isRealMode()
      ? r.calc.showDeriv || r.calc.showTangent || r.calc.showIntegral
      : c.showDomain || c.taylor.enabled || c.foundZeros.length > 0;
    toolsActiveDot.classList.toggle("hidden", !on);
  }

  btnOpenTools.addEventListener("click", () => {
    const open = toolsPopover.classList.toggle("hidden");
    btnOpenTools.classList.toggle("active", !open);
  });
  document.getElementById("btn-close-tools").addEventListener("click", () => {
    toolsPopover.classList.add("hidden");
    btnOpenTools.classList.remove("active");
  });

  document.getElementById("opt-mesh").addEventListener("change", (e) => {
    window.CFVComplex.state.showMesh = e.target.checked;
    window.CFVComplex.recomputeAll(1.0);
  });
  document.getElementById("opt-domain").addEventListener("change", (e) => {
    window.CFVComplex.state.showDomain = e.target.checked;
    if (e.target.checked) window.CFVComplex.fetchDomain();
    else window.CFVComplex.requestRender();
    updateToolsDot();
  });
  document.getElementById("opt-landmarks").addEventListener("change", (e) => {
    window.CFVComplex.state.showLandmarks = e.target.checked;
    window.CFVComplex.requestRender();
  });

  async function renderZeroHunt(insideShape) {
    const list = document.getElementById("zeros-list");
    list.innerHTML = '<span style="color:#94a3b8;font-size:11px;">Hunting…</span>';
    const zeros = await window.CFVComplex.huntZeros(insideShape);
    list.innerHTML = "";
    if (zeros.length === 0) list.innerHTML = '<span style="color:#64748b;font-size:11px;">No zeros found.</span>';
    zeros.forEach((z, idx) => {
      const b = document.createElement("button");
      b.className = "zero-item";
      b.innerHTML = `<span>Z${idx + 1}: ${z.x.toFixed(5)} ${z.y >= 0 ? "+" : "−"} ${Math.abs(z.y).toFixed(5)}i</span><span style="color:#34d399">${z.res.toExponential(1)}</span>`;
      b.addEventListener("click", () => window.CFVComplex.centerInputOn(z.x, z.y, 2.5));
      list.appendChild(b);
    });
    updateToolsDot();
  }
  document.getElementById("btn-hunt-shape").addEventListener("click", () => renderZeroHunt(true));
  document.getElementById("btn-hunt-view").addEventListener("click", () => renderZeroHunt(false));
  document.getElementById("btn-hunt-clear").addEventListener("click", () => {
    window.CFVComplex.state.foundZeros = [];
    document.getElementById("zeros-list").innerHTML = "";
    updateToolsDot(); window.CFVComplex.requestRender();
  });

  document.getElementById("opt-taylor").addEventListener("change", (e) => {
    window.CFVComplex.state.taylor.enabled = e.target.checked;
    if (e.target.checked) window.CFVComplex.fetchTaylor();
    else window.CFVComplex.requestRender();
    updateToolsDot();
  });
  document.getElementById("taylor-x0").addEventListener("change", (e) => {
    window.CFVComplex.state.taylor.x0 = parseFloat(e.target.value) || 0;
    window.CFVComplex.fetchTaylor();
  });
  document.getElementById("taylor-y0").addEventListener("change", (e) => {
    window.CFVComplex.state.taylor.y0 = parseFloat(e.target.value) || 0;
    window.CFVComplex.fetchTaylor();
  });
  document.getElementById("taylor-deg").addEventListener("input", (e) => {
    document.getElementById("taylor-deg-val").textContent = e.target.value;
    window.CFVComplex.state.taylor.degree = parseInt(e.target.value, 10) || 8;
    window.CFVComplex.fetchTaylor();
  });

  document.getElementById("opt-real-markers").addEventListener("change", (e) => {
    window.CFVReal.state.showMarkers = e.target.checked; window.CFVReal.requestRender();
  });
  document.getElementById("opt-real-errfill").addEventListener("change", (e) => {
    window.CFVReal.state.showErrorFill = e.target.checked; window.CFVReal.requestRender();
  });
  document.getElementById("opt-real-deriv").addEventListener("change", (e) => {
    window.CFVReal.state.calc.showDeriv = e.target.checked;
    window.CFVReal.refreshCalculus(); updateToolsDot();
  });
  document.getElementById("opt-real-tangent").addEventListener("change", (e) => {
    window.CFVReal.state.calc.showTangent = e.target.checked;
    window.CFVReal.requestRender(); updateToolsDot();
  });
  document.getElementById("opt-real-int").addEventListener("change", (e) => {
    window.CFVReal.state.calc.showIntegral = e.target.checked;
    window.CFVReal.refreshCalculus(); updateToolsDot();
  });
  document.getElementById("calc-a").addEventListener("change", (e) => {
    window.CFVReal.state.calc.a = parseFloat(e.target.value) || 0;
    window.CFVReal.refreshCalculus();
  });
  document.getElementById("calc-b").addEventListener("change", (e) => {
    window.CFVReal.state.calc.b = parseFloat(e.target.value) || 1;
    window.CFVReal.refreshCalculus();
  });

  /* Clean Full-Bleed High-Res PNG Export (No Header Title Banner or Clutter!) */
  document.getElementById("btn-export-png").addEventListener("click", () => {
    const out = document.createElement("canvas");
    if (isRealMode()) {
      const src = window.CFVReal.canvas;
      out.width = src.width;
      out.height = src.height;
      const g = out.getContext("2d");
      g.drawImage(src, 0, 0);
    } else {
      const c1 = window.CFVComplex.canvasIn;
      const c2 = window.CFVComplex.canvasOut;
      const showIn = !state.inputHidden && c1.width > 0 && c1.height > 0;
      const showOut = !state.outputHidden && c2.width > 0 && c2.height > 0;
      if (showIn && !showOut) {
        out.width = c1.width;
        out.height = c1.height;
        out.getContext("2d").drawImage(c1, 0, 0);
      } else if (!showIn && showOut) {
        out.width = c2.width;
        out.height = c2.height;
        out.getContext("2d").drawImage(c2, 0, 0);
      } else {
        const seam = 2;
        out.width = c1.width + c2.width + seam;
        out.height = Math.max(c1.height, c2.height);
        const g = out.getContext("2d");
        g.fillStyle = "#070a10";
        g.fillRect(0, 0, out.width, out.height);
        g.drawImage(c1, 0, 0);
        g.drawImage(c2, c1.width + seam, 0);
      }
    }
    const a = document.createElement("a");
    a.download = `c11-visualizer-${state.mode}-${Date.now()}.png`;
    a.href = out.toDataURL("image/png");
    a.click();
  });

  window.addEventListener("resize", () => {
    window.CFVComplex.resize();
    window.CFVReal.resize();
  });

  window.CFVWorkspace = {
    state,
    VIEWPORT_GLOBALS,
    getViewportGlobals,
    applyViewportGlobals,
    paramsRequireServerRecompute,
    resolveVariables,
    analyzeRealCode,
    getSliders: sliderCards,
    getVars: varCards,
    getParamValues,
    getParamMap,
    resolveVariables,
    applySidebarWidth,
    applyLayoutVisibility,
    setSidebarCollapsed,
    setPanelVisibility,
    renderMiniSliders,
    isWorkspaceCompiled,
    getPrimaryComplexTarget,
    getVisibleComplexTargets,
    getVisibleRealCards,
    isAnySliderPlaying,
    isBlankWorkspace,
    hasUnsavedChanges,
    guardNavigation,
    openBlankWorkspace,
    addFunctionCard,
    compileWorkspace,
    loadExample,
    importAIBundle,
    openItemSettings,
    openItemSettingsAt,
    renderDomainCards,
    syncPointCoords,
    syncGuideLine,
    syncShapeBadges,
    notifyStateChanged,
    applySplitPct,
    buildWorkspaceSnapshot,
    restoreWorkspaceSnapshot,
    snapshotToReadableState,
    readableStateToSnapshot,
    exportFullProjectObject,
    exportProjectJSON,
    openProjectImportExport,
    syncProjectsWithServer,
    isInSavedProject,
    saveCurrentProject,
    saveCurrentProjectInPlace,
    renameSavedProject,
    renameBuiltInExample,
    deleteBuiltInExample,
    exampleToProjectObject,
    getFoldersForMode,
    createFolder,
    renameFolder,
    deleteFolder,
    requestDeleteProject,
    confirmPendingDelete,
    closeDeleteModal,
    updatePresetInCurrentProject,
    loadSavedProjects,
    loadSavedProject,
    deleteSavedProject,
    addPresetToCurrentProject,
    removePresetFromCurrentProject,
  };

  async function init() {
    window.CFVDocs.init();
    loadLibraryMeta();
    loadSavedProjects();
    syncProjectsWithServer();
    try {
      const r = await fetch("/api/config");
      if (r.ok) state.serverCfg = await r.json();
    } catch (_) {}

    if (!state.serverCfg.compile_enabled) {
      btnCompileAll.classList.add("hidden");
      document.getElementById("btn-add-fn").classList.add("hidden");
      setStatus("ok", "Public Safe Mode · Precompiled C11");
    } else if (state.serverCfg.compile_requires_token) {
      tokenBar.classList.remove("hidden");
      const saved = sessionStorage.getItem("cfv_compile_token");
      if (saved) tokenInput.value = saved;
    }

    const hashSnap = parseUrlStateHash();
    if (hashSnap) {
      await restoreWorkspaceSnapshot(hashSnap, false);
    } else {
      const route = parseUrlRoute();
      if (route.kind === "example") {
        await loadExample(route.ex.id, route.preset ? route.preset.id : null, false);
      } else {
        openBlankWorkspace(route.mode, false);
      }
    }
  }

  init();
})();
