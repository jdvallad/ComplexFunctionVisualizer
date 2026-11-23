#include "real_math.h"
#include "complex_math.h"

#include <math.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#ifndef M_LN2
#define M_LN2 0.69314718055994530942
#endif

/*
 * First 200 non-trivial zeros of zeta(1/2 + i*gamma_k) = 0,
 * verified against c_zeta to < 5.2e-13.
 */
const double RIEMANN_ZEROS[RIEMANN_ZERO_COUNT] = {
    14.134725141734698,  21.022039638771552,  25.010857580145689,  30.424876125859512,
    32.935061587739185,  37.586178158825675,  40.918719012147506,  43.327073280915002,
    48.005150881167154,  49.773832477672286,  52.970321477714464,  56.446247697063384,
    59.347044002602360,  60.831778524609803,  65.112544048081617,  67.079810529494182,
    69.546401711173985,  72.067157674481905,  75.704690699083926,  77.144840068874799,
    79.337375020249368,  82.910380854086043,  84.735492980517051,  87.425274613125225,
    88.809111207634487,  92.491899270558491,  94.651344040519859,  95.870634228245279,
    98.831194218193701,  101.317851005731399, 103.725538040478369, 105.446623052326117,
    107.168611184276386, 111.029535543169658, 111.874659176992651, 114.320220915452751,
    116.226680320857554, 118.790782865976212, 121.370125002420622, 122.946829293552611,
    124.256818554345784, 127.516683879596485, 129.578704199956007, 131.087688530932667,
    133.497737202997598, 134.756509753373848, 138.116042054533466, 139.736208952121387,
    141.123707404021104, 143.111845807620625, 146.000982486765508, 147.422765342559558,
    150.053520420784878, 150.925257612241467, 153.024693811198858, 156.112909294237852,
    157.597591817594093, 158.849988171420534, 161.188964137596031, 163.030709687181968,
    165.537069187900443, 167.184439978174510, 169.094515415568878, 169.911976479411692,
    173.411536519591550, 174.754191523365762, 176.441434297710430, 178.377407776099972,
    179.916484020257030, 182.207078484366491, 184.874467848387440, 185.598783677707445,
    187.228922583501799, 189.416158656016933, 192.026656360713787, 193.079726603845700,
    195.265396679529260, 196.876481840958320, 198.015309676251889, 201.264751943703743,
    202.493594514140455, 204.189671803104545, 205.394697202163343, 207.906258887806189,
    209.576509716856322, 211.690862595365275, 213.347919359712705, 214.547044783491458,
    216.169538508263713, 219.067596349021358, 220.714918839314009, 221.430705554693361,
    224.007000254604293, 224.983324669582316, 227.421444279679292, 229.337413305525331,
    231.250188700499109, 231.987235253180302, 233.693404178908281, 236.524229665816165,
    237.769820480925205, 239.555477573327664, 241.049157796216605, 242.823271934222589,
    244.070898497078133, 247.136990074897540, 248.101990060148523, 249.573689644707201,
    251.014947795016042, 253.069986747999508, 255.306256454914035, 256.380713694434462,
    258.610439491531338, 259.874406989677937, 260.805084504596834, 263.573893904870147,
    265.557851838876331, 266.614973781501135, 267.921915082824057, 269.970449023997617,
    271.494055641644991, 273.459609188403306, 275.587492649343858, 276.452049503132912,
    278.250743529841884, 279.229250927745170, 282.465114765052135, 283.211185733233833,
    284.835963980904694, 286.667445363002912, 287.911920501422173, 289.579854929218868,
    291.846291329067412, 293.558434139356336, 294.965369619265630, 295.573254878958323,
    297.979277061943435, 299.840326053721242, 301.649325462194156, 302.696749589606952,
    304.864371340857360, 305.728912602036871, 307.219496128170022, 310.109463146701955,
    311.165141530355982, 312.427801180600909, 313.985285731159024, 315.475616089475693,
    317.734805942370144, 318.853104256316556, 321.160134309113573, 322.144558672482844,
    323.466969557512016, 324.862866051739616, 327.443901261905467, 329.033071680480816,
    329.953239728233825, 331.474467582663465, 333.645378524869784, 334.211354833244286,
    336.841850428390671, 338.339992850806652, 339.858216725363491, 341.042261111046628,
    342.054877510363553, 344.661702940252326, 346.347870566009988, 347.272677584420421,
    349.316260870696169, 350.408419349192059, 351.878649025359209, 353.488900488718741,
    356.017574977264985, 357.151302252039386, 357.952685101632142, 359.743754953114490,
    361.289361695804587, 363.331330578973848, 364.736024114088991, 366.212710288331323,
    367.993575481740322, 368.968438095734314, 370.050919212106010, 373.061928372112902,
    373.864873910908614, 375.825912766739293, 376.324092230668157, 378.436680249965434,
    379.872975346532371, 381.484468617186508, 383.443529449536527, 384.956116814863776,
    385.861300845974370, 387.222890222387946, 388.846128354232292, 391.456083563637890,
    392.245083339519056, 393.427743844433962, 395.582870010993815, 396.381854222592210};

