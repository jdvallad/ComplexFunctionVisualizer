#define _POSIX_C_SOURCE 200809L

#include "hot_compile.h"
#include "complex_math.h"
#include "sampler.h"

#include <ctype.h>
#include <dlfcn.h>
#include <math.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

typedef double complex (*HotComplexSlotFn)(int slot, double complex z, const EvalParams *params);
typedef double (*HotRealSlotFn)(int slot, double x, const EvalParams *params);
typedef double (*HotReal2DSlotFn)(int slot, double x, double y, const EvalParams *params);

#define HOT_CACHE_CAP 16

typedef struct {
    bool used;
    bool is_real;
    uint64_t hash;
    unsigned long last_use;
    char *source;
    size_t source_len;
    void *handle;
    HotComplexSlotFn complex_fn;
    HotRealSlotFn real_fn;
    HotReal2DSlotFn real2d_fn;
    int slots;
    char so_path[128];
} HotCacheEntry;

static pthread_rwlock_t g_hot_lock = PTHREAD_RWLOCK_INITIALIZER;
static HotCacheEntry g_cache[HOT_CACHE_CAP];
static int g_active_complex_idx = -1;
static int g_active_real_idx = -1;
static HotComplexSlotFn g_complex_slot_fn = NULL;
static HotRealSlotFn g_real_slot_fn = NULL;
static HotReal2DSlotFn g_real2d_slot_fn = NULL;
static int g_complex_slots = 0;
static int g_real_slots = 0;
static unsigned long g_build_seq = 0;
static unsigned long g_use_clock = 0;

void hot_init(void) { /* Static PTHREAD_RWLOCK_INITIALIZER is already ready. */
}

static void cache_entry_free(HotCacheEntry *e) {
    if (!e || !e->used) {
        return;
    }
    if (e->handle) {
        dlclose(e->handle);
    }
    if (e->so_path[0]) {
        unlink(e->so_path);
    }
    free(e->source);
    memset(e, 0, sizeof(*e));
}

void hot_cleanup(void) {
    pthread_rwlock_wrlock(&g_hot_lock);
    g_active_complex_idx = -1;
    g_active_real_idx = -1;
    g_complex_slot_fn = NULL;
    g_real_slot_fn = NULL;
    g_real2d_slot_fn = NULL;
    g_complex_slots = 0;
    g_real_slots = 0;
    for (int i = 0; i < HOT_CACHE_CAP; i++) {
        cache_entry_free(&g_cache[i]);
    }
    pthread_rwlock_unlock(&g_hot_lock);
}

static double now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec * 1e-6;
}

static uint64_t fnv1a_64(const char *s, size_t len) {
    uint64_t h = 14695981039346656037ULL;
    for (size_t i = 0; i < len; i++) {
        h ^= (unsigned char)s[i];
        h *= 1099511628211ULL;
    }
    return h;
}

typedef struct {
    char *data;
    size_t len;
    size_t cap;
} SrcBuf;

static bool sb_printf(SrcBuf *sb, const char *fmt, ...) {
    va_list ap, ap2;
    va_start(ap, fmt);
    va_copy(ap2, ap);
    int need = vsnprintf(NULL, 0, fmt, ap);
    va_end(ap);
    if (need < 0) {
        va_end(ap2);
        return false;
    }
    if (sb->len + (size_t)need + 1 > sb->cap) {
        size_t ncap = sb->cap ? sb->cap * 2 : 4096;
        while (ncap < sb->len + (size_t)need + 1) {
            ncap *= 2;
        }
        char *nd = realloc(sb->data, ncap);
        if (!nd) {
            va_end(ap2);
            return false;
        }
        sb->data = nd;
        sb->cap = ncap;
    }
    vsnprintf(sb->data + sb->len, sb->cap - sb->len, fmt, ap2);
    va_end(ap2);
    sb->len += (size_t)need;
    return true;
}

