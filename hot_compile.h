#ifndef HOT_COMPILE_H
#define HOT_COMPILE_H

#include <complex.h>
#include <stdbool.h>
#include <stddef.h>

/* Initialize hot-compiler rwlock state. */
void hot_init(void);

/* Unload any dynamically compiled shared libraries and remove temp files. */
void hot_cleanup(void);

/*
 * Compiles user-supplied C source code into a temporary shared library using
 * `clang -O2 -shared -fPIC` and loads it via dlopen().
 *   is_real = false -> expects a function body or definition for:
 *                      double complex user_fn(double complex z)
 *   is_real = true  -> expects a function body or definition for:
 *                      double user_real_fn(double x)
 * On error, writes compiler diagnostics into diag_out.
 */
bool hot_compile_code(bool is_real, const char *code, char *diag_out, size_t diag_cap,
                      double *elapsed_ms_out);

/* Thread-safe evaluators for the active hot-compiled C functions. */
bool hot_has_complex(void);
bool hot_has_real(void);
double complex hot_eval_complex(double complex z);
double hot_eval_real(double x);

/* Retrieve current hot-compiled source snippet (empty string if none). */
void hot_get_source(bool is_real, char *out, size_t out_cap);

#endif /* HOT_COMPILE_H */
