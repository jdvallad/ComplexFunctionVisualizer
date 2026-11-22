/*
 * ============================================================================
 *  functions.c — Define your complex functions here as literal C code!
 * ============================================================================
 *
 *  To visualize your own complex function f(z):
 *    1. Write a C function with signature:
 *           static double complex fn_my_func(double complex z) { ... }
 *       You have full access to <complex.h> (cexp, clog, csin, ccos, cpow,
 *       csqrt, creal, cimag, cabs, carg) plus complex_math.h (c_make, c_zeta,
 *       c_gamma, c_lgamma, c_eta).
 *    2. Add an entry to the REGISTRY[] array below (put it first to make it
 *       the default on startup).
 *    3. Rebuild and run with:  make web
 * ============================================================================
 */

#include "functions.h"
#include "complex_math.h"

#include <math.h>

/* ----------------------------------------------------------------------------
 * 1. Prototype Function: Full Analytic Continuation of Riemann Zeta zeta(s)
 * ---------------------------------------------------------------------------- */
static double complex fn_riemann_zeta(double complex s) { return c_zeta(s); }

static const SpecialPoint ZETA_LANDMARKS[] = {
    {1.0, 0.0, "Pole s = 1", "pole"},
    {-2.0, 0.0, "Trivial zero -2", "zero"},
    {-4.0, 0.0, "Trivial zero -4", "zero"},
    {-6.0, 0.0, "Trivial zero -6", "zero"},
    {0.5, 14.13472514, "Zero #1 (1/2 + 14.135i)", "zero"},
    {0.5, 21.02203964, "Zero #2 (1/2 + 21.022i)", "zero"},
    {0.5, 25.01085758, "Zero #3 (1/2 + 25.011i)", "zero"},
    {0.5, 30.42487613, "Zero #4 (1/2 + 30.425i)", "zero"},
    {0.5, 32.93506159, "Zero #5 (1/2 + 32.935i)", "zero"},
    {0.5, -14.13472514, "Zero #-1 (1/2 - 14.135i)", "zero"},
    {0.5, -21.02203964, "Zero #-2 (1/2 - 21.022i)", "zero"},
};

/* ----------------------------------------------------------------------------
 * 1a. Completed Riemann Zeta Function: xi(s)
 *     xi(s) = (1/2) s (s - 1) pi^(-s/2) Gamma(s/2) zeta(s)
 *     Entire across all C, symmetric xi(s) = xi(1 - s), real on Re(s) = 1/2!
 * ---------------------------------------------------------------------------- */
static double complex fn_riemann_xi(double complex s) { return c_xi(s); }

static const SpecialPoint XI_LANDMARKS[] = {
    {0.5, 0.0, "Symmetry center s = 1/2", "landmark"},
    {1.0, 0.0, "xi(1) = 1/2 (removable pole!)", "landmark"},
    {0.0, 0.0, "xi(0) = 1/2", "landmark"},
    {0.5, 14.13472514, "Zero #1 (1/2 + 14.135i)", "zero"},
    {0.5, 21.02203964, "Zero #2 (1/2 + 21.022i)", "zero"},
    {0.5, 25.01085758, "Zero #3 (1/2 + 25.011i)", "zero"},
    {0.5, -14.13472514, "Zero #-1 (1/2 - 14.135i)", "zero"},
};

/* ----------------------------------------------------------------------------
 * 1b. Zeta Logarithmic Derivative: zeta'(s) / zeta(s)
 *     By Cauchy's Argument Principle, (1 / 2pi*i) * oint zeta'/zeta ds
 *     counts (zeros - poles) enclosed by any contour!
 * ---------------------------------------------------------------------------- */
static double complex fn_zeta_log_deriv(double complex s) { return c_zeta_log_deriv(s); }

/* ----------------------------------------------------------------------------
 * 1c. Simple Pole: f(z) = 1 / z  (Residue +1 at z = 0)
 * ---------------------------------------------------------------------------- */
static double complex fn_inv_z(double complex z) {
    if (cabs(z) < 1e-12) {
        return c_make(INFINITY, 0.0);
    }
    return 1.0 / z;
}

static const SpecialPoint SIMPLE_POLE_ORIGIN[] = {
    {0.0, 0.0, "Simple pole z = 0 (Res = 1)", "pole"},
};

/* ----------------------------------------------------------------------------
 * 1d. Two Poles: f(z) = 1 / (z^2 + 1)  (Poles at +/-i, Res = -/+ i/2)
 * ---------------------------------------------------------------------------- */
