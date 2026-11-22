#include "complex_math.h"

#include <math.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#ifndef M_LN2
#define M_LN2 0.69314718055994530942
#endif

static const double LN_PI = 1.14472988584940017414;
static const double HALF_LN_2PI = 0.91893853320467274178;

/* Godfrey's Lanczos coefficients (g = 7, n = 9) for ~15-digit accuracy. */
static const double LANCZOS_P[9] = {0.99999999999980993227684700473478,
                                    676.520368121885098567009190444019,
                                    -1259.13921672240287047156078755283,
                                    771.3234287776530788486528258894,
                                    -176.61502916214059906584551354,
                                    12.507343278686904814458936853,
                                    -0.13857109526572011689554707,
                                    9.984369578019570859563e-6,
                                    1.50563273514931155834e-7};

/* Precomputed B_{2k} / (2k)! for k = 1 .. 12 (Euler-Maclaurin weights). */
#define EM_BERNOULLI_TERMS 12
static const double B2K_OVER_FACT[EM_BERNOULLI_TERMS] = {1.0 / 12.0,
                                                         -1.0 / 720.0,
                                                         1.0 / 30240.0,
                                                         -1.0 / 1209600.0,
                                                         1.0 / 47900160.0,
                                                         -691.0 / 1307674368000.0,
                                                         1.0 / 74724249600.0,
                                                         -3617.0 / 10670622842880000.0,
                                                         43867.0 / 5109094217170944000.0,
                                                         -174611.0 / 802857662698291200000.0,
                                                         854513.0 / 155112100433309859840000.0,
                                                         -236364091.0 /
                                                             1693824136731743669452800000.0};

bool c_isfinite(double complex z) { return isfinite(creal(z)) && isfinite(cimag(z)); }

static double complex c_lgamma_rhp(double complex z) {
    double complex zm1 = z - 1.0;
    double complex x = c_make(LANCZOS_P[0], 0.0);
    for (int i = 1; i < 9; i++) {
        x += LANCZOS_P[i] / (zm1 + (double)i);
    }
    double complex t = zm1 + 7.5;
    return HALF_LN_2PI + (zm1 + 0.5) * clog(t) - t + clog(x);
}

double complex c_lgamma(double complex z) {
    if (creal(z) >= 0.5) {
        return c_lgamma_rhp(z);
    }
    /* Reflection: ln(Gamma(z)) = ln(pi) - ln(sin(pi*z)) - ln(Gamma(1 - z)). */
    double complex sin_pz = csin(M_PI * z);
    if (cabs(sin_pz) < 1e-15) {
        return c_make(INFINITY, 0.0);
    }
    return LN_PI - clog(sin_pz) - c_lgamma_rhp(1.0 - z);
}

double complex c_gamma(double complex z) {
    if (creal(z) >= 0.5) {
        return cexp(c_lgamma_rhp(z));
    }
    /* Reflection: Gamma(z) = pi / (sin(pi * z) * Gamma(1 - z)). */
    double t = cimag(z);
    double complex lg = c_lgamma_rhp(1.0 - z);
    double complex i_pi_z = c_make(0.0, M_PI) * z;
    if (t >= 0.0) {
        double complex denom_factor = c_make(0.0, 0.5) * (1.0 - cexp(2.0 * i_pi_z));
        if (cabs(denom_factor) < 1e-15) {
            return c_make(INFINITY, 0.0);
        }
        return cexp(LN_PI + i_pi_z - lg) / denom_factor;
    } else {
        double complex denom_factor = c_make(0.0, -0.5) * (1.0 - cexp(-2.0 * i_pi_z));
        if (cabs(denom_factor) < 1e-15) {
            return c_make(INFINITY, 0.0);
        }
        return cexp(LN_PI - i_pi_z - lg) / denom_factor;
    }
}

/*
 * Euler-Maclaurin summation for zeta(s).
 * Accurate to ~15 digits for Re(s) >= 0.5 and in a neighborhood of s = 0.
 */
