# C11 Function Studio — Complex & Real Function Visualizer

A fast, zero-dependency mathematical visualization studio written in **native C11 (Clang)** with a multi-threaded backend (`pthreads`) and an interactive Light/Dark-mode browser workspace. Write live C11 complex mappings $w = f(z)$, contour integrands $\int_\gamma f(z)\,dz$, real functions, implicit relations $F(x, y) = 0$, parametric curves $(x(t), y(t))$, 3D solid Riemann globes, and smooth logarithmic-zoom fractals — hot-compiled into native shared libraries with a 0 ms LRU cache.

## Build & Run

```bash
make web          # Compiles with clang (-Wall -Wextra -Werror -Wpedantic -O2) and launches http://127.0.0.1:1738
make test         # Runs the 54-check C11 numerical verification suite (zeta, Gamma, primes, contours, Game of Life)
make valgrind     # Runs memory-leak check on the test suite
make format       # Formats C sources using clang-format
make scan-build   # Runs Clang static analyzer
```

Custom port, host, or public-safe mode:

```bash
./visualizer --host 127.0.0.1 --port 9000
./visualizer --public                       # Binds 0.0.0.0:1738 with live C compile disabled
./visualizer --compile-token SECRET         # Requires X-Compile-Token header for live compilation
```

## Workspace Modes

1. **Complex (`ℂ Complex` / `/map`)**: Unified dual synchronized input ($z$-plane) and output ($w$-plane) workspace with **one-click toggleable Contour Integration (`∮ Contour`)**:
   - **Complex Mapping**: Draw or formula-bind circles, arcs, rectangles, line segments, polygons, freehand loops, points, and guide lines on the input plane and watch $w = f(z)$ update live on the output plane (2D plane, 3D Riemann Sphere, bounded Stereographic Disk, bounded Poincaré Disk, or custom projection $P(w)$).
   - **Toggleable Contour Integration (`∮ Contour`)**: Saved per-project and per-preset! Turns on adaptive 8-point Gauss-Legendre quadrature in C11 along open or closed multi-piece contours (Pac-Man keyholes, Fresnel sectors, residue loops), plotting the cumulative integral path $I(\tau) = \int_0^\tau f(\gamma(u))\gamma'(u)\,du$ with a clean, draggable, resizable **Contour Integration** window showing total $\sum \int f(z)\,dz$, net Cauchy residue $\div 2\pi i$, exact $\pi / 2\pi i$ hints, and one-click orientation reversal (`⇄`).