static bool is_valid_ident(const char *s) {
    if (!s || !s[0]) {
        return false;
    }
    if (!(isalpha((unsigned char)s[0]) || s[0] == '_')) {
        return false;
    }
    for (const char *p = s + 1; *p; p++) {
        if (!(isalnum((unsigned char)*p) || *p == '_')) {
            return false;
        }
    }
    if (strcmp(s, "z") == 0 || strcmp(s, "s") == 0 || strcmp(s, "x") == 0 || strcmp(s, "y") == 0 ||
        strcmp(s, "P") == 0 || strcmp(s, "slot") == 0) {
        return false;
    }
    return strlen(s) <= 24;
}

static bool looks_like_bare_expr(const char *code) {
    if (!code) {
        return false;
    }
    if (strstr(code, "return") != NULL || strchr(code, ';') != NULL || strchr(code, '{') != NULL) {
        return false;
    }
    return true;
}

static void activate_cached_locked(int idx) {
    HotCacheEntry *e = &g_cache[idx];
    e->last_use = ++g_use_clock;
    if (e->is_real) {
        g_active_real_idx = idx;
        g_real_slot_fn = e->real_fn;
        g_real2d_slot_fn = e->real2d_fn;
        g_real_slots = e->slots;
    } else {
        g_active_complex_idx = idx;
        g_complex_slot_fn = e->complex_fn;
        g_complex_slots = e->slots;
    }
}