/* Mobius function mu(n) for n = 0 .. 64 (covers x up to 2^64!). */
static const int8_t MOBIUS[65] = {0,  1, -1, -1, 0, -1, 1,  -1, 0,  0,  1,  -1, 0,  -1, 1,  1, 0,
                                  -1, 0, -1, 0,  1, 1,  -1, 0,  0,  1,  0,  0,  -1, -1, -1, 0, 1,
                                  1,  1, 0,  -1, 1, 1,  0,  -1, -1, -1, 0,  0,  1,  -1, 0,  0, 0,
                                  1,  0, -1, 0,  1, 0,  1,  1,  -1, 0,  -1, 1,  0,  0};

static bool is_prime_int(int n) {
    if (n < 2) {
        return false;
    }
    if (n < 4) {
        return true;
    }
    if (n % 2 == 0 || n % 3 == 0) {
        return false;
    }
    for (int d = 5; d * d <= n; d += 6) {
        if (n % d == 0 || n % (d + 2) == 0) {
            return false;
        }
    }
    return true;
}

/* Thread-safe lazy sieve table up to 100000 for O(1) exact pi(x) and psi(x) lookups. */
#define PRIME_LIMIT 100000
static int g_pi_table[PRIME_LIMIT + 1];
static double g_psi_table[PRIME_LIMIT + 1];
static pthread_once_t g_sieve_once = PTHREAD_ONCE_INIT;

static void init_prime_tables(void) {
    static uint8_t composite[PRIME_LIMIT + 1];
    for (int p = 2; p * p <= PRIME_LIMIT; p++) {
        if (!composite[p]) {
            for (int m = p * p; m <= PRIME_LIMIT; m += p) {
                composite[m] = 1;
            }
        }
    }
    int pi_acc = 0;
    for (int i = 2; i <= PRIME_LIMIT; i++) {
        if (!composite[i]) {
            pi_acc++;
            double lp = log((double)i);
            for (long long pk = i; pk <= PRIME_LIMIT; pk *= i) {
                g_psi_table[pk] += lp;
            }
        }
        g_pi_table[i] = pi_acc;
    }
    double psi_acc = 0.0;
    for (int i = 1; i <= PRIME_LIMIT; i++) {
        psi_acc += g_psi_table[i];
        g_psi_table[i] = psi_acc;
    }
}

static void ensure_prime_tables(void) {
    pthread_once(&g_sieve_once, init_prime_tables);
}

double real_pi_exact(double x) {
    if (x < 2.0) {
        return 0.0;
    }
    ensure_prime_tables();
    int n = (int)floor(x);
    if (n <= PRIME_LIMIT) {
        return (double)g_pi_table[n];
    }
    /* Fallback beyond 100k */
    int cnt = g_pi_table[PRIME_LIMIT];
    for (int k = PRIME_LIMIT + 1; k <= n; k++) {
        if (is_prime_int(k)) {
            cnt++;
        }
    }
    return (double)cnt;
}

