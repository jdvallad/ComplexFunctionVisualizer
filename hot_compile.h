#ifndef HOT_COMPILE_H
#define HOT_COMPILE_H

#include <complex.h>
#include <stdbool.h>
#include <stddef.h>

#define MAX_HOT_SLOTS 24
#define MAX_EVAL_PARAMS 16

typedef struct {
    double v[MAX_EVAL_PARAMS];
    int count;
} EvalParams;

/* Initialize hot-compiler state. */
void hot_init(void);

/* Unload any dynamically compiled shared libraries and remove temp files. */
void hot_cleanup(void);

/*
 * Single-function convenience wrapper (legacy /api/compile compatibility).
 */
bool hot_compile_code(bool is_real, const char *code, char *diag_out, size_t diag_cap,
                      double *elapsed_ms_out);

/*
 * Compiles an entire Desmos-style workspace of C expression cards + named
 * slider parameters into a single native shared library via `clang -O2 -shared -fPIC`.
 *   is_real = false -> Complex cards (z and s both bound to input double complex)
 *   is_real = true  -> 2D Real cards (x bound to input double)
 * Cards may reference earlier cards as f1(z), f2(z), ... (or f1(x), f2(x), ...)
 * and any slider parameter by its identifier name (e.g. K, N, t, a, b).
 */
bool hot_compile_workspace(bool is_real, const char *const *card_codes, size_t card_count,
                           const char *const *param_names, size_t param_count, char *diag_out,
                           size_t diag_cap, double *elapsed_ms_out);

/* Thread-safe status & evaluators. */
bool hot_has_complex(void);
bool hot_has_real(void);
int hot_complex_slot_count(void);
int hot_real_slot_count(void);

double complex hot_eval_complex(double complex z);
double hot_eval_real(double x);

double complex hot_eval_complex_slot(int slot, double complex z, const EvalParams *params);
double hot_eval_real_slot(int slot, double x, const EvalParams *params);
double hot_eval_real2d_slot(int slot, double x, double y, const EvalParams *params);

/* Multi-threaded batch sampling for a compiled 2D real slot. */
void hot_sample_real_slot(int slot, const EvalParams *params, const double *xs, size_t count,
                          double *ys_out);

/* Multi-threaded 2D grid evaluation for implicit relations F(x, y) = 0. */
void hot_sample_implicit_slot(int slot, const EvalParams *params, double xmin, double xmax,
                              double ymin, double ymax, int nx, int ny, float *grid_out);

/* Multi-threaded sampling for 2D parametric curves (x(t), y(t)), interleaved [x, y] floats. */
void hot_sample_parametric_slot(int slot, const EvalParams *params, double tmin, double tmax,
                                size_t count, float *xy_out);

#endif /* HOT_COMPILE_H */
