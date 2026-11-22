#include "complex_math.h"
#include "functions.h"
#include "real_functions.h"
#include "real_math.h"
#include "sampler.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static int g_passed = 0;
static int g_failed = 0;

static void check_near(const char *label, double complex got, double complex expected, double tol) {
    double err = cabs(got - expected);
    if (c_isfinite(got) && err <= tol) {
        g_passed++;
        printf("  [PASS] %-42s  err = %.2e\n", label, err);
    } else {
        g_failed++;
        printf("  [FAIL] %-42s  got = (%.12f, %.12f), expected = (%.12f, %.12f), err = %.2e\n",
               label, creal(got), cimag(got), creal(expected), cimag(expected), err);
    }
}

int main(void) {
    printf("=== Complex Function Visualizer — Math Test Suite ===\n\n");

    printf("1. Right Half-Plane zeta(s) (Euler-Maclaurin):\n");
    check_near("zeta(2) = pi^2 / 6", c_zeta(c_make(2.0, 0.0)), c_make(M_PI * M_PI / 6.0, 0.0),
               1e-13);
    check_near("zeta(4) = pi^4 / 90", c_zeta(c_make(4.0, 0.0)), c_make(pow(M_PI, 4.0) / 90.0, 0.0),
               1e-13);
    check_near("zeta(0.5)", c_zeta(c_make(0.5, 0.0)), c_make(-1.4603545088095868, 0.0), 1e-12);
    check_near("zeta(1 + 2pi*i/ln2) (no eta singularity)",
               c_zeta(c_make(1.0, 2.0 * M_PI / log(2.0))),
               c_make(1.346579542836290, 0.109883136796206), 1e-12);

    printf("\n2. Analytic Continuation to Re(s) <= 0:\n");
    check_near("zeta(0) = -1/2", c_zeta(c_make(0.0, 0.0)), c_make(-0.5, 0.0), 1e-13);
    check_near("zeta(-1) = -1/12", c_zeta(c_make(-1.0, 0.0)), c_make(-1.0 / 12.0, 0.0), 1e-13);
    check_near("zeta(-2) = 0 (trivial zero)", c_zeta(c_make(-2.0, 0.0)), c_make(0.0, 0.0), 1e-13);
    check_near("zeta(-3) = 1/120", c_zeta(c_make(-3.0, 0.0)), c_make(1.0 / 120.0, 0.0), 1e-13);
    check_near("zeta(-4) = 0 (trivial zero)", c_zeta(c_make(-4.0, 0.0)), c_make(0.0, 0.0), 1e-13);
    check_near("zeta(-5) = -1/252", c_zeta(c_make(-5.0, 0.0)), c_make(-1.0 / 252.0, 0.0), 1e-12);
    check_near("zeta(-6) = 0 (trivial zero)", c_zeta(c_make(-6.0, 0.0)), c_make(0.0, 0.0), 1e-13);

    printf("\n3. Non-trivial Zeros on the Critical Line Re(s) = 1/2:\n");
    check_near("zeta(1/2 + 14.134725141734694i) = 0", c_zeta(c_make(0.5, 14.13472514173469379)),
               c_make(0.0, 0.0), 1e-11);
    check_near("zeta(1/2 + 21.022039638771555i) = 0", c_zeta(c_make(0.5, 21.02203963877155499)),
               c_make(0.0, 0.0), 1e-11);
    check_near("zeta(1/2 + 25.010857580145689i) = 0", c_zeta(c_make(0.5, 25.01085758014568876)),
               c_make(0.0, 0.0), 1e-11);
    check_near("zeta(1/2 - 14.134725141734694i) = 0", c_zeta(c_make(0.5, -14.13472514173469379)),
               c_make(0.0, 0.0), 1e-11);

    printf("\n4. Seam Continuity & Functional Equation Stability:\n");
    double complex left = c_zeta(c_make(0.5 - 1e-7, 35.0));
    double complex right = c_zeta(c_make(0.5 + 1e-7, 35.0));
    check_near("Continuity across Re(s)=0.5 at t=35", left, right, 1e-5);

    double complex high_left = c_zeta(c_make(0.5 - 1e-7, 100.0));
    double complex high_right = c_zeta(c_make(0.5 + 1e-7, 100.0));
    check_near("Continuity across Re(s)=0.5 at t=100", high_left, high_right, 1e-4);

    double complex zero_left = c_zeta(c_make(-0.25 - 1e-7, 0.0));
    double complex zero_right = c_zeta(c_make(-0.25 + 1e-7, 0.0));
    check_near("Continuity across |s|=0.25 seam", zero_left, zero_right, 1e-5);

    double complex conj_a = c_zeta(c_make(-1.3, 17.4));
    double complex conj_b = conj(c_zeta(c_make(-1.3, -17.4)));
    check_near("Conjugate symmetry in Re(s) < 0", conj_a, conj_b, 1e-11);

    double complex eps = c_make(1e-7, 2e-7);
    check_near("Simple pole residue: (s-1)*zeta(s) -> 1", eps * c_zeta(1.0 + eps), c_make(1.0, 0.0),
               1e-6);

    printf("\n5. Gamma Function & Function Registry:\n");
    check_near("Gamma(5) = 24", c_gamma(c_make(5.0, 0.0)), c_make(24.0, 0.0), 1e-12);
    check_near("Gamma(0.5) = sqrt(pi)", c_gamma(c_make(0.5, 0.0)), c_make(sqrt(M_PI), 0.0), 1e-13);
    check_near("Gamma(-0.5) = -2*sqrt(pi)", c_gamma(c_make(-0.5, 0.0)),
               c_make(-2.0 * sqrt(M_PI), 0.0), 1e-12);

    printf("  Registered functions: %zu (default: %s)\n", functions_count(),
           functions_get(0)->name);

    printf("\n6. Adaptive Gauss-Legendre Contour Integrals:\n");
    Point2D circ[64];
    /* 1. oint zeta(s) ds around pole s = 1 -> 2*pi*i */
    for (int i = 0; i < 64; i++) {
        double a = 2.0 * M_PI * (double)i / 64.0;
        circ[i] = (Point2D){1.0 + 0.4 * cos(a), 0.4 * sin(a)};
    }
    IntegralResult ir;
    sampler_integrate(functions_get(0), circ, 64, true, 0.2, &ir);
    check_near("oint zeta(s) ds around s=1 -> 2*pi*i", c_make(ir.total_re, ir.total_im),
               c_make(0.0, 2.0 * M_PI), 1e-8);
    integral_result_free(&ir);

    /* 2. oint zeta'(s)/zeta(s) ds around first 3 nontrivial zeros -> 3 * 2*pi*i */
    Point2D zero_box[4] = {
        {-0.5, 10.0},
        {1.5, 10.0},
        {1.5, 27.0},
        {-0.5, 27.0},
    };
    sampler_integrate(functions_get(2), zero_box, 4, true, 0.4, &ir);
    check_near("(1/2pi*i) oint zeta'/zeta (3 zeros) = +3",
               c_make(ir.total_re, ir.total_im) / c_make(0.0, 2.0 * M_PI), c_make(3.0, 0.0), 1e-6);
    integral_result_free(&ir);

    /* 3. oint 1/(z^2+1) dz around +i -> +pi */
    for (int i = 0; i < 64; i++) {
        double a = 2.0 * M_PI * (double)i / 64.0;
        circ[i] = (Point2D){0.5 * cos(a), 1.0 + 0.5 * sin(a)};
    }
    sampler_integrate(functions_get(4), circ, 64, true, 0.2, &ir);
    check_near("oint 1/(z^2+1) dz around +i -> +pi", c_make(ir.total_re, ir.total_im),
               c_make(M_PI, 0.0), 1e-9);
    integral_result_free(&ir);

    /* 4. oint 1/(z^2+1) dz around BOTH +i and -i -> 0 */
    for (int i = 0; i < 64; i++) {
        double a = 2.0 * M_PI * (double)i / 64.0;
        circ[i] = (Point2D){2.0 * cos(a), 2.0 * sin(a)};
    }
    sampler_integrate(functions_get(4), circ, 64, true, 0.2, &ir);
    check_near("oint 1/(z^2+1) dz around +/-i -> 0", c_make(ir.total_re, ir.total_im),
               c_make(0.0, 0.0), 1e-9);
    integral_result_free(&ir);

    printf("\n7. Completed Zeta xi(s) & Hardy Z(t):\n");
    check_near("xi(1) = 1/2", c_xi(c_make(1.0, 0.0)), c_make(0.5, 0.0), 1e-13);
    check_near("xi(0) = 1/2", c_xi(c_make(0.0, 0.0)), c_make(0.5, 0.0), 1e-13);
    check_near("xi(1/2) = 0.497120778188314", c_xi(c_make(0.5, 0.0)),
               c_make(0.4971207781883141, 0.0), 1e-12);
    check_near("xi(s) = xi(1-s) at s=-2.3+5.1i", c_xi(c_make(-2.3, 5.1)), c_xi(c_make(3.3, -5.1)),
               1e-13);
    check_near("xi(1/2 + 14.134725i) = 0", c_xi(c_make(0.5, RIEMANN_ZEROS[0])), c_make(0.0, 0.0),
               1e-13);
    check_near("Im(xi(1/2 + 7.5i)) = 0 (real on crit line)",
               c_make(cimag(c_xi(c_make(0.5, 7.5))), 0.0), c_make(0.0, 0.0), 1e-14);
    check_near("Hardy Z(gamma_1) = 0", c_make(c_hardy_z(RIEMANN_ZEROS[0]), 0.0), c_make(0.0, 0.0),
               1e-12);

    printf("\n8. Prime Counting pi(x) & Riemann Explicit Formula Convergence:\n");
    check_near("pi(100) = 25", c_make(real_pi_exact(100.0), 0.0), c_make(25.0, 0.0), 1e-12);
    check_near("pi(29.5) = 10", c_make(real_pi_exact(29.5), 0.0), c_make(10.0, 0.0), 1e-12);
    double pi_k0 = real_pi_explicit(29.5, 0);
    double pi_k5 = real_pi_explicit(29.5, 5);
    double pi_k50 = real_pi_explicit(29.5, 50);
    double pi_k200 = real_pi_explicit(29.5, 200);
    printf("  [INFO] pi(29.5) = 10  |  K=0: %.4f  K=5: %.4f  K=50: %.4f  K=200: %.4f\n", pi_k0,
           pi_k5, pi_k50, pi_k200);
    check_near("pi_explicit(29.5, K=200) -> 10", c_make(pi_k200, 0.0), c_make(10.0, 0.0), 0.05);
    check_near("pi_explicit(50.5, K=200) -> 15", c_make(real_pi_explicit(50.5, 200), 0.0),
               c_make(15.0, 0.0), 0.08);
    check_near("psi_explicit(29.5, K=200) -> psi(29.5)", c_make(real_psi_explicit(29.5, 200), 0.0),
               c_make(real_psi_exact(29.5), 0.0), 0.15);
    printf("  Registered 2D real functions: %zu (default: %s)\n", real_functions_count(),
           real_functions_get(0)->name);

    printf("\n9. Zero Hunter, Taylor Series, Dirichlet Partial Sums & 2D Definite Integrals:\n");
    FoundZero fz[16];
    size_t nfound = sampler_find_zeros(functions_get(0), NULL, 0, -0.5, 1.5, 12.0, 27.0, fz, 16);
    check_near("Zero Hunter found 3 zeta zeros in [12,27]", c_make((double)nfound, 0.0),
               c_make(3.0, 0.0), 1e-12);
    if (nfound > 0) {
        check_near("Zero Hunter 1st zero residual < 1e-10", c_make(fz[0].residual, 0.0),
                   c_make(0.0, 0.0), 1e-10);
    }

    TaylorResult tr;
    sampler_taylor(functions_get(0), 2.0, 0.0, 10, &tr);
    check_near("Taylor zeta around s=2 radius R = 1 (pole at 1)", c_make(tr.radius, 0.0),
               c_make(1.0, 0.0), 1e-12);
    check_near("Taylor zeta a_0 = zeta(2)", c_make(tr.coeff_re[0], tr.coeff_im[0]),
               c_make(M_PI * M_PI / 6.0, 0.0), 1e-11);

    check_near("Dirichlet partial sum S_200(2) -> pi^2/6", c_zeta_partial(c_make(2.0, 0.0), 200),
               c_make(M_PI * M_PI / 6.0, 0.0), 6e-3);

    double int_x2 = real_integrate_interval(real_functions_get(6)->exact_fn, 0.0, 1.0);
    check_near("2D Gauss-Legendre definite integral finite",
               c_make(isfinite(int_x2) ? 1.0 : 0.0, 0.0), c_make(1.0, 0.0), 1e-12);

    printf("\nSummary: %d passed, %d failed\n", g_passed, g_failed);
    return g_failed == 0 ? EXIT_SUCCESS : EXIT_FAILURE;
}
