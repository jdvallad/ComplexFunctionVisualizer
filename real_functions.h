#ifndef REAL_FUNCTIONS_H
#define REAL_FUNCTIONS_H

#include <stdbool.h>
#include <stddef.h>

typedef double (*RealExactFn)(double x);
typedef double (*RealApproxFn)(double x, int k);

typedef struct {
    const char *id;
    const char *name;
    const char *formula;
    const char *description;
    const char *c_source;
    RealExactFn exact_fn;    /* Primary / exact curve y = f(x) */
    RealApproxFn approx_fn;  /* Optional convergence family y = f_K(x) (NULL if single curve) */
    RealExactFn baseline_fn; /* Optional smooth reference curve (e.g. Li(x)) */
    const char *baseline_label;
    bool is_step_exact; /* Draw exact curve cleanly as step staircase */
    bool show_primes;   /* Show prime markers along x-axis */
    bool show_zeros;    /* Show Riemann zero markers along x-axis */
    int max_k;          /* Maximum K for convergence slider */
    int default_ks[5];  /* Default multi-line K levels */
    int default_k_count;
    const char *k_unit; /* "zeros" or "harmonics" */

    /* Default 2D viewport */
    double xmin;
    double xmax;
    double ymin;
    double ymax;
} RealFunctionDef;

size_t real_functions_count(void);
const RealFunctionDef *real_functions_get(size_t index);

/*
 * Evaluates a single series (kind: 0=exact, 1=baseline, 2=approx(k)) over
 * evenly spaced xs[0..count-1] using pthreads for fast parallel evaluation.
 */
void real_sample_series(const RealFunctionDef *fn, int kind, int k, const double *xs, size_t count,
                        double *ys_out);

#endif /* REAL_FUNCTIONS_H */
