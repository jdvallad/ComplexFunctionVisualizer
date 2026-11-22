#define _POSIX_C_SOURCE 200809L

/*
 * ============================================================================
 *  real_functions.c — Define 2D real-valued functions here as literal C code!
 * ============================================================================
 *
 *  To visualize your own 2D real function y = f(x):
 *    1. Write a C function:
 *           static double rfn_my_func(double x) { ... }
 *       (Optionally add a convergence family `static double rfn_my_approx(double x, int k)`!)
 *    2. Add an entry to REAL_REGISTRY[] below.
 *    3. Rebuild and run with:  make web
 * ============================================================================
 */

#include "real_functions.h"
#include "complex_math.h"
#include "real_math.h"

#include <math.h>
#include <pthread.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

/* ----------------------------------------------------------------------------
 * 1. Prime Counting Function pi(x) + Riemann's Explicit Formula (Prototype!)
 * ---------------------------------------------------------------------------- */
static double rfn_pi_exact(double x) { return real_pi_exact(x); }

static double rfn_pi_explicit(double x, int num_zeros) { return real_pi_explicit(x, num_zeros); }

static double rfn_li(double x) { return x > 1.05 ? real_li(x) : NAN; }

/* ----------------------------------------------------------------------------
 * 2. Riemann Prime-Power Function J(x) + Explicit Formula
 * ---------------------------------------------------------------------------- */
static double rfn_J_exact(double x) { return real_J_exact(x); }

static double rfn_J_explicit(double x, int num_zeros) { return real_J_explicit(x, num_zeros); }

/* ----------------------------------------------------------------------------
 * 3. Chebyshev psi(x) + Von Mangoldt Explicit Formula
 * ---------------------------------------------------------------------------- */
static double rfn_psi_exact(double x) { return real_psi_exact(x); }

static double rfn_psi_explicit(double x, int num_zeros) { return real_psi_explicit(x, num_zeros); }

static double rfn_identity(double x) { return x >= 0.0 ? x : NAN; }

/* ----------------------------------------------------------------------------
 * 4. Hardy's Z(t) — Real-valued Critical Line Signal
 * ---------------------------------------------------------------------------- */
static double rfn_hardy_z(double t) { return c_hardy_z(t); }

/* ----------------------------------------------------------------------------
 * 5. Completed Zeta xi(x) on the Real Line (Symmetric around x = 1/2!)
 * ---------------------------------------------------------------------------- */
static double rfn_xi_real(double x) { return creal(c_xi(c_make(x, 0.0))); }

/* ----------------------------------------------------------------------------
 * 6. Fourier Square Wave Convergence Demo
 * ---------------------------------------------------------------------------- */
static double rfn_square_wave_exact(double x) {
    double s = sin(x);
    if (fabs(s) < 1e-12) {
        return 0.0;
    }
    return s > 0.0 ? 1.0 : -1.0;
}

static double rfn_square_wave_fourier(double x, int terms) {
    if (terms <= 0) {
        return 0.0;
    }
    double sum = 0.0;
    for (int k = 1; k <= terms; k++) {
        double n = (double)(2 * k - 1);
        sum += sin(n * x) / n;
    }
    return (4.0 / M_PI) * sum;
}

/* ----------------------------------------------------------------------------
 * 7. Custom Sandbox Example: Damped Sinc Wave
 *    Edit this (or add your own!) and run `make web`.
 * ---------------------------------------------------------------------------- */
static double rfn_sinc_wave(double x) {
    if (fabs(x) < 1e-9) {
        return 1.0;
    }
    return (sin(M_PI * x) / (M_PI * x)) * cos(0.35 * x);
}