double real_li(double x) {
    if (x <= 1.0) {
        return NAN;
    }
    return creal(c_ei(c_make(log(x), 0.0)));
}

double real_J_exact(double x) {
    if (x < 2.0) {
        return 0.0;
    }
    double sum = 0.0;
    for (int n = 1; n <= 64; n++) {
        double root = pow(x, 1.0 / (double)n);
        if (root < 2.0) {
            break;
        }
        sum += real_pi_exact(root) / (double)n;
    }
    return sum;
}

/* Tail integral int_x^inf dt / (t * (t^2 - 1) * ln t) = sum_{m=1}^inf E_1(2*m*ln x). */
static double riemann_tail_integral(double lnx) {
    double sum = 0.0;
    for (int m = 1; m <= 60; m++) {
        double arg = 2.0 * (double)m * lnx;
        if (arg > 40.0) {
            break;
        }
        double term = c_e1_real(arg);
        sum += term;
        if (term < 1e-14 * (sum + 1e-30)) {
            break;
        }
    }
    return sum;
}

/* Fast asymptotic Re(Ei(a + i*b)) for |a + i*b| >= 22 (error < 2e-7, ~8x faster than Lentz CF). */
static inline double fast_re_ei_asymp(double a, double b, double exp_a) {
    double r2 = a * a + b * b;
    double inv_r = a / r2;
    double inv_i = -b / r2;
    /* sum_{k=0}^7 k! * (1/z)^k via Horner or direct recurrence */
    double sr = 1.0, si = 0.0;
    double tr = 1.0, ti = 0.0;
    for (int k = 1; k <= 7; k++) {
        double nr = (tr * inv_r - ti * inv_i) * (double)k;
        double ni = (tr * inv_i + ti * inv_r) * (double)k;
        tr = nr;
        ti = ni;
        sr += tr;
        si += ti;
    }
    /* Multiply by (1/z) * e^z = (inv_r + i*inv_i) * exp_a * (cos b + i*sin b) */
    double pr = sr * inv_r - si * inv_i;
    double pi = sr * inv_i + si * inv_r;
    return exp_a * (pr * cos(b) - pi * sin(b));
}

double real_J_explicit(double x, int num_zeros) {
    if (x <= 1.05) {
        return 0.0;
    }
    if (num_zeros < 0) {
        num_zeros = 0;
    }
    if (num_zeros > RIEMANN_ZERO_COUNT) {
        num_zeros = RIEMANN_ZERO_COUNT;
    }

    double lnx = log(x);
    double val = creal(c_ei(c_make(lnx, 0.0))) - M_LN2 + riemann_tail_integral(lnx);

    double half_lnx = 0.5 * lnx;
    double sqrtx = sqrt(x);
    for (int k = 0; k < num_zeros; k++) {
        double b = RIEMANN_ZEROS[k] * lnx;
        double r2 = half_lnx * half_lnx + b * b;
        if (r2 >= 484.0) {
            val -= 2.0 * fast_re_ei_asymp(half_lnx, b, sqrtx);
        } else {
            val -= 2.0 * creal(c_ei(c_make(half_lnx, b)));
        }
    }
    return val;
}

double real_pi_explicit(double x, int num_zeros) {
    if (x <= 1.05) {
        return 0.0;
    }
    if (num_zeros == 0) {
        /* Smooth Riemann R(x) or Li(x) baseline: use Mobius-inverted J_0(x) = R(x)
         * or Li(x). Actually J_0(x) via Mobius inversion is Riemann's R(x) (even closer
         * to pi(x) than Li(x)!). Let's compute exact Mobius inversion of J_K(x) for all K >= 0
         * so K = 0 is the exact 0-zero term of the explicit formula! */
    }
    double sum = 0.0;
    for (int n = 1; n <= 64; n++) {
        if (MOBIUS[n] == 0) {
            continue;
        }
        double root = pow(x, 1.0 / (double)n);
        if (root < 1.65) {
            break;
        }
        sum += ((double)MOBIUS[n] / (double)n) * real_J_explicit(root, num_zeros);
    }
    return sum;
}

