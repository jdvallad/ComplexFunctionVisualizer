(() => {
  "use strict";

  function circlePts(cx, cy, r, n = 64) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function pt(x, y, label, icon = "dot", color = "#fbbf24", size = 5, locked = false) {
    return { x, y, label, icon, color, size, locked, visible: true, showLabel: true };
  }

  const VECTOR_EXAMPLES = [
    {
      id: "vec_linear_transform",
      mode: "vector",
      category: "cat_vec_linalg",
      name: "2×2 Linear Transformations, Basis & Determinant",
      badge: "A·v",
      summary: "Interactive 3Blue1Brown-style linear algebra lab: drag vectors v₁, v₂ on canvas to watch A·v, warped grids, basis vectors î′, ĵ′, determinant area, and unit-circle ellipses update at 60 FPS!",
      defaultView: { xmin: -5.0, xmax: 5.0, ymin: -3.6, ymax: 3.6 },
      defaultSliders: [
        { name: "k", label: "Shear / Scale k", val: 0.75, min: -2.0, max: 2.0, step: 0.05 },
        { name: "theta", label: "Rotation / Mirror θ", val: 0.55, min: -3.1416, max: 3.1416, step: 0.04 },
      ],
      defaultCards: [
        { title: "Shear Matrix M1", kind: "matrix", color: "#a78bfa", active: false, visible: false, code: "[[1, k], [0, 1]]" },
        { title: "Linear Map T(v) = M * v", kind: "field", color: "#34d399", active: false, visible: false, code: "M * v" },
        { title: "Rotation Matrix rot(θ)", kind: "matrix", color: "#34d399", active: false, visible: false, code: "rot(theta)" },
        { title: "Reflection Matrix (det = −1)", kind: "matrix", color: "#fb7185", active: false, visible: false, code: "reflect(theta)" },
        { title: "Rank-1 Projection (det = 0)", kind: "matrix", color: "#fbbf24", active: false, visible: false, code: "proj(theta)" },
      ],
      defaultShapes: [
        {
          kind: "vector",
          label: "u (Input)",
          color: "#38bdf8",
          lineWidth: 2.8,
          opacity: 1.0,
          closed: false,
          rawPts: [{ x: 0, y: 0 }, { x: 1.8, y: 1.2 }],
        },
        {
          kind: "vector",
          label: "T(u) (Output)",
          color: "#fbbf24",
          lineWidth: 2.8,
          opacity: 1.0,
          closed: false,
          imageOf: { sourceKind: "shape", sourceIdx: 0, fnIdx: 1, anchorMode: "same_tail" },
          rawPts: [{ x: 0, y: 0 }, { x: 2.7, y: 1.2 }],
        },
      ],
      presets: [
        {
          id: "la_shear",
          name: "Clean Linear Map T(v) = M·v (Input & Image Arrows)",
          activeCardIdx: 1,
          view: { xmin: -4.8, xmax: 4.8, ymin: -3.4, ymax: 3.4 },
          heatmap: "none",
          showArrows: false,
          showStreamlines: false,
          showEquipotentials: false,
          showParticles: false,
          showTransformGrid: true,
          sliders: { k: 0.85, theta: 0.55 },
          texts: [
            {
              title: "Clean Linear Map $T(\\mathbf{v}) = M\\mathbf{v}$ (No Frills!)",
              text: "Matrix $M_1$ and function $T(\\mathbf{v}) = M\\mathbf{v}$ are defined in the sidebar with graphing OFF.\n• Drag the blue input arrow $\\mathbf{u}$ (tip to rotate/scale, tail to anchor anywhere — even snap onto a Point!) and watch its live amber **Image Element** $T(\\mathbf{u})$ move on the same plane!\n• Click the visibility dot on $M_1$ to overlay the warped grid & $\\det(M_1)$, or on $T$ to show the full vector field!",
              anchor: "bottom-left",
              color: "#a78bfa",
              width: 365,
            },
          ],
        },
        {
          id: "la_rotation",
          name: "Pure Rotation rot(θ) + Unit Circle Image",
          activeCardIdx: 2,
          view: { xmin: -4.8, xmax: 4.8, ymin: -3.4, ymax: 3.4 },
          heatmap: "none",
          showArrows: false,
          showStreamlines: false,
          showEquipotentials: false,
          showParticles: false,
          showTransformGrid: true,
          sliders: { k: 0.85, theta: 0.785 },
          shapes: [
            { kind: "vector", label: "u (Input)", color: "#38bdf8", lineWidth: 2.8, opacity: 1.0, closed: false, rawPts: [{ x: 0, y: 0 }, { x: 2.0, y: 0.6 }] },
            { kind: "vector", label: "rot(θ)·u", color: "#fbbf24", lineWidth: 2.8, opacity: 1.0, closed: false, imageOf: { sourceKind: "shape", sourceIdx: 0, fnIdx: 2, anchorMode: "origin" }, rawPts: [{ x: 0, y: 0 }, { x: 1.0, y: 1.8 }] },
            { kind: "circle", label: "Unit Circle", color: "#34d399", lineWidth: 2.0, opacity: 0.10, closed: true, rawPts: circlePts(0, 0, 1.0, 64) },
          ],
          texts: [
            {
              title: "Orthogonal Rotation $\\mathrm{rot}(\\theta)$",
              text: "Play slider $\\theta$ to rotate the input arrow $\\mathbf{u}$ rigidly: $|A\\mathbf{u}| = |\\mathbf{u}|$, $\\det(A) = +1$, and eigenvalues $\\lambda = e^{\\pm i\\theta}$ are purely complex!",
              anchor: "bottom-left",
              color: "#34d399",
              width: 345,
            },
          ],
        },
        {
          id: "la_reflection",
          name: "Reflection & Orientation Flip (det = −1)",
          activeCardIdx: 3,
          view: { xmin: -4.8, xmax: 4.8, ymin: -3.4, ymax: 3.4 },
          heatmap: "none",
          showArrows: false,
          showStreamlines: false,
          showEquipotentials: false,
          showParticles: false,
          showTransformGrid: true,
          sliders: { k: 0.85, theta: 0.52 },
          shapes: [
            { kind: "vector", label: "u (Input)", color: "#38bdf8", lineWidth: 2.8, opacity: 1.0, closed: false, rawPts: [{ x: 0, y: 0 }, { x: 1.8, y: 1.6 }] },
            { kind: "vector", label: "Reflected u", color: "#fb7185", lineWidth: 2.8, opacity: 1.0, closed: false, imageOf: { sourceKind: "shape", sourceIdx: 0, fnIdx: 3, anchorMode: "origin" }, rawPts: [{ x: 0, y: 0 }, { x: 1.8, y: -1.6 }] },
          ],
          texts: [
            {
              title: "Orientation-Reversing Reflection ($\\det = -1$)",
              text: "Drag $\\mathbf{u}$ across the mirror axis — its reflection flips smoothly! Click the visibility dot on the Reflection Matrix to show the crimson $\\det = -1$ parallelogram and dashed gold eigenlines.",
              anchor: "bottom-left",
              color: "#fb7185",
              width: 355,
            },
          ],
        },
        {
          id: "la_singular",
          name: "Singular Projection (det = 0, Rank 1)",
          activeCardIdx: 4,
          view: { xmin: -4.8, xmax: 4.8, ymin: -3.4, ymax: 3.4 },
          heatmap: "none",
          showArrows: false,
          showStreamlines: false,
          showEquipotentials: false,
          showParticles: false,
          showTransformGrid: true,
          sliders: { k: 0.85, theta: 0.58 },
          shapes: [
            { kind: "vector", label: "u (Input)", color: "#38bdf8", lineWidth: 2.8, opacity: 1.0, closed: false, rawPts: [{ x: 0, y: 0 }, { x: 1.2, y: 2.2 }] },
            { kind: "vector", label: "proj(u)", color: "#fbbf24", lineWidth: 2.8, opacity: 1.0, closed: false, imageOf: { sourceKind: "shape", sourceIdx: 0, fnIdx: 4, anchorMode: "origin" }, rawPts: [{ x: 0, y: 0 }, { x: 1.6, y: 1.0 }] },
          ],
          texts: [
            {
              title: "Singular Projection ($\\det = 0$, Rank 1)",
              text: "Every vector $\\mathbf{u}$ projects onto the 1D column space ($\\lambda_1 = 1$, $\\lambda_2 = 0$).\n• Drag $\\mathbf{u}$ perpendicular to the line to watch $\\mathrm{proj}(\\mathbf{u}) \\to \\mathbf{0}$ (the Null Space $\\ker A$!).",
              anchor: "bottom-left",
              color: "#fbbf24",
              width: 350,
            },
          ],
        },
      ],
    },
    {
      id: "vec_eigenvectors",
      mode: "vector",
      category: "cat_vec_linalg",
      name: "Eigenvectors, Eigenvalues & Matrix Composition",
      badge: "Av = λv",
      summary: "Drag v onto the gold dashed eigenlines to watch Av snap collinear with v (lighting up the Eigen! badge), or compose two matrices M₂·M₁.",
      defaultView: { xmin: -5.0, xmax: 5.0, ymin: -3.6, ymax: 3.6 },
      defaultSliders: [
        { name: "s", label: "Coupling / Twist s", val: 0.6, min: -1.5, max: 1.5, step: 0.05 },
        { name: "t", label: "Angle t", val: 0.5, min: -3.14, max: 3.14, step: 0.04 },
      ],
      defaultCards: [
        { title: "Symmetric / Asymmetric Matrix M1", kind: "matrix", color: "#a78bfa", active: true, code: "[[1.4, s], [0.5, 0.9]]" },
        { title: "Composed Product M2 = rot(t) * M1", kind: "matrix", color: "#34d399", active: false, visible: false, code: "rot(t) * M1" },
        { title: "Probe Vector v1 (Drag onto Gold Line!)", kind: "vector", color: "#38bdf8", active: false, visible: true, code: "[1.8, 0.8]" },
        { title: "Transformed Image v2 = M1 * v1", kind: "vector", color: "#fbbf24", active: false, visible: false, code: "M1 * v1" },
      ],
      presets: [
        {
          id: "eig_finder",
          name: "Interactive Eigenvector Finder (Drag v₁!)",
          activeCardIdx: 0,
          view: { xmin: -5.0, xmax: 5.0, ymin: -3.6, ymax: 3.6 },
          heatmap: "none",
          showArrows: false,
          showStreamlines: false,
          showEquipotentials: false,
          showParticles: false,
          showTransformGrid: true,
          sliders: { s: 0.6, t: 0.5 },
          texts: [
            {
              title: "Hunt the Eigenvectors: $A\\mathbf{v} = \\lambda\\mathbf{v}$",
              text: "Grab the tip of blue vector $\\mathbf{v}_1$ and rotate it around the origin.\n• Whenever $\\mathbf{v}_1$ lands on a dashed gold line, $M_1\\mathbf{v}_1$ aligns perfectly with $\\mathbf{v}_1$ and triggers the **Eigen!** badge in the sidebar!\n• Scrub $s < -0.5$ to watch the two real eigenlines collide and become complex!",
              anchor: "bottom-left",
              color: "#fbbf24",
              width: 360,
            },
          ],
        },
        {
          id: "eig_compose",
          name: "Matrix Composition M₂ = rot(t) · M₁",
          activeCardIdx: 1,
          view: { xmin: -5.0, xmax: 5.0, ymin: -3.6, ymax: 3.6 },
          heatmap: "none",
          showArrows: false,
          showStreamlines: false,
          showEquipotentials: false,
          showParticles: false,
          showTransformGrid: true,
          sliders: { s: 0.6, t: 0.65 },
          texts: [
            {
              title: "Matrix Algebra in Code: $M_2 = \\mathrm{rot}(t)\\cdot M_1$",
              text: "Click `</>` on any Matrix or Vector card to write algebraic expressions like `rot(t) * M1`, `inv(M1)`, `T(M1)`, `M1^2`, or `M1 * v1 + v2`!",
              anchor: "bottom-left",
              color: "#34d399",
              width: 345,
            },
          ],
        },
      ],
    },
    {
      id: "vec_matrix_ode",
      mode: "vector",
      category: "cat_vec_linalg",
      name: "Matrix Phase Portraits (F(x) = A·x) — Linear ODEs",
      badge: "x′ = Ax",
      summary: "Bridges Linear Algebra and Vector Calculus: every 2×2 Matrix card A automatically compiles its linear vector field F(x, y) = A·x in native C11 with RK4 streamlines and live eigenlines!",
      defaultView: { xmin: -4.5, xmax: 4.5, ymin: -3.2, ymax: 3.2 },
      defaultSliders: [
        { name: "mu", label: "Damping μ (Trace)", val: -0.35, min: -1.5, max: 1.5, step: 0.05 },
        { name: "w", label: "Spin ω", val: 1.15, min: -2.5, max: 2.5, step: 0.05 },
      ],
      defaultCards: [
        { title: "Linear ODE Saddle Matrix", kind: "matrix", color: "#fb7185", active: true, code: "[[1.1, 0.4], [0.4, -0.9]]" },
        { title: "Spiral Sink / Source Matrix", kind: "matrix", color: "#38bdf8", active: false, visible: false, code: "[[mu, -w], [w, mu]]" },
        { title: "Test Trajectory Vector v1", kind: "vector", color: "#34d399", active: false, visible: true, code: "[1.5, 1.0]" },
      ],
      presets: [
        {
          id: "ode_saddle",
          name: "Hyperbolic Saddle Point (det < 0, Real Eigenlines)",
          activeCardIdx: 0,
          view: { xmin: -4.5, xmax: 4.5, ymin: -3.2, ymax: 3.2 },
          heatmap: "mag",
          showArrows: true,
          showStreamlines: true,
          showEquipotentials: false,
          showParticles: true,
          showTransformGrid: true,
          sliders: { mu: -0.35, w: 1.15 },
          texts: [
            {
              title: "Linear ODE Flow $\\dot{\\mathbf{x}} = A\\mathbf{x}$ — Saddle",
              text: "Because $\\det(A) < 0$, one eigenvalue is positive (unstable manifold) and one is negative (stable manifold) — flow particles rush in along one gold eigenline and shoot out along the other!",
              anchor: "bottom-left",
              color: "#fb7185",
              width: 350,
            },
          ],
        },
        {
          id: "ode_spiral",
          name: "Spiral Sink / Source (Complex Eigenvalues μ ± iω)",
          activeCardIdx: 1,
          view: { xmin: -4.5, xmax: 4.5, ymin: -3.2, ymax: 3.2 },
          heatmap: "curl",
          showArrows: true,
          showStreamlines: true,
          showEquipotentials: false,
          showParticles: true,
          showTransformGrid: false,
          sliders: { mu: -0.35, w: 1.25 },
          texts: [
            {
              title: "Hopf Bifurcation: $\\lambda = \\mu \\pm i\\omega$",
              text: "Scrub damping $\\mu$ from negative (spiral sink, $\\nabla\\cdot\\mathbf{F} = 2\\mu < 0$) across $0$ (pure elliptic center) to positive (spiral source)!",
              anchor: "bottom-left",
              color: "#38bdf8",
              width: 345,
            },
          ],
        },
      ],
    },
    {
      id: "vec_electric_dipole",
      mode: "vector",
      category: "cat_vec_physics",
      name: "Electric Dipole & Gauss Flux Lab",
      badge: "∇·E = ρ",
      summary: "2D electrostatic dipole field E = −∇φ with equipotentials, streamlines, and a draggable Gauss loop measuring live outward flux ∮ E·n ds.",
      defaultView: { xmin: -5.2, xmax: 5.2, ymin: -3.8, ymax: 3.8 },
      defaultSliders: [
        { name: "q1", label: "Left Charge +q", val: 1.5, min: -3.0, max: 3.0, step: 0.1 },
        { name: "q2", label: "Right Charge −q", val: -1.5, min: -3.0, max: 3.0, step: 0.1 },
        { name: "d", label: "Half-Separation d", val: 1.6, min: 0.4, max: 3.2, step: 0.05 },
      ],
      defaultCards: [
        {
          title: "Electric Dipole Field E(x, y) & Potential φ",
          kind: "field",
          color: "#38bdf8",
          active: true,
          code:
`double r1sq = (x + d)*(x + d) + y*y + 0.09;
double r2sq = (x - d)*(x - d) + y*y + 0.09;
fx = q1 * (x + d) / r1sq + q2 * (x - d) / r2sq;
fy = q1 * y / r1sq + q2 * y / r2sq;
phi = -0.5 * (q1 * log(r1sq) + q2 * log(r2sq));`,
        },
      ],
      defaultPoints: [
        pt(-1.6, 0, "+q", "plus", "#fb7185", 6, true),
        pt(1.6, 0, "−q", "cross", "#38bdf8", 6, true),
      ],
      defaultShapes: [
        {
          kind: "circle",
          label: "Gauss Flux Loop",
          color: "#34d399",
          lineWidth: 2.4,
          opacity: 0.14,
          closed: true,
          rawPts: circlePts(-1.6, 0, 1.15, 64),
        },
      ],
      presets: [
        {
          id: "dipole_gauss",
          name: "Electric Dipole + Gauss Flux Loop",
          view: { xmin: -5.2, xmax: 5.2, ymin: -3.8, ymax: 3.8 },
          heatmap: "phi",
          showArrows: true,
          showStreamlines: true,
          showEquipotentials: true,
          showParticles: true,
          sliders: { q1: 1.5, q2: -1.5, d: 1.6 },
          shapes: [
            { kind: "circle", label: "Gauss Loop (+q)", color: "#34d399", lineWidth: 2.4, opacity: 0.14, closed: true, rawPts: circlePts(-1.6, 0, 1.15, 64) },
          ],
          texts: [
            {
              title: "Gauss's Divergence Law",
              text: "Drag the green **Gauss Flux Loop** across $+q$ and $-q$:\n• Enclosing $+q$: $\\oint \\mathbf{E}\\cdot\\mathbf{n}\\,ds \\approx +2\\pi q_1$\n• Enclosing both charges: net flux cancels to $0$!\n• Circulation $\\oint \\mathbf{E}\\cdot d\\mathbf{r} = 0$ everywhere (conservative field).",
              anchor: "bottom-left",
              color: "#38bdf8",
              width: 340,
            },
          ],
        },
        {
          id: "same_sign_repel",
          name: "Like Charges (+q, +q) Repulsion & Saddle",
          view: { xmin: -5.2, xmax: 5.2, ymin: -3.8, ymax: 3.8 },
          heatmap: "mag",
          showArrows: true,
          showStreamlines: true,
          showEquipotentials: true,
          showParticles: true,
          sliders: { q1: 1.6, q2: 1.6, d: 1.5 },
          shapes: [
            { kind: "circle", label: "Total Flux Loop", color: "#fbbf24", lineWidth: 2.4, opacity: 0.12, closed: true, rawPts: circlePts(0, 0, 2.5, 64) },
          ],
          texts: [
            {
              title: "Repulsive Stagnation Saddle",
              text: "With $q_1 = q_2 = +1.6$, a hyperbolic stagnation saddle forms at the origin $(0,0)$, and the outer loop encloses total flux $2\\pi(q_1 + q_2) \\approx +20.1$.",
              anchor: "bottom-left",
              color: "#fbbf24",
              width: 330,
            },
          ],
        },
        {
          id: "div_heatmap",
          name: "Divergence ∇·E Source/Sink Heatmap",
          view: { xmin: -4.5, xmax: 4.5, ymin: -3.3, ymax: 3.3 },
          heatmap: "div",
          showArrows: true,
          showStreamlines: false,
          showEquipotentials: false,
          showParticles: true,
          sliders: { q1: 2.0, q2: -2.0, d: 1.5 },
          texts: [
            {
              title: "Divergence Density $\\nabla \\cdot \\mathbf{E}$",
              text: "Red/rose glow highlights positive **sources** ($\\nabla\\cdot\\mathbf{E} > 0$) and cyan highlights negative **sinks** ($\\nabla\\cdot\\mathbf{E} < 0$), directly visualizing $\\nabla\\cdot\\mathbf{E} = \\rho$.",
              anchor: "bottom-left",
              color: "#fb7185",
              width: 330,
            },
          ],
        },
      ],
    },

    {
      id: "vec_rankine_vortex",
      mode: "vector",
      category: "cat_vec_physics",
      name: "Rankine Vortex & Green's Circulation Theorem",
      badge: "∮ v·dr",
      summary: "Fluid Rankine vortex combining solid-body rotational core (r < R) and irrotational outer swirl (r ≥ R). Drag a loop to test Green's Theorem live!",
      defaultView: { xmin: -4.8, xmax: 4.8, ymin: -3.5, ymax: 3.5 },
      defaultSliders: [
        { name: "G", label: "Circulation Γ", val: 3.2, min: -6.0, max: 6.0, step: 0.1 },
        { name: "R", label: "Core Radius R", val: 1.25, min: 0.35, max: 2.6, step: 0.05 },
        { name: "sink", label: "Drain Sink α", val: 0.0, min: -1.5, max: 1.5, step: 0.05 },
      ],
      defaultCards: [
        {
          title: "Rankine Vortex + Optional Drain",
          kind: "field",
          color: "#a78bfa",
          active: true,
          code:
`double r2 = x*x + y*y;
double R2 = R*R;
double swirl = (r2 < R2) ? (G / R2) : (G / (r2 + 1e-6));
fx = -swirl * y + sink * x / (r2 + 0.25);
fy =  swirl * x + sink * y / (r2 + 0.25);`,
        },
      ],
      defaultShapes: [
        {
          kind: "circle",
          label: "Circulation Loop γ",
          color: "#fbbf24",
          lineWidth: 2.5,
          opacity: 0.13,
          closed: true,
          rawPts: circlePts(0, 0, 1.85, 72),
        },
      ],
      presets: [
        {
          id: "vortex_greens",
          name: "Rankine Vortex + Curl Heatmap",
          view: { xmin: -4.8, xmax: 4.8, ymin: -3.5, ymax: 3.5 },
          heatmap: "curl",
          showArrows: true,
          showStreamlines: true,
          showEquipotentials: false,
          showParticles: true,
          sliders: { G: 3.2, R: 1.25, sink: 0.0 },
          shapes: [
            { kind: "circle", label: "Circulation Loop γ", color: "#fbbf24", lineWidth: 2.5, opacity: 0.13, closed: true, rawPts: circlePts(0, 0, 1.85, 72) },
          ],
          texts: [
            {
              title: "Green's Circulation Theorem",
              text: "Inside $r < R$, vorticity $\\nabla\\times\\mathbf{v} = 2\\Gamma/R^2$ is uniform; outside $r > R$, $\\nabla\\times\\mathbf{v} = 0$!\n• Drag the yellow loop **off the core** $\\Rightarrow$ circulation $\\oint \\mathbf{v}\\cdot d\\mathbf{r} \\to 0$!\n• Enclose the core $\\Rightarrow \\oint \\mathbf{v}\\cdot d\\mathbf{r} = 2\\pi\\Gamma \\approx 20.1$.",
              anchor: "bottom-left",
              color: "#a78bfa",
              width: 355,
            },
          ],
        },
        {
          id: "spiral_drain",
          name: "Spiral Tornado Drain (Swirl + Sink)",
          view: { xmin: -4.8, xmax: 4.8, ymin: -3.5, ymax: 3.5 },
          heatmap: "div",
          showArrows: true,
          showStreamlines: true,
          showEquipotentials: false,
          showParticles: true,
          sliders: { G: 3.0, R: 0.9, sink: -1.1 },
          shapes: [
            { kind: "circle", label: "Inflow & Swirl Loop", color: "#34d399", lineWidth: 2.4, opacity: 0.12, closed: true, rawPts: circlePts(0, 0, 2.0, 72) },
          ],
          texts: [
            {
              title: "Combined Vorticity & Inward Flux",
              text: "Adding drain strength $\\alpha = -1.1$ yields BOTH nonzero circulation $\\oint \\mathbf{v}\\cdot d\\mathbf{r} > 0$ AND negative outward flux $\\oint \\mathbf{v}\\cdot\\mathbf{n}\\,ds < 0$!",
              anchor: "bottom-left",
              color: "#34d399",
              width: 335,
            },
          ],
        },
      ],
    },

    {
      id: "vec_cylinder_flow",
      mode: "vector",
      category: "cat_vec_physics",
      name: "Potential Flow Past a Cylinder & Magnus Lift",
      badge: "Aerodynamics",
      summary: "Incompressible inviscid airflow past a spinning cylinder: uniform stream + doublet + circulation Γ producing Kutta–Joukowski Magnus lift.",
      defaultView: { xmin: -4.8, xmax: 4.8, ymin: -3.4, ymax: 3.4 },
      defaultSliders: [
        { name: "U", label: "Freestream U", val: 1.5, min: 0.2, max: 3.5, step: 0.1 },
        { name: "a", label: "Cylinder Radius a", val: 1.15, min: 0.4, max: 2.0, step: 0.05 },
        { name: "G", label: "Spin Circulation Γ", val: 2.2, min: -6.0, max: 6.0, step: 0.1 },
      ],
      defaultCards: [
        {
          title: "Cylinder Potential Flow + Magnus Spin",
          kind: "field",
          color: "#34d399",
          active: true,
          code:
`double r2 = x*x + y*y;
double a2 = a*a;
if (r2 < a2 * 0.92) {
  fx = 0.0; fy = 0.0; phi = 0.0;
} else {
  double r4 = r2 * r2;
  fx = U * (1.0 - a2 * (x*x - y*y) / r4) + (G / (2.0 * M_PI)) * (y / r2);
  fy = U * (-2.0 * a2 * x * y / r4) - (G / (2.0 * M_PI)) * (x / r2);
  phi = U * y * (1.0 - a2 / r2) - (G / (2.0 * M_PI)) * 0.5 * log(r2 / a2);
}`,
        },
      ],
      defaultShapes: [
        { kind: "circle", label: "Cylinder Wall r = a", color: "#94a3b8", lineWidth: 2.4, opacity: 0.28, closed: true, locked: true, rawPts: circlePts(0, 0, 1.15, 72) },
      ],
      presets: [
        {
          id: "magnus_lift",
          name: "Spinning Cylinder (Magnus Lift Γ = 2.2)",
          view: { xmin: -4.8, xmax: 4.8, ymin: -3.4, ymax: 3.4 },
          heatmap: "mag",
          showArrows: true,
          showStreamlines: true,
          showEquipotentials: true,
          showParticles: true,
          sliders: { U: 1.5, a: 1.15, G: 2.2 },
          texts: [
            {
              title: "Kutta–Joukowski Magnus Lift",
              text: "Scrub spin $\\Gamma$: faster flow over the top lowers pressure (Bernoulli) and shifts the two stagnation points downward, generating upward lift $L = \\rho U \\Gamma$!",
              anchor: "bottom-left",
              color: "#34d399",
              width: 350,
            },
          ],
        },
        {
          id: "symmetric_flow",
          name: "Symmetric Potential Flow (Γ = 0)",
          view: { xmin: -4.8, xmax: 4.8, ymin: -3.4, ymax: 3.4 },
          heatmap: "phi",
          showArrows: true,
          showStreamlines: true,
          showEquipotentials: true,
          showParticles: true,
          sliders: { U: 1.6, a: 1.15, G: 0.0 },
          texts: [
            {
              title: "D'Alembert's Symmetric Flow",
              text: "With $\\Gamma = 0$, streamlines ($\\psi = \\text{const}$) bend smoothly around the cylinder with zero net lift and symmetric stagnation points at $(\\pm a, 0)$.",
              anchor: "bottom-left",
              color: "#38bdf8",
              width: 340,
            },
          ],
        },
      ],
    },

    {
      id: "vec_phase_portraits",
      mode: "vector",
      category: "cat_vec_ode",
      name: "ODE Phase Portraits (Van der Pol & Pendulum)",
      badge: "Limit Cycle",
      summary: "Explore nonlinear dynamical systems in the phase plane: Van der Pol self-sustaining limit cycle, damped nonlinear pendulum, and Lotka–Volterra predator–prey cycles.",
      defaultView: { xmin: -4.2, xmax: 4.2, ymin: -3.8, ymax: 3.8 },
      defaultSliders: [
        { name: "mu", label: "Nonlinearity μ / Damping", val: 1.15, min: 0.0, max: 3.2, step: 0.05 },
        { name: "w0", label: "Frequency ω₀", val: 1.0, min: 0.4, max: 2.2, step: 0.05 },
      ],
      defaultCards: [
        {
          title: "Van der Pol Oscillator: x' = y, y' = μ(1 − x²)y − ω₀²x",
          kind: "field",
          color: "#f472b6",
          active: true,
          code:
`fx = y;
fy = mu * (1.0 - x*x) * y - w0*w0 * x;`,
        },
        {
          title: "Damped Nonlinear Pendulum: θ' = ω, ω' = −ω₀²sin(θ) − 0.35μ·ω",
          kind: "field",
          color: "#38bdf8",
          active: false,
          code:
`fx = y;
fy = -w0*w0 * sin(x) - 0.35 * mu * y;`,
        },
        {
          title: "Lotka–Volterra Predator–Prey (x, y > 0)",
          kind: "field",
          color: "#34d399",
          active: false,
          code:
`fx = x * (1.2 - 0.6 * y);
fy = y * (0.45 * x - 0.9);`,
        },
      ],
      presets: [
        {
          id: "vdp_limit_cycle",
          name: "Van der Pol Limit Cycle",
          view: { xmin: -4.2, xmax: 4.2, ymin: -3.8, ymax: 3.8 },
          activeCardIdx: 0,
          heatmap: "div",
          showArrows: true,
          showStreamlines: true,
          showEquipotentials: false,
          showParticles: true,
          sliders: { mu: 1.15, w0: 1.0 },
          texts: [
            {
              title: "Van der Pol Attracting Limit Cycle",
              text: "Near $|x| < 1$, divergence $\\nabla\\cdot\\mathbf{F} = \\mu(1-x^2) > 0$ pumps energy outward; for $|x| > 1$, $\\nabla\\cdot\\mathbf{F} < 0$ damps trajectories inward — locking all particles onto one stable **limit cycle**!",
              anchor: "bottom-left",
              color: "#f472b6",
              width: 365,
            },
          ],
        },
        {
          id: "damped_pendulum",
          name: "Damped Pendulum Phase Portrait",
          view: { xmin: -6.8, xmax: 6.8, ymin: -3.6, ymax: 3.6 },
          activeCardIdx: 1,
          heatmap: "mag",
          showArrows: true,
          showStreamlines: true,
          showEquipotentials: false,
          showParticles: true,
          sliders: { mu: 0.65, w0: 1.35 },
          texts: [
            {
              title: "Nonlinear Pendulum Separatrix",
              text: "Stable spirals sit at $\\theta = 0, \\pm 2\\pi$ (hanging down) while unstable hyperbolic saddles sit at $\\theta = \\pm\\pi$ (balanced inverted!). Set $\\mu = 0$ for conservative closed orbits.",
              anchor: "bottom-left",
              color: "#38bdf8",
              width: 355,
            },
          ],
        },
        {
          id: "lotka_volterra",
          name: "Lotka–Volterra Predator–Prey Orbits",
          view: { xmin: -0.4, xmax: 6.5, ymin: -0.4, ymax: 5.2 },
          activeCardIdx: 2,
          heatmap: "curl",
          showArrows: true,
          showStreamlines: true,
          showEquipotentials: false,
          showParticles: true,
          sliders: { mu: 1.0, w0: 1.0 },
          texts: [
            {
              title: "Lotka–Volterra Ecosystem Cycles",
              text: "Closed periodic predator–prey orbits circle the coexistence equilibrium $(x^*, y^*) = (2.0, 2.0)$ in the positive quadrant.",
              anchor: "bottom-left",
              color: "#34d399",
              width: 330,
            },
          ],
        },
      ],
    },

    {
      id: "vec_curl_turbulence",
      mode: "vector",
      category: "cat_vec_ode",
      name: "2D Curl-Noise Incompressible Turbulence",
      badge: "∇·v = 0",
      summary: "Divergence-free 2D turbulent velocity field generated by taking the 2D curl (∂ψ/∂y, −∂ψ/∂x) of a smooth multi-octave harmonic streamfunction ψ(x, y).",
      defaultView: { xmin: -4.5, xmax: 4.5, ymin: -3.4, ymax: 3.4 },
      defaultSliders: [
        { name: "freq", label: "Eddy Frequency", val: 1.15, min: 0.4, max: 2.6, step: 0.05 },
        { name: "phase", label: "Flow Phase", val: 0.0, min: 0.0, max: 6.2832, step: 0.04, speed: 0.35 },
      ],
      defaultCards: [
        {
          title: "Incompressible Curl-Noise Velocity v = (∂ψ/∂y, −∂ψ/∂x)",
          kind: "field",
          color: "#38bdf8",
          active: true,
          code:
`double h = 1e-3;
double k = freq;
double psi0 = sin(k*x + phase)*cos(k*y) + 0.5*sin(1.9*k*x - 1.3*k*y - phase) + 0.25*cos(2.8*k*x + 2.4*k*y + 0.7*phase);
double psi_x = sin(k*(x+h) + phase)*cos(k*y) + 0.5*sin(1.9*k*(x+h) - 1.3*k*y - phase) + 0.25*cos(2.8*k*(x+h) + 2.4*k*y + 0.7*phase);
double psi_y = sin(k*x + phase)*cos(k*(y+h)) + 0.5*sin(1.9*k*x - 1.3*k*(y+h) - phase) + 0.25*cos(2.8*k*x + 2.4*k*(y+h) + 0.7*phase);
fx = (psi_y - psi0) / h;
fy = -(psi_x - psi0) / h;
phi = psi0;`,
        },
      ],
      defaultShapes: [
        { kind: "circle", label: "Zero-Flux Test Loop", color: "#34d399", lineWidth: 2.3, opacity: 0.12, closed: true, rawPts: circlePts(0, 0, 1.5, 64) },
      ],
      presets: [
        {
          id: "curl_eddies",
          name: "Incompressible Swirling Eddies",
          view: { xmin: -4.5, xmax: 4.5, ymin: -3.4, ymax: 3.4 },
          heatmap: "curl",
          showArrows: true,
          showStreamlines: true,
          showEquipotentials: true,
          showParticles: true,
          sliders: { freq: 1.15, phase: 0.0 },
          texts: [
            {
              title: "Exact Zero-Divergence Curl Flow",
              text: "Because $\\mathbf{v} = (\\partial_y\\psi, -\\partial_x\\psi)$, $\\nabla\\cdot\\mathbf{v} \\equiv 0$ everywhere! Notice the outward **Flux** across ANY closed loop is identically $0.000$ while **Circulation** varies with enclosed vorticity!",
              anchor: "bottom-left",
              color: "#38bdf8",
              width: 365,
            },
          ],
        },
      ],
    },

    {
      id: "vec_gradient_topology",
      mode: "vector",
      category: "cat_vec_ode",
      name: "Gradient Terrain ∇φ & Saddle Topology",
      badge: "F = ∇φ",
      summary: "Scalar Potential card mode: write φ(x, y) and C11 automatically computes the exact gradient vector field ∇φ = (∂φ/∂x, ∂φ/∂y) orthogonal to every contour!",
      defaultView: { xmin: -3.6, xmax: 3.6, ymin: -2.8, ymax: 2.8 },
      defaultSliders: [
        { name: "a", label: "Peak Separation", val: 1.35, min: 0.4, max: 2.4, step: 0.05 },
      ],
      defaultCards: [
        {
          title: "Gaussian Twin-Peaks & Valley Potential φ(x, y)",
          kind: "potential",
          color: "#fbbf24",
          active: true,
          code: `2.2*exp(-((x - a)*(x - a) + (y - 0.5)*(y - 0.5))) - 2.0*exp(-((x + a)*(x + a) + (y + 0.5)*(y + 0.5))) + 0.9*exp(-(x*x + (y + 1.4)*(y + 1.4)))`,
        },
        {
          title: "Monkey Saddle Potential φ(x, y) = x³ − 3xy²",
          kind: "potential",
          color: "#a78bfa",
          active: false,
          code: `0.22 * (x*x*x - 3.0*x*y*y)`,
        },
      ],
      presets: [
        {
          id: "twin_peaks",
          name: "Steepest-Ascent Gradient ∇φ",
          view: { xmin: -3.6, xmax: 3.6, ymin: -2.8, ymax: 2.8 },
          activeCardIdx: 0,
          heatmap: "phi",
          showArrows: true,
          showStreamlines: true,
          showEquipotentials: true,
          showParticles: true,
          sliders: { a: 1.35 },
          texts: [
            {
              title: "Fundamental Theorem for Line Integrals",
              text: "Every gradient arrow $\\nabla\\phi$ meets the equipotential level curves $\\phi(x,y)=c$ at exact $90^\\circ$ angles. Draw any open path from $A$ to $B$: $\\int_A^B \\nabla\\phi\\cdot d\\mathbf{r} = \\phi(B) - \\phi(A)$!",
              anchor: "bottom-left",
              color: "#fbbf24",
              width: 365,
            },
          ],
        },
        {
          id: "monkey_saddle",
          name: "Monkey Saddle φ = x³ − 3xy²",
          view: { xmin: -3.4, xmax: 3.4, ymin: -2.6, ymax: 2.6 },
          activeCardIdx: 1,
          heatmap: "phi",
          showArrows: true,
          showStreamlines: true,
          showEquipotentials: true,
          showParticles: true,
          sliders: { a: 1.35 },
          texts: [
            {
              title: "Harmonic Monkey Saddle ($\\nabla^2\\phi = 0$)",
              text: "Three valleys and three ridges meet at $(0,0)$ — a degenerate critical point with $\\nabla^2\\phi = \\nabla\\cdot(\\nabla\\phi) = 0$ everywhere!",
              anchor: "bottom-left",
              color: "#a78bfa",
              width: 345,
            },
          ],
        },
      ],
    },
  ];

  const VECTOR_CATEGORIES = [
    { id: "cat_vec_linalg", mode: "vector", name: "Linear Algebra & 2×2 Transformations", icon: "⊞", color: "#34d399" },
    { id: "cat_vec_physics", mode: "vector", name: "Electromagnetism & Fluid Dynamics", icon: "⚡", color: "#38bdf8" },
    { id: "cat_vec_ode", mode: "vector", name: "Phase Planes, Curl Noise & Gradients", icon: "🌀", color: "#a78bfa" },
  ];

  window.CFVVectorExamples = {
    examples: VECTOR_EXAMPLES,
    categories: VECTOR_CATEGORIES,
  };
})();