static const RealFunctionDef REAL_REGISTRY[] = {
    {
        .id = "pi_explicit",
        .name = "Prime Counting pi(x)",
        .formula = "pi(x) = sum (mu(n)/n) J_K(x^(1/n))",
        .description =
            "Riemann's 1859 Explicit Formula for the prime-counting staircase pi(x) via Mobius "
            "inversion of J_K(x) summed over the first K non-trivial zeros of zeta(s). Watch the "
            "smooth curve crystallize into prime jumps as K increases!",
        .c_source =
            "double rfn_pi_explicit(double x, int K) {\n"
            "    /* Mobius inversion of Riemann's explicit formula J_K(x):\n"
            "     *   J_K(x) = li(x) - 2 sum_{k=1}^K Re(Ei(rho_k * ln x)) - ln(2) + tail */\n"
            "    return real_pi_explicit(x, K);\n"
            "}",
        .exact_fn = rfn_pi_exact,
        .approx_fn = rfn_pi_explicit,
        .baseline_fn = rfn_li,
        .baseline_label = "Li(x)",
        .is_step_exact = true,
        .show_primes = true,
        .show_zeros = false,
        .max_k = RIEMANN_ZERO_COUNT,
        .default_ks = {0, 5, 20, 50, 150},
        .default_k_count = 5,
        .k_unit = "zeros",
        .xmin = 1.8,
        .xmax = 40.0,
        .ymin = -0.8,
        .ymax = 14.5,
    },
    {
        .id = "J_explicit",
        .name = "Riemann J(x) Explicit",
        .formula = "J(x) = li(x) - sum_rho li(x^rho) - ln 2 + tail",
        .description =
            "Riemann's prime-power counting function J(x) = pi(x) + (1/2)pi(x^(1/2)) + "
            "(1/3)pi(x^(1/3)) + ..., jumping by +1 at primes, +1/2 at p^2, and +1/3 at p^3.",
        .c_source = "double rfn_J_explicit(double x, int K) {\n"
                    "    return real_J_explicit(x, K);\n"
                    "}",
        .exact_fn = rfn_J_exact,
        .approx_fn = rfn_J_explicit,
        .baseline_fn = rfn_li,
        .baseline_label = "Li(x)",
        .is_step_exact = true,
        .show_primes = true,
        .show_zeros = false,
        .max_k = RIEMANN_ZERO_COUNT,
        .default_ks = {0, 5, 20, 50, 150},
        .default_k_count = 5,
        .k_unit = "zeros",
        .xmin = 1.8,
        .xmax = 40.0,
        .ymin = -0.8,
        .ymax = 16.5,
    },
    {
        .id = "psi_explicit",
        .name = "Chebyshev psi(x) Explicit",
        .formula = "psi(x) = x - sum_rho x^rho / rho - ln(2pi) - ...",
        .description =
            "Von Mangoldt's explicit formula for Chebyshev's prime-power log sum psi(x) = sum_{p^k "
            "<= x} ln(p). Every zeta zero adds a damped cosine wave in ln(x)!",
        .c_source =
            "double rfn_psi_explicit(double x, int K) {\n"
            "    /* psi_K(x) = x - 2 sum Re(x^rho / rho) - ln(2*pi) - (1/2)ln(1 - x^-2) */\n"
            "    return real_psi_explicit(x, K);\n"
            "}",
        .exact_fn = rfn_psi_exact,
        .approx_fn = rfn_psi_explicit,
        .baseline_fn = rfn_identity,
        .baseline_label = "y = x",
        .is_step_exact = true,
        .show_primes = true,
        .show_zeros = false,
        .max_k = RIEMANN_ZERO_COUNT,
        .default_ks = {1, 5, 20, 50, 150},
        .default_k_count = 5,
        .k_unit = "zeros",
        .xmin = 1.5,
        .xmax = 45.0,
        .ymin = -2.0,
        .ymax = 46.0,
    },
    {
        .id = "hardy_z",
        .name = "Hardy's Z(t) (Critical Line)",
        .formula = "Z(t) = e^(i*theta(t)) * zeta(1/2 + i*t)",
        .description =
            "Strictly real-valued function on the critical line with |Z(t)| = |zeta(1/2 + it)|. "
            "Every zero crossing corresponds directly to a non-trivial Riemann zero gamma_k!",
        .c_source = "double rfn_hardy_z(double t) {\n"
                    "    return c_hardy_z(t);\n"
                    "}",
        .exact_fn = rfn_hardy_z,
        .approx_fn = NULL,
        .baseline_fn = NULL,
        .baseline_label = NULL,
        .is_step_exact = false,
        .show_primes = false,
        .show_zeros = true,
        .max_k = 0,
        .default_ks = {0, 0, 0, 0, 0},
        .default_k_count = 0,
        .k_unit = "",
        .xmin = 0.0,
        .xmax = 62.0,
        .ymin = -3.8,
        .ymax = 4.2,
    },
    {
        .id = "xi_real",
        .name = "Completed Zeta xi(x)",
        .formula = "xi(x) = (1/2) x(x-1) pi^(-x/2) Gamma(x/2) zeta(x)",
        .description =
            "Completed zeta function restricted to the real axis: perfectly symmetric around x = "
            "1/2 (xi(x) = xi(1 - x)) with xi(0) = xi(1) = 1/2 and minimum at x = 1/2.",
        .c_source = "double rfn_xi_real(double x) {\n"
                    "    return creal(c_xi(c_make(x, 0.0)));\n"
                    "}",
        .exact_fn = rfn_xi_real,
        .approx_fn = NULL,
        .baseline_fn = NULL,
        .baseline_label = NULL,
        .is_step_exact = false,
        .show_primes = false,
        .show_zeros = false,
        .max_k = 0,
        .default_ks = {0, 0, 0, 0, 0},
        .default_k_count = 0,
        .k_unit = "",
        .xmin = -4.0,
        .xmax = 5.0,
        .ymin = 0.0,
        .ymax = 4.5,
    },
    {
        .id = "fourier_square",
        .name = "Fourier Square Wave",
        .formula = "(4/pi) * sum_{k=1}^K sin((2k-1)x) / (2k-1)",
        .description = "Classic Fourier series convergence with Gibbs phenomenon overshoot at "
                       "discontinuities — an iconic companion to Riemann's explicit formula!",
        .c_source = "double rfn_square_wave_fourier(double x, int K) {\n"
                    "    double s = 0.0;\n"
                    "    for (int k = 1; k <= K; k++) s += sin((2*k-1)*x) / (2*k-1);\n"
                    "    return (4.0 / M_PI) * s;\n"
                    "}",
        .exact_fn = rfn_square_wave_exact,
        .approx_fn = rfn_square_wave_fourier,
        .baseline_fn = NULL,
        .baseline_label = NULL,
        .is_step_exact = true,
        .show_primes = false,
        .show_zeros = false,
        .max_k = 100,
        .default_ks = {1, 3, 9, 25, 75},
        .default_k_count = 5,
        .k_unit = "terms",
        .xmin = -6.5,
        .xmax = 6.5,
        .ymin = -1.6,
        .ymax = 1.6,
    },
    {
        .id = "sinc_wave",
        .name = "Damped Sinc Sandbox",
        .formula = "sinc(x) * cos(0.35x)",
        .description = "Simple real-valued sandbox function in real_functions.c — edit or replace "
                       "with your own literal C code and run `make web`.",
        .c_source = "double rfn_sinc_wave(double x) {\n"
                    "    if (fabs(x) < 1e-9) return 1.0;\n"
                    "    return (sin(M_PI * x) / (M_PI * x)) * cos(0.35 * x);\n"
                    "}",
        .exact_fn = rfn_sinc_wave,
        .approx_fn = NULL,
        .baseline_fn = NULL,
        .baseline_label = NULL,
        .is_step_exact = false,
        .show_primes = false,
        .show_zeros = false,
        .max_k = 0,
        .default_ks = {0, 0, 0, 0, 0},
        .default_k_count = 0,
        .k_unit = "",
        .xmin = -8.0,
        .xmax = 8.0,
        .ymin = -0.5,
        .ymax = 1.2,
    },
};