bool hot_compile_workspace(bool is_real, const char *const *card_codes, size_t card_count,
                           const char *const *param_names, size_t param_count, char *diag_out,
                           size_t diag_cap, double *elapsed_ms_out) {
    if (!card_codes || card_count == 0 || card_count > MAX_HOT_SLOTS) {
        snprintf(diag_out, diag_cap, "Workspace must contain 1 to %d C cards.", MAX_HOT_SLOTS);
        return false;
    }
    if (param_count > MAX_EVAL_PARAMS) {
        param_count = MAX_EVAL_PARAMS;
    }

    double t0 = now_ms();

    /* Build generated C11 source into memory first so identical workspaces hit the 0ms LRU cache!
     */
    SrcBuf sb = {0};
    bool ok_gen = true;
    ok_gen &= sb_printf(&sb, "#include <complex.h>\n");
    ok_gen &= sb_printf(&sb, "#include <math.h>\n");
    ok_gen &= sb_printf(&sb, "#include <stdbool.h>\n");
    ok_gen &= sb_printf(&sb, "#include <stdlib.h>\n");
    ok_gen &= sb_printf(&sb, "#include \"complex_math.h\"\n");
    ok_gen &= sb_printf(&sb, "#include \"real_math.h\"\n");
    ok_gen &= sb_printf(&sb, "#include \"hot_compile.h\"\n\n");
    ok_gen &= sb_printf(&sb, "#ifndef M_PI\n#define M_PI 3.14159265358979323846\n#endif\n");
    ok_gen &= sb_printf(&sb, "#ifndef M_E\n#define M_E 2.71828182845904523536\n#endif\n\n");

    const char *ret_ty = is_real ? "double" : "double complex";
    const char *arg_decl = is_real ? "double x, double y" : "double complex z";

    for (size_t i = 0; i < card_count; i++) {
        ok_gen &= sb_printf(&sb, "static %s cfv_card_%zu(%s, const EvalParams *P);\n", ret_ty, i,
                            arg_decl);
    }
    ok_gen &= sb_printf(&sb, "\n");
    for (size_t i = 0; i < card_count; i++) {
        if (is_real) {
            ok_gen &= sb_printf(&sb, "#define f%zu(arg_) cfv_card_%zu((arg_), 0.0, P)\n", i + 1, i);
        } else {
            ok_gen &= sb_printf(&sb, "#define f%zu(arg_) cfv_card_%zu((arg_), P)\n", i + 1, i);
        }
    }
    ok_gen &= sb_printf(&sb, "\n");

    for (size_t i = 0; i < card_count; i++) {
        const char *code = card_codes[i];
        if (!code || !code[0]) {
            code = is_real ? "0.0" : "c_make(0.0, 0.0)";
        }
        ok_gen &= sb_printf(&sb, "static %s cfv_card_%zu(%s, const EvalParams *P) {\n", ret_ty, i,
                            arg_decl);
        ok_gen &= sb_printf(&sb, "    (void)P;\n");
        if (is_real) {
            ok_gen &= sb_printf(&sb, "    (void)x; (void)y;\n");
        } else {
            ok_gen &= sb_printf(&sb, "    double complex s = z; (void)z; (void)s;\n");
        }
        for (size_t p = 0; p < param_count; p++) {
            if (is_valid_ident(param_names[p])) {
                ok_gen &= sb_printf(&sb, "    double %s = P->v[%zu]; (void)%s;\n", param_names[p],
                                    p, param_names[p]);
            }
        }
        if (looks_like_bare_expr(code)) {
            ok_gen &= sb_printf(&sb, "    return (%s);\n", code);
        } else {
            ok_gen &= sb_printf(&sb, "%s\n", code);
        }
        ok_gen &= sb_printf(&sb, "}\n\n");
    }

    if (is_real) {
        ok_gen &=
            sb_printf(&sb, "double cfv_dispatch_real(int slot, double x, const EvalParams *P) {\n");
        ok_gen &= sb_printf(&sb, "    switch (slot) {\n");
        for (size_t i = 0; i < card_count; i++) {
            ok_gen &= sb_printf(&sb, "    case %zu: return cfv_card_%zu(x, 0.0, P);\n", i, i);
        }
        ok_gen &= sb_printf(&sb, "    default: return NAN;\n    }\n}\n\n");

        ok_gen &= sb_printf(
            &sb,
            "double cfv_dispatch_real2d(int slot, double x, double y, const EvalParams *P) {\n");
        ok_gen &= sb_printf(&sb, "    switch (slot) {\n");
        for (size_t i = 0; i < card_count; i++) {
            ok_gen &= sb_printf(&sb, "    case %zu: return cfv_card_%zu(x, y, P);\n", i, i);
        }
        ok_gen &= sb_printf(&sb, "    default: return NAN;\n    }\n}\n");
    } else {
        ok_gen &= sb_printf(&sb, "double complex cfv_dispatch_complex(int slot, double complex z, "
                                 "const EvalParams *P) {\n");
        ok_gen &= sb_printf(&sb, "    switch (slot) {\n");
        for (size_t i = 0; i < card_count; i++) {
            ok_gen &= sb_printf(&sb, "    case %zu: return cfv_card_%zu(z, P);\n", i, i);
        }
        ok_gen &= sb_printf(&sb, "    default: return c_make(NAN, NAN);\n    }\n}\n");
    }

    if (!ok_gen || !sb.data) {
        free(sb.data);
        snprintf(diag_out, diag_cap, "Out of memory generating C11 source.");
        return false;
    }

    uint64_t h = fnv1a_64(sb.data, sb.len);

    /* Fast path: check 16-entry compiled .so LRU cache (0ms hit!) */
    pthread_rwlock_wrlock(&g_hot_lock);
    for (int i = 0; i < HOT_CACHE_CAP; i++) {
        if (g_cache[i].used && g_cache[i].is_real == is_real && g_cache[i].hash == h &&
            g_cache[i].source_len == sb.len && memcmp(g_cache[i].source, sb.data, sb.len) == 0) {
            activate_cached_locked(i);
            pthread_rwlock_unlock(&g_hot_lock);
            free(sb.data);
            if (diag_out && diag_cap > 0) {
                diag_out[0] = '\0';
            }
            if (elapsed_ms_out) {
                *elapsed_ms_out = now_ms() - t0;
            }
            return true;
        }
    }
    unsigned long seq = ++g_build_seq;
    pthread_rwlock_unlock(&g_hot_lock);

    char c_path[128];
    char so_path[128];
    snprintf(c_path, sizeof(c_path), "/tmp/cfv_ws_%d_%lu.c", (int)getpid(), seq);
    snprintf(so_path, sizeof(so_path), "/tmp/cfv_ws_%d_%lu.so", (int)getpid(), seq);

    FILE *fp = fopen(c_path, "wb");
    if (!fp) {
        free(sb.data);
        snprintf(diag_out, diag_cap, "Failed to create temporary source file.");
        return false;
    }
    if (fwrite(sb.data, 1, sb.len, fp) != sb.len) {
        fclose(fp);
        unlink(c_path);
        free(sb.data);
        snprintf(diag_out, diag_cap, "Failed writing temporary source file.");
        return false;
    }
    fclose(fp);

    int pipefd[2];
    if (pipe(pipefd) != 0) {
        unlink(c_path);
        free(sb.data);
        snprintf(diag_out, diag_cap, "Failed to create compiler pipe.");
        return false;
    }

    pid_t pid = fork();
    if (pid < 0) {
        close(pipefd[0]);
        close(pipefd[1]);
        unlink(c_path);
        free(sb.data);
        snprintf(diag_out, diag_cap, "Failed to fork clang compiler.");
        return false;
    }

    if (pid == 0) {
        close(pipefd[0]);
        dup2(pipefd[1], STDOUT_FILENO);
        dup2(pipefd[1], STDERR_FILENO);
        close(pipefd[1]);
        /* -O1 compiles ~20% faster than -O2 while math builtins run at full -O2 in host binary */
        char *argv[] = {"clang", "-O1",  "-shared", "-fPIC", "-Wall", "-Wextra",
                        "-I.",   c_path, "-o",      so_path, "-lm",   NULL};
        execvp("clang", argv);
        _exit(127);
    }

    close(pipefd[1]);
    size_t dlen = 0;
    if (diag_out && diag_cap > 0) {
        diag_out[0] = '\0';
        while (dlen + 1 < diag_cap) {
            ssize_t r = read(pipefd[0], diag_out + dlen, diag_cap - 1 - dlen);
            if (r <= 0) {
                break;
            }
            dlen += (size_t)r;
        }
        diag_out[dlen] = '\0';
    }
    close(pipefd[0]);

    int status = 0;
    waitpid(pid, &status, 0);
    unlink(c_path);

    if (elapsed_ms_out) {
        *elapsed_ms_out = now_ms() - t0;
    }

    if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        unlink(so_path);
        free(sb.data);
        if (diag_out && diag_out[0] == '\0') {
            snprintf(diag_out, diag_cap, "clang exited with status %d.", WEXITSTATUS(status));
        }
        return false;
    }

    void *handle = dlopen(so_path, RTLD_NOW | RTLD_LOCAL);
    if (!handle) {
        unlink(so_path);
        free(sb.data);
        snprintf(diag_out, diag_cap, "dlopen failed: %s", dlerror());
        return false;
    }

    const char *sym_name = is_real ? "cfv_dispatch_real" : "cfv_dispatch_complex";
    void *sym = dlsym(handle, sym_name);
    if (!sym) {
        dlclose(handle);
        unlink(so_path);
        free(sb.data);
        snprintf(diag_out, diag_cap, "Missing symbol '%s': %s", sym_name, dlerror());
        return false;
    }
    void *sym2d = is_real ? dlsym(handle, "cfv_dispatch_real2d") : NULL;

    pthread_rwlock_wrlock(&g_hot_lock);
    int dst = -1;
    for (int i = 0; i < HOT_CACHE_CAP; i++) {
        if (!g_cache[i].used) {
            dst = i;
            break;
        }
    }
    if (dst < 0) {
        /* Evict least-recently-used non-active cache entry */
        unsigned long oldest = (unsigned long)-1;
        for (int i = 0; i < HOT_CACHE_CAP; i++) {
            if (i == g_active_complex_idx || i == g_active_real_idx) {
                continue;
            }
            if (g_cache[i].last_use < oldest) {
                oldest = g_cache[i].last_use;
                dst = i;
            }
        }
        if (dst < 0) {
            dst = 0;
        }
        cache_entry_free(&g_cache[dst]);
    }

    HotCacheEntry *e = &g_cache[dst];
    e->used = true;
    e->is_real = is_real;
    e->hash = h;
    e->source = sb.data;
    e->source_len = sb.len;
    e->handle = handle;
    e->slots = (int)card_count;
    snprintf(e->so_path, sizeof(e->so_path), "%s", so_path);
    if (is_real) {
        memcpy(&e->real_fn, &sym, sizeof(e->real_fn));
        if (sym2d) {
            memcpy(&e->real2d_fn, &sym2d, sizeof(e->real2d_fn));
        }
    } else {
        memcpy(&e->complex_fn, &sym, sizeof(e->complex_fn));
    }
    activate_cached_locked(dst);
    pthread_rwlock_unlock(&g_hot_lock);

    return true;
}