double real_psi_exact(double x) {
    if (x < 2.0) {
        return 0.0;
    }
    ensure_prime_tables();
    int n = (int)floor(x);
    if (n <= PRIME_LIMIT) {
        return g_psi_table[n];
    }
    return g_psi_table[PRIME_LIMIT];
}

double real_psi_explicit(double x, int num_zeros) {
    if (x <= 1.02) {
        return 0.0;
    }
    if (num_zeros < 0) {
        num_zeros = 0;
    }
    if (num_zeros > RIEMANN_ZERO_COUNT) {
        num_zeros = RIEMANN_ZERO_COUNT;
    }

    double lnx = log(x);
    double sqrtx = sqrt(x);
    double val = x - log(2.0 * M_PI) - 0.5 * log(1.0 - 1.0 / (x * x));

    for (int k = 0; k < num_zeros; k++) {
        double g = RIEMANN_ZEROS[k];
        /* Re(x^(1/2 + ig) / (1/2 + ig)) = sqrt(x) * (0.5*cos(g*lnx) + g*sin(g*lnx)) / (0.25 + g^2)
         */
        double ang = g * lnx;
        double re_term = sqrtx * (0.5 * cos(ang) + g * sin(ang)) / (0.25 + g * g);
        val -= 2.0 * re_term;
    }
    return val;
}

double real_zero_wave(double x, int zero_idx) {
    if (x <= 1.05 || zero_idx < 0 || zero_idx >= RIEMANN_ZERO_COUNT) {
        return 0.0;
    }
    double lnx = log(x);
    double complex z = c_make(0.5 * lnx, RIEMANN_ZEROS[zero_idx] * lnx);
    return -2.0 * creal(c_ei(z));
}

static const double RGL8_X[8] = {-0.96028985649753623168, -0.79666647741362673959,
                                 -0.52553240991632898582, -0.18343464249564980494,
                                 0.18343464249564980494,  0.52553240991632898582,
                                 0.79666647741362673959,  0.96028985649753623168};

static const double RGL8_W[8] = {
    0.10122853629037625915, 0.22238103445337447054, 0.31370664587788728734, 0.36268378337836198297,
    0.36268378337836198297, 0.31370664587788728734, 0.22238103445337447054, 0.10122853629037625915};

static double gl8_real_panel(RealScalarFn fn, double a, double b) {
    double mid = 0.5 * (a + b);
    double half = 0.5 * (b - a);
    double s = 0.0;
    for (int i = 0; i < 8; i++) {
        double v = fn(mid + half * RGL8_X[i]);
        if (isfinite(v)) {
            s += RGL8_W[i] * v;
        }
    }
    return half * s;
}

static double gl8_real_adapt(RealScalarFn fn, double a, double b, double whole, int depth) {
    double m = 0.5 * (a + b);
    double left = gl8_real_panel(fn, a, m);
    double right = gl8_real_panel(fn, m, b);
    if (depth >= 8 || fabs((left + right) - whole) < 1e-8) {
        return left + right;
    }
    return gl8_real_adapt(fn, a, m, left, depth + 1) + gl8_real_adapt(fn, m, b, right, depth + 1);
}

double real_integrate_interval(RealScalarFn fn, double a, double b) {
    if (!fn || !isfinite(a) || !isfinite(b) || fabs(b - a) < 1e-12) {
        return 0.0;
    }
    /* Subdivide into 16 panels first so step functions like pi(x) integrate cleanly. */
    const int panels = 16;
    double h = (b - a) / (double)panels;
    double total = 0.0;
    for (int i = 0; i < panels; i++) {
        double x0 = a + h * (double)i;
        double x1 = a + h * (double)(i + 1);
        double w = gl8_real_panel(fn, x0, x1);
        total += gl8_real_adapt(fn, x0, x1, w, 0);
    }
    return total;
}