static double complex fn_two_poles(double complex z) {
    double complex d = z * z + 1.0;
    if (cabs(d) < 1e-12) {
        return c_make(INFINITY, 0.0);
    }
    return 1.0 / d;
}

static const SpecialPoint TWO_POLES_LANDMARKS[] = {
    {0.0, 1.0, "Pole +i (Res = -i/2)", "pole"},
    {0.0, -1.0, "Pole -i (Res = +i/2)", "pole"},
};

/* ----------------------------------------------------------------------------
 * 2. Euler Gamma Function Gamma(z)
 * ---------------------------------------------------------------------------- */
static double complex fn_gamma(double complex z) { return c_gamma(z); }

static const SpecialPoint GAMMA_LANDMARKS[] = {
    {0.0, 0.0, "Pole z = 0", "pole"},   {-1.0, 0.0, "Pole z = -1", "pole"},
    {-2.0, 0.0, "Pole z = -2", "pole"}, {-3.0, 0.0, "Pole z = -3", "pole"},
    {-4.0, 0.0, "Pole z = -4", "pole"},
};

/* ----------------------------------------------------------------------------
 * 3. Complex Squaring f(z) = z^2
 * ---------------------------------------------------------------------------- */
static double complex fn_square(double complex z) { return z * z; }

static const SpecialPoint ZERO_ORIGIN[] = {
    {0.0, 0.0, "Double zero z = 0", "zero"},
};

/* ----------------------------------------------------------------------------
 * 4. Joukowsky Airfoil Transform f(z) = (z + 1/z) / 2
 * ---------------------------------------------------------------------------- */
static double complex fn_joukowsky(double complex z) {
    if (cabs(z) < 1e-12) {
        return c_make(INFINITY, 0.0);
    }
    return 0.5 * (z + 1.0 / z);
}

static const SpecialPoint JOUKOWSKY_LANDMARKS[] = {
    {0.0, 0.0, "Pole z = 0", "pole"},
    {1.0, 0.0, "Critical pt +1", "landmark"},
    {-1.0, 0.0, "Critical pt -1", "landmark"},
};

/* ----------------------------------------------------------------------------
 * 5. Complex Sine f(z) = sin(z)
 * ---------------------------------------------------------------------------- */
static double complex fn_sin(double complex z) { return csin(z); }

/* ----------------------------------------------------------------------------
 * 6. Essential Singularity f(z) = exp(1 / z)
 * ---------------------------------------------------------------------------- */
static double complex fn_exp_inv(double complex z) {
    if (cabs(z) < 1e-12) {
        return c_make(INFINITY, 0.0);
    }
    return cexp(1.0 / z);
}

static const SpecialPoint POLE_ORIGIN[] = {
    {0.0, 0.0, "Essential singularity z = 0", "pole"},
};

/* ----------------------------------------------------------------------------
 * 7. Custom Sandbox Example: f(z) = (z^3 - 1) / (z^2 + 1)
 *    Edit this function (or add your own!) and run `make web`.
 * ---------------------------------------------------------------------------- */
static double complex fn_rational(double complex z) {
    double complex denom = z * z + 1.0;
    if (cabs(denom) < 1e-12) {
        return c_make(INFINITY, 0.0);
    }
    return (z * z * z - 1.0) / denom;
}

static const SpecialPoint RATIONAL_LANDMARKS[] = {
    {0.0, 1.0, "Pole +i", "pole"},
    {0.0, -1.0, "Pole -i", "pole"},
    {1.0, 0.0, "Zero 1", "zero"},
    {-0.5, 0.8660254, "Zero e^(2pi*i/3)", "zero"},
    {-0.5, -0.8660254, "Zero e^(-2pi*i/3)", "zero"},
};

/* ----------------------------------------------------------------------------
 * Function Registry
 * ---------------------------------------------------------------------------- */