bool hot_compile_code(bool is_real, const char *code, char *diag_out, size_t diag_cap,
                      double *elapsed_ms_out) {
    const char *cards[1] = {code};
    return hot_compile_workspace(is_real, cards, 1, NULL, 0, diag_out, diag_cap, elapsed_ms_out);
}

bool hot_has_complex(void) {
    pthread_rwlock_rdlock(&g_hot_lock);
    bool ok = g_complex_slot_fn != NULL && g_complex_slots > 0;
    pthread_rwlock_unlock(&g_hot_lock);
    return ok;
}

bool hot_has_real(void) {
    pthread_rwlock_rdlock(&g_hot_lock);
    bool ok = g_real_slot_fn != NULL && g_real_slots > 0;
    pthread_rwlock_unlock(&g_hot_lock);
    return ok;
}

int hot_complex_slot_count(void) {
    pthread_rwlock_rdlock(&g_hot_lock);
    int n = g_complex_slots;
    pthread_rwlock_unlock(&g_hot_lock);
    return n;
}

int hot_real_slot_count(void) {
    pthread_rwlock_rdlock(&g_hot_lock);
    int n = g_real_slots;
    pthread_rwlock_unlock(&g_hot_lock);
    return n;
}

double complex hot_eval_complex_slot(int slot, double complex z, const EvalParams *params) {
    static const EvalParams ZERO_P = {{0}, 0};
    const EvalParams *p = params ? params : &ZERO_P;
    pthread_rwlock_rdlock(&g_hot_lock);
    HotComplexSlotFn fn = g_complex_slot_fn;
    int max_s = g_complex_slots;
    double complex res = (fn && slot >= 0 && slot < max_s) ? fn(slot, z, p) : c_zeta(z);
    pthread_rwlock_unlock(&g_hot_lock);
    return res;
}

