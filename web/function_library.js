(() => {
  "use strict";

  /*
   * Prewritten Function Libraries (Strictly Separated: Complex Analysis vs. 2D Real)
   * + Human-Friendly Strict C11 Syntax Guide for the Function Writing Section
   */

  const COMPLEX_FUNCTIONS = [
    /* Analytic Number Theory & Special Functions */
    { cat: "Analytic & Special", name: "Riemann Zeta ζ(s)", expr: "c_zeta(s)", desc: "Full analytic continuation across ℂ \\ {1}" },
    { cat: "Analytic & Special", name: "Completed Zeta ξ(s)", expr: "c_xi(s)", desc: "Entire symmetric functional-equation zeta" },
    { cat: "Analytic & Special", name: "Dirichlet Eta η(s)", expr: "c_eta(s)", desc: "Alternating entire zeta (1 − 2^(1−s))ζ(s)" },
    { cat: "Analytic & Special", name: "Zeta Derivative ζ'(s)", expr: "c_zeta_deriv(s)", desc: "4th-order complex derivative of ζ(s)" },
    { cat: "Analytic & Special", name: "Zeta Log-Deriv ζ'(s)/ζ(s)", expr: "c_zeta_log_deriv(s)", desc: "Argument Principle zero/pole counter" },
    { cat: "Analytic & Special", name: "Dirichlet Partial Sum S₂₀(s)", expr: "c_zeta_partial(s, 20)", desc: "Truncated sum Σ_{n=1}^{20} n^(−s)" },
    { cat: "Analytic & Special", name: "Euler Gamma Γ(z)", expr: "c_gamma(z)", desc: "Meromorphic factorial with poles at 0, −1, −2, …" },
    { cat: "Analytic & Special", name: "Log-Gamma ln Γ(z)", expr: "c_lgamma(z)", desc: "Principal complex log-Gamma via Lanczos" },
    { cat: "Analytic & Special", name: "Exponential Integral Ei(z)", expr: "c_ei(z)", desc: "Complex exponential integral off (−∞, 0]" },
    { cat: "Analytic & Special", name: "Euler Beta B(z, 2)", expr: "c_gamma(z) * c_gamma(c_make(2.0, 0.0)) / c_gamma(z + c_make(2.0, 0.0))", desc: "Γ(z)Γ(2)/Γ(z+2) = 1/(z(z+1))" },
    { cat: "Analytic & Special", name: "Reciprocal Gamma 1/Γ(z)", expr: "c_make(1.0, 0.0) / c_gamma(z)", desc: "Entire function with zeros at 0, −1, −2, …" },

    /* Conformal Maps & Möbius Transformations */
    { cat: "Conformal & Möbius", name: "Identity w = z", expr: "z", desc: "Trivial identity map" },
    { cat: "Conformal & Möbius", name: "Inversion w = 1/z", expr: "cabs(z) < 1e-12 ? c_make(INFINITY, 0.0) : c_make(1.0, 0.0) / z", desc: "Maps circles/lines through 0 ↔ lines/circles" },
    { cat: "Conformal & Möbius", name: "Cayley Transform (z−i)/(z+i)", expr: "(z - c_make(0.0, 1.0)) / (z + c_make(0.0, 1.0))", desc: "Conformal map: upper half-plane → unit disk" },
    { cat: "Conformal & Möbius", name: "Inverse Cayley i(1+z)/(1−z)", expr: "c_make(0.0, 1.0) * (c_make(1.0, 0.0) + z) / (c_make(1.0, 0.0) - z)", desc: "Unit disk → upper half-plane" },
    { cat: "Conformal & Möbius", name: "Joukowsky Airfoil z + 1/z", expr: "cabs(z) < 1e-12 ? c_make(INFINITY, 0.0) : z + c_make(1.0, 0.0) / z", desc: "Maps off-center circles to aerodynamic airfoils" },
    { cat: "Conformal & Möbius", name: "Koebe Function z/(1−z)²", expr: "z / ((c_make(1.0, 0.0) - z) * (c_make(1.0, 0.0) - z))", desc: "Extremal univalent slit map of the unit disk" },
    { cat: "Conformal & Möbius", name: "Blaschke Factor (z−0.5)/(1−0.5z)", expr: "(z - c_make(0.5, 0.0)) / (c_make(1.0, 0.0) - c_make(0.5, 0.0) * z)", desc: "Disk automorphism fixing |z| = 1" },
    { cat: "Conformal & Möbius", name: "Squaring Map z²", expr: "z * z", desc: "Doubles angles at origin; double cover" },
    { cat: "Conformal & Möbius", name: "Cubing Map z³", expr: "z * z * z", desc: "Triples angles; 3-fold ramified cover" },
    { cat: "Conformal & Möbius", name: "Principal Square Root √z", expr: "csqrt(z)", desc: "Halves angles; branch cut on (−∞, 0]" },
    { cat: "Conformal & Möbius", name: "Complex Exponential e^z", expr: "cexp(z)", desc: "Maps horizontal strips to sectors, grid → polar" },
    { cat: "Conformal & Möbius", name: "Principal Logarithm ln(z)", expr: "clog(z)", desc: "Maps polar rings/rays to Cartesian rectangles" },

    /* Trigonometric & Hyperbolic */
    { cat: "Trig & Hyperbolic", name: "Complex Sine sin(z)", expr: "csin(z)", desc: "Periodic conformal map with zeros at kπ" },
    { cat: "Trig & Hyperbolic", name: "Complex Cosine cos(z)", expr: "ccos(z)", desc: "Confocal ellipses & hyperbolas" },
    { cat: "Trig & Hyperbolic", name: "Complex Tangent tan(z)", expr: "ctan(z)", desc: "Simple poles at (k + ½)π" },
    { cat: "Trig & Hyperbolic", name: "Complex Cosecant 1/sin(z)", expr: "c_make(1.0, 0.0) / csin(z)", desc: "Simple poles at all integer multiples of π" },
    { cat: "Trig & Hyperbolic", name: "Hyperbolic Sine sinh(z)", expr: "csinh(z)", desc: "90°-rotated sine map" },
    { cat: "Trig & Hyperbolic", name: "Hyperbolic Cosine cosh(z)", expr: "ccosh(z)", desc: "Maps vertical lines to confocal ellipses" },
    { cat: "Trig & Hyperbolic", name: "Hyperbolic Tangent tanh(z)", expr: "ctanh(z)", desc: "Poles along imaginary axis at i(k+½)π" },
    { cat: "Trig & Hyperbolic", name: "Inverse Sine asin(z)", expr: "casin(z)", desc: "Branch cuts on (−∞, −1] and [1, ∞)" },
    { cat: "Trig & Hyperbolic", name: "Inverse Tangent atan(z)", expr: "catan(z)", desc: "Logarithmic branch points at ±i" },

    /* Singularities, Poles & Fractals */
    { cat: "Singularities & Fractals", name: "Essential Singularity e^(1/z)", expr: "cabs(z) < 1e-12 ? c_make(INFINITY, 0.0) : cexp(c_make(1.0, 0.0) / z)", desc: "Picard's Great Theorem: hits every w ≠ 0 infinitely often" },
    { cat: "Singularities & Fractals", name: "Simple Poles 1/(z²+1)", expr: "c_make(1.0, 0.0) / (z * z + c_make(1.0, 0.0))", desc: "Simple poles at +i (Res = −i/2) and −i (Res = +i/2)" },
    { cat: "Singularities & Fractals", name: "Branch Cut Dipole ln((z−1)/(z+1))", expr: "clog((z - c_make(1.0, 0.0)) / (z + c_make(1.0, 0.0)))", desc: "Finite branch cut segment [−1, 1]" },
    { cat: "Singularities & Fractals", name: "Complex Gaussian e^(−z²)", expr: "cexp(-(z * z))", desc: "Saddle at 0; rapid decay on ℝ, growth on iℝ" },
    { cat: "Singularities & Fractals", name: "Newton Cubic Step z − (z³−1)/(3z²)", expr: "z - (z * z * z - c_make(1.0, 0.0)) / (c_make(3.0, 0.0) * z * z)", desc: "Single Newton-Raphson iteration for z³ = 1" },
    {
      cat: "Singularities & Fractals",
      name: "Mandelbrot Smooth Escape Field",
      expr: "double complex c = z, w = c_make(0.0, 0.0);\nint max_it = 180;\nfor (int k = 0; k < max_it; k++) {\n  w = w * w + c;\n  double r2 = creal(w) * creal(w) + cimag(w) * cimag(w);\n  if (r2 > 256.0) {\n    double nu = (double)k + 1.0 - log2(0.5 * log2(r2));\n    return c_make(nu, 0.0);\n  }\n}\nreturn c_make(-1.0, 0.0);",
      desc: "Smooth escape count ν for Mandelbrot (use Mandelbrot Smooth color scheme!)",
    },
    {
      cat: "Singularities & Fractals",
      name: "Burning Ship Smooth Escape Field",
      expr: "double cr = creal(z), ci = -cimag(z);\ndouble xr = 0.0, xi = 0.0;\nfor (int k = 0; k < 180; k++) {\n  double ax = fabs(xr), ay = fabs(xi);\n  double nx = ax * ax - ay * ay + cr;\n  double ny = 2.0 * ax * ay + ci;\n  xr = nx; xi = ny;\n  double r2 = xr * xr + xi * xi;\n  if (r2 > 256.0) {\n    return c_make((double)k + 1.0 - log2(0.5 * log2(r2)), 0.0);\n  }\n}\nreturn c_make(-1.0, 0.0);",
      desc: "Burning Ship fractal escape field (pair with Inferno or Mandelbrot Smooth)",
    },
    {
      cat: "Singularities & Fractals",
      name: "Julia Set (c = −0.745 + 0.186i)",
      expr: "double complex w = z, c = c_make(-0.745, 0.186);\nfor (int k = 0; k < 180; k++) {\n  w = w * w + c;\n  double r2 = creal(w) * creal(w) + cimag(w) * cimag(w);\n  if (r2 > 256.0) {\n    return c_make((double)k + 1.0 - log2(0.5 * log2(r2)), 0.0);\n  }\n}\nreturn c_make(-1.0, 0.0);",
      desc: "Douady-style spiral Julia set smooth coloring field",
    },
  ];

  const REAL_FUNCTIONS = [
    /* Trigonometric & Waves */
    { cat: "Trig & Waves", name: "Sine y = sin(x)", expr: "sin(x)", desc: "Standard sine wave" },
    { cat: "Trig & Waves", name: "Cosine y = cos(x)", expr: "cos(x)", desc: "Standard cosine wave" },
    { cat: "Trig & Waves", name: "Tangent y = tan(x)", expr: "tan(x)", desc: "Tangent with vertical asymptotes at (k+½)π" },
    { cat: "Trig & Waves", name: "Sinc Wave sin(x)/x", expr: "fabs(x) < 1e-9 ? 1.0 : sin(x) / x", desc: "Cardinal sine wave (Fourier transform of box)" },
    { cat: "Trig & Waves", name: "Damped Harmonic e^(−0.15|x|)sin(3x)", expr: "exp(-0.15 * fabs(x)) * sin(3.0 * x)", desc: "Exponentially decaying oscillation" },
    { cat: "Trig & Waves", name: "Linear Chirp sin(x²)", expr: "sin(x * x)", desc: "Frequency increases linearly with |x|" },
    { cat: "Trig & Waves", name: "Acoustic Beats cos(4x) + cos(4.4x)", expr: "cos(4.0 * x) + cos(4.4 * x)", desc: "Superposition of two nearby frequencies" },
    { cat: "Trig & Waves", name: "Fourier Square Wave (11 terms)", expr: "double s = 0.0;\nfor (int k = 1; k <= 21; k += 2) s += sin((double)k * x) / (double)k;\nreturn (4.0 / M_PI) * s;", desc: "Odd-harmonic Fourier synthesis showing Gibbs phenomenon" },
    { cat: "Trig & Waves", name: "Fourier Sawtooth Wave (12 terms)", expr: "double s = 0.0;\nfor (int k = 1; k <= 12; k++) s += ((k % 2 ? 1.0 : -1.0) / (double)k) * sin((double)k * x);\nreturn (2.0 / M_PI) * s;", desc: "Sawtooth Fourier series approximation" },

    /* Algebraic, Exp, Log & Probability */
    { cat: "Algebraic & Exp", name: "Gaussian Bell e^(−x²)", expr: "exp(-x * x)", desc: "Normal distribution bell curve" },
    { cat: "Algebraic & Exp", name: "Logistic Sigmoid 1/(1+e^(−x))", expr: "1.0 / (1.0 + exp(-x))", desc: "Smooth S-curve activation function" },
    { cat: "Algebraic & Exp", name: "Softplus ln(1 + e^x)", expr: "log(1.0 + exp(x))", desc: "Smooth ReLU approximation" },
    { cat: "Algebraic & Exp", name: "Lorentzian / Witch 4/(1+x²)", expr: "4.0 / (1.0 + x * x)", desc: "Cauchy distribution / Witch of Agnesi" },
    { cat: "Algebraic & Exp", name: "Cubic Polynomial x³ − 3x", expr: "x * x * x - 3.0 * x", desc: "Local extrema at x = ±1" },
    { cat: "Algebraic & Exp", name: "Hyperbolic Catenary cosh(x)", expr: "cosh(x)", desc: "Ideal hanging chain curve" },
    { cat: "Algebraic & Exp", name: "Hyperbolic Tangent tanh(x)", expr: "tanh(x)", desc: "Maps ℝ smoothly onto (−1, 1)" },
    { cat: "Algebraic & Exp", name: "Error Function erf(x)", expr: "erf(x)", desc: "Gauss error function (integral of Gaussian)" },
    { cat: "Algebraic & Exp", name: "Real Gamma Γ(x)", expr: "tgamma(x)", desc: "C11 real Gamma function with poles at 0, −1, −2, …" },
    { cat: "Algebraic & Exp", name: "Natural Logarithm ln(x)", expr: "x > 0.0 ? log(x) : NAN", desc: "Defined for x > 0 (NAN for x ≤ 0)" },

    /* Number Theory & Special Real Functions */
    { cat: "Number Theory", name: "Prime Counting π(x)", expr: "real_pi_exact(x)", desc: "Exact prime-counting step function up to x = 100,000" },
    { cat: "Number Theory", name: "Riemann Explicit π₅₀(x)", expr: "real_pi_explicit(x, 50)", desc: "Riemann's 1859 explicit formula using 50 zeta zeros" },
    { cat: "Number Theory", name: "Logarithmic Integral li(x)", expr: "real_li(x)", desc: "Asymptotic prime density ∫ dt/ln(t)" },
    { cat: "Number Theory", name: "Chebyshev ψ(x)", expr: "real_psi_exact(x)", desc: "Weighted prime-power sum Σ_{p^k ≤ x} ln(p)" },
    { cat: "Number Theory", name: "Riemann J(x)", expr: "real_J_exact(x)", desc: "Prime-power counting function Σ (1/n)π(x^(1/n))" },
    { cat: "Number Theory", name: "Hardy Z-Function Z(t)", expr: "c_hardy_z(x)", desc: "Real-valued critical-line zeta whose zeros = ζ zeros" },
    { cat: "Number Theory", name: "Exponential Integral E₁(x)", expr: "c_e1_real(x)", desc: "Real exponential integral for x > 0" },
    { cat: "Number Theory", name: "First Zero Harmonic Wave", expr: "real_zero_wave(x, 0)", desc: "Oscillatory contribution of γ₁ ≈ 14.1347" },

    /* Implicit Relations F(x, y) = 0 */
    { cat: "Implicit F(x,y)=0", name: "Circle x² + y² = 9", expr: "x*x + y*y = 9", desc: "Radius-3 circle via Marching Squares" },
    { cat: "Implicit F(x,y)=0", name: "Ellipse x²/16 + y²/9 = 1", expr: "x*x/16.0 + y*y/9.0 = 1.0", desc: "Semi-axes a = 4, b = 3" },
    { cat: "Implicit F(x,y)=0", name: "Hyperbola x² − y² = 4", expr: "x*x - y*y = 4.0", desc: "Rectangular hyperbola" },
    { cat: "Implicit F(x,y)=0", name: "Elliptic Curve y² = x³ − 3x + 2", expr: "y*y = x*x*x - 3.0*x + 2.0", desc: "Smooth Weierstrass cubic curve" },
    { cat: "Implicit F(x,y)=0", name: "Lemniscate of Bernoulli", expr: "(x*x + y*y)*(x*x + y*y) = 12.0*(x*x - y*y)", desc: "Classic figure-eight lemniscate" },
    { cat: "Implicit F(x,y)=0", name: "Folium of Descartes", expr: "x*x*x + y*y*y = 6.0*x*y", desc: "Self-intersecting nodal cubic" },
    { cat: "Implicit F(x,y)=0", name: "Algebraic Heart Curve", expr: "pow(x*x + y*y - 4.0, 3.0) = 16.0*x*x*y*y*y", desc: "Implicit heart contour" },
    { cat: "Implicit F(x,y)=0", name: "Trig Lattice sin(x)·cos(y) = 0.25", expr: "sin(x) * cos(y) = 0.25", desc: "Periodic 2D checkerboard contour lattice" },
    { cat: "Implicit F(x,y)=0", name: "Inverted Curve x = 2 sin(y)", expr: "x = 2.0 * sin(y)", desc: "Horizontal sine wave x = g(y)" },
    { cat: "Implicit F(x,y)=0", name: "Vertical Line x = 2", expr: "x = 2.0", desc: "Exact vertical asymptote/line" },

    /* Parametric Curves (x(t), y(t)) */
    { cat: "Parametric (x,y)", name: "Circle (3cos t, 3sin t)", expr: "(3.0*cos(t), 3.0*sin(t)) for t in [0, 2*pi]", desc: "Single-line parametric circle" },
    { cat: "Parametric (x,y)", name: "Lissajous Knot (3:4)", expr: "(4.0*sin(3.0*t + 0.5), 4.0*sin(4.0*t)) for t in [0, 2*pi]", desc: "Harmonic Lissajous figure" },
    { cat: "Parametric (x,y)", name: "Cardioid", expr: "(2.0*(1.0 + cos(t))*cos(t), 2.0*(1.0 + cos(t))*sin(t)) for t in [0, 2*pi]", desc: "Heart-shaped epicycloid" },
    { cat: "Parametric (x,y)", name: "5-Petal Rose Curve", expr: "(4.0*cos(5.0*t)*cos(t), 4.0*cos(5.0*t)*sin(t)) for t in [0, pi]", desc: "Polar rose r = 4 cos(5t)" },
    { cat: "Parametric (x,y)", name: "Astroid (cos³ t, sin³ t)", expr: "(4.0*pow(cos(t), 3.0), 4.0*pow(sin(t), 3.0)) for t in [0, 2*pi]", desc: "4-cusp hypocycloid" },
    { cat: "Parametric (x,y)", name: "Logarithmic Spiral", expr: "(0.15*exp(0.18*t)*cos(t), 0.15*exp(0.18*t)*sin(t)) for t in [0, 6*pi]", desc: "Self-similar golden-like spiral" },
    { cat: "Parametric (x,y)", name: "Butterfly Curve (Temple Fay)", expr: "parametric [0, 37.6991]:\ndouble r = exp(cos(t)) - 2.0*cos(4.0*t) - pow(sin(t/12.0), 5.0);\npx = sin(t) * r;\npy = cos(t) * r;", desc: "Multi-line C11 parametric transcendental butterfly" },
    { cat: "Parametric (x,y)", name: "Cycloid Arch", expr: "(t - sin(t), 1.0 - cos(t)) for t in [-4*pi, 4*pi]", desc: "Curve traced by a point on a rolling wheel" },
  ];

  function renderSyntaxGuideHtml(mode) {
    const isReal = mode === "real";
    if (isReal) {
      return `
        <div class="guide-box">
          <div class="guide-sec">
            <div class="guide-sec-hdr">1. Four Curve Types in Real Mode (Click + Insert)</div>
            <div class="guide-examples">
              <div class="guide-ex">
                <button class="guide-copy-btn" data-guide-insert="sin(a * x) * exp(-0.12 * x * x)">+ Insert</button>
                <span class="guide-ex-badge">y = f(x)</span>
                <code>sin(a * x) * exp(-0.12 * x * x)</code>
                <span class="guide-ex-note">1-line expression or full C11 body ending in <code>return ...;</code>.</span>
              </div>
              <div class="guide-ex">
                <button class="guide-copy-btn" data-guide-insert="parametric [0, 6.2832]:\ndouble r = 2.0 + cos(5.0 * t);\npx = r * cos(t); py = r * sin(t);">+ Insert</button>
                <span class="guide-ex-badge param">Parametric (x(t), y(t))</span>
                <code>parametric [0, 6.2832]:\ndouble r = 2.0 + cos(5.0 * t);\npx = r * cos(t); py = r * sin(t);</code>
                <span class="guide-ex-note">Assign <code>px</code> &amp; <code>py</code> (or <code>NAN</code> to lift pen). Great for RK4 physics!</span>
              </div>
              <div class="guide-ex">
                <button class="guide-copy-btn" data-guide-insert="cos(3*M_PI*x)*cos(5*M_PI*y) = cos(5*M_PI*x)*cos(3*M_PI*y)">+ Insert</button>
                <span class="guide-ex-badge imp">Implicit F(x, y) = 0</span>
                <code>cos(3*M_PI*x)*cos(5*M_PI*y) = cos(5*M_PI*x)*cos(3*M_PI*y)</code>
                <span class="guide-ex-note">Any equation with <code>=</code> and both <code>x, y</code> runs parallel Marching Squares.</span>
              </div>
              <div class="guide-ex">
                <button class="guide-copy-btn" data-guide-insert="x = 2.0 * sin(y)">+ Insert</button>
                <span class="guide-ex-badge imp">Vertical / x = g(y)</span>
                <code>x = 3.0 &nbsp;or&nbsp; x = 2.0 * sin(y)</code>
                <span class="guide-ex-note">Vertical guide or inverted function of <code>y</code>.</span>
              </div>
            </div>
          </div>

          <div class="guide-sec">
            <div class="guide-sec-hdr">2. Dynamic Camera Tracking &amp; Inline LaTeX</div>
            <ul class="guide-list">
              <li><strong>Camera Follow:</strong> Add <code>+ Var</code> formulas named <code>real_xmin</code>, <code>real_xmax</code>, <code>real_ymin</code>, <code>real_ymax</code> (e.g. <code>real_xmin = craft_x - 3</code>). Avoid naming vars <code>px, py, t</code> alongside parametric cards.</li>
              <li><strong>Formula Landmarks:</strong> Put slider/var formulas inside Point <code>x:/y:</code> or Guide Line fields — they glide live even when 🔒 Locked!</li>
              <li><strong>Inline LaTeX:</strong> Wrap math in <code>$...$</code> inside any Text card (e.g. <code>$f'(c^*) = \\frac{f(b)-f(a)}{b-a}$</code>) for typeset fractions, roots &amp; Greek letters!</li>
            </ul>
          </div>

          <div class="guide-sec">
            <div class="guide-sec-hdr">3. Real C11 Math &amp; Number Theory API</div>
            <div class="guide-api"><strong>&lt;math.h&gt;:</strong> <code>sin cos tan asin acos atan atan2 sinh cosh tanh exp log log2 log10 pow sqrt cbrt hypot fabs floor ceil fmod erf tgamma M_PI M_E NAN</code></div>
            <div class="guide-api"><strong>Primes:</strong> <code>real_pi_exact(x)</code> <code>real_pi_explicit(x, K)</code> <code>real_li(x)</code> <code>real_J_exact(x)</code> <code>real_psi_exact(x)</code> <code>real_psi_explicit(x, K)</code> <code>c_hardy_z(x)</code></div>
          </div>
        </div>
      `;
    }
    return `
      <div class="guide-box">
        <div class="guide-sec">
          <div class="guide-sec-hdr">1. Quick-Start Complex C11 Recipes (Click + Insert)</div>
          <div class="guide-examples">
            <div class="guide-ex">
              <button class="guide-copy-btn" data-guide-insert="(z - c_make(a, 0.0)) / (1.0 - c_make(a, 0.0) * z)">+ Insert</button>
              <span class="guide-ex-badge">1-Line Map</span>
              <code>(z - c_make(a, 0.0)) / (1.0 - c_make(a, 0.0) * z)</code>
              <span class="guide-ex-note">Use <code>z</code> or <code>s</code> (<code>double complex</code>). Constants: <code>c_make(re, im)</code>. Call earlier cards via <code>f1(z)</code>.</span>
            </div>
            <div class="guide-ex">
              <button class="guide-copy-btn" data-guide-insert="double complex w = 0.0;\nfor (int k = 0; k < 200; k++) {\n  w = w * w + z;\n  if (creal(w)*creal(w) + cimag(w)*cimag(w) > 256.0) return c_make((double)k, 0.0);\n}\nreturn c_make(-1.0, 0.0);">+ Insert</button>
              <span class="guide-ex-badge param">Fractal Escape Field</span>
              <code>for (...) { w = w*w + z; if (|w|² > 256) return c_make(k, 0); }\nreturn c_make(-1.0, 0.0);</code>
              <span class="guide-ex-note">Multi-line C11 loops &amp; branches (set Tools → <strong>Ultra-Fractal / Inferno</strong>).</span>
            </div>
          </div>
        </div>

        <div class="guide-sec">
          <div class="guide-sec-hdr">2. Color Fields Explained (Tools → Domain / Fractal Coloring)</div>
          <p class="guide-prose">Every pixel evaluates <code>w = f(z)</code> across all CPU cores. Pick a palette matching what your function returns:</p>
          <div class="guide-palette-row">
            <div class="guide-swatch-card">
              <div class="guide-mini-title">Phase Schemes (Any Complex Map)</div>
              <div class="guide-swatch-bar" style="background:linear-gradient(90deg,#ef4444,#eab308,#22c55e,#06b6d4,#6366f1,#ec4899,#ef4444);"></div>
              <div class="guide-mini-sub"><strong>Classic · Neon Prism · Grayscale</strong></div>
              <p class="guide-prose" style="margin:3px 0 0;"><strong>Hue</strong> = angle <code>arg(w)</code>; <strong>dark</strong> = zeros, <strong>bright</strong> = poles, rings = constant <code>|w|</code>.</p>
            </div>
            <div class="guide-swatch-card">
              <div class="guide-mini-title">Scalar Schemes (Fractals &amp; Shaders)</div>
              <div class="guide-swatch-bar" style="background:linear-gradient(90deg,#05070d 12%,#1e3a8a 30%,#38bdf8 55%,#fbbf24 80%,#ffffff 100%);"></div>
              <div class="guide-mini-sub"><strong>Ultra-Fractal · Inferno · Ocean</strong></div>
              <p class="guide-prose" style="margin:3px 0 0;">Return <code>c_make(v, 0.0)</code>: <code>v &lt; 0</code> paints <strong>jet black</strong>; <code>v &ge; 0</code> maps smoothly across the palette!</p>
            </div>
          </div>
        </div>

        <div class="guide-sec">
          <div class="guide-sec-hdr">3. Projections, 60 FPS Sphere Spin &amp; Inline LaTeX</div>
          <ul class="guide-list">
            <li><strong>Editable vs Viewing Projections:</strong> Draw &amp; edit elements in <strong>Planar &Copf;</strong> or <strong>Polar &Copf;</strong>. Switch Input or Output to <strong>Mercator</strong>, <strong>Stereographic Disk</strong>, <strong>Poincaré Disk</strong>, or <strong>Riemann Sphere</strong> to inspect!</li>
            <li><strong>60 FPS Camera Vars (Zero Lag!):</strong> Drive <code>sphere_yaw</code>, <code>sphere_pitch</code>, <code>sphere_zoom</code>, <code>in_cx/cy/r</code>, <code>out_cx/cy/r</code> via <code>+ Var</code> formulas — never put <code>spin</code> inside <code>f(z)</code> just to rotate the sphere!</li>
            <li><strong>Inline LaTeX:</strong> Wrap math in <code>$...$</code> in any Text card (e.g. <code>$\\oint \\zeta(s)\\,ds = 2\\pi i$</code>) for typeset math on both sidebar &amp; canvas!</li>
          </ul>
        </div>

        <div class="guide-sec">
          <div class="guide-sec-hdr">4. Built-in Complex C11 API</div>
          <div class="guide-api"><strong>Special:</strong> <code>c_make(re,im)</code> <code>c_zeta(s)</code> <code>c_xi(s)</code> <code>c_eta(s)</code> <code>c_zeta_deriv(s)</code> <code>c_zeta_log_deriv(s)</code> <code>c_zeta_partial(s,N)</code> <code>c_gamma(z)</code> <code>c_lgamma(z)</code> <code>c_ei(z)</code></div>
          <div class="guide-api"><strong>&lt;complex.h&gt;:</strong> <code>cexp clog csin ccos ctan csinh ccosh ctanh casin cacos catan cpow csqrt cabs carg creal cimag conj</code></div>
        </div>
      </div>
    `;
  }

  const VECTOR_FUNCTIONS = [
    { cat: "Electromagnetism & Fluids", name: "Electric Dipole Field", desc: "Two opposite charges ±1 at (±1.5, 0) + potential φ", code: "double r1 = (x+1.5)*(x+1.5)+y*y+0.1, r2 = (x-1.5)*(x-1.5)+y*y+0.1;\nfx = (x+1.5)/r1 - (x-1.5)/r2; fy = y/r1 - y/r2;\nphi = -0.5*(log(r1) - log(r2));", insert: "fx = (x+1.5)/((x+1.5)*(x+1.5)+y*y+0.1) - (x-1.5)/((x-1.5)*(x-1.5)+y*y+0.1); fy = y/((x+1.5)*(x+1.5)+y*y+0.1) - y/((x-1.5)*(x-1.5)+y*y+0.1);" },
    { cat: "Electromagnetism & Fluids", name: "Rankine Vortex", desc: "Solid-body core (r < 1.2) + irrotational outer swirl", code: "double r2 = x*x + y*y, s = r2 < 1.44 ? 2.5/1.44 : 2.5/(r2+1e-6);\nfx = -s*y; fy = s*x;", insert: "double r2 = x*x + y*y; fx = -y/(r2+0.25); fy = x/(r2+0.25);" },
    { cat: "Electromagnetism & Fluids", name: "Source + Vortex Spiral", desc: "Outward radial source + counter-clockwise rotation", code: "double r2 = x*x + y*y + 0.25;\nfx = (x - 2.0*y)/r2; fy = (y + 2.0*x)/r2;", insert: "fx = (x - 2.0*y)/(x*x+y*y+0.25); fy = (y + 2.0*x)/(x*x+y*y+0.25);" },
    { cat: "Phase Planes & ODEs", name: "Van der Pol Oscillator", desc: "Self-sustaining limit cycle x'=y, y'=(1-x²)y - x", code: "fx = y;\nfy = 1.2*(1.0 - x*x)*y - x;", insert: "fx = y; fy = 1.2*(1.0 - x*x)*y - x;" },
    { cat: "Phase Planes & ODEs", name: "Damped Pendulum", desc: "Nonlinear pendulum phase portrait θ'=ω, ω'=-sin(θ)-0.25ω", code: "fx = y;\nfy = -sin(x) - 0.25*y;", insert: "fx = y; fy = -sin(x) - 0.25*y;" },
    { cat: "Phase Planes & ODEs", name: "Hyperbolic Saddle", desc: "Incompressible saddle flow F = (x, -y)", code: "fx = x; fy = -y; phi = 0.5*(x*x - y*y);", insert: "fx = x; fy = -y;" },
    { cat: "Curl & Gradient Fields", name: "Incompressible Cellular Eddies", desc: "Exact zero-divergence curl of sin(x)sin(y)", code: "fx = sin(x)*cos(y);\nfy = -cos(x)*sin(y);\nphi = sin(x)*sin(y);", insert: "fx = sin(x)*cos(y); fy = -cos(x)*sin(y);" },
    { cat: "Curl & Gradient Fields", name: "Gaussian Peak Gradient", desc: "Conservative gradient field pointing toward peak", code: "double e = exp(-(x*x + y*y));\nfx = -2.0*x*e; fy = -2.0*y*e; phi = e;", insert: "double e = exp(-(x*x + y*y)); fx = -2.0*x*e; fy = -2.0*y*e; phi = e;" },
  ];

  const _origRenderSyntaxGuideHtml = renderSyntaxGuideHtml;
  function renderSyntaxGuideHtmlEx(mode) {
    if (mode === "vector") {
      return `
        <div class="guide-box">
          <div class="guide-sec">
            <div class="guide-sec-hdr">1. 2D Vector Field C11 Syntax (Click + Insert)</div>
            <div class="guide-examples">
              <div class="guide-ex">
                <button class="guide-copy-btn" data-guide-insert="fx = -y;\nfy = x;">+ Insert</button>
                <span class="guide-ex-badge">Vector Field</span>
                <code>fx = -y; fy = x;</code>
                <span class="guide-ex-note">Assign <code>fx</code> and <code>fy</code> (both <code>double</code>) using <code>x, y</code> and any Sliders/Vars. Optional: assign <code>phi = ...;</code> for equipotentials!</span>
              </div>
              <div class="guide-ex">
                <button class="guide-copy-btn" data-guide-insert="double r2 = x*x + y*y + 0.15;\nfx = x / r2; fy = y / r2;\nphi = -0.5 * log(r2);">+ Insert</button>
                <span class="guide-ex-badge param">Field + Potential</span>
                <code>fx = x/r2; fy = y/r2; phi = -0.5*log(r2);</code>
                <span class="guide-ex-note">Or write a <strong>Potential</strong> card (toggle card kind) returning scalar <code>φ(x, y)</code> — C11 computes <code>∇φ</code> automatically!</span>
              </div>
            </div>
          </div>
          <div class="guide-sec">
            <div class="guide-sec-hdr">2. Live Divergence, Curl, Work &amp; Flux</div>
            <ul class="guide-list">
              <li><strong>Heatmaps:</strong> Switch the top-right dropdown between <strong>Potential φ</strong>, <strong>Magnitude |F|</strong>, <strong>Divergence ∇·F</strong> (sources/sinks), and <strong>Curl ∇×F</strong> (vorticity)!</li>
              <li><strong>Green's &amp; Gauss's Theorems:</strong> Draw a Circle, Rect, or Freehand loop and drag it across sources or vortices — the floating panel computes live <strong>Work/Circulation ∮ F·dr</strong> and <strong>Outward Flux ∮ F·n ds</strong>!</li>
              <li><strong>60 FPS Flow Particles &amp; Streamlines:</strong> Toggle RK4 Streamlines, Equipotentials, Quiver Arrows &amp; 60 FPS Advected Particles in <strong>Tools</strong>.</li>
            </ul>
          </div>
        </div>
      `;
    }
    return _origRenderSyntaxGuideHtml(mode);
  }

  window.CFVFunctionLibrary = {
    complex: COMPLEX_FUNCTIONS,
    real: REAL_FUNCTIONS,
    vector: VECTOR_FUNCTIONS,
    getForMode(mode) {
      if (mode === "real") return REAL_FUNCTIONS;
      if (mode === "vector") return VECTOR_FUNCTIONS;
      return COMPLEX_FUNCTIONS;
    },
    renderSyntaxGuideHtml: renderSyntaxGuideHtmlEx,
  };
})();