static double complex c_zeta_em(double complex s) {
    double complex sm1 = s - 1.0;
    if (cabs(sm1) < 1e-13) {
        return c_make(INFINITY, 0.0);
    }

    double sigma = creal(s);
    double t = cimag(s);
    double r = cabs(s);

    /*
     * Choose N so that (|s| + 2M) / (2*pi*N) <= ~0.21, ensuring the
     * 12-term Bernoulli tail drops below double machine epsilon.
     */
    int N = (int)ceil(0.75 * r + 18.0);
    if (N < 18) {
        N = 18;
    }
    if (N > 2048) {
        N = 2048;
    }

    /* Partial Dirichlet sum: sum_{n=1}^{N-1} n^{-s} */
    double sum_re = 1.0;
    double sum_im = 0.0;
    for (int n = 2; n < N; n++) {
        double ln_n = log((double)n);
        double mag = exp(-sigma * ln_n);
        double ang = -t * ln_n;
        sum_re += mag * cos(ang);
        sum_im += mag * sin(ang);
    }

    double complex sum = c_make(sum_re, sum_im);

    double ln_N = log((double)N);
    double mag_N = exp(-sigma * ln_N);
    double ang_N = -t * ln_N;
    double complex N_neg_s = c_make(mag_N * cos(ang_N), mag_N * sin(ang_N));

    /* Integral term N^{1-s}/(s-1) + midpoint term (1/2) N^{-s} */
    sum += ((double)N * N_neg_s) / sm1 + 0.5 * N_neg_s;

    /* Bernoulli correction series */
    double inv_N = 1.0 / (double)N;
    double inv_N2 = inv_N * inv_N;
    double complex prod = s * N_neg_s * inv_N;

    for (int k = 0; k < EM_BERNOULLI_TERMS; k++) {
        double complex term = B2K_OVER_FACT[k] * prod;
        sum += term;
        if (k >= 2 && cabs(term) < 1e-16 * (cabs(sum) + 1e-30)) {
            break;
        }
        int j = 2 * k + 1;
        prod *= (s + (double)j) * (s + (double)(j + 1)) * inv_N2;
    }

    return sum;
}

double complex c_zeta(double complex s) {
    if (!c_isfinite(s)) {
        return c_make(NAN, NAN);
    }

    double sigma = creal(s);
    double t = cimag(s);

    /* Fast path for large positive real part where zeta(s) -> 1. */
    if (sigma > 55.0) {
        return c_make(1.0, 0.0) + cexp(-s * M_LN2);
    }

    /*
     * Evaluate directly via Euler-Maclaurin on Re(s) >= 0.5 and in a small
     * disk around s = 0 (avoiding the 0 * inf removable singularity at s = 0
     * where 1 - s hits the pole at 1).
     */
    if (sigma >= 0.5 || cabs(s) < 0.25) {
        return c_zeta_em(s);
    }

    /* Exact trivial zeros at negative even integers s = -2, -4, -6, ... */
    if (t == 0.0 && sigma < 0.0) {
        double nearest = round(sigma);
        if (fabs(sigma - nearest) < 1e-14 && ((long long)llround(nearest) % 2 == 0)) {
            return c_make(0.0, 0.0);
        }
    }

    /*
     * Full analytic continuation to Re(s) < 0.5 via Riemann's functional eq:
     *   zeta(s) = 2^s * pi^(s-1) * sin(pi*s / 2) * Gamma(1 - s) * zeta(1 - s)
     *
     * Computed in log-space so the e^(+pi|t|/2) growth of sin(pi*s/2) cancels
     * the e^(-pi|t|/2) decay of Gamma(1-s) without overflow.
     */
    double complex one_minus_s = 1.0 - s;
    double complex z_ref = c_zeta_em(one_minus_s);
    double complex lg = c_lgamma_rhp(one_minus_s);
    double complex log_pref = s * M_LN2 + (s - 1.0) * LN_PI + lg;

    double complex sin_factor;
    double complex expo;
    if (t >= 0.0) {
        /* sin(pi*s/2) = (i/2) * e^(-i*pi*s/2) * (1 - e^(i*pi*s)) */
        sin_factor = c_make(0.0, 0.5) * (1.0 - cexp(c_make(0.0, M_PI) * s));
        expo = cexp(log_pref - c_make(0.0, 0.5 * M_PI) * s);
    } else {
        /* sin(pi*s/2) = (-i/2) * e^(+i*pi*s/2) * (1 - e^(-i*pi*s)) */
        sin_factor = c_make(0.0, -0.5) * (1.0 - cexp(c_make(0.0, -M_PI) * s));
        expo = cexp(log_pref + c_make(0.0, 0.5 * M_PI) * s);
    }

    return sin_factor * expo * z_ref;
}