double hot_eval_real_slot(int slot, double x, const EvalParams *params) {
    static const EvalParams ZERO_P = {{0}, 0};
    const EvalParams *p = params ? params : &ZERO_P;
    pthread_rwlock_rdlock(&g_hot_lock);
    HotRealSlotFn fn = g_real_slot_fn;
    int max_s = g_real_slots;
    double res = (fn && slot >= 0 && slot < max_s) ? fn(slot, x, p) : sin(x);
    pthread_rwlock_unlock(&g_hot_lock);
    return res;
}

double hot_eval_real2d_slot(int slot, double x, double y, const EvalParams *params) {
    static const EvalParams ZERO_P = {{0}, 0};
    const EvalParams *p = params ? params : &ZERO_P;
    pthread_rwlock_rdlock(&g_hot_lock);
    HotReal2DSlotFn fn = g_real2d_slot_fn;
    int max_s = g_real_slots;
    double res = (fn && slot >= 0 && slot < max_s) ? fn(slot, x, y, p) : NAN;
    pthread_rwlock_unlock(&g_hot_lock);
    return res;
}

double complex hot_eval_complex(double complex z) { return hot_eval_complex_slot(0, z, NULL); }

double hot_eval_real(double x) { return hot_eval_real_slot(0, x, NULL); }

