#ifndef REAL_MATH_H
#define REAL_MATH_H

#include <stddef.h>
#include <stdint.h>

#define RIEMANN_ZERO_COUNT 200

/* First 200 non-trivial Riemann zeta zero imaginary parts gamma_1 .. gamma_200. */
extern const double RIEMANN_ZEROS[RIEMANN_ZERO_COUNT];

/* Exact prime-counting step function pi(x) = #{primes p <= x}. */
double real_pi_exact(double x);

/* Logarithmic integral li(x) = Ei(ln x) for x > 1. */
double real_li(double x);

/* Exact Riemann prime-power counting function J(x) = sum_{n>=1} (1/n) * pi(x^(1/n)). */
double real_J_exact(double x);

/*
 * Riemann's 1859 Explicit Formula for J(x) truncated to K non-trivial zero pairs:
 *   J_K(x) = li(x) - 2 * sum_{k=1}^K Re(Ei((1/2 + i*gamma_k) * ln x))
 *            - ln(2) + int_x^inf dt / (t * (t^2 - 1) * ln t)
 */
double real_J_explicit(double x, int num_zeros);

/*
 * Riemann's Explicit Formula for the prime-counting function pi(x) via Mobius inversion:
 *   pi_K(x) = sum_{n >= 1} (mu(n) / n) * J_K(x^(1/n))
 */
double real_pi_explicit(double x, int num_zeros);

/* Exact Chebyshev second function psi(x) = sum_{p^k <= x} ln(p). */
double real_psi_exact(double x);

/* Von Mangoldt explicit formula for Chebyshev psi(x) with K zero pairs. */
double real_psi_explicit(double x, int num_zeros);

/* Single Riemann zero oscillatory harmonic wave: -2 * Re(Ei((1/2 + i*gamma_idx)*ln x)). */
double real_zero_wave(double x, int zero_idx);

/* Adaptive 8-point Gauss-Legendre definite integral int_a^b f(x) dx. */
typedef double (*RealScalarFn)(double x);
double real_integrate_interval(RealScalarFn fn, double a, double b);

/* Thread-safe cellular automaton seed & cached [-R, R]^2 B3/S23 evaluator (from 2D Real polygons). */
void real_seed_set_rows(const uint64_t *rows, size_t count);
void real_seed_set_cells(const int *xy, size_t npairs);
uint64_t real_seed_row(int r);
int real_seed_count(void);
int real_life_cell_at(int R, int gen, int cell_idx, int *out_gx, int *out_gy);

#endif /* REAL_MATH_H */