double complex c_eta(double complex s) {
    if (cabs(s - 1.0) < 1e-12) {
        return c_make(M_LN2, 0.0);
    }
    return (1.0 - cexp((1.0 - s) * M_LN2)) * c_zeta(s);
}

double complex c_zeta_deriv(double complex s) {
    if (!c_isfinite(s) || cabs(s - 1.0) < 1e-7) {
        return c_make(INFINITY, 0.0);
    }
    const double h = 1e-4;
    double complex f_m2 = c_zeta(s - 2.0 * h);
    double complex f_m1 = c_zeta(s - h);
    double complex f_p1 = c_zeta(s + h);
    double complex f_p2 = c_zeta(s + 2.0 * h);
    return (-f_p2 + 8.0 * f_p1 - 8.0 * f_m1 + f_m2) / (12.0 * h);
}

double complex c_zeta_log_deriv(double complex s) {
    if (!c_isfinite(s) || cabs(s - 1.0) < 1e-7) {
        return c_make(INFINITY, 0.0);
    }
    double complex z = c_zeta(s);
    if (!c_isfinite(z) || cabs(z) < 1e-12) {
        return c_make(INFINITY, 0.0);
    }
    return c_zeta_deriv(s) / z;
}

static const double EULER_MASCHERONI = 0.57721566490153286061;
static const double STIELTJES_G1 = -0.07281584548367672486;

double complex c_xi(double complex s) {
    if (!c_isfinite(s)) {
        return c_make(NAN, NAN);
    }

    /* Exploit exact reflection symmetry xi(s) = xi(1 - s) so Re(s) >= 0.5. */
    if (creal(s) < 0.5) {
        s = 1.0 - s;
    }

    /*
     * Compute (s - 1) * zeta(s) smoothly across the removable singularity at s = 1
     * using its Laurent series: (s-1)*zeta(s) = 1 + gamma*(s-1) - gamma_1*(s-1)^2 + ...
     */
    double complex sm1 = s - 1.0;
    double complex sm1_zeta;
    if (cabs(sm1) < 1e-5) {
        sm1_zeta = 1.0 + EULER_MASCHERONI * sm1 - STIELTJES_G1 * sm1 * sm1;
    } else {
        sm1_zeta = sm1 * c_zeta(s);
    }

    /* Compute ln(Gamma(s/2)). Since Re(s) >= 0.5, Re(s/2) >= 0.25. */
    double complex half_s = 0.5 * s;
    double complex lg_half_s;
    if (creal(half_s) >= 0.5) {
        lg_half_s = c_lgamma_rhp(half_s);
    } else {
        /* Shift right by +1: ln(Gamma(z)) = ln(Gamma(z + 1)) - ln(z). */
        lg_half_s = c_lgamma_rhp(half_s + 1.0) - clog(half_s);
    }

    double complex log_factor = -half_s * LN_PI + lg_half_s;
    double complex res = 0.5 * s * sm1_zeta * cexp(log_factor);

    /* On the critical line Re(s) = 0.5, xi is strictly real by functional symmetry. */
    if (fabs(creal(s) - 0.5) < 1e-14) {
        res = c_make(creal(res), 0.0);
    }
    return res;
}

double c_hardy_z(double t) {
    /* theta(t) = Im(ln Gamma(1/4 + i*t/2)) - (t/2) * ln(pi) */
    double complex q = c_make(0.25, 0.5 * t);
    double complex lg = c_lgamma_rhp(q + 1.0) - clog(q);
    double theta = cimag(lg) - 0.5 * t * LN_PI;
    double complex val = cexp(c_make(0.0, theta)) * c_zeta(c_make(0.5, t));
    return creal(val);
}

