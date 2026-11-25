(() => {
  "use strict";

  /*
   * Complete C11 Math Studio Reference, Context-Aware Multi-Card GenAI Prompt Builder,
   * Live-Validating AI Import Terminal, and 1-Click Cookbook & Shortcuts Guide.
   */

  const DOC_GROUPS = [
    {
      id: "real_relations",
      category: "2D Real Curves, Parametric & Non-Functions",
      items: [
        {
          sig: "(x(t), y(t)) for t in [t0, t1]   (Parametric Curve)",
          desc: "Continuous parametric curve in 2D Real mode — NOT required to be a function! Ideal for loops, hearts, spirals, Lissajous figures, and self-intersecting paths.",
          notes: "Compiled with clang -O1 and sampled on 4 pthreads · supports M_PI / pi in bounds",
          example: "(16.0*pow(sin(t),3), 13.0*cos(t)-5.0*cos(2*t)-2.0*cos(3*t)-cos(4*t)) for t in [0, 2*M_PI]",
          mode: "real",
        },
        {
          sig: "parametric [t0, t1]:   (Multi-Line Continuous C11 Curve)",
          desc: "Write full C11 statements computing `px` and `py` as a function of `t`! Ideal for continuous cursive handwriting, names/signatures, splines, and piecewise paths. Set `px = NAN; py = NAN;` to lift the pen between disconnected strokes.",
          notes: "Best choice for drawing names, letters, or multi-segment curves in a SINGLE card",
          example: "parametric [0, 6.283185]:\ndouble r = 3.0 + 1.2 * cos(5.0 * t);\npx = r * cos(t);\npy = r * sin(t);",
          mode: "real",
        },
        {
          sig: "x = c   (e.g. x = 5, x = M_PI, x = r)",
          desc: "Vertical line in 2D Real mode. Any C11 expression on the right-hand side is compiled natively and can animate live with sliders.",
          notes: "Compiled natively · supports sliders & M_PI/M_E",
          example: "x = 14.134725",
          mode: "real",
        },
        {
          sig: "x = g(y)   (e.g. x = sin(y) * 2.0)",
          desc: "Inverted / horizontal curve sampled smoothly along the visible y-axis range [ymin, ymax] in native C11.",
          notes: "Great for sideways waves, parabolas x = y*y, and phase curves",
          example: "x = sin(y) * 2.0",
          mode: "real",
        },
        {
          sig: "LHS = RHS   (Implicit Relation F(x, y) = 0)",
          desc: "Any equation containing both x and y is compiled as (LHS) - (RHS) and traced across the viewport using 4-thread POSIX pthreads + Marching Squares.",
          notes: "Circles, ellipses, hyperbolas, elliptic curves, Cassini ovals, level sets",
          example: "x*x + y*y = 16.0",
          mode: "real",
        },
        {
          sig: "y = f(x)   (or bare expression / C block)",
          desc: "Standard 2D real function. Return `NAN` outside the valid domain to create clean breaks or asymptotes.",
          notes: "All visible cards graph simultaneously in 2D Real mode",
          example: "y = sin(x) * exp(-0.08 * fabs(x))",
          mode: "real",
        },
      ],
    },
    {
      id: "zeta_nt",
      category: "Riemann Zeta & Analytic Number Theory",
      items: [
        {
          sig: "double complex c_zeta(double complex s)",
          desc: "Full analytic continuation of the Riemann zeta function ζ(s) across C \\ {1}. Euler-Maclaurin for Re(s) ≥ 0.5 and log-stabilized functional equation for Re(s) < 0.5.",
          notes: "~15-digit accuracy · simple pole at s = 1 (residue 1) · trivial zeros at -2, -4, -6, …",
          example: "c_zeta(s)",
          mode: "complex",
        },
        {
          sig: "double complex c_xi(double complex s)",
          desc: "Completed entire Riemann zeta function ξ(s) = ½ s(s − 1) π^(−s/2) Γ(s/2) ζ(s). No poles anywhere in C; satisfies ξ(s) = ξ(1 − s) and is strictly real on Re(s) = 1/2.",
          notes: "Entire function · ξ(0) = ξ(1) = 1/2",
          example: "c_xi(s)",
          mode: "complex",
        },
        {
          sig: "double complex c_zeta_deriv(double complex s)",
          desc: "Complex derivative ζ'(s) computed via 4th-order central difference.",
          notes: "Useful for Newton-Raphson & critical point analysis",
          example: "c_zeta_deriv(s)",
          mode: "complex",
        },
        {
          sig: "double complex c_zeta_log_deriv(double complex s)",
          desc: "Logarithmic derivative ζ'(s)/ζ(s). By the Argument Principle, (1/2πi) ∮ ζ'(s)/ζ(s) ds = Z − P counts (Riemann zeros − poles) inside any closed contour!",
          notes: "Best paired with Integral mode",
          example: "c_zeta_log_deriv(s)",
          mode: "complex",
        },
        {
          sig: "double complex c_zeta_partial(double complex s, int N)",
          desc: "Truncated Dirichlet series S_N(s) = Σ_{n=1}^N n^(−s). Converges for Re(s) > 1 and diverges wildly past the Re(s) = 1 convergence wall.",
          notes: "Pair with integer slider N (e.g. 2..150)",
          example: "c_zeta_partial(s, (int)N)",
          mode: "complex",
        },
        {
          sig: "double complex c_eta(double complex s)",
          desc: "Dirichlet eta function η(s) = (1 − 2^(1−s)) ζ(s). Entire across all of C (cancels the simple pole at s = 1 with η(1) = ln 2).",
          notes: "Entire · alternating zeta function",
          example: "c_eta(s)",
          mode: "complex",
        },
        {
          sig: "double c_hardy_z(double t)",
          desc: "Hardy's real-valued critical-line function Z(t) = e^(iθ(t)) ζ(1/2 + it). Real for all real t, with |Z(t)| = |ζ(1/2 + it)|; sign changes locate non-trivial Riemann zeros γₖ.",
          notes: "2D Real mode: pass x as t -> c_hardy_z(x)",
          example: "c_hardy_z(x)",
          mode: "real",
        },
      ],
    },
    {
      id: "primes",
      category: "Prime Counting & Explicit Formulas",
      items: [
        {
          sig: "double real_pi_exact(double x)",
          desc: "Exact prime-counting step function π(x) = #{primes p ≤ x}.",
          notes: "O(1) precomputed prime sieve table up to x = 100,000",
          example: "real_pi_exact(x)",
          mode: "real",
        },
        {
          sig: "double real_pi_explicit(double x, int K)",
          desc: "Riemann's 1859 explicit formula for π(x) via Möbius inversion μ(n) using the first K non-trivial Riemann zeros (0 ≤ K ≤ 200).",
          notes: "Watch the smooth curve sharpen into prime steps as K increases!",
          example: "real_pi_explicit(x, (int)K)",
          mode: "real",
        },
        {
          sig: "double real_li(double x)",
          desc: "Logarithmic integral li(x) = Ei(ln x) for x > 1 (principal value). Smooth main term of the Prime Number Theorem.",
          notes: "Returns NAN for x <= 1",
          example: "real_li(x)",
          mode: "real",
        },
        {
          sig: "double real_J_exact(double x)  /  real_J_explicit(double x, int K)",
          desc: "Riemann's prime-power counting function J(x) = Σ (1/n) π(x^(1/n)) (jumps +1 at primes, +1/2 at p², +1/3 at p³) and its K-zero explicit approximation.",
          notes: "0 <= K <= 200",
          example: "real_J_explicit(x, (int)K)",
          mode: "real",
        },
        {
          sig: "double real_psi_exact(double x)  /  real_psi_explicit(double x, int K)",
          desc: "Chebyshev's second function ψ(x) = Σ_{p^k ≤ x} ln(p) and Von Mangoldt's explicit formula ψ_K(x) = x − Σ x^ρ/ρ − ln(2π) − ½ln(1 − x⁻²).",
          notes: "0 <= K <= 200",
          example: "real_psi_explicit(x, (int)K)",
          mode: "real",
        },
        {
          sig: "double real_zero_wave(double x, int idx)  &  RIEMANN_ZEROS[200]",
          desc: "Single oscillatory harmonic −2 Re(Ei((1/2 + iγ_idx) ln x)) contributed by the idx-th zero (0..199), plus the verified constant array RIEMANN_ZEROS[0..199] (γ₁ = 14.134725…).",
          notes: "RIEMANN_ZERO_COUNT == 200",
          example: "real_zero_wave(x, 0)",
          mode: "real",
        },
      ],
    },
    {
      id: "special_complex",
      category: "Special Functions & Complex Primitives",
      items: [
        {
          sig: "double complex c_gamma(double complex z)  /  c_lgamma(z)",
          desc: "Full analytic continuation of Euler's Gamma function Γ(z) (9-term Lanczos + Euler reflection) and principal branch ln Γ(z) for Re(z) > 0.",
          notes: "Simple poles at z = 0, -1, -2, … with residue (-1)^n / n!",
          example: "c_gamma(z)",
          mode: "complex",
        },
        {
          sig: "double complex c_ei(double complex z)  /  double c_e1_real(double x)",
          desc: "Complex exponential integral Ei(z) (power series + Lentz continued fraction) and real exponential integral E₁(x) = ∫_x^∞ (e^(−t)/t) dt for x > 0.",
          notes: "Branch cut along (-∞, 0] for complex c_ei(z)",
          example: "c_ei(z)",
          mode: "complex",
        },
        {
          sig: "double complex c_make(double re, double im)  &  bool c_isfinite(z)",
          desc: "Portable ISO C11 complex constructor (required instead of GNU `1.0i` or `I`). `c_isfinite(z)` checks both real and imaginary parts are finite.",
          notes: "Use c_make(INFINITY, 0.0) to explicitly mark a pole",
          example: "c_make(0.0, 1.0) * z + c_make(1.0, 0.0)",
          mode: "complex",
        },
        {
          sig: "Standard <complex.h> & <math.h>",
          desc: "Complex: cexp, clog, csin, ccos, ctan, csinh, ccosh, ctanh, cpow, csqrt, cabs, carg, creal, cimag, conj. Real: sin, cos, tan, asin, acos, atan, atan2, sinh, cosh, tanh, exp, log, log10, pow, sqrt, cbrt, fabs, floor, ceil, fmod, M_PI, M_E, NAN, INFINITY.",
          notes: "Compiled natively with clang -O2 -lm",
          example: "cexp(z) * csin(z)",
          mode: "both",
        },
      ],
    },
    {
      id: "composition",
      category: "Auxiliary Helpers, Sliders & C11 Idioms",
      items: [
        {
          sig: "Auxiliary Cards: f1(z), f2(z), … (Map/Integral) & f1(x), f2(x), … (2D Real)",
          desc: "Every card is forward-declared as f1(..), f2(..), … (up to 24 cards!). In Map/Integral mode, mark helper cards as Aux and click ★ Graphed on the one final card to plot or integrate.",
          notes: "Example: Card 1 `z*z - 1.0` (Aux), Card 2 `f1(z) / (z*z + 1.0)` (★ Graphed)",
          example: "f1(z) / (z*z + 1.0)",
          mode: "both",
        },
        {
          sig: "Parameter Sliders (up to 8 live variables)",
          desc: "Every slider card exposes a live `double` C variable directly inside every function card. Avoid reserved names: `z`, `s`, `x`, `y`, `P`, `slot`.",
          notes: "Cast to (int) when passing to integer arguments like c_zeta_partial(s, (int)N)",
          example: "(1.0 - t) * z + t * c_zeta(z)",
          mode: "both",
        },
        {
          sig: "Multi-Line C11 Function Bodies (Loops, Locals, Guards)",
          desc: "Any card containing `;`, `{`, or `return` is compiled as a full C11 function body instead of a single expression — write loops, products, piecewise logic, or finite differences freely!",
          notes: "Input is `z` (alias `s`) in Complex/Integral, or `x` (and `y` for implicits) in 2D Real",
          example: "double complex sum = c_make(0.0, 0.0);\nfor (int n = 1; n <= 20; n++) {\n    sum += cpow(z, n) / (double)n;\n}\nreturn sum;",
          mode: "both",
        },
      ],
    },
    {
      id: "residue_contours",
      category: "Residue Theory, Branch Cuts & Variable Contours",
      items: [
        {
          sig: "Branch Cut on [0, +∞):  clog(-z) + c_make(0.0, M_PI)",
          desc: "C11's built-in clog(z) has its branch cut on (-∞, 0]. Shifting to clog(-z) + iπ moves the branch cut to [0, +∞) with arg(z) ∈ (0, 2π) — the exact branch needed for right-facing Pac-Man / Keyhole contours!",
          notes: "Compute z^α on [0, ∞) cut via cexp(alpha * (clog(-z) + c_make(0.0, M_PI)))",
          example: "double complex d = z + c_make(1.0, 0.0);\nif (cabs(d) < 1e-12 || cabs(z) < 1e-12) return c_make(INFINITY, 0.0);\nreturn cexp((a - 1.0) * (clog(-z) + c_make(0.0, M_PI))) / d;",
          mode: "complex",
        },
        {
          sig: "Variable Domain Shape Formula (`fx` button on any shape card)",
          desc: "Bind any contour piece (`arc`, `line`, `circle`, `rect`, `parametric`) to live slider variables (`R`, `r`, `eps`, `pi`, `sin`, `cos`, `sqrt`). Every open piece evaluates its own ∫ f(z) dz on the right AND displays the total sum!",
          notes: "Click Join in the dock to merge touching pieces into one closed loop",
          example: "// JSON shape formula example:\n// { \"kind\": \"arc\", \"cx\": \"0\", \"cy\": \"0\", \"r\": \"R\", \"a0\": \"eps\", \"a1\": \"2*pi - eps\" }",
          mode: "complex",
        },
        {
          sig: "Indented Semicircle & Jordan's Lemma (e^(iz)/z, sin(z)/z)",
          desc: "Build upper-half-plane contours out of 4 variable pieces: left real segment [-R, -r], small CW indentation arc around 0, right real segment [r, R], and large CCW semicircle of radius R → ∞.",
          notes: "Watch the large arc vanish as R increases while the real segments converge to π!",
          example: "cabs(z) < 1e-12 ? c_make(INFINITY, 0.0) : cexp(c_make(0.0, 1.0) * z) / z",
          mode: "complex",
        },
      ],
    },
    {
      id: "project_automata_viewport",
      category: "Game of Life Engine, Viewport Globals & Full Project JSON",
      items: [
        {
          sig: "int real_life_cell_at(int R, int gen, int cell_idx, int *out_gx, int *out_gy)",
          desc: "Origin-centered Conway's Game of Life (B3/S23) engine on [-R, R] × [-R, R] (4 ≤ R ≤ 60, up to 120×120 = 14,400 cells) seeded live from user-selectable/deletable 2D Real cell polygons (`seedCells`). Cached per (R, gen, seed_epoch) in O(1)! Returns total alive cells and writes the cell_idx-th alive cell's signed grid coordinates (gx, gy) ∈ [-R, R-1]².",
          notes: "Pair with single radius variable `R` (e.g. R = 32) and integer generation slider `G`",
          example: "parametric [0, 3599.99]:\nint idx = (int)(t / 6.0);\nint step = (int)fmod(t, 6.0);\nint gx = 0, gy = 0;\nint n_alive = real_life_cell_at((int)R, (int)G, idx, &gx, &gy);\nif (idx >= n_alive || step == 5) { px = NAN; py = NAN; }\nelse {\n    double x0 = (double)gx + 0.08, y0 = (double)gy + 0.08;\n    double x1 = (double)gx + 0.92, y1 = (double)gy + 0.92;\n    if (step == 0 || step == 4) { px = x0; py = y0; }\n    else if (step == 1) { px = x1; py = y0; }\n    else if (step == 2) { px = x1; py = y1; }\n    else { px = x0; py = y1; }\n}",
          mode: "real",
        },
        {
          sig: "Global Viewport & 3D Camera Variables (sphere_yaw, sphere_pitch, sphere_zoom, in_cx/cy/r, out_cx/cy/r, real_xmin/xmax/ymin/ymax)",
          desc: "All 13 viewport & camera globals can be READ inside any C11 card or shape formula, AND dynamically DRIVEN at 60 FPS (zero HTTP overhead!) by creating a slider or computed variable (`vars`) with that exact name!",
          notes: "Example: var `sphere_yaw = -0.58 + spin` rotates the 3D Riemann Sphere live at 60 FPS",
          example: "sphere_yaw = -0.58 + spin",
          mode: "both",
        },
        {
          sig: "Unlocked Domain Points (`\"locked\": false`) & Unified Element Layering (`\"layerOrder\"`)",
          desc: "Shapes, points, and guide lines live in a single unified Elements & Layers stack (drawn back-to-front in list order). Drag cards in the sidebar to reorder layers, or right-click any element directly on a graph to adjust color, opacity (0–100%, applies to both input & output space), lineWidth (down to 0 for fill-only shapes!), layer order, or lock status. Locked elements show a clear LOCKED badge and stay pinned to the Input Plane.",
          notes: "layerOrder uses refs like [\"s:0\", \"l:0\", \"p:0\"] (s=shape, l=line, p=point)",
          example: "{ \"kind\": \"circle\", \"cx\": 0, \"cy\": 0, \"r\": 1.5, \"color\": \"#38bdf8\", \"lineWidth\": 0, \"opacity\": 0.45, \"closed\": true }",
          mode: "both",
        },
        {
          sig: "Output Projections (`planar`, `sphere`, `stereographic`, `poincare`, `custom` + `projectionExpr`)",
          desc: "Switch the Complex Output Space between flat Planar ℂ, 3D Riemann Sphere S², Stereographic Finite Disk ((2/π)atan(|w|)e^(iθ) mapping all of ℂ ∪ {∞} into |W| ≤ 1), Poincaré Disk (w / (1 + √(1+|w|²)) with orthogonal hyperbolic geodesics), or Custom P(w) where users enter any complex expression in w, u, v, r, theta, i, pi, e, and slider variables.",
          notes: "Set viewport.projection and optional viewport.projectionExpr in cfv_project_v1 JSON",
          example: "\"viewport\": { \"projection\": \"poincare\", \"inView\": { \"cx\": 0, \"cy\": 0, \"r\": 3 }, \"outView\": { \"cx\": 0, \"cy\": 0, \"r\": 1.32 } }",
          mode: "complex",
        },
        {
          sig: "4-Thread C11 Domain & Fractal Color Schemes (`showDomain`, `domainScheme`, `domainOpacity`)",
          desc: "Renders up to 900×900 native C11 color fields over the Complex Input Plane. Supports 6 palettes: `classic` (phase + log₂|w|), `smooth_escape` (Mandelbrot Ultra-Fractal smooth cyclic gradient where Re(w) < 0 renders black), `inferno`, `ocean`, `neon_prism`, and `grayscale`.",
          notes: "For Mandelbrot/Julia fractals return c_make(nu, 0.0) for escaped points and c_make(-1.0, 0.0) for interior points",
          example: "\"viewport\": { \"showDomain\": true, \"domainScheme\": \"smooth_escape\", \"domainOpacity\": 1.0 }",
          mode: "complex",
        },
        {
          sig: "Full Project JSON (`\"format\": \"cfv_project_v1\"`), Descriptions, `#json=` URLs & Repo Persistence",
          desc: "Every saved or exported project is encoded as a complete, human-readable `cfv_project_v1` JSON object containing `name`, `subtitle`, `description`, `mode`, `cards`, `sliders` (with `speed`), `vars`, `shapes` / `seedCells`, `points`, `lines`, `layerOrder`, `viewport` (including projections & color schemes), and `presets[]`. Live shareable URLs use readable `#json={...}` encoding, and saved projects persist in `projects/*.json` with custom folder creation directly in Save As.",
          notes: "Use Shift+Scroll (X-axis) or Ctrl+Scroll (Y-axis) or X±/Y± buttons for independent axis scaling; click 1:1 to reset",
          example: "{ \"format\": \"cfv_project_v1\", \"name\": \"My Project\", \"description\": \"Math notes...\", \"mode\": \"map\", \"cards\": [...], \"viewport\": {...}, \"presets\": [...] }",
          mode: "both",
        },
      ],
    },
  ];

  const PROMPT_IDEAS = {
    map: [
      "Helper polynomial f1(z) = z^3 - a and active rational map f1(z) / (z^2 + 1) with pole landmarks & test disk",
      "Blaschke product with 3 zeros inside the unit disk + unit circle & zero landmarks",
      "Möbius transform (a*z + b) / (c*z + 1) with sliders a, b, c and 2 circles",
      "Dirichlet L-function L(s, chi_4) partial sum with slider N, critical line Re=1/2, and test rectangle",
      "Essential singularity exp(1/(z-a)) with movable slider a and small loop around the singularity",
      "Mandelbrot / Burning Ship smooth escape-time fractal using showDomain: true and domainScheme: smooth_escape or inferno",
      "Poincaré Disk or Stereographic finite projection of a Möbius / Blaschke map with opacity-layered shapes",
    ],
    integral: [
      "Pac-Man / Keyhole contour in 4 separate slider-driven pieces (R, r, eps, a) to evaluate ∫₀^∞ x^(a-1)/(x+1) dx via residue at z = -1",
      "Indented upper semicircle in 4 slider-driven pieces (R, r) for e^(iz)/z around pole z = 0 (Dirichlet integral)",
      "Dogbone (dumbbell) contour in 4 slider-driven pieces around branch cut [-1, 1] for 1/sqrt(z^2 - 1)",
      "Rectangular box contour (sliders R, H) with 4 line pieces to evaluate ∫_{-∞}^∞ e^(a*x)/(1 + e^x) dx",
      "Pizza-slice / wedge contour (angle 2π/3, slider R) in 3 pieces for ∫₀^∞ 1/(1 + x^3) dx",
      "Argument Principle zero counter: helper f1(z) = z^3 - 1 and active numerical f1'(z)/f1(z) with 2 loops",
    ],
    real: [
      "Draw my name in one continuous cursive parametric curve using parametric [t0, t1]: with smooth Bezier/trig strokes",
      "Parametric butterfly curve & heart curve with animated slider a",
      "Circle x^2 + y^2 = r^2 with slider r, vertical tangents x = r and x = -r, and intersection points",
      "Elliptic curve y^2 = x^3 - a*x + b with sliders a, b and vertical guide lines",
      "Compare real_pi_exact(x), real_li(x), and real_pi_explicit(x, K) with prime vertical guides",
    ],
  };

  const COOKBOOK_RECIPES = [
    {
      title: "Mandelbrot Set Smooth Fractal Field (C11 4-Thread Palette)",
      badge: "Map · Smooth Fractal Coloring",
      desc: "Computes smooth escape potential ν = k + 1 − log₂(log₂|z|) for z² + c in native C11 and renders it with the Ultra-Fractal smooth_escape palette at high resolution.",
      bundle: {
        mode: "map",
        name: "Mandelbrot Smooth Escape Field",
        description: "Smooth continuous escape-time Mandelbrot set evaluated natively across 4 C11 threads.",
        cards: [
          {
            title: "Mandelbrot ν(c)",
            code: "double complex c = z, w = c_make(0.0, 0.0);\nint lim = (int)floor(max_iter + 0.5);\nif (lim < 16) lim = 16;\nfor (int k = 0; k < lim; k++) {\n  w = w * w + c;\n  double r2 = creal(w)*creal(w) + cimag(w)*cimag(w);\n  if (r2 > 256.0) return c_make((double)k + 1.0 - log2(0.5 * log2(r2)), 0.0);\n}\nreturn c_make(-1.0, 0.0);",
            color: "#38bdf8",
            active: true,
          },
        ],
        sliders: [
          { name: "max_iter", label: "Max Iterations", value: 180, min: 32, max: 400, step: 8, speed: 0.5 },
        ],
        viewport: {
          inView: { cx: -0.55, cy: 0.0, r: 1.45 },
          outView: { cx: 12.0, cy: 0.0, r: 18.0 },
          inSquare: true,
          outSquare: true,
          showDomain: true,
          domainScheme: "smooth_escape",
          domainOpacity: 1.0,
        },
      },
    },
    {
      title: "Pac-Man / Keyhole Residue Contour (4 Variable Pieces)",
      badge: "Integral · Residue Theory",
      desc: "Classic branch-cut keyhole contour for z^(a−1)/(z+1) built from 4 separate slider-driven pieces (R, r, eps, a). Each piece integrates separately on the right while their sum equals 2πi·Res(−1) = 2π (for a = ½). Scrub R → 24 to watch Outer Arc → 0, or click Join to merge into one closed loop!",
      bundle: {
        mode: "integral",
        cards: [
          {
            title: "Integrand z^(a−1)/(z+1) [cut ℝ⁺]",
            code: "double complex d = z + c_make(1.0, 0.0);\nif (cabs(d) < 1e-12 || cabs(z) < 1e-12) return c_make(INFINITY, 0.0);\nreturn cexp((a - 1.0) * (clog(-z) + c_make(0.0, M_PI))) / d;",
            color: "#38bdf8",
            active: true,
          },
        ],
        sliders: [
          { name: "t", label: "Keyhole Limit (0 → 1)", value: 0.35, min: 0.0, max: 1.0, step: 0.01 },
          { name: "a", label: "Exponent a", value: 0.5, min: 0.15, max: 0.85, step: 0.05 },
        ],
        vars: [
          { name: "R", expr: "2.2 + 18*t*t", label: "Outer radius" },
          { name: "r", expr: "0.52*(1 - 0.88*t)", label: "Inner radius" },
          { name: "eps", expr: "0.34*(1 - 0.9*t)", label: "Mouth angle" },
        ],
        points: [
          { x: 0.0, y: 0.0, label: "Branch pt 0", icon: "diamond", color: "#fbbf24", size: 6, locked: true },
          { x: -1.0, y: 0.0, label: "Pole z = −1", icon: "cross", color: "#fb7185", size: 6, locked: true },
        ],
        lines: [
          { orientation: "horizontal", value: 0.0, label: "Branch Cut [0, ∞)", color: "#fbbf24", lineStyle: "dotted", locked: true },
        ],
        shapes: [
          { kind: "line", label: "1. Top Cut (r → R)", color: "#34d399", closed: false, formula: { kind: "line", x0: "r*cos(eps)", y0: "r*sin(eps)", x1: "R*cos(eps)", y1: "R*sin(eps)" } },
          { kind: "arc", label: "2. Outer Arc γ_R (CCW)", color: "#38bdf8", closed: false, formula: { kind: "arc", cx: "0", cy: "0", r: "R", a0: "eps", a1: "2*pi - eps" } },
          { kind: "line", label: "3. Bottom Cut (R → r)", color: "#a78bfa", closed: false, formula: { kind: "line", x0: "R*cos(eps)", y0: "-R*sin(eps)", x1: "r*cos(eps)", y1: "-r*sin(eps)" } },
          { kind: "arc", label: "4. Inner Arc γ_r (CW)", color: "#fbbf24", closed: false, formula: { kind: "arc", cx: "0", cy: "0", r: "r", a0: "2*pi - eps", a1: "eps" } },
        ],
        inView: { cx: 0.0, cy: 0.0, r: 5.8 },
        outView: { cx: 3.1, cy: 0.0, r: 4.5 },
      },
    },
    {
      title: "Indented Semicircle Contour (Jordan's Lemma · e^(iz)/z)",
      badge: "Integral · Residue Theory",
      desc: "4 variable pieces around the simple pole at z = 0 with sliders R and r. Total closed sum = 0 (no interior poles), small CW indent gives −iπ, Outer Arc → 0 by Jordan's Lemma, leaving the real segments converging to +iπ (so ∫₀^∞ sin(x)/x dx = π/2)!",
      bundle: {
        mode: "integral",
        cards: [
          {
            title: "Integrand e^(iz) / z",
            code: "if (cabs(z) < 1e-12) return c_make(INFINITY, 0.0);\nreturn cexp(c_make(0.0, 1.0) * z) / z;",
            color: "#38bdf8",
            active: true,
          },
        ],
        sliders: [
          { name: "R", label: "Outer radius", value: 6.0, min: 2.0, max: 25.0, step: 0.5 },
          { name: "r", label: "Indent radius", value: 0.35, min: 0.05, max: 1.0, step: 0.05 },
        ],
        points: [
          { x: 0.0, y: 0.0, label: "Pole z = 0 (Res 1)", icon: "cross", color: "#fb7185", size: 6, locked: true },
        ],
        lines: [],
        shapes: [
          { kind: "line", label: "1. Left Real (−R → −r)", color: "#34d399", closed: false, formula: { kind: "line", x0: "-R", y0: "0", x1: "-r", y1: "0" } },
          { kind: "arc", label: "2. Small Indent γ_r (CW)", color: "#fbbf24", closed: false, formula: { kind: "arc", cx: "0", cy: "0", r: "r", a0: "pi", a1: "0" } },
          { kind: "line", label: "3. Right Real (r → R)", color: "#a78bfa", closed: false, formula: { kind: "line", x0: "r", y0: "0", x1: "R", y1: "0" } },
          { kind: "arc", label: "4. Upper Semicircle γ_R", color: "#38bdf8", closed: false, formula: { kind: "arc", cx: "0", cy: "0", r: "R", a0: "0", a1: "pi" } },
        ],
        inView: { cx: 0.0, cy: 2.8, r: 7.0 },
        outView: { cx: 0.0, cy: 1.5, r: 4.0 },
      },
    },
    {
      title: "Auxiliary Helper Composition (Map)",
      badge: "Map · Aux + Active",
      desc: "Define two reusable helper cards f1(z) and f2(z) (Aux), then combine them into one active graphed rational map f3(z) = f1(z) / f2(z) with locked pole landmarks.",
      bundle: {
        mode: "map",
        cards: [
          { title: "Helper Numerator P(z)", code: "z*z*z - c_make(a, 0.0)", color: "#a78bfa", active: false },
          { title: "Helper Denominator Q(z)", code: "z*z + c_make(1.0, 0.0)", color: "#fbbf24", active: false },
          { title: "Active f(z) = f1(z) / f2(z)", code: "double complex d = f2(z);\nreturn cabs(d) < 1e-12 ? c_make(INFINITY, 0.0) : f1(z) / d;", color: "#38bdf8", active: true },
        ],
        sliders: [{ name: "a", label: "Shift", value: 1.0, min: -4.0, max: 4.0, step: 0.1 }],
        points: [
          { x: 0, y: 1, label: "Pole +i", icon: "cross", color: "#fb7185", locked: true },
          { x: 0, y: -1, label: "Pole −i", icon: "cross", color: "#fb7185", locked: true },
        ],
        lines: [{ orientation: "vertical", value: 0, label: "Im Axis", color: "#fbbf24", lineStyle: "dashed", locked: true }],
        shapes: [{ kind: "circle", cx: 0, cy: 0, r: 1.6, label: "Circle r = 1.6", color: "#38bdf8", closed: true }],
        inView: { cx: 0, cy: 0, r: 3.0 },
        outView: { cx: 0, cy: 0, r: 4.5 },
      },
    },
    {
      title: "Argument Principle Zero Counter via Helper (Integral)",
      badge: "Integral · Aux + Active",
      desc: "Put ANY holomorphic function in helper f1(z), and let active card f2(z) compute its logarithmic derivative f1'(z)/f1(z). Every closed loop's integral ÷ 2πi equals (Zeros − Poles) inside!",
      bundle: {
        mode: "integral",
        cards: [
          { title: "Helper g(z) = z³ − 1", code: "z*z*z - c_make(1.0, 0.0)", color: "#a78bfa", active: false },
          { title: "Active Log-Deriv g'(z)/g(z)", code: "double h = 1e-6;\ndouble complex v = f1(z);\nif (cabs(v) < 1e-12) return c_make(INFINITY, 0.0);\ndouble complex dv = (f1(z + c_make(h, 0.0)) - f1(z - c_make(h, 0.0))) / (2.0 * h);\nreturn dv / v;", color: "#34d399", active: true },
        ],
        sliders: [],
        points: [
          { x: 1.0, y: 0.0, label: "Root 1", icon: "ring", color: "#34d399", locked: true },
          { x: -0.5, y: 0.866025, label: "Root ω", icon: "ring", color: "#34d399", locked: true },
          { x: -0.5, y: -0.866025, label: "Root ω²", icon: "ring", color: "#34d399", locked: true },
        ],
        lines: [],
        shapes: [
          { kind: "circle", cx: 1.0, cy: 0.0, r: 0.45, label: "1 Root (÷2πi = +1)", color: "#38bdf8", closed: true },
          { kind: "circle", cx: 0.0, cy: 0.0, r: 1.5, label: "All 3 Roots (÷2πi = +3)", color: "#34d399", closed: true },
        ],
        inView: { cx: 0, cy: 0, r: 2.6 },
        outView: { cx: 0, cy: 9.0, r: 12.0 },
      },
    },
    {
      title: "Blaschke Product (Multi-Line C11 Loop)",
      badge: "Map · Multi-Line C",
      desc: "Maps the unit disk onto itself with a configurable number of interior zeros via a native C11 product loop. Try toggling Riemann Sphere on the output!",
      bundle: {
        mode: "map",
        cards: [
          {
            title: "Blaschke Product B(z)",
            code: "double complex prod = c_make(1.0, 0.0);\nint n = (int)N;\nfor (int k = 0; k < n; k++) {\n    double ang = (2.0 * M_PI * k) / (double)n;\n    double complex a = c_make(r * cos(ang), r * sin(ang));\n    double complex den = c_make(1.0, 0.0) - conj(a) * z;\n    if (cabs(den) < 1e-12) return c_make(INFINITY, 0.0);\n    prod *= (z - a) / den;\n}\nreturn prod;",
            color: "#38bdf8",
            active: true,
          },
        ],
        sliders: [
          { name: "N", label: "Zeros", value: 3, min: 1, max: 8, step: 1 },
          { name: "r", label: "Zero radius", value: 0.55, min: 0.05, max: 0.9, step: 0.05 },
        ],
        points: [{ x: 0, y: 0, label: "Origin", icon: "dot", color: "#fbbf24", locked: true }],
        lines: [],
        shapes: [
          { kind: "circle", cx: 0, cy: 0, r: 0.99, label: "Unit Circle |z|=1", color: "#38bdf8", closed: true },
          { kind: "circle", cx: 0, cy: 0, r: 0.72, label: "Inner Disk r=0.72", color: "#a78bfa", closed: true },
        ],
        inView: { cx: 0, cy: 0, r: 1.6 },
        outView: { cx: 0, cy: 0, r: 1.5 },
      },
    },
    {
      title: "2D Real Implicit Cassini Ovals & Vertical Guides",
      badge: "2D Real · Multi-Card",
      desc: "Plots an implicit quartic curve F(x, y) = 0 using 4-thread Marching Squares alongside animated vertical lines x = ±a and a standard y = f(x) overlay.",
      bundle: {
        mode: "real",
        cards: [
          { title: "Cassini Oval", code: "(x*x + y*y)*(x*x + y*y) - 2.0*a*a*(x*x - y*y) = b*b*b*b - a*a*a*a", color: "#38bdf8", lineWidth: 2.5 },
          { title: "Focus Line x = +a", code: "x = a", color: "#fb7185", lineStyle: "dashed" },
          { title: "Focus Line x = −a", code: "x = -a", color: "#fb7185", lineStyle: "dashed" },
          { title: "Envelope y = b", code: "y = b", color: "#34d399", lineStyle: "dotted" },
        ],
        sliders: [
          { name: "a", label: "Focus a", value: 2.5, min: 0.5, max: 5.0, step: 0.1 },
          { name: "b", label: "Scale b", value: 2.65, min: 0.5, max: 5.5, step: 0.05 },
        ],
        points: [
          { x: 2.5, y: 0, label: "+a", icon: "diamond", color: "#fbbf24", locked: true },
          { x: -2.5, y: 0, label: "−a", icon: "diamond", color: "#fbbf24", locked: true },
        ],
        lines: [{ orientation: "horizontal", value: 0, label: "y = 0", color: "#94a3b8", lineStyle: "dotted", locked: true }],
        view: { xmin: -6.5, xmax: 6.5, ymin: -4.8, ymax: 4.8 },
      },
    },
    {
      title: "2D Real Continuous Parametric Butterfly & Lissajous (Non-Functions)",
      badge: "2D Real · Parametric",
      desc: "True continuous 2D parametric curves (x(t), y(t)) — no need to restrict graphs to y = f(x)! Uses both single-line `(x(t), y(t)) for t in [a, b]` and multi-line `parametric [a, b]:` C11 blocks.",
      bundle: {
        mode: "real",
        cards: [
          {
            title: "Butterfly Curve",
            code: "parametric [0, 37.6991]:\ndouble r = exp(cos(t)) - 2.0*cos(4.0*t) + pow(sin(t/12.0), 5.0);\npx = sin(t) * r * scale;\npy = cos(t) * r * scale;",
            color: "#38bdf8",
            lineWidth: 2.2,
          },
          {
            title: "Parametric Heart",
            code: "(0.22 * 16.0 * pow(sin(t), 3), 0.22 * (13.0*cos(t) - 5.0*cos(2.0*t) - 2.0*cos(3.0*t) - cos(4.0*t))) for t in [0, 2*M_PI]",
            color: "#fb7185",
            lineWidth: 2.2,
            lineStyle: "dashed",
          },
        ],
        sliders: [{ name: "scale", label: "Scale", value: 1.0, min: 0.4, max: 2.0, step: 0.05 }],
        points: [{ x: 0, y: 0, label: "Origin", icon: "dot", color: "#fbbf24", locked: true }],
        lines: [],
        view: { xmin: -5.5, xmax: 5.5, ymin: -4.2, ymax: 4.8 },
      },
    },
  ];

  const STUDIO_SHORTCUTS = [
    ["1 – 5", "Draw / Line / Circle / Rect / Polygon (available in BOTH Complex & 2D Real modes!)"],
    ["V  or  Alt+Drag", "Select, Move, Resize & Rotate unlocked shapes / points"],
    ["Ctrl/Shift + Click", "Toggle-select or DESELECT individual shapes, points, or 2D Real cell polygons"],
    ["Drag Box / Alt+Drag Box", "Marquee select (blue) or Alt+Drag marquee DESELECT (rose) multiple items"],
    ["Rotate Handle (+Shift)", "Drag circular grip above selection to rotate (Shift snaps every 15°)"],
    ["Ctrl + A  /  Escape", "Select all unlocked items / Clear selection or close popovers"],
    ["Ctrl + Z", "Undo last edit (Join, Move, Resize, Rotate, Delete, 2D Real Shapes & Polygon edits)"],
    ["Delete / Backspace", "Delete all currently selected unlocked shapes, points, or cell polygons"],
    ["Join (Dock or Sidebar)", "Weld selected or touching open paths into one continuous contour / loop"],
    ["Space  or  Right-Drag", "Pan plane (Right-click any element on any 2D graph for Color/Opacity/Width/Layer menu)"],
    ["Scroll Wheel", "Zoom plane (Shift+Scroll = X-axis, Ctrl+Scroll = Y-axis) or Riemann Sphere"],
    ["Ctrl + Enter", "Compile all C11 cards natively with clang"],
    ["Ctrl + S", "Save current custom project in-place"],
    ["P", "Play / Pause animated contour tracer"],
    ["Double-Click Splitter", "Reset sidebar width or Input/Output split"],
    ["Shift + Click Dot", "Open item color / opacity (0–100% solid) / width (down to 0) / icon / lock settings"],
  ];

  function buildGenAIPrompt(mode, userRequest, sliders, opts = {}) {
    const isReal = mode === "real";
    const includeContext = opts.includeContext !== false;
    const includeSliders = opts.includeSliders !== false;
    const includeLandmarks = opts.includeLandmarks !== false;
    const currentCards = Array.isArray(opts.currentCards) ? opts.currentCards : [];
    const currentVars = Array.isArray(opts.currentVars) ? opts.currentVars : [];

    const activeSliders =
      sliders && sliders.length > 0
        ? sliders.map((s) => `${s.name}=${s.value} [${s.min}, ${s.max}, step=${s.step}]`).join(", ")
        : "none";
    const activeVars =
      currentVars.length > 0
        ? currentVars.map((v) => `${v.name} = ${v.expr} (currently ${Number(v.value).toFixed(4)})`).join(", ")
        : "none";

    let contextSection = "";
    if (includeContext && currentCards.length > 0) {
      const cardLines = currentCards
        .map((c, i) => `  ${i + 1}. "${c.title}" (${isReal ? (c.visible ? "visible" : "hidden") : (c.isActive ? "★ ACTIVE GRAPHED" : "Aux helper")}): \`${c.code.replace(/\n/g, " ")}\``)
        .join("\n");
      contextSection = `\nCURRENT WORKSPACE CARDS (modify/extend if relevant, or replace cleanly):\n${cardLines}\n`;
    }

    const compilerSpec = isReal
      ? `C11 REAL CARD SYNTAX (clang -Wall -Wextra -Werror -Wpedantic):
- Input: double x (plus every slider/var as double). Return double (NAN for gaps). Multi-line bodies need ';', '{', or 'return'.
- Smart formats: y = f(x) | x = c | x = g(y) | LHS = RHS (implicit) | (x(t), y(t)) for t in [a, b] | parametric [a, b]: px = ...; py = ...;
- Built-ins: real_pi_exact(x), real_pi_explicit(x, K), real_li(x), real_psi_exact(x), real_psi_explicit(x, K), c_hardy_z(t), real_life_cell_at(R, gen, idx, &gx, &gy), <math.h> (sin, cos, exp, log, pow, sqrt, fabs, hypot, fmin, fmax, floor, ceil, M_PI, NAN).`
      : `C11 COMPLEX CARD SYNTAX (clang -Wall -Wextra -Werror -Wpedantic):
- Signature: fK(double complex z) (alias s = z; sliders/vars injected as double). Up to 24 cards (f1..f24 callable across cards); EXACTLY ONE card has "active": true.
- REQUIRED: use c_make(re, im) — NEVER 1.0i or I. Guard poles: if (cabs(d) < 1e-12) return c_make(INFINITY, 0.0);
- Built-ins: c_make, c_isfinite, c_zeta, c_xi, c_eta, c_zeta_deriv, c_zeta_log_deriv, c_zeta_partial(s, N), c_gamma, c_lgamma, c_ei, <complex.h> & <math.h> (cexp, clog, csin, ccos, cpow, csqrt, cabs, carg, creal, cimag, conj, hypot, M_PI).
- Branch cut on [0, +∞): use clog(-z) + c_make(0.0, M_PI) instead of clog(z).`;

    const wantContour = mode === "integral" || (!isReal && window.CFVComplex && window.CFVComplex.state && window.CFVComplex.state.contourMode);
    const exampleJson = isReal
      ? `{
  "format": "cfv_project_v1",
  "name": "Mean Value Theorem Explorer",
  "subtitle": "Interactive secant, movable tangent & guaranteed parallel tangent",
  "description": "Demonstrates Lagrange's Mean Value Theorem with live endpoints a, b and probe c.",
  "mode": "real",
  "folder": "cat_calculus",
  "cards": [
    { "title": "f(x) = x^3/4 - x + 1", "code": "0.25*x*x*x - x + 1.0", "color": "#38bdf8", "visible": true },
    { "title": "Secant [a, b]", "code": "double fa=0.25*a*a*a-a+1, fb=0.25*b*b*b-b+1; return fa + ((fb-fa)/(b-a))*(x-a);", "color": "#fbbf24", "lineStyle": "dashed", "visible": true }
  ],
  "sliders": [
    { "name": "a", "label": "Left a", "value": -1.5, "min": -2.5, "max": 0.5, "step": 0.05, "speed": 0.4 },
    { "name": "b", "label": "Right b", "value": 2.5, "min": 0.5, "max": 3.0, "step": 0.05, "speed": 0.4 }
  ],
  "vars": [],
  "points": [{ "x": -1.5, "y": 1.656, "xExpr": "a", "yExpr": "0.25*a*a*a - a + 1", "label": "a", "icon": "dot", "color": "#fbbf24", "locked": true }],
  "lines": [{ "orientation": "vertical", "value": -1.5, "valExpr": "a", "label": "x = a", "color": "#fbbf24", "lineStyle": "dotted", "locked": true }],
  "texts": [{ "title": "Mean Value Theorem", "text": "Drag a and b — locked landmarks move automatically via xExpr/yExpr/valExpr!", "anchor": "bottom-left", "color": "#38bdf8" }],
  "viewport": { "view": { "xmin": -3.5, "xmax": 3.5, "ymin": -2, "ymax": 3.5 }, "squareAspect": true },
  "presets": [
    { "id": "default", "name": "MVT View", "sliderValues": { "a": -1.5, "b": 2.5 }, "visibleFnIndices": [0, 1], "viewport": { "view": { "xmin": -3.5, "xmax": 3.5, "ymin": -2, "ymax": 3.5 }, "squareAspect": true } }
  ]
}`
      : `{
  "format": "cfv_project_v1",
  "name": "Rational Map & Contour Residue Explorer",
  "subtitle": "Unified Complex mode with Mapping, Domain Coloring & Contour Integration presets",
  "description": "Maps shapes through 1/(z^2+a^2), paints domain coloring, and verifies Cauchy's Residue Theorem.",
  "mode": "map",
  "folder": "${wantContour ? "cat_contours" : "cat_complex_analysis"}",
  "cards": [
    { "title": "f(z) = 1 / (z^2 + a^2)", "code": "double complex d = z*z + c_make(a*a, 0.0);\\nif (cabs(d) < 1e-12) return c_make(INFINITY, 0.0);\\nreturn 1.0 / d;", "color": "#38bdf8", "active": true }
  ],
  "sliders": [{ "name": "a", "label": "Pole height a", "value": 1.0, "min": 0.4, "max": 2.2, "step": 0.05, "speed": 0.4 }],
  "vars": [],
  "points": [{ "x": 0, "y": 1, "xExpr": "0", "yExpr": "a", "label": "Pole +ia", "icon": "cross", "color": "#fb7185", "locked": true }],
  "shapes": [{ "kind": "circle", "label": "Loop around +ia", "color": "#38bdf8", "closed": true, "formula": { "kind": "circle", "cx": "0", "cy": "a", "r": "0.55" } }],
  "texts": [{ "title": "Cauchy Residue Theorem", "text": "Toggle ∮ Contour to switch between mapping w=f(z) and live contour integration ∮ f(z) dz.", "anchor": "bottom-left", "plane": "in", "color": "#34d399" }],
  "viewport": { "inView": { "cx": 0, "cy": 0, "r": 3 }, "outView": { "cx": 0, "cy": 0, "r": 3 }, "inSquare": true, "outSquare": true, "contourMode": ${wantContour ? "true" : "false"}, "projection": "planar", "showDomain": false },
  "presets": [
    { "id": "contour", "name": "∮ Residue Around +ia", "sliderValues": { "a": 1.0 }, "viewport": { "inView": { "cx": 0, "cy": 0, "r": 3 }, "outView": { "cx": 0, "cy": 0, "r": 3 }, "contourMode": true } },
    { "id": "domain", "name": "Domain Coloring (Full Input)", "sliderValues": { "a": 1.0 }, "viewport": { "inView": { "cx": 0, "cy": 0, "r": 3 }, "contourMode": false, "showDomain": true, "domainScheme": "classic", "domainOpacity": 0.9 }, "layout": { "outputHidden": true } }
  ]
}`;

    const prefHints = [
      includeSliders ? "Include interactive sliders (+ speed) and computed vars where helpful." : "Keep sliders minimal.",
      includeLandmarks ? "Include clear explanation texts[], landmarks (use xExpr/yExpr/valExpr so locked items track sliders!), and shapes." : "Keep annotations concise.",
    ].join(" ");

    return `Generate one valid **C11 Function Studio Full Project JSON** (\`"format": "cfv_project_v1"\`) inside a single \`\`\`json code fence.

GOAL: ${userRequest || (isReal ? "Create a polished, educational Real project with interactive sliders, formula-linked landmarks, explanation text boxes, and 2-3 presets." : "Create a polished Complex project with C11 cards, interactive sliders, formula shapes/landmarks, explanation text boxes, and 2-3 presets.")}
MODE: "${isReal ? "real" : "map"}"${wantContour ? " (with contourMode: true)" : ""} | SLIDERS: ${activeSliders} | VARS: ${activeVars}${contextSection}
NOTES: ${prefHints}

${compilerSpec}

SCHEMA HIGHLIGHTS:
- Sliders + vars <= 16 total (never name them z, s, x, y, P, slot; avoid t in parametric Real cards).
- Dynamic viewport globals (editable via vars/sliders at 60 FPS): sphere_yaw, sphere_pitch, sphere_zoom, in_cx, in_cy, in_r, out_cx, out_cy, out_r, real_xmin, real_xmax, real_ymin, real_ymax.
- Locked elements with formulas (shape.formula, point.xExpr/yExpr, line.valExpr) STILL move live with sliders!
- Allowed formula math: pi, e, sin, cos, tan, asin, acos, atan, atan2, sinh, cosh, tanh, exp, log, log2, log10, sqrt, cbrt, hypot, abs, fabs, pow, min, max, fmin, fmax, floor, ceil, round.
- Complex viewport: contourMode (bool, per-preset!), projection ("planar"|"sphere"|"stereographic"|"poincare"|"custom"), showDomain, domainScheme ("classic"|"smooth_escape"|"inferno"|"ocean"|"neon_prism"|"grayscale"), domainOpacity (0..1), showMesh. Shape opacity=1.0 is 100% solid (lineWidth=0 for fill-only; isOcean=true for 3D globe ocean).
- Text callouts ("texts"): { title, text, anchor ("bottom-left"|"bottom-right"|"top-left"|"top-right"|"world"), plane ("in"|"out"), color, width }.
- Presets: { id, name, sliderValues, startSlider, activeFnIndex (Complex) / visibleFnIndices (Real), viewport, layout ({ sidebarCollapsed, inputHidden, outputHidden, realHidden, sidebarWidth, splitPct }), shapes/points/lines/texts }.
- Strict JSON only: no comments, no trailing commas, escape newlines in C code as \\n.

TEMPLATE:
\`\`\`json
${exampleJson}
\`\`\``;
  }

  /* -------------------------------------------------------------------------
   * Resilient Multi-Card AI Bundle Parser
   * ------------------------------------------------------------------------- */

  function parseAIOutput(rawText) {
    const text = (rawText || "").trim();
    if (!text) return { error: "Nothing to import — paste GenAI output into the terminal first." };

    /* 1. Try all fenced ```json ... ``` blocks (resilient even if prose mentions ```json earlier) */
    for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
      const candidate = (m[1] || "").trim();
      if (candidate.startsWith("{") || candidate.startsWith("[")) {
        try {
          const parsed = JSON.parse(candidate);
          return normalizeBundle(parsed, "JSON bundle (from markdown block)");
        } catch (_) {}
      }
    }

    /* 2. Try raw JSON or outermost { ... } object */
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
        if (
          parsed &&
          (parsed.format === "cfv_project_v1" ||
            parsed.cards ||
            parsed.fn ||
            parsed.baseState ||
            parsed.sliders ||
            parsed.points ||
            parsed.lines ||
            parsed.shapes ||
            parsed.presets)
        ) {
          return normalizeBundle(parsed, parsed.format === "cfv_project_v1" ? "Full Project JSON (cfv_project_v1)" : "JSON project bundle");
        }
      } catch (err) {
        if (text.startsWith("{")) {
          return { error: `Invalid JSON syntax: ${err.message}` };
        }
      }
    }

    /* 3. Try multiple fenced ```c / ```c11 / ``` blocks */
    const codeBlocks = [...text.matchAll(/```(?:c|c11|cpp|text)?\s*\n([\s\S]*?)```/gi)]
      .map((m) => m[1].trim())
      .filter((s) => s.length > 0 && !s.startsWith("{"));
    if (codeBlocks.length > 0) {
      return {
        source: `${codeBlocks.length} C code block${codeBlocks.length === 1 ? "" : "s"}`,
        bundle: {
          cards: codeBlocks.map((code, i) => ({ title: `AI Card ${i + 1}`, code })),
          sliders: [],
          points: [],
          lines: [],
          shapes: [],
        },
      };
    }

    /* 4. Plain text single C expression / block */
    return {
      source: "Single C11 expression/block",
      bundle: {
        cards: [{ title: "AI Expression", code: text }],
        sliders: [],
        points: [],
        lines: [],
        shapes: [],
      },
    };
  }

  function normalizeBundle(obj, source) {
    if (Array.isArray(obj)) {
      return {
        source,
        bundle: { cards: obj, sliders: [], vars: [], points: [], lines: [], shapes: [], presets: [] },
      };
    }
    if (!obj || typeof obj !== "object") {
      return { error: "Parsed JSON was not an object or array of cards." };
    }
    /* Support raw v:1 snapshot objects too if pasted directly */
    if (obj.v === 1 && Array.isArray(obj.fn) && window.CFVWorkspace && typeof window.CFVWorkspace.snapshotToReadableState === "function") {
      obj = window.CFVWorkspace.snapshotToReadableState(obj);
    } else if (obj.baseState && !Array.isArray(obj.cards) && window.CFVWorkspace && typeof window.CFVWorkspace.snapshotToReadableState === "function") {
      obj = { ...obj, ...window.CFVWorkspace.snapshotToReadableState(obj.baseState) };
    }
    const vp = obj.viewport || {};
    return {
      source: obj.format === "cfv_project_v1" ? "Full Project JSON (cfv_project_v1)" : source,
      bundle: {
        format: "cfv_project_v1",
        id: obj.id || null,
        name: obj.name || obj.title || null,
        subtitle: obj.subtitle || null,
        mode: obj.mode || null,
        splitPct: obj.splitPct,
        cards: Array.isArray(obj.cards) ? obj.cards : [],
        sliders: Array.isArray(obj.sliders) ? obj.sliders : [],
        vars: Array.isArray(obj.vars) ? obj.vars : [],
        points: Array.isArray(obj.points) ? obj.points : [],
        lines: Array.isArray(obj.lines) ? obj.lines : [],
        shapes: Array.isArray(obj.shapes) ? obj.shapes : [],
        seedCells: Array.isArray(obj.seedCells) ? obj.seedCells : (Array.isArray(obj.polygons) ? obj.polygons : null),
        viewport: {
          ...vp,
          ...(obj.view ? { view: obj.view } : {}),
          ...(obj.inView ? { inView: obj.inView } : {}),
          ...(obj.outView ? { outView: obj.outView } : {}),
          ...(obj.inSquare !== undefined ? { inSquare: obj.inSquare } : {}),
          ...(obj.outSquare !== undefined ? { outSquare: obj.outSquare } : {}),
          ...(obj.showSphere !== undefined ? { showSphere: obj.showSphere } : {}),
          ...(obj.sphereView ? { sphereView: obj.sphereView } : {}),
          ...(obj.squareAspect !== undefined ? { squareAspect: obj.squareAspect } : {}),
        },
        view: obj.view || vp.view || null,
        inView: obj.inView || vp.inView || null,
        outView: obj.outView || vp.outView || null,
        presets: Array.isArray(obj.presets) ? obj.presets : [],
      },
    };
  }

  function sampleBundleForMode(mode) {
    const rec = COOKBOOK_RECIPES.find((r) => r.bundle && r.bundle.mode === mode) || COOKBOOK_RECIPES[0];
    const fullProj = {
      format: "cfv_project_v1",
      name: rec.title,
      subtitle: rec.desc.slice(0, 90),
      ...rec.bundle,
      viewport: rec.bundle.mode === "real"
        ? { view: rec.bundle.view || { xmin: -10, xmax: 10, ymin: -10, ymax: 10 }, squareAspect: true }
        : {
            inView: rec.bundle.inView || { cx: 0, cy: 0, r: 4 },
            outView: rec.bundle.outView || { cx: 0, cy: 0, r: 4 },
            inSquare: true,
            outSquare: true,
            showSphere: false,
            sphereView: { yaw: -0.58, pitch: 0.22, zoom: 1.0 },
          },
      presets: [
        {
          id: "default_view",
          name: "Default 1:1 View",
          viewport: rec.bundle.mode === "real"
            ? { view: rec.bundle.view || { xmin: -10, xmax: 10, ymin: -10, ymax: 10 }, squareAspect: true }
            : {
                inView: rec.bundle.inView || { cx: 0, cy: 0, r: 4 },
                outView: rec.bundle.outView || { cx: 0, cy: 0, r: 4 },
                inSquare: true,
                outSquare: true,
                showSphere: false,
              },
        },
      ],
    };
    return JSON.stringify(fullProj, null, 2);
  }

  function summarizeParsedBundle(res, fallbackMode) {
    if (!res || res.error) return { ok: false, text: res ? `✗ ${res.error}` : "" };
    const b = res.bundle;
    const mode = b.mode || fallbackMode || "map";
    const isReal = mode === "real";
    const cardCount = b.cards.length;
    const activeCard = !isReal
      ? (b.cards.find((c) => typeof c === "object" && c.active === true) || b.cards[b.cards.length - 1])
      : null;
    const lockedCount =
      (b.points || []).filter((p) => p.locked).length +
      (b.lines || []).filter((l) => l.locked).length +
      (b.shapes || []).filter((s) => s.locked).length;
    const parts = [
      `✓ ${b.name ? `"${b.name}"` : res.source}`,
      `mode=${mode}`,
      `${cardCount} card${cardCount === 1 ? "" : "s"}` + (activeCard && activeCard.title ? ` (★ ${activeCard.title})` : isReal ? " (all graphed)" : ""),
    ];
    if (b.sliders.length) parts.push(`${b.sliders.length} slider${b.sliders.length === 1 ? "" : "s"} (${b.sliders.map((s) => s.name).join(",")})`);
    if (b.vars && b.vars.length) parts.push(`${b.vars.length} var${b.vars.length === 1 ? "" : "s"} (${b.vars.map((v) => v.name).join(",")})`);
    if (b.shapes.length) parts.push(`${b.shapes.length} shape${b.shapes.length === 1 ? "" : "s"}`);
    if (b.seedCells && b.seedCells.length) parts.push(`${b.seedCells.length} seed cells`);
    if (b.points.length || b.lines.length) parts.push(`${b.points.length} pt / ${b.lines.length} line (${lockedCount} locked)`);
    if (b.presets && b.presets.length) parts.push(`${b.presets.length} preset${b.presets.length === 1 ? "" : "s"}`);
    return { ok: true, text: parts.join(" · ") };
  }

  function initDocsModal() {
    const modal = document.getElementById("docs-modal");
    const docsSearch = document.getElementById("docs-search");
    const docsCatPills = document.getElementById("docs-cat-pills");
    const docsList = document.getElementById("docs-list");
    const docsCookbook = document.getElementById("docs-cookbook");
    const promptGoal = document.getElementById("prompt-goal");
    const promptPreview = document.getElementById("prompt-preview");
    const promptIdeas = document.getElementById("prompt-ideas");
    const optContext = document.getElementById("prompt-opt-context");
    const optSliders = document.getElementById("prompt-opt-sliders");
    const optLandmarks = document.getElementById("prompt-opt-landmarks");
    const btnCopyPrompt = document.getElementById("btn-copy-prompt");
    const termInput = document.getElementById("ai-terminal-input");
    const termPreview = document.getElementById("ai-terminal-preview");
    const termLog = document.getElementById("ai-terminal-log");

    let activeCategory = "all";

    function activeMode() {
      return window.CFVWorkspace ? window.CFVWorkspace.state.mode : "map";
    }

    function switchTab(target) {
      document.querySelectorAll("[data-docs-tab]").forEach((t) => t.classList.toggle("active", t.dataset.docsTab === target));
      document.querySelectorAll("[data-docs-pane]").forEach((p) => p.classList.toggle("hidden", p.dataset.docsPane !== target));
      if (target === "prompt") refreshPrompt();
      if (target === "terminal") updateTerminalPreview();
      if (target === "reference") { renderCategoryPills(); renderDocs(docsSearch.value); }
      if (target === "cookbook") renderCookbook();
    }

    function renderCategoryPills() {
      if (!docsCatPills) return;
      docsCatPills.innerHTML = "";
      const cats = [{ id: "all", label: "All Categories" }, ...DOC_GROUPS.map((g) => ({ id: g.id, label: g.category }))];
      for (const c of cats) {
        const b = document.createElement("button");
        b.className = "docs-cat-pill" + (activeCategory === c.id ? " active" : "");
        b.textContent = c.label;
        b.addEventListener("click", () => {
          activeCategory = c.id;
          renderCategoryPills();
          renderDocs(docsSearch.value);
        });
        docsCatPills.appendChild(b);
      }
    }

    function renderDocs(filter = "") {
      const q = filter.trim().toLowerCase();
      docsList.innerHTML = "";
      let totalMatches = 0;

      for (const grp of DOC_GROUPS) {
        if (activeCategory !== "all" && grp.id !== activeCategory) continue;
        const matches = grp.items.filter(
          (it) =>
            !q ||
            it.sig.toLowerCase().includes(q) ||
            it.desc.toLowerCase().includes(q) ||
            (it.notes && it.notes.toLowerCase().includes(q)) ||
            it.example.toLowerCase().includes(q) ||
            grp.category.toLowerCase().includes(q)
        );
        if (matches.length === 0) continue;
        totalMatches += matches.length;

        const h = document.createElement("div");
        h.className = "doc-cat-title";
        h.textContent = grp.category;
        docsList.appendChild(h);

        for (const it of matches) {
          const card = document.createElement("div");
          card.className = "doc-item";
          const modeLabel = it.mode === "real" ? "2D Real" : it.mode === "both" ? "All Modes" : "Complex / Integral";
          const badgeCls = it.mode === "real" ? "doc-badge real" : it.mode === "both" ? "doc-badge both" : "doc-badge";
          card.innerHTML = `
            <div class="doc-item-top">
              <code class="doc-sig">${it.sig}</code>
              <div class="doc-item-btns">
                <button class="doc-mini-btn" data-act="copy">Copy</button>
                <button class="doc-mini-btn accent" data-act="insert">+ Card</button>
              </div>
            </div>
            <div class="doc-desc">${it.desc}</div>
            <div class="doc-meta-row">
              <span class="${badgeCls}">${modeLabel}</span>
              ${it.notes ? `<span>${it.notes}</span>` : ""}
            </div>
          `;
          card.querySelector('[data-act="copy"]').addEventListener("click", async (ev) => {
            try {
              await navigator.clipboard.writeText(it.example);
              ev.target.textContent = "Copied!";
              setTimeout(() => (ev.target.textContent = "Copy"), 1200);
            } catch (_) {}
          });
          card.querySelector('[data-act="insert"]').addEventListener("click", () => {
            if (window.CFVWorkspace) {
              window.CFVWorkspace.addFunctionCard(it.example, it.example.split("\n")[0].slice(0, 32));
              modal.classList.add("hidden");
            }
          });
          docsList.appendChild(card);
        }
      }

      if (totalMatches === 0) {
        const empty = document.createElement("div");
        empty.style.cssText = "padding:14px;color:#64748b;font-size:12px;";
        empty.textContent = `No C11 API entries matched "${filter}".`;
        docsList.appendChild(empty);
      }
    }

    function renderCookbook() {
      if (!docsCookbook) return;
      docsCookbook.innerHTML = "";

      const h1 = document.createElement("div");
      h1.className = "doc-cat-title";
      h1.textContent = "1-Click Multi-Card Recipes";
      docsCookbook.appendChild(h1);

      for (const rec of COOKBOOK_RECIPES) {
        const card = document.createElement("div");
        card.className = "doc-item";
        const previewLines = rec.bundle.cards
          .map((c, i) => `f${i + 1}: ${c.title}${rec.bundle.mode !== "real" ? (c.active ? " [★ Graphed]" : " [Aux]") : ""} -> ${c.code.split("\n")[0]}`)
          .join("\n");
        card.innerHTML = `
          <div class="doc-item-top">
            <strong style="color:#f8fafc;font-size:12.5px;">${rec.title}</strong>
            <div class="doc-item-btns">
              <button class="doc-mini-btn" data-act="copy-json">Copy JSON</button>
              <button class="doc-mini-btn accent" data-act="load-recipe">Load Recipe</button>
            </div>
          </div>
          <div class="doc-desc">${rec.desc}</div>
          <div class="doc-meta-row"><span class="doc-badge ${rec.bundle.mode === "real" ? "real" : ""}">${rec.badge}</span></div>
          <pre class="doc-code-preview">${previewLines}</pre>
        `;
        card.querySelector('[data-act="copy-json"]').addEventListener("click", async (ev) => {
          try {
            await navigator.clipboard.writeText(JSON.stringify(rec.bundle, null, 2));
            ev.target.textContent = "Copied!";
            setTimeout(() => (ev.target.textContent = "Copy JSON"), 1200);
          } catch (_) {}
        });
        card.querySelector('[data-act="load-recipe"]').addEventListener("click", () => {
          if (!window.CFVWorkspace) return;
          const run = async () => {
            await window.CFVWorkspace.importAIBundle(rec.bundle, true);
            modal.classList.add("hidden");
          };
          if (typeof window.CFVWorkspace.guardNavigation === "function") {
            window.CFVWorkspace.guardNavigation(run);
          } else {
            run();
          }
        });
        docsCookbook.appendChild(card);
      }

      const h2 = document.createElement("div");
      h2.className = "doc-cat-title";
      h2.textContent = "Keyboard Shortcuts & Studio Controls";
      docsCookbook.appendChild(h2);

      const grid = document.createElement("div");
      grid.className = "shortcuts-grid";
      for (const [key, desc] of STUDIO_SHORTCUTS) {
        const row = document.createElement("div");
        row.className = "shortcut-row";
        row.innerHTML = `<span>${desc}</span><kbd class="shortcut-key">${key}</kbd>`;
        grid.appendChild(row);
      }
      docsCookbook.appendChild(grid);
    }

    function refreshPrompt() {
      const mode = activeMode();
      const ws = window.CFVWorkspace;
      const sliders = ws ? ws.getSliders() : [];
      const currentCards = ws
        ? ws.state.cards
            .filter((c) => c.kind === "fn")
            .map((c) => ({
              title: c.title,
              code: c.code,
              visible: c.visible,
              isActive: c.id === ws.state.primaryCardId,
            }))
        : [];

      promptPreview.value = buildGenAIPrompt(mode, promptGoal.value.trim(), sliders, {
        includeContext: optContext ? optContext.checked : true,
        includeSliders: optSliders ? optSliders.checked : true,
        includeLandmarks: optLandmarks ? optLandmarks.checked : true,
        currentCards,
        currentVars: ws && ws.getVars ? ws.getVars() : [],
      });

      const modeNote = document.getElementById("prompt-mode-note");
      if (modeNote) {
        if (mode === "real") {
          modeNote.innerHTML =
            "<strong>2D Real Mode:</strong> Curves do <strong>not</strong> need to be functions! Supports continuous <strong>parametric curves</strong> (<code>(x(t), y(t)) for t in [a,b]</code> or multi-line <code>parametric [a,b]:</code> for cursive names/drawings), <code>LHS=RHS</code>, <code>x=c</code>, <code>x=g(y)</code>, and <code>y=f(x)</code> — all visible cards graph simultaneously.";
        } else if (mode === "integral") {
          modeNote.innerHTML =
            "<strong>Contour Integral &amp; Residue Theory Mode:</strong> Ask for <strong>multi-piece slider-driven contours</strong> (Pac-Man / keyhole, indented semicircle, dogbone, box, wedge) using <code>formula</code> shapes — every piece evaluates individually on the right alongside their sum, and <code>clog(-z) + iπ</code> branch-cut rules are built right into the prompt!";
        } else {
          modeNote.innerHTML =
            "<strong>Complex Map Mode:</strong> GenAI can define multiple <strong>auxiliary helper cards</strong> (<code>f1(z)</code>, <code>f2(z)</code>, …) with <strong>exactly one active graphed card</strong> (<code>\"active\": true</code>). Locked landmarks stay strictly on the Input Plane.";
        }
      }

      const ideas = PROMPT_IDEAS[mode] || PROMPT_IDEAS.map;
      promptIdeas.innerHTML = "";
      for (const idea of ideas) {
        const b = document.createElement("button");
        b.className = "snippet-btn";
        b.textContent = idea;
        b.addEventListener("click", () => {
          promptGoal.value = idea;
          refreshPrompt();
        });
        promptIdeas.appendChild(b);
      }
    }

    function updateTerminalPreview() {
      if (!termPreview) return;
      const raw = termInput.value.trim();
      if (!raw) {
        termPreview.classList.remove("err");
        termPreview.textContent = "Paste a JSON bundle or C snippet above for instant validation & card breakdown.";
        return;
      }
      const res = parseAIOutput(raw);
      const sum = summarizeParsedBundle(res, activeMode());
      termPreview.classList.toggle("err", !sum.ok);
      termPreview.textContent = sum.text;
    }

    function loadJsonIntoTerminal(jsonStr, logMsg = "") {
      if (!termInput) return;
      termInput.value = jsonStr || "";
      updateTerminalPreview();
      if (termLog && logMsg) {
        termLog.classList.remove("err");
        termLog.textContent = logMsg;
      }
    }

    async function executeImport(replace, opts = {}) {
      const res = parseAIOutput(termInput.value);
      if (res.error) {
        termLog.classList.add("err");
        termLog.textContent = `✗ ${res.error}`;
        return;
      }
      termLog.classList.remove("err");
      const b = res.bundle;
      const lines = [
        `> Parsed ${res.source}${b.name ? ` ("${b.name}")` : ""}`,
        `> Cards: ${b.cards.length} | Sliders: ${b.sliders.length} | Vars: ${(b.vars || []).length} | Shapes: ${b.shapes.length} | Presets: ${(b.presets || []).length}`,
        `> Applying (${opts.saveToRepo ? "import project & save to repo projects/" : replace ? "import full project" : "append cards"}) & compiling C11...`,
      ];
      termLog.textContent = lines.join("\n");

      if (!window.CFVWorkspace || typeof window.CFVWorkspace.importAIBundle !== "function") {
        termLog.classList.add("err");
        termLog.textContent += "\n✗ Workspace importer unavailable.";
        return;
      }
      const outcome = await window.CFVWorkspace.importAIBundle(b, replace, opts);
      if (outcome.ok) {
        termLog.classList.remove("err");
        termLog.textContent += `\n✓ ${outcome.message}${opts.saveToRepo ? " · Saved to projects/" : ""}`;
        setTimeout(() => modal.classList.add("hidden"), 650);
      } else {
        termLog.classList.add("err");
        termLog.textContent += `\n✗ ${outcome.message}`;
      }
    }

    function runImport(replace, opts = {}) {
      if (replace && window.CFVWorkspace && typeof window.CFVWorkspace.guardNavigation === "function") {
        window.CFVWorkspace.guardNavigation(() => executeImport(true, opts));
      } else {
        executeImport(replace, opts);
      }
    }

    document.querySelectorAll("[data-docs-tab]").forEach((tab) => {
      tab.addEventListener("click", () => switchTab(tab.dataset.docsTab));
    });

    docsSearch.addEventListener("input", () => renderDocs(docsSearch.value));
    promptGoal.addEventListener("input", refreshPrompt);
    if (optContext) optContext.addEventListener("change", refreshPrompt);
    if (optSliders) optSliders.addEventListener("change", refreshPrompt);
    if (optLandmarks) optLandmarks.addEventListener("change", refreshPrompt);
    termInput.addEventListener("input", updateTerminalPreview);

    btnCopyPrompt.addEventListener("click", async () => {
      refreshPrompt();
      try {
        await navigator.clipboard.writeText(promptPreview.value);
        btnCopyPrompt.textContent = "✓ Prompt Copied! Paste into any GenAI";
      } catch (_) {
        promptPreview.select();
        document.execCommand("copy");
        btnCopyPrompt.textContent = "✓ Selected & Copied";
      }
      setTimeout(() => {
        btnCopyPrompt.textContent = "Copy Full-Project GenAI Prompt";
      }, 2200);
    });

    document.getElementById("btn-goto-terminal").addEventListener("click", () => switchTab("terminal"));

    const btnUploadTerm = document.getElementById("btn-upload-terminal-json");
    const termFileIn = document.getElementById("terminal-file-input");
    if (btnUploadTerm && termFileIn) {
      btnUploadTerm.addEventListener("click", () => termFileIn.click());
      termFileIn.addEventListener("change", () => {
        const f = termFileIn.files && termFileIn.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          loadJsonIntoTerminal(
            String(reader.result || ""),
            `✓ Loaded "${f.name}" from disk. Click Import Project & Compile or Import & Save to My Projects!`
          );
          termFileIn.value = "";
        };
        reader.readAsText(f);
      });
    }

    const btnExportCur = document.getElementById("btn-export-current-json");
    if (btnExportCur) {
      btnExportCur.addEventListener("click", () => {
        if (!window.CFVWorkspace || typeof window.CFVWorkspace.exportProjectJSON !== "function") return;
        const jsonStr = window.CFVWorkspace.exportProjectJSON();
        loadJsonIntoTerminal(
          jsonStr,
          "✓ Serialized active project into Full Project JSON (cfv_project_v1). Click Copy JSON or Download .json!"
        );
      });
    }

    const btnCopyTerm = document.getElementById("btn-copy-terminal-json");
    if (btnCopyTerm) {
      btnCopyTerm.addEventListener("click", async () => {
        if (!termInput.value.trim() && window.CFVWorkspace && typeof window.CFVWorkspace.exportProjectJSON === "function") {
          loadJsonIntoTerminal(window.CFVWorkspace.exportProjectJSON(), "Exported current project JSON.");
        }
        try {
          await navigator.clipboard.writeText(termInput.value);
          btnCopyTerm.textContent = "✓ Copied!";
        } catch (_) {
          termInput.select();
          document.execCommand("copy");
          btnCopyTerm.textContent = "✓ Copied!";
        }
        setTimeout(() => {
          btnCopyTerm.textContent = "Copy JSON";
        }, 1600);
      });
    }

    const btnDownloadTerm = document.getElementById("btn-download-terminal-json");
    if (btnDownloadTerm) {
      btnDownloadTerm.addEventListener("click", () => {
        if (!termInput.value.trim() && window.CFVWorkspace && typeof window.CFVWorkspace.exportProjectJSON === "function") {
          loadJsonIntoTerminal(window.CFVWorkspace.exportProjectJSON(), "Exported current project JSON.");
        }
        const raw = termInput.value.trim();
        if (!raw) return;
        let slug = "cfv_project";
        try {
          const obj = JSON.parse(raw);
          if (obj && obj.name) {
            slug = String(obj.name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "cfv_project";
          }
        } catch (_) {}
        const blob = new Blob([raw], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${slug}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    }

    document.getElementById("btn-load-sample-bundle").addEventListener("click", () => {
      termInput.value = sampleBundleForMode(activeMode());
      updateTerminalPreview();
      termLog.classList.remove("err");
      termLog.textContent = `Loaded sample Full Project JSON for ${activeMode()} mode. Click Import Project & Compile!`;
    });
    const btnSampleInt = document.getElementById("btn-load-sample-integral");
    if (btnSampleInt) {
      btnSampleInt.addEventListener("click", () => {
        termInput.value = sampleBundleForMode("integral");
        updateTerminalPreview();
        termLog.classList.remove("err");
        termLog.textContent = "Loaded Contour Integral Full Project JSON sample.";
      });
    }
    const btnSampleReal = document.getElementById("btn-load-sample-real");
    if (btnSampleReal) {
      btnSampleReal.addEventListener("click", () => {
        termInput.value = sampleBundleForMode("real");
        updateTerminalPreview();
        termLog.classList.remove("err");
        termLog.textContent = "Loaded 2D Real Full Project JSON sample.";
      });
    }
    document.getElementById("btn-ai-import-replace").addEventListener("click", () => runImport(true, { saveToRepo: false }));
    const btnImportSaveRepo = document.getElementById("btn-ai-import-save-repo");
    if (btnImportSaveRepo) {
      btnImportSaveRepo.addEventListener("click", () => runImport(true, { saveToRepo: true }));
    }
    document.getElementById("btn-ai-import-append").addEventListener("click", () => runImport(false));
    document.getElementById("btn-ai-import-clear").addEventListener("click", () => {
      termInput.value = "";
      updateTerminalPreview();
      termLog.classList.remove("err");
      termLog.textContent = "Cleared. Paste Full Project JSON above or click ⤓ Load Current Project JSON.";
    });

    window.CFVDocs.loadJsonIntoTerminal = loadJsonIntoTerminal;

    document.getElementById("btn-open-docs").addEventListener("click", () => {
      const opening = modal.classList.contains("hidden");
      modal.classList.toggle("hidden");
      if (opening) {
        renderCategoryPills();
        renderDocs(docsSearch.value);
        renderCookbook();
        refreshPrompt();
        updateTerminalPreview();
      }
    });

    document.getElementById("btn-close-docs").addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });
  }

  window.CFVDocs = {
    init: initDocsModal,
    buildGenAIPrompt,
    parseAIOutput,
    summarizeParsedBundle,
    recipes: COOKBOOK_RECIPES,
    groups: DOC_GROUPS,
  };
})();