/* ----------------------------------------------------------------------------
 * Lock-Free Inner Loops (1 rwlock acquire per worker batch!)
 * ---------------------------------------------------------------------------- */

typedef struct {
    int slot;
    EvalParams params;
    const double *xs;
    double *ys;
    size_t start;
    size_t end;
} HotRealJob;

static void *hot_real_worker(void *arg) {
    HotRealJob *job = (HotRealJob *)arg;
    pthread_rwlock_rdlock(&g_hot_lock);
    HotRealSlotFn fn = g_real_slot_fn;
    int max_s = g_real_slots;
    if (fn && job->slot >= 0 && job->slot < max_s) {
        for (size_t i = job->start; i < job->end; i++) {
            job->ys[i] = fn(job->slot, job->xs[i], &job->params);
        }
    } else {
        for (size_t i = job->start; i < job->end; i++) {
            job->ys[i] = NAN;
        }
    }
    pthread_rwlock_unlock(&g_hot_lock);
    return NULL;
}

void hot_sample_real_slot(int slot, const EvalParams *params, const double *xs, size_t count,
                          double *ys_out) {
    if (!xs || !ys_out || count == 0) {
        return;
    }
    EvalParams p_copy = {{0}, 0};
    if (params) {
        p_copy = *params;
    }

    if (count >= 96) {
        const int nthreads = 4;
        pthread_t threads[4];
        HotRealJob jobs[4];
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
            jobs[t] = (HotRealJob){
                .slot = slot, .params = p_copy, .xs = xs, .ys = ys_out, .start = s, .end = e};
            if (pthread_create(&threads[t], NULL, hot_real_worker, &jobs[t]) == 0) {
                launched++;
            } else {
                hot_real_worker(&jobs[t]);
            }
        }
        for (int t = 0; t < launched; t++) {
            pthread_join(threads[t], NULL);
        }
    } else {
        HotRealJob job = {
            .slot = slot, .params = p_copy, .xs = xs, .ys = ys_out, .start = 0, .end = count};
        hot_real_worker(&job);
    }
}

typedef struct {
    int slot;
    EvalParams params;
    double xmin;
    double xmax;
    double ymin;
    double ymax;
    int nx;
    int ny;
    int y_start;
    int y_end;
    float *grid;
} HotImplicitJob;

static void *hot_implicit_worker(void *arg) {
    HotImplicitJob *j = (HotImplicitJob *)arg;
    double dx = (j->nx > 1) ? (j->xmax - j->xmin) / (double)(j->nx - 1) : 0.0;
    double dy = (j->ny > 1) ? (j->ymax - j->ymin) / (double)(j->ny - 1) : 0.0;
    pthread_rwlock_rdlock(&g_hot_lock);
    HotReal2DSlotFn fn = g_real2d_slot_fn;
    int max_s = g_real_slots;
    if (fn && j->slot >= 0 && j->slot < max_s) {
        for (int row = j->y_start; row < j->y_end; row++) {
            double y = j->ymin + dy * (double)row;
            float *out_row = j->grid + (size_t)row * (size_t)j->nx;
            for (int col = 0; col < j->nx; col++) {
                double x = j->xmin + dx * (double)col;
                double v = fn(j->slot, x, y, &j->params);
                out_row[col] = isfinite(v) ? (float)v : NAN;
            }
        }
    } else {
        for (int row = j->y_start; row < j->y_end; row++) {
            float *out_row = j->grid + (size_t)row * (size_t)j->nx;
            for (int col = 0; col < j->nx; col++) {
                out_row[col] = NAN;
            }
        }
    }
    pthread_rwlock_unlock(&g_hot_lock);
    return NULL;
}