/* Contracted continued fraction for E_1(w) via modified Lentz's algorithm. */
static double complex c_e1_cf(double complex w) {
    const double tiny = 1e-30;
    double complex b0 = w + 1.0;
    double complex f = cabs(b0) > tiny ? b0 : c_make(tiny, 0.0);
    double complex C = f;
    double complex D = c_make(0.0, 0.0);

    for (int k = 1; k <= 160; k++) {
        double a = -(double)k * (double)k;
        double complex b = w + (double)(2 * k + 1);
        D = b + a * D;
        if (cabs(D) < tiny) {
            D = c_make(tiny, 0.0);
        }
        C = b + a / C;
        if (cabs(C) < tiny) {
            C = c_make(tiny, 0.0);
        }
        D = 1.0 / D;
        double complex delta = C * D;
        f *= delta;
        if (cabs(delta - 1.0) < 1e-14) {
            break;
        }
    }
    return cexp(-w) / f;
}

static double complex c_ei_series(double complex z) {
    double complex sum = c_make(EULER_MASCHERONI, 0.0) + clog(z);
    double complex term = z;
    for (int k = 1; k <= 160; k++) {
        double complex contrib = term / (double)k;
        sum += contrib;
        if (cabs(contrib) < 1e-16 * (cabs(sum) + 1e-30)) {
            break;
        }
        term = term * z / (double)(k + 1);
    }
    return sum;
}

double complex c_ei(double complex z) {
    if (!c_isfinite(z) || cabs(z) < 1e-15) {
        return c_make(NAN, NAN);
    }
    double im = cimag(z);
    double re = creal(z);
    /* For real positive z (e.g. li(x) = Ei(ln x)), all series terms are positive. */
    if (fabs(im) < 1e-13 && re > 0.0) {
        if (re <= 40.0) {
            return c_ei_series(z);
        }
        /* Asymptotic expansion for very large positive real z > 40. */
        double inv = 1.0 / re;
        double s = 1.0;
        double term = 1.0;
        for (int k = 1; k <= 30; k++) {
            term *= (double)k * inv;
            s += term;
        }
        return c_make(exp(re) * inv * s, 0.0);
    }
    if (cabs(z) < 8.0) {
        return c_ei_series(z);
    }
    double complex res = -c_e1_cf(-z);
    if (im > 0.0) {
        res += c_make(0.0, M_PI);
    } else if (im < 0.0) {
        res -= c_make(0.0, M_PI);
    }
    return res;
}

double c_e1_real(double x) {
    if (x <= 0.0 || !isfinite(x)) {
        return NAN;
    }
    if (x < 1.5) {
        double sum = -EULER_MASCHERONI - log(x);
        double term = -x;
        for (int k = 1; k <= 80; k++) {
            double contrib = -term / (double)k;
            sum += contrib;
            if (fabs(contrib) < 1e-16 * (fabs(sum) + 1e-30)) {
                break;
            }
            term = -term * x / (double)(k + 1);
        }
        return sum;
    }
    return creal(c_e1_cf(c_make(x, 0.0)));
}

double complex c_zeta_partial(double complex s, int N) {
    if (!c_isfinite(s)) {
        return c_make(NAN, NAN);
    }
    if (N < 1) {
        N = 1;
    }
    if (N > 2000) {
        N = 2000;
    }
    double sigma = creal(s);
    double t = cimag(s);
    double sum_re = 1.0;
    double sum_im = 0.0;
    for (int n = 2; n <= N; n++) {
        double ln_n = log((double)n);
        double exponent = -sigma * ln_n;
        if (exponent > 500.0) {
            return c_make(INFINITY, 0.0);
        }
        double mag = exp(exponent);
        double ang = -t * ln_n;
        sum_re += mag * cos(ang);
        sum_im += mag * sin(ang);
    }
    return c_make(sum_re, sum_im);
}