static const FunctionDef REGISTRY[] = {
    {
        .id = "zeta",
        .name = "Riemann Zeta",
        .formula = "zeta(s)",
        .description = "Full analytic continuation of the Riemann zeta function across C \\ {1} "
                       "via Euler-Maclaurin summation and the functional equation.",
        .c_source = "double complex fn_riemann_zeta(double complex s) {\n"
                    "    /* Euler-Maclaurin (Re(s) >= 0.5) +\n"
                    "     * Functional Eq: 2^s pi^(s-1) sin(pi*s/2) Gamma(1-s) zeta(1-s) */\n"
                    "    return c_zeta(s);\n"
                    "}",
        .eval = fn_riemann_zeta,
        .in_cx = 0.5,
        .in_cy = 14.0,
        .in_radius = 12.0,
        .out_cx = 0.5,
        .out_cy = 0.0,
        .out_radius = 4.0,
        .landmarks = ZETA_LANDMARKS,
        .landmark_count = sizeof(ZETA_LANDMARKS) / sizeof(ZETA_LANDMARKS[0]),
    },
    {
        .id = "xi",
        .name = "Completed Zeta xi(s)",
        .formula = "xi(s)",
        .description = "Entire completed Riemann zeta function: xi(s) = (1/2) s(s-1) pi^(-s/2) "
                       "Gamma(s/2) zeta(s). Satisfies xi(s) = xi(1 - s), is real on Re(s) = 1/2, "
                       "and its ONLY zeros are the non-trivial zeros of zeta!",
        .c_source = "double complex fn_riemann_xi(double complex s) {\n"
                    "    /* Entire function: xi(s) = xi(1 - s), no poles, no trivial zeros! */\n"
                    "    return c_xi(s);\n"
                    "}",
        .eval = fn_riemann_xi,
        .in_cx = 0.5,
        .in_cy = 0.0,
        .in_radius = 4.5,
        .out_cx = 0.5,
        .out_cy = 0.0,
        .out_radius = 1.5,
        .landmarks = XI_LANDMARKS,
        .landmark_count = sizeof(XI_LANDMARKS) / sizeof(XI_LANDMARKS[0]),
    },
    {
        .id = "zeta_log_deriv",
        .name = "Zeta Zero Counter",
        .formula = "zeta'(s) / zeta(s)",
        .description = "Logarithmic derivative of zeta(s). Integrating around any closed contour "
                       "divided by 2*pi*i counts (Riemann zeros - poles) inside!",
        .c_source = "double complex fn_zeta_log_deriv(double complex s) {\n"
                    "    /* (1 / 2*pi*i) * oint zeta'(s)/zeta(s) ds = Z - P */\n"
                    "    return c_zeta_log_deriv(s);\n"
                    "}",
        .eval = fn_zeta_log_deriv,
        .in_cx = 0.5,
        .in_cy = 18.0,
        .in_radius = 12.0,
        .out_cx = 0.0,
        .out_cy = 0.0,
        .out_radius = 4.0,
        .landmarks = ZETA_LANDMARKS,
        .landmark_count = sizeof(ZETA_LANDMARKS) / sizeof(ZETA_LANDMARKS[0]),
    },
    {
        .id = "inv_z",
        .name = "Simple Pole",
        .formula = "1 / z",
        .description = "Prototype Cauchy residue function: any counterclockwise loop around z = 0 "
                       "integrates to exact 2*pi*i.",
        .c_source = "double complex fn_inv_z(double complex z) {\n"
                    "    return 1.0 / z;\n"
                    "}",
        .eval = fn_inv_z,
        .in_cx = 0.0,
        .in_cy = 0.0,
        .in_radius = 3.0,
        .out_cx = 0.0,
        .out_cy = 0.0,
        .out_radius = 3.5,
        .landmarks = SIMPLE_POLE_ORIGIN,
        .landmark_count = sizeof(SIMPLE_POLE_ORIGIN) / sizeof(SIMPLE_POLE_ORIGIN[0]),
    },
    {
        .id = "two_poles",
        .name = "Two Poles",
        .formula = "1 / (z^2 + 1)",
        .description = "Simple poles at +i (integral +pi) and -i (integral -pi). Enclosing both "
                       "poles cancels the residues to 0!",
        .c_source = "double complex fn_two_poles(double complex z) {\n"
                    "    return 1.0 / (z * z + 1.0);\n"
                    "}",
        .eval = fn_two_poles,
        .in_cx = 0.0,
        .in_cy = 0.0,
        .in_radius = 3.0,
        .out_cx = 0.0,
        .out_cy = 0.0,
        .out_radius = 3.5,
        .landmarks = TWO_POLES_LANDMARKS,
        .landmark_count = sizeof(TWO_POLES_LANDMARKS) / sizeof(TWO_POLES_LANDMARKS[0]),
    },
    {
        .id = "gamma",
        .name = "Euler Gamma",
        .formula = "Gamma(z)",
        .description =
            "Analytic continuation of (z-1)! via Lanczos approximation and Euler reflection.",
        .c_source = "double complex fn_gamma(double complex z) {\n"
                    "    return c_gamma(z);\n"
                    "}",
        .eval = fn_gamma,
        .in_cx = 0.0,
        .in_cy = 0.0,
        .in_radius = 4.5,
        .out_cx = 0.0,
        .out_cy = 0.0,
        .out_radius = 4.5,
        .landmarks = GAMMA_LANDMARKS,
        .landmark_count = sizeof(GAMMA_LANDMARKS) / sizeof(GAMMA_LANDMARKS[0]),
    },
    {
        .id = "joukowsky",
        .name = "Joukowsky Map",
        .formula = "(z + 1/z) / 2",
        .description = "Classic aerodynamic conformal map transforming off-center circles into "
                       "airfoil profiles.",
        .c_source = "double complex fn_joukowsky(double complex z) {\n"
                    "    return 0.5 * (z + 1.0 / z);\n"
                    "}",
        .eval = fn_joukowsky,
        .in_cx = 0.0,
        .in_cy = 0.0,
        .in_radius = 3.0,
        .out_cx = 0.0,
        .out_cy = 0.0,
        .out_radius = 3.0,
        .landmarks = JOUKOWSKY_LANDMARKS,
        .landmark_count = sizeof(JOUKOWSKY_LANDMARKS) / sizeof(JOUKOWSKY_LANDMARKS[0]),
    },
    {
        .id = "square",
        .name = "Complex Square",
        .formula = "z^2",
        .description =
            "Doubles angles and squares radii; closed loops around 0 wrap twice in output space.",
        .c_source = "double complex fn_square(double complex z) {\n"
                    "    return z * z;\n"
                    "}",
        .eval = fn_square,
        .in_cx = 0.0,
        .in_cy = 0.0,
        .in_radius = 3.0,
        .out_cx = 0.0,
        .out_cy = 0.0,
        .out_radius = 6.0,
        .landmarks = ZERO_ORIGIN,
        .landmark_count = sizeof(ZERO_ORIGIN) / sizeof(ZERO_ORIGIN[0]),
    },
    {
        .id = "sin",
        .name = "Complex Sine",
        .formula = "sin(z)",
        .description =
            "Periodic along the real axis and exponentially growing along the imaginary axis.",
        .c_source = "double complex fn_sin(double complex z) {\n"
                    "    return csin(z);\n"
                    "}",
        .eval = fn_sin,
        .in_cx = 0.0,
        .in_cy = 0.0,
        .in_radius = 4.0,
        .out_cx = 0.0,
        .out_cy = 0.0,
        .out_radius = 5.0,
        .landmarks = NULL,
        .landmark_count = 0,
    },
    {
        .id = "exp_inv",
        .name = "Essential Singularity",
        .formula = "exp(1/z)",
        .description = "Illustrates Picard's Great Theorem: near z = 0 it assumes almost every "
                       "complex value infinitely often.",
        .c_source = "double complex fn_exp_inv(double complex z) {\n"
                    "    return cexp(1.0 / z);\n"
                    "}",
        .eval = fn_exp_inv,
        .in_cx = 0.0,
        .in_cy = 0.0,
        .in_radius = 2.5,
        .out_cx = 0.0,
        .out_cy = 0.0,
        .out_radius = 5.0,
        .landmarks = POLE_ORIGIN,
        .landmark_count = sizeof(POLE_ORIGIN) / sizeof(POLE_ORIGIN[0]),
    },
    {
        .id = "rational",
        .name = "Rational Demo",
        .formula = "(z^3 - 1) / (z^2 + 1)",
        .description = "Three cube-root zeros and two poles at +/-i. Great for exploring Cauchy's "
                       "Argument Principle.",
        .c_source = "double complex fn_rational(double complex z) {\n"
                    "    return (z * z * z - 1.0) / (z * z + 1.0);\n"
                    "}",
        .eval = fn_rational,
        .in_cx = 0.0,
        .in_cy = 0.0,
        .in_radius = 3.0,
        .out_cx = 0.0,
        .out_cy = 0.0,
        .out_radius = 5.0,
        .landmarks = RATIONAL_LANDMARKS,
        .landmark_count = sizeof(RATIONAL_LANDMARKS) / sizeof(RATIONAL_LANDMARKS[0]),
    },
};

size_t functions_count(void) { return sizeof(REGISTRY) / sizeof(REGISTRY[0]); }

const FunctionDef *functions_get(size_t index) {
    if (index >= functions_count()) {
        return NULL;
    }
    return &REGISTRY[index];
}