size_t real_functions_count(void) { return sizeof(REAL_REGISTRY) / sizeof(REAL_REGISTRY[0]); }

const RealFunctionDef *real_functions_get(size_t index) {
    if (index >= real_functions_count()) {
        return NULL;
    }
    return &REAL_REGISTRY[index];
}

typedef struct {
    const RealFunctionDef *fn;
    int kind;
    int k;
    const double *xs;
    double *ys;
    size_t start;
    size_t end;
} RealSampleJob;

static void *real_sample_worker(void *arg) {
    RealSampleJob *job = (RealSampleJob *)arg;
    for (size_t i = job->start; i < job->end; i++) {
        double x = job->xs[i];
        double y = NAN;
        if (job->kind == 0 && job->fn->exact_fn) {
            y = job->fn->exact_fn(x);
        } else if (job->kind == 1 && job->fn->baseline_fn) {
            y = job->fn->baseline_fn(x);
        } else if (job->kind == 2 && job->fn->approx_fn) {
            y = job->fn->approx_fn(x, job->k);
        }
        job->ys[i] = y;
    }
    return NULL;
}

void real_sample_series(const RealFunctionDef *fn, int kind, int k, const double *xs, size_t count,
                        double *ys_out) {
    if (!fn || !xs || !ys_out || count == 0) {
        return;
    }

    /* Use 4 threads for expensive high-K explicit formula series; single thread for cheap curves.
     */
    if (kind == 2 && k >= 15 && count >= 120) {
        const int nthreads = 4;
        pthread_t threads[4];
        RealSampleJob jobs[4];
        size_t chunk = (count + (size_t)nthreads - 1) / (size_t)nthreads;
        int launched = 0;

        for (int t = 0; t < nthreads; t++) {
            size_t s = (size_t)t * chunk;
            if (s >= count) {
                break;
            }
            size_t e = s + chunk;
            if (e > count) {
                e = count;
            }
            jobs[t] = (RealSampleJob){
                .fn = fn, .kind = kind, .k = k, .xs = xs, .ys = ys_out, .start = s, .end = e};
            if (pthread_create(&threads[t], NULL, real_sample_worker, &jobs[t]) == 0) {
                launched++;
            } else {
                real_sample_worker(&jobs[t]);
            }
        }
        for (int t = 0; t < launched; t++) {
            pthread_join(threads[t], NULL);
        }
    } else {
        RealSampleJob job = {
            .fn = fn, .kind = kind, .k = k, .xs = xs, .ys = ys_out, .start = 0, .end = count};
        real_sample_worker(&job);
    }
}