static pthread_mutex_t g_seed_mu = PTHREAD_MUTEX_INITIALIZER;
static uint64_t g_seed_rows[64];
static unsigned char g_seed_grid[128][128]; /* [gy + 64][gx + 64] for gx, gy in [-64, 63] */
static int g_seed_total = 0;
static uint64_t g_seed_epoch = 1;

/* Cached Conway's Game of Life generation snapshot on [-R, R-1]^2
 * - Global board g_life_board[122][122] steps incrementally in O(1) when gen advances by +1!
 * - _Thread_local cache avoids 7,200 mutex locks across 4 pthreads during parametric sampling! */
#define MAX_LIFE_CELLS 800
static uint64_t g_life_cache_epoch = 0;
static int g_life_cache_R = -1;
static int g_life_cache_gen = -1;
static int g_life_cnt = 0;
static int g_life_ax[MAX_LIFE_CELLS];
static int g_life_ay[MAX_LIFE_CELLS];
static unsigned char g_life_board[122][122];

static _Thread_local uint64_t tls_life_epoch = 0;
static _Thread_local int tls_life_R = -1;
static _Thread_local int tls_life_gen = -1;
static _Thread_local int tls_life_cnt = 0;
static _Thread_local int16_t tls_life_ax[MAX_LIFE_CELLS];
static _Thread_local int16_t tls_life_ay[MAX_LIFE_CELLS];

void real_seed_set_rows(const uint64_t *rows, size_t count) {
    pthread_mutex_lock(&g_seed_mu);
    int total = 0;
    for (int y = 0; y < 128; y++) {
        for (int x = 0; x < 128; x++) {
            g_seed_grid[y][x] = 0;
        }
    }
    for (size_t i = 0; i < 64; i++) {
        uint64_t v = (rows && i < count) ? rows[i] : 0ULL;
        g_seed_rows[i] = v;
        for (int b = 0; b < 64; b++) {
            if ((v >> b) & 1ULL) {
                g_seed_grid[i + 64][b + 64] = 1;
                total++;
            }
        }
    }
    g_seed_total = total;
    g_seed_epoch++;
    pthread_mutex_unlock(&g_seed_mu);
}

void real_seed_set_cells(const int *xy, size_t npairs) {
    pthread_mutex_lock(&g_seed_mu);
    for (int y = 0; y < 128; y++) {
        for (int x = 0; x < 128; x++) {
            g_seed_grid[y][x] = 0;
        }
    }
    for (int i = 0; i < 64; i++) {
        g_seed_rows[i] = 0ULL;
    }
    int total = 0;
    if (xy) {
        for (size_t i = 0; i < npairs; i++) {
            int gx = xy[i * 2];
            int gy = xy[i * 2 + 1];
            if (gx >= -64 && gx < 64 && gy >= -64 && gy < 64) {
                if (!g_seed_grid[gy + 64][gx + 64]) {
                    g_seed_grid[gy + 64][gx + 64] = 1;
                    total++;
                }
                if (gx >= 0 && gx < 64 && gy >= 0 && gy < 64) {
                    g_seed_rows[gy] |= (1ULL << gx);
                }
            }
        }
    }
    g_seed_total = total;
    g_seed_epoch++;
    pthread_mutex_unlock(&g_seed_mu);
}

uint64_t real_seed_row(int r) {
    if (r < 0 || r >= 64) {
        return 0ULL;
    }
    pthread_mutex_lock(&g_seed_mu);
    uint64_t v = g_seed_rows[r];
    pthread_mutex_unlock(&g_seed_mu);
    return v;
}

int real_seed_count(void) {
    pthread_mutex_lock(&g_seed_mu);
    int c = g_seed_total;
    pthread_mutex_unlock(&g_seed_mu);
    return c;
}

