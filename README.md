# C11 Function Studio — Complex & 2D Real Function Visualizer

A fast, zero-dependency mathematical visualization studio written in **native C11 (Clang)** with a multi-threaded backend (`pthreads`) and an interactive Light/Dark-mode browser workspace. Write live C11 complex mappings $w = f(z)$, contour integrands $\int_\gamma f(z)\,dz$, 2D real functions, implicit relations $F(x, y) = 0$, parametric curves $(x(t), y(t))$, and high-resolution fractal color fields — hot-compiled into native shared libraries with a 0 ms LRU cache.

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

1. **Complex Map (`ℂ Map` / `/map`)**: Dual synchronized input ($z$-plane) and output ($w$-plane) canvases. Draw or formula-bind circles, arcs, rectangles, line segments, polygons, freehand loops, points, and guide lines on the input plane and watch $w = f(z)$ update live on the output plane.
2. **Contour Integral (`∮ Integral` / `/integral`)**: Adaptive 8-point Gauss-Legendre quadrature in C11 along open or closed multi-piece contours (Pac-Man keyholes, Fresnel sectors, residue loops), plotting the cumulative integral path $I(\tau) = \int_0^\tau f(\gamma(u))\gamma'(u)\,du$, individual contour values, $\div 2\pi i$ residue readouts, and total sum.
3. **2D Real Studio (`ℝ 2D Real` / `/real`)**: Plots multiple simultaneous curves with smart syntax detection:
   - Standard functions `y = f(x)` or bare C11 expressions / multi-line C11 bodies
   - Parametric curves `(x(t), y(t)) for t in [a, b]` and multi-line `parametric [a, b]:` blocks (4-thread native sampling)
   - Implicit relations `LHS = RHS` (4-thread Marching Squares)
   - Vertical lines `x = c` and inverted curves `x = g(y)`
   - Interactive centered $[-R, R]^2$ cell grids (e.g. Conway's Game of Life B3/S23 in C11), derivative $f'(x)$, live tangent line, definite integral $\int_a^b f(x)\,dx$, and Web Audio *Music of the Primes*.

## Key Features

- **Output Space Projections**: Switch the Complex Output Space between:
  - **Planar $\mathbb{C}$** — Standard flat complex plane
  - **3D Riemann Sphere $S^2$** — Interactive frosted-glass 3D sphere with stereographic geodesic subdivision
  - **Stereographic Disk** — Full finite bounded mapping of $\mathbb{C} \cup \{\infty\}$ into $|W| \le 1$ via $\frac{2}{\pi}\arctan(|w|)e^{i\arg w}$ with concentric modulus rings and phase rays
  - **Poincaré Disk** — Hyperboloid-to-Poincaré unit disk projection $W = \frac{w}{1 + \sqrt{1 + |w|^2}}$ with orthogonal hyperbolic geodesics
  - **Custom Projection $P(w)$** — Type any arbitrary complex projection formula in `w`, `u`, `v`, `r`, `theta`, `i`, `pi`, `e`, and live slider variables (with quick Cayley, Disk, Log-Polar, and $1/w$ chips)
- **Multi-Threaded C11 Domain & Fractal Color Schemes + Mandelbrot Set**:
  - 4-thread native C11 `/api/domain` renderer up to `900×900` resolution with 6 selectable palettes in **Tools**: *Classic Domain*, *Mandelbrot Smooth (Ultra-Fractal)*, *Inferno Flame*, *Electric Ocean*, *Neon Prism Cosine*, and *Grayscale Iso-Contours*, plus a live Field Opacity slider.
  - Includes a built-in **Mandelbrot & Multibrot Set** example with smooth continuous escape-time coloring and Seahorse Valley, Elephant Valley, and $z^3 + c$ presets.
- **Prewritten Function Libraries & Inline Syntax Guide**:
  - Click **`ƒ Library ▾`** in the Function tab to browse and insert from 40+ Complex Analysis functions (in Map/Integral mode) or 45+ 2D Real functions/implicit/parametric curves (in 2D Real mode) — strictly separated by mode.
  - Click **`? Guide`** right in the Function tab for strict, human-friendly C11 syntax rules, parameter/reserved-name rules, and copyable input examples.
- **Unified Element Layering, Drag-to-Reorder, Opacity & Zero Line Width**:
  - Shapes, points, and guide lines live in a single **Elements & Layers** list rendered in exact back-to-front order (locked elements stay right in the layer stack with clear `LOCKED` visual styling).
  - Drag any sidebar card (`⋮⋮` grip) to reorder layers or function/slider/var cards.
  - **Right-click** any element directly on any 2D graph (Input plane, Output plane, or 2D Real plane) to open its properties menu: Color, **Opacity** (`0%`–`100%`, applied to both Input & Output space), **Line Thickness** down to **`0.0`** (fill-only shapes), Line Style, Point Icon/Size, Layer Order (`Back` / `↑` / `↓` / `Front`), Lock, and Delete.
- **Independent X/Y Axis Scaling on Every 2D Graph**:
  - Use the on-screen **`X+` / `X−`** and **`Y+` / `Y−`** buttons or **`Shift + Scroll`** (X-axis only) / **`Ctrl + Scroll`** (Y-axis only) on any 2D plane.
  - Click **`1:1`** to toggle equal aspect-ratio scaling back on.
- **Light & Dark Mode + Ergonomic Layout**:
  - Toggle **Light / Dark mode** from the top-right utility cluster (`Docs & AI`, `Tools`, `PNG`, `Light/Dark`) — updates both UI chrome and all 2D/3D canvases.
  - Hidden panel restore pills (`+ Sidebar`, `+ Input`, `+ Output`, `+ 2D Plane`) dock cleanly in the bottom-right footer.
- **Project Library, Folders, Descriptions & Readable JSON URLs**:
  - Organize saved projects (`projects/*.json`) into custom folders (create folders directly from the Project Library OR inside the **Save As** popover via **`+ Folder`**).
  - View and edit **Project Descriptions** from the collapsible Description strip in the sidebar or the Save As popover; all built-in examples and saved projects include descriptions.
  - Live URL state uses human-readable JSON encoding (`#json={...}`) representing the current `cfv_project_v1` workspace (with backward compatibility for legacy `#s=` links).
- **GenAI Workbench & Full Project JSON (`cfv_project_v1`)**:
  - Context-aware GenAI Prompt Builder, Live-Validating Project JSON Import/Export Terminal, searchable C11 API Reference, and interactive Cookbook inside **Docs & AI**.
- **Analytic Number Theory Engine (`complex_math.c` & `real_math.c`)**:
  - Full analytic continuation of $\zeta(s)$ across $\mathbb{C} \setminus \{1\}$, entire completed $\xi(s)$, Dirichlet $\eta(s)$, $\zeta'(s)$, $\zeta'(s)/\zeta(s)$, Euler $\Gamma(z)$ & $\ln\Gamma(z)$, $\operatorname{Ei}(z)$, Hardy's $Z(t)$, exact $\pi(x)$, $J(x)$, $\psi(x)$, $\operatorname{li}(x)$, and Riemann's 1859 explicit formulas summed over 200 verified zeta zeros.

## Docker / Unraid & Public Web Deployment

All container and Unraid deployment files live in `Dockerfile` and `deploy/`:

- **[Dockerfile](Dockerfile)** — Multi-stage hardened non-root image (public-safe by default with `clang` removed; pass `--build-arg WITH_CLANG=1` + `CFV_COMPILE_TOKEN` for token-gated remote compilation).
- **[deploy/docker-compose.yml](deploy/docker-compose.yml)** — Ready-to-run compose stack with an optional `cloudflared` tunnel profile.
- **[deploy/unraid-template.xml](deploy/unraid-template.xml)** — Native Unraid Docker UI template.
- **[deploy/UNRAID_PUBLIC_GUIDE.md](deploy/UNRAID_PUBLIC_GUIDE.md)** — Full step-by-step Unraid + Cloudflare Tunnel / Tailscale guide.