void hot_sample_implicit_slot(int slot, const EvalParams *params, double xmin, double xmax,
                              double ymin, double ymax, int nx, int ny, float *grid_out) {
    if (!grid_out || nx < 2 || ny < 2) {
        return;
    }
    EvalParams p_copy = {{0}, 0};
    if (params) {
        p_copy = *params;
    }

    const int nthreads = (ny >= 32) ? 4 : 1;
    if (nthreads > 1) {
        pthread_t threads[4];
        HotImplicitJob jobs[4];
        int chunk = (ny + nthreads - 1) / nthreads;
        int launched = 0;
        for (int t = 0; t < nthreads; t++) {
            int ys = t * chunk;
            if (ys >= ny) {
                break;
            }
            int ye = ys + chunk;
            if (ye > ny) {
                ye = ny;
            }
            jobs[t] = (HotImplicitJob){
                .slot = slot,
                .params = p_copy,
                .xmin = xmin,
                .xmax = xmax,
                .ymin = ymin,
                .ymax = ymax,
                .nx = nx,
                .ny = ny,
                .y_start = ys,
                .y_end = ye,
                .grid = grid_out,
            };
            if (pthread_create(&threads[t], NULL, hot_implicit_worker, &jobs[t]) == 0) {
                launched++;
            } else {
                hot_implicit_worker(&jobs[t]);
            }
        }
        for (int t = 0; t < launched; t++) {
            pthread_join(threads[t], NULL);
        }
    } else {
        HotImplicitJob job = {
            .slot = slot,
            .params = p_copy,
            .xmin = xmin,
            .xmax = xmax,
            .ymin = ymin,
            .ymax = ymax,
            .nx = nx,
            .ny = ny,
            .y_start = 0,
            .y_end = ny,
            .grid = grid_out,
        };
        hot_implicit_worker(&job);
    }
}

typedef struct {
    int slot;
    EvalParams params;
    double tmin;
    double tmax;
    size_t total;
    size_t start;
    size_t end;
    float *xy;
} HotParametricJob;

static void *hot_parametric_worker(void *arg) {
    HotParametricJob *j = (HotParametricJob *)arg;
    double dt = (j->total > 1) ? (j->tmax - j->tmin) / (double)(j->total - 1) : 0.0;
    pthread_rwlock_rdlock(&g_hot_lock);
    HotReal2DSlotFn fn = g_real2d_slot_fn;
    int max_s = g_real_slots;
    if (fn && j->slot >= 0 && j->slot < max_s) {
        for (size_t i = j->start; i < j->end; i++) {
            double t = j->tmin + dt * (double)i;
            double px = fn(j->slot, t, 0.0, &j->params);
            double py = fn(j->slot, t, 1.0, &j->params);
            j->xy[2 * i] = isfinite(px) ? (float)px : NAN;
            j->xy[2 * i + 1] = isfinite(py) ? (float)py : NAN;
        }
    } else {
        for (size_t i = j->start; i < j->end; i++) {
            j->xy[2 * i] = NAN;
            j->xy[2 * i + 1] = NAN;
        }
    }
    pthread_rwlock_unlock(&g_hot_lock);
    return NULL;
}

void hot_sample_parametric_slot(int slot, const EvalParams *params, double tmin, double tmax,
                                size_t count, float *xy_out) {
    if (!xy_out || count < 2) {
        return;
    }
    EvalParams p_copy = {{0}, 0};
    if (params) {
        p_copy = *params;
    }

    if (count >= 160) {
        const int nthreads = 4;
        pthread_t threads[4];
        HotParametricJob jobs[4];
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
            jobs[t] = (HotParametricJob){.slot = slot,
                                         .params = p_copy,
                                         .tmin = tmin,
                                         .tmax = tmax,
                                         .total = count,
                                         .start = s,
                                         .end = e,
                                         .xy = xy_out};
            if (pthread_create(&threads[t], NULL, hot_parametric_worker, &jobs[t]) == 0) {
                launched++;
            } else {
                hot_parametric_worker(&jobs[t]);
            }
        }
        for (int t = 0; t < launched; t++) {
            pthread_join(threads[t], NULL);
        }
    } else {
        HotParametricJob job = {.slot = slot,
                                .params = p_copy,
                                .tmin = tmin,
                                .tmax = tmax,
                                .total = count,
                                .start = 0,
                                .end = count,
                                .xy = xy_out};
        hot_parametric_worker(&job);
    }
}

