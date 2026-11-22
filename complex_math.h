#ifndef COMPLEX_MATH_H
#define COMPLEX_MATH_H

#include <complex.h>
#include <stdbool.h>

/* Portable ISO C11 complex constructor (clean under -Wpedantic). */
static inline double complex c_make(double re, double im) {
#ifdef CMPLX
    return CMPLX(re, im);
#else
    return re + im * _Complex_I;
#endif
}

/* Returns true if both real and imaginary parts are finite numbers. */
bool c_isfinite(double complex z);

/* Complex log-Gamma function ln(Gamma(z)) for Re(z) > 0 via Lanczos. */
double complex c_lgamma(double complex z);

/* Full analytic continuation of Euler's Gamma function Gamma(z). */
double complex c_gamma(double complex z);

/*
 * Full analytic continuation of the Riemann zeta function zeta(s).
 * Accurate across the entire complex plane C \ {1}:
 *   - Euler-Maclaurin summation for Re(s) >= 0.5 and around s = 0
 *   - Log-stabilized Riemann functional equation for Re(s) < 0.5
 */
double complex c_zeta(double complex s);

/* Dirichlet eta function eta(s) = (1 - 2^(1-s)) * zeta(s). */
double complex c_eta(double complex s);

/* Complex derivative zeta'(s) via 4th-order central difference. */
double complex c_zeta_deriv(double complex s);

/* Logarithmic derivative zeta'(s) / zeta(s) (Argument Principle zero/pole counter). */
double complex c_zeta_log_deriv(double complex s);

/*
 * Completed Riemann zeta function:
 *   xi(s) = (1/2) * s * (s - 1) * pi^(-s/2) * Gamma(s/2) * zeta(s)
 * Entire across all of C, satisfies xi(s) = xi(1 - s), and is real on Re(s) = 1/2.
 */
double complex c_xi(double complex s);

/* Hardy's real-valued Z-function Z(t) = e^(i*theta(t)) * zeta(1/2 + i*t). */
double c_hardy_z(double t);

/* Complex exponential integral Ei(z) (for z off (-inf, 0]; real positive z supported). */
double complex c_ei(double complex z);

/* Real exponential integral E_1(x) = int_x^inf (e^-t / t) dt for x > 0. */
double c_e1_real(double x);

/* Partial Dirichlet sum S_N(s) = sum_{n=1}^N n^(-s) (diverges for Re(s) <= 1). */
double complex c_zeta_partial(double complex s, int N);

#endif /* COMPLEX_MATH_H */