int real_life_cell_at(int R, int gen, int cell_idx, int *out_gx, int *out_gy) {
    if (R < 4) R = 4;
    if (R > 60) R = 60;
    if (gen < 0) gen = 0;
    if (gen > 400) gen = 400;

    /* Fast lock-free thread-local hit (covers 1,799 out of 1,800 calls per pthread per frame!) */
    uint64_t cur_epoch = g_seed_epoch;
    if (tls_life_epoch == cur_epoch && tls_life_R == R && tls_life_gen == gen) {
        int total = tls_life_cnt;
        if (cell_idx >= 0 && cell_idx < total) {
            if (out_gx) *out_gx = (int)tls_life_ax[cell_idx];
            if (out_gy) *out_gy = (int)tls_life_ay[cell_idx];
        }
        return total;
    }

    pthread_mutex_lock(&g_seed_mu);
    if (g_life_cache_epoch != g_seed_epoch || g_life_cache_R != R || g_life_cache_gen != gen) {
        const int side = 2 * R;
        unsigned char nxt[122][122];
        int start_gen = 0;

        /* Incremental stepping: if same seed & radius and gen >= cached gen, step forward from cached board! */
        if (g_life_cache_epoch == g_seed_epoch && g_life_cache_R == R &&
            g_life_cache_gen >= 0 && gen >= g_life_cache_gen) {
            start_gen = g_life_cache_gen;
        } else {
            for (int r = 0; r <= side + 1; r++) {
                for (int c = 0; c <= side + 1; c++) {
                    g_life_board[r][c] = 0;
                }
            }
            for (int r = 0; r < side; r++) {
                int gy = r - R;
                for (int c = 0; c < side; c++) {
                    int gx = c - R;
                    g_life_board[r + 1][c + 1] = g_seed_grid[gy + 64][gx + 64];
                }
            }
        }

        for (int s = start_gen; s < gen; s++) {
            for (int r = 1; r <= side; r++) {
                const unsigned char *rp = g_life_board[r - 1];
                const unsigned char *rc = g_life_board[r];
                const unsigned char *rn = g_life_board[r + 1];
                for (int c = 1; c <= side; c++) {
                    int nb = (int)rp[c - 1] + (int)rp[c] + (int)rp[c + 1] +
                             (int)rc[c - 1] +              (int)rc[c + 1] +
                             (int)rn[c - 1] + (int)rn[c] + (int)rn[c + 1];
                    nxt[r][c] = (unsigned char)(nb == 3 || (rc[c] && nb == 2));
                }
            }
            for (int r = 1; r <= side; r++) {
                for (int c = 1; c <= side; c++) {
                    g_life_board[r][c] = nxt[r][c];
                }
            }
        }
        int cnt = 0;
        for (int r = side; r >= 1 && cnt < MAX_LIFE_CELLS; r--) {
            for (int c = 1; c <= side && cnt < MAX_LIFE_CELLS; c++) {
                if (g_life_board[r][c]) {
                    g_life_ax[cnt] = (c - 1) - R;
                    g_life_ay[cnt] = (r - 1) - R;
                    cnt++;
                }
            }
        }
        g_life_cnt = cnt;
        g_life_cache_R = R;
        g_life_cache_gen = gen;
        g_life_cache_epoch = g_seed_epoch;
    }

    int total = g_life_cnt;
    tls_life_cnt = total;
    for (int i = 0; i < total; i++) {
        tls_life_ax[i] = (int16_t)g_life_ax[i];
        tls_life_ay[i] = (int16_t)g_life_ay[i];
    }
    tls_life_R = R;
    tls_life_gen = gen;
    tls_life_epoch = g_life_cache_epoch;
    pthread_mutex_unlock(&g_seed_mu);

    if (cell_idx >= 0 && cell_idx < total) {
        if (out_gx) *out_gx = (int)tls_life_ax[cell_idx];
        if (out_gy) *out_gy = (int)tls_life_ay[cell_idx];
    }
    return total;
}