typedef struct {
    int slot;
    EvalParams params;
    double cx;
    double cy;
    double half_w;
    double half_h;
    int width;
    int height;
    int y_start;
    int y_end;
    int scheme;
    uint8_t *rgba;
} HotDomainJob;

static void *hot_domain_worker(void *arg) {
    HotDomainJob *j = (HotDomainJob *)arg;
    double x0 = j->cx - j->half_w;
    double y0 = j->cy + j->half_h;
    double dx = (2.0 * j->half_w) / (double)j->width;
    double dy = (2.0 * j->half_h) / (double)j->height;

    pthread_rwlock_rdlock(&g_hot_lock);
    HotComplexSlotFn fn = g_complex_slot_fn;
    int max_s = g_complex_slots;
    if (fn && j->slot >= 0 && j->slot < max_s) {
        for (int py = j->y_start; py < j->y_end; py++) {
            double im = y0 - ((double)py + 0.5) * dy;
            for (int px = 0; px < j->width; px++) {
                double re = x0 + ((double)px + 0.5) * dx;
                double complex w = fn(j->slot, c_make(re, im), &j->params);
                size_t idx = ((size_t)py * (size_t)j->width + (size_t)px) * 4;
                uint8_t r, g, b;
                sampler_color_complex(w, j->scheme, &r, &g, &b);
                j->rgba[idx + 0] = r;
                j->rgba[idx + 1] = g;
                j->rgba[idx + 2] = b;
                j->rgba[idx + 3] = 255;
            }
        }
    } else {
        for (int py = j->y_start; py < j->y_end; py++) {
            for (int px = 0; px < j->width; px++) {
                size_t idx = ((size_t)py * (size_t)j->width + (size_t)px) * 4;
                j->rgba[idx + 0] = 10;
                j->rgba[idx + 1] = 14;
                j->rgba[idx + 2] = 23;
                j->rgba[idx + 3] = 255;
            }
        }
    }
    pthread_rwlock_unlock(&g_hot_lock);
    return NULL;
}

void hot_render_domain_slot(int slot, const EvalParams *params, double cx, double cy, double half_w,
                            double half_h, int width, int height, int scheme, uint8_t *rgba_out) {
    if (!rgba_out || width <= 0 || height <= 0) {
        return;
    }
    EvalParams p_copy = {{0}, 0};
    if (params) {
        p_copy = *params;
    }
    const int nthreads = (height >= 32) ? 4 : 1;
    if (nthreads > 1) {
        pthread_t threads[4];
        HotDomainJob jobs[4];
        int rows_per = (height + nthreads - 1) / nthreads;
        int launched = 0;
        for (int t = 0; t < nthreads; t++) {
            int ys = t * rows_per;
            if (ys >= height) {
                break;
            }
            int ye = ys + rows_per;
            if (ye > height) {
                ye = height;
            }
            jobs[t] = (HotDomainJob){.slot = slot,
                                     .params = p_copy,
                                     .cx = cx,
                                     .cy = cy,
                                     .half_w = half_w,
                                     .half_h = half_h,
                                     .width = width,
                                     .height = height,
                                     .y_start = ys,
                                     .y_end = ye,
                                     .scheme = scheme,
                                     .rgba = rgba_out};
            if (pthread_create(&threads[t], NULL, hot_domain_worker, &jobs[t]) == 0) {
                launched++;
            } else {
                hot_domain_worker(&jobs[t]);
            }
        }
        for (int t = 0; t < launched; t++) {
            pthread_join(threads[t], NULL);
        }
    } else {
        HotDomainJob job = {.slot = slot,
                            .params = p_copy,
                            .cx = cx,
                            .cy = cy,
                            .half_w = half_w,
                            .half_h = half_h,
                            .width = width,
                            .height = height,
                            .y_start = 0,
                            .y_end = height,
                            .scheme = scheme,
                            .rgba = rgba_out};
        hot_domain_worker(&job);
    }
}