2. **Real (`ℝ Real` / `/real`)**: Plots multiple simultaneous curves with smart syntax detection AND shares the **exact same standardized bottom Tools & Elements dock** as Complex mode (`Move`, `Draw`, `Line`, `Circle`, `Rect`, `Poly`, `Pan`, `+ Arc`, `+ Seg`, `+ Point`, `+ Line`, `+ Text`, `Close`, `Undo`, `Clear`):
   - Standard functions `y = f(x)` or bare C11 expressions / multi-line C11 bodies
   - Parametric curves `(x(t), y(t)) for t in [a, b]` and multi-line `parametric [a, b]:` blocks (4-thread native sampling)
   - Implicit relations `LHS = RHS` (4-thread Marching Squares)
   - Vertical lines `x = c` and inverted curves `x = g(y)`
   - Draggable, minimizable, resizable **Curves & Relations** legend panel
   - Interactive centered $[-R, R]^2$ cell grids (e.g. Conway's Game of Life B3/S23 in C11), derivative $f'(x)$, live tangent line, definite integral $\int_a^b f(x)\,dx$, and Web Audio *Music of the Primes*.

## Curated Project Library (8 Thematic Folders)

- **Complex Mode Folders**: *Complex Analysis & Conformal Maps* ($\zeta(s)$ + $\xi(s)$ + Residue, Dirichlet $S_N(s)$, live Joukowsky Airfoil, $e^{1/z}$ Essential Singularity, Blaschke Products), *Contour Integration & Residues* (Cauchy's Theorem & Path Independence, Riemann Zero Counter $\zeta'/\zeta$, Euler $\Gamma(z)$ Residue Ladder, Keyhole Branch Cut, Fresnel 45° Sector), *Fractals & Complex Dynamics* (Mandelbrot Live Deep Zoom, Julia Sculptor, Newton Stained-Glass Basins), and *Spheres, Atlases & Conformal Art* (Full-Color 3D Earth Atlas with 88 solid layers & 43 cities, Conformal Stained-Glass Orb).
- **2D Real Mode Folders**: *Calculus & Classroom Theorems* (Mean Value Theorem & Rolle's Theorem, Riemann Sums / Darboux Bounds & FTC, Taylor Polynomials & Radius of Convergence, Fourier Series & Gibbs Phenomenon), *Measure Theory & Real Analysis* (Lebesgue Simple Functions & Fatou's Lemma, Cantor Function / Devil's Staircase & Measure Zero, Nowhere-Differentiable Weierstrass & Takagi), *Number Theory & Primes* ($\pi(x)$, $\psi(x)$, Hardy's $Z(t)$), and *Curves, Epicycles & Automata* (Solar Orrery Resonance Mandala, Fourier Epicycles, Parametric/Implicit/Cornu Gallery, Conway's Game of Life).

## Key Features

- **Output Space Projections & High-Speed 3D Riemann Sphere**:
  - **Planar $\mathbb{C}$** — Standard flat complex plane with exact interior/exterior pole-inversion shading.
  - **3D Riemann Sphere $S^2$** — High-FPS horizon-clipped 3D sphere with per-frame trig caching, O(1) back-hemisphere bounding-cap culling, solid opaque fills (`opacity: 1.0`), full-globe oceans (`isOcean: true`), and selective output-only repainting during 60 FPS globe spin. Includes the full-color **Earth Atlas** globe example (sapphire Global Ocean, biome-colored continents, desert/rainforest/ice overlays, inland lakes, and cities).
  - **Bounded Stereographic Disk** — Clean finite compactification of all of $\mathbb{C} \cup \{\infty\}$ inside $|W| \le 1$ via $\frac{2}{\pi}\arctan(|w|)e^{i\arg w}$ with zero exterior gridlines, interior modulus rings/axes/`±∞` labels, and explicit boundary-at-infinity banner.
  - **Bounded Poincaré Disk** — Hyperboloid-to-Poincaré unit disk projection $W = \frac{w}{1 + \sqrt{1 + |w|^2}}$ with orthogonal hyperbolic geodesics and zero exterior gridlines (showcased in the Blaschke Product Hyperbolic Automorphism preset).
  - **Custom Projection $P(w)$** — Type any complex projection formula in `w`, `u`, `v`, `r`, `theta`, `i`, `pi`, `e`, and live slider variables.
- **Adaptive Multi-Threaded Fractal & Domain Coloring + Razor-Sharp Native-Res Zoom**:
  - Up to **16 interleaved POSIX pthreads** in C11 `/api/domain` (supporting up to `2400×2400` / 4.2M pixels) paired with a parallel, FPS-targeted adaptive scrub pipeline (~26 ms/frame live slider morphing on Julia sets & Mandelbrot zooms + automatic 1:1 native device-pixel settle).
  - Built-in **Mandelbrot & Multibrot Set** and **Julia Set Sculptor** feature live `zoom` / `theta_c` / `shift` sliders with crisp logarithmic dives up to **100,000×**!
  - 6 selectable palettes in **Tools**: *Classic Domain*, *Mandelbrot Smooth (Ultra-Fractal)*, *Inferno Flame*, *Electric Ocean*, *Neon Prism Cosine*, and *Grayscale Iso-Contours*.
- **Canvas Explanation Text Boxes & Sidebar Text Cards**:
  - Add corner-anchored or world-anchored glass **Text Boxes** (`+ Text`) directly on any Complex or Real graph, synced with editable **Text Cards** in **Elements & Layers** (and bundled into all 29 curated classroom & showcase examples).
- **Formula-Bound Locked Elements & Preset Panel Layouts**:
  - Locked shapes (`formula`), locked points (`xExpr`/`yExpr`), locked guide lines (`valExpr`), and locked text boxes continue to evaluate slider/variable formulas (including `hypot`) and glide live across the graph while staying protected from accidental dragging or deletion.
  - Presets save and restore **panel visibility & relative sizes** (`sidebarCollapsed`, `inputHidden`, `outputHidden`, `realHidden`, `sidebarWidth`, `splitPct`), letting deep-zoom fractal and 3D Earth presets open directly in full-width showcase layouts.
  - Built-in examples can be edited and **saved in-place** (`Save` / `Ctrl+S`), with edits persisted to `projects/`.
- **Editable Global Viewport & 3D Camera Variables**:
  - Any `var` or `slider` named `sphere_yaw`, `sphere_pitch`, `sphere_zoom`, `in_cx`, `in_cy`, `in_r`, `out_cx`, `out_cy`, `out_r`, `real_xmin`, `real_xmax`, `real_ymin`, or `real_ymax` dynamically drives the 2D/3D camera at 60 FPS (down to `1e-13` zoom radius!) and is readable from C11 cards and formulas.
- **Persistent Sidebar & Mini-Rail Tools Dock**:
  - The Drawing & Landmark Tools Dock sits cleanly at the bottom of the left sidebar and automatically moves to the bottom of the persistent **Sliders & Vars** mini-rail whenever the sidebar is closed (even if all graph panels are hidden).
- **Prewritten Function Libraries & Inline `? Guide`**:
  - Click **`ƒ Library ▾`** in the Function tab to browse and insert from 40+ Complex Analysis or 45+ 2D Real expressions (strictly separated by mode, hoisted above all panels).
  - Click **`? Guide`** for strict C11 syntax rules, parameter rules, and editable global viewport variables.
- **Unified Elements & Layers, Solid/Translucent Opacity & Zero Line Width**:
  - Shapes, points, and guide lines live in a single **Elements & Layers** list rendered back-to-front with drag-to-reorder (`⋮⋮`).
  - Closed shapes default to translucent fill (`22%`), while `100%` Fill Opacity renders completely solid opaque fills across 2D Input, 2D Output, and 3D Riemann Sphere; Line Thickness supports `0.0` for fill-only layers.
  - **Right-click** any element on any 2D graph to edit Color, Opacity, Line Thickness, Line Style, Point Icon/Size, Layer Order, Lock, and Delete.
- **Independent X/Y Axis Scaling & Adaptive Light / Dark Mode**:
  - Scale axes independently via **`X+` / `X−`**, **`Y+` / `Y−`**, **`Shift + Scroll`** (X), or **`Ctrl + Scroll`** (Y), and toggle **`1:1`** to lock equal aspect ratio.
  - Toggle **Light / Dark mode** from the top-right bar — an automatic contrast engine (`CFVTheme.adaptColor`) ensures bright/white curves, labels, and legend swatches remain crisp on the calm slate/paper Light canvas (while preserving pure white snow/ice over dark solid ocean globes), and dark lines remain readable in Dark mode.
- **Project Library, Custom Folders, Descriptions & Readable JSON URLs**:
  - Save projects to disk (`projects/*.json`) organized into custom folders (create folders from the Project Library or directly inside **Save As** via **`+ Folder`**).
  - Prompt for project descriptions on first save and edit both Name & Description together in the unified **Edit Project Details** (`✎`) modal (supported for both saved projects and built-in examples).
  - Live URL state uses human-readable `#json={...}` encoding of `cfv_project_v1` (backward compatible with legacy `#s=` links).
- **GenAI Workbench & Analytic Number Theory Engine (`complex_math.c` & `real_math.c`)**:
  - Context-aware GenAI Prompt Builder, Live-Validating Project JSON Import/Export Terminal, searchable C11 API Reference, and interactive Cookbook inside **Docs & AI**.
  - Full analytic continuation of $\zeta(s)$ across $\mathbb{C} \setminus \{1\}$, entire $\xi(s)$, $\eta(s)$, $\zeta'(s)$, $\zeta'(s)/\zeta(s)$, $\Gamma(z)$ & $\ln\Gamma(z)$, $\operatorname{Ei}(z)$, Hardy's $Z(t)$, exact $\pi(x)$, $J(x)$, $\psi(x)$, $\operatorname{li}(x)$, and Riemann's 1859 explicit formulas over 200 verified zeta zeros.

## Docker / Unraid & Public Web Deployment

All container and Unraid deployment files live in `Dockerfile` and `deploy/`:

- **[Dockerfile](Dockerfile)** — Multi-stage hardened non-root image (public-safe by default with `clang` removed; pass `--build-arg WITH_CLANG=1` + `CFV_COMPILE_TOKEN` for token-gated remote compilation).
- **[deploy/docker-compose.yml](deploy/docker-compose.yml)** — Ready-to-run compose stack with an optional `cloudflared` tunnel profile.
- **[deploy/unraid-template.xml](deploy/unraid-template.xml)** — Native Unraid Docker UI template.
- **[deploy/UNRAID_PUBLIC_GUIDE.md](deploy/UNRAID_PUBLIC_GUIDE.md)** — Full step-by-step Unraid + Cloudflare Tunnel / Tailscale guide.
