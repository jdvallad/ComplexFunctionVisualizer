# Complex Function Visualizer

A fast, zero-dependency complex function visualizer written in **C11 (Clang)** with a dark-mode interactive dual-plane browser UI. Define any complex function $w = f(z)$ directly as literal C code, trace paths or closed shapes on the input plane, and watch them map live onto the output plane.

Includes the **full analytic continuation of the Riemann zeta function $\zeta(s)$** across $\mathbb{C} \setminus \{1\}$ as the default prototype example.

## Build & Run

```bash
make web          # Compiles with clang and launches http://127.0.0.1:1738
make test         # Runs the numerical verification suite for zeta(s) & Gamma(z)
make valgrind     # Runs memory-leak check on the test suite
make format       # Formats C sources using clang-format
make scan-build   # Runs Clang static analyzer
```

Custom port, host, or public-safe mode:

```bash
./visualizer --host 127.0.0.1 --port 9000
./visualizer --public                       # Binds 0.0.0.0:1738 with live C compile disabled
```

## Docker / Unraid & Public Web Deployment

Your personal terminal workflow (`make web`) stays untouched. All container and Unraid deployment files are split cleanly into `Dockerfile` and `deploy/`:

- **[Dockerfile](Dockerfile)** — Multi-stage hardened non-root image (public-safe by default with `clang` removed from the runtime image; pass `--build-arg WITH_CLANG=1` + `CFV_COMPILE_TOKEN` for token-gated remote compilation).
- **[deploy/docker-compose.yml](deploy/docker-compose.yml)** — Ready-to-run compose stack with an optional `cloudflared` tunnel profile for zero-port-forwarding HTTPS access.
- **[deploy/unraid-template.xml](deploy/unraid-template.xml)** — Native Unraid Docker UI template.
- **[deploy/UNRAID_PUBLIC_GUIDE.md](deploy/UNRAID_PUBLIC_GUIDE.md)** — Full step-by-step Unraid + Cloudflare Tunnel / Tailscale setup guide.

## Entering Your Own Function in C

Open `functions.c`, write a standard `<complex.h>` function, and register it in `REGISTRY[]`:

```c
static double complex fn_my_func(double complex z) {
    return cexp(z) - z * z;
}
```

Then rebuild and launch with `make web`.

## Features

- **Full Analytic Continuation of $\zeta(s)$ & Completed Zeta $\xi(s)$**: Euler-Maclaurin summation for $\operatorname{Re}(s) \ge 1/2$ (and around $s = 0$), log-stabilized Riemann functional equation for $\operatorname{Re}(s) < 1/2$, entire completed $\xi(s) = \frac{1}{2}s(s-1)\pi^{-s/2}\Gamma(s/2)\zeta(s)$, Hardy's $Z(t)$, and $\zeta'(s)/\zeta(s)$ for Argument Principle zero counting.
- **2D Real-Valued Mode (`ℝ 2D Real` toggle or `/real`)**: Classic 2D Cartesian visualizer featuring **Riemann's 1859 Explicit Formula for $\pi(x)$** (plus $J(x)$ and Chebyshev $\psi(x)$) summed over the first 200 verified non-trivial Riemann zeros in C11. Overlay multiple convergence lines simultaneously (`Exact π(x)`, `Li(x)`, `K=5`, `K=20`, `K=50`, `K=150`), toggle error shading and prime markers, or scrub/animate the live `K = 0..200` slider. Define your own 2D real C functions in `real_functions.c`.
- **Dual Interactive Complex Planes (`ℂ Complex` → `Map` Mode)**: Trace freehand curves, straight lines, circles, rectangles, and polygons on the $z$-plane and watch $w = f(z)$ trace out live on the $w$-plane.
- **Contour Integral Mode (`ℂ Complex` → `Integral` or `/integral`)**: Draw any open or closed contour on the left and watch the cumulative partial integral trajectory $I(t)$ trace out on the right using adaptive 8-point Gauss-Legendre quadrature in C, with exact $\int_\gamma f(z)\,dz$, residue readout $\frac{1}{2\pi i}\oint_\gamma f(z)\,dz$, orientation reversal, and showcase examples.
- **Move & Resize Shapes Live**: Use the `Move / Resize` tool (`V`) or `Alt+drag` to pick up any shape and drag handles while the output plane or contour integral updates in real time.
- **Solid Closed Boundaries, Domain Coloring & Animated Tracer**: Magnetic snap-to-close with conformal interior grids and winding number $W(0)$, `pthreads` domain coloring, and synchronized comet playback (`P`).
