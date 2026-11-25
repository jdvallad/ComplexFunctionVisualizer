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
typedef void (*HotVectorSlotFn)(int slot, double x, double y, const EvalParams *params,
                                double *fx_out, double *fy_out, double *phi_out);

#define HOT_CACHE_CAP 24

enum { HOT_KIND_COMPLEX = 0, HOT_KIND_REAL = 1, HOT_KIND_VECTOR = 2 };

typedef struct {
    bool used;
    int ws_kind;
    uint64_t hash;
    unsigned long last_use;
    char *source;
    size_t source_len;
    void *handle;
    HotComplexSlotFn complex_fn;
    HotRealSlotFn real_fn;
    HotReal2DSlotFn real2d_fn;
    HotVectorSlotFn vector_fn;
    int slots;
    char so_path[128];
} HotCacheEntry;

static pthread_rwlock_t g_hot_lock = PTHREAD_RWLOCK_INITIALIZER;
static HotCacheEntry g_cache[HOT_CACHE_CAP];
static int g_active_complex_idx = -1;
static int g_active_real_idx = -1;
static int g_active_vector_idx = -1;
static HotComplexSlotFn g_complex_slot_fn = NULL;
static HotRealSlotFn g_real_slot_fn = NULL;
static HotReal2DSlotFn g_real2d_slot_fn = NULL;
static HotVectorSlotFn g_vector_slot_fn = NULL;
static int g_complex_slots = 0;
static int g_real_slots = 0;
static int g_vector_slots = 0;
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
    g_active_vector_idx = -1;
    g_complex_slot_fn = NULL;
    g_real_slot_fn = NULL;
    g_real2d_slot_fn = NULL;
    g_vector_slot_fn = NULL;
    g_complex_slots = 0;
    g_real_slots = 0;
    g_vector_slots = 0;
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
    if (e->ws_kind == HOT_KIND_REAL) {
        g_active_real_idx = idx;
        g_real_slot_fn = e->real_fn;
        g_real2d_slot_fn = e->real2d_fn;
        g_real_slots = e->slots;
    } else if (e->ws_kind == HOT_KIND_VECTOR) {
        g_active_vector_idx = idx;
        g_vector_slot_fn = e->vector_fn;
        g_vector_slots = e->slots;
    } else {
        g_active_complex_idx = idx;
        g_complex_slot_fn = e->complex_fn;
        g_complex_slots = e->slots;
    }
}

bool hot_compile_workspace(bool is_real, const char *const *card_codes, size_t card_count,
                           const char *const *param_names, size_t param_count, char *diag_out,
                           size_t diag_cap, double *elapsed_ms_out) {
    return hot_compile_workspace_named(is_real, card_codes, NULL, card_count, param_names,
                                       param_count, diag_out, diag_cap, elapsed_ms_out);
}

bool hot_compile_workspace_named(bool is_real, const char *const *card_codes,
                                 const char *const *card_names, size_t card_count,
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
        char def_nm[32];
        snprintf(def_nm, sizeof(def_nm), "f%zu", i + 1);
        if (is_real) {
            ok_gen &= sb_printf(&sb, "#define f%zu(arg_) cfv_card_%zu((arg_), 0.0, P)\n", i + 1, i);
        } else {
            ok_gen &= sb_printf(&sb, "#define f%zu(arg_) cfv_card_%zu((arg_), P)\n", i + 1, i);
        }
        if (card_names && card_names[i] && is_valid_ident(card_names[i]) &&
            strcmp(card_names[i], def_nm) != 0) {
            if (is_real) {
                ok_gen &= sb_printf(&sb, "#define %s(arg_) cfv_card_%zu((arg_), 0.0, P)\n",
                                    card_names[i], i);
            } else {
                ok_gen &= sb_printf(&sb, "#define %s(arg_) cfv_card_%zu((arg_), P)\n",
                                    card_names[i], i);
            }
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
        bool is_param_card = is_real && (strstr(code, "double px =") != NULL || strstr(code, "double py =") != NULL);
        for (size_t p = 0; p < param_count; p++) {
            if (is_valid_ident(param_names[p])) {
                if (is_param_card && (strcmp(param_names[p], "px") == 0 || strcmp(param_names[p], "py") == 0 || strcmp(param_names[p], "t") == 0)) {
                    continue;
                }
                ok_gen &= sb_printf(&sb, "    double %s = P->v[%zu]; (void)%s;\n", param_names[p],
                                    p, param_names[p]);
            }
        }
        ok_gen &= sb_printf(&sb, "#line 1 \"cfv_card_%zu\"\n", i);
        if (looks_like_bare_expr(code)) {
            ok_gen &= sb_printf(&sb, "    return (%s);\n", code);
        } else {
            ok_gen &= sb_printf(&sb, "%s\n", code);
        }
        ok_gen &= sb_printf(&sb, "#line 1000 \"cfv_generated.c\"\n}\n\n");
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

    int target_kind = is_real ? HOT_KIND_REAL : HOT_KIND_COMPLEX;
    /* Fast path: check compiled .so LRU cache (0ms hit!) */
    pthread_rwlock_wrlock(&g_hot_lock);
    for (int i = 0; i < HOT_CACHE_CAP; i++) {
        if (g_cache[i].used && g_cache[i].ws_kind == target_kind && g_cache[i].hash == h &&
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
            if (i == g_active_complex_idx || i == g_active_real_idx || i == g_active_vector_idx) {
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
    e->ws_kind = target_kind;
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
        long ncpu = sysconf(_SC_NPROCESSORS_ONLN);
        int nthreads = (ncpu >= 4 && ncpu <= 12) ? (int)ncpu : (ncpu > 12 ? 12 : 4);
        pthread_t threads[12];
        HotRealJob jobs[12];
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
    int y_offset;
    int y_stride;
    int scheme;
    DomainProjSpec pspec;
    uint8_t *rgba;
} HotDomainJob;

static bool domain_pixel_to_z(double px_f, double py_f, const HotDomainJob *j, double *re_out,
                              double *im_out, uint8_t *alpha_out) {
    *alpha_out = 255;
    int proj = j->pspec.proj;
    if (proj == DOMAIN_PROJ_SPHERE) {
        double cw = j->pspec.canvas_w > 1.0 ? j->pspec.canvas_w : (double)j->width;
        double ch = j->pspec.canvas_h > 1.0 ? j->pspec.canvas_h : (double)j->height;
        double min_dim = cw < ch ? cw : ch;
        double zoom = j->pspec.sphere_zoom > 0.05 ? j->pspec.sphere_zoom : 1.0;
        double R = min_dim * 0.38 * zoom;
        if (R < 1.0) {
            R = 1.0;
        }
        double u = (px_f / (double)j->width - 0.5) * cw / R;
        double v = (0.5 - py_f / (double)j->height) * ch / R;
        const double k = 0.72 / 3.8;
        const double k2 = k * k;
        const double omk2 = 1.0 - k2;
        double a = u * u + v * v;
        double disc = 1.0 - a * omk2;
        if (disc <= 0.0) {
            *alpha_out = 0;
            return false;
        }
        /* Smooth anti-aliased sphere rim */
        double rim_fade = sqrt(disc) * R * 0.12;
        if (rim_fade < 1.0) {
            *alpha_out = (uint8_t)(rim_fade * 255.0);
        }
        double depth = (a * k + sqrt(disc)) / (1.0 + a * k2);
        double invP = 1.0 - k * depth;
        double x1 = u * invP;
        double scrY = v * invP;
        double cp = cos(j->pspec.sphere_pitch);
        double sp = sin(j->pspec.sphere_pitch);
        double cy = cos(j->pspec.sphere_yaw);
        double sy = sin(j->pspec.sphere_yaw);
        double y1 = depth * cp - scrY * sp;
        double wz = depth * sp + scrY * cp;
        double wx = x1 * cy + y1 * sy;
        double wy = -x1 * sy + y1 * cy;
        if (j->pspec.merc_uv) {
            double zc = wz < -0.996 ? -0.996 : (wz > 0.996 ? 0.996 : wz);
            *re_out = atan2(wx, wy);
            *im_out = 0.5 * log((1.0 + zc) / (1.0 - zc));
        } else {
            double den = 1.0 - wz;
            if (den < 1e-7) {
                den = 1e-7;
            }
            *re_out = wx / den;
            *im_out = wy / den;
        }
        return true;
    }

    double x0 = j->cx - j->half_w;
    double y0 = j->cy + j->half_h;
    double sx = x0 + (px_f / (double)j->width) * (2.0 * j->half_w);
    double sy = y0 - (py_f / (double)j->height) * (2.0 * j->half_h);

    if (proj == DOMAIN_PROJ_MERCATOR) {
        if (j->pspec.merc_uv) {
            *re_out = sx;
            *im_out = sy;
            return true;
        }
        double yc = sy < -12.0 ? -12.0 : (sy > 12.0 ? 12.0 : sy);
        double r = exp(yc);
        *re_out = r * sin(sx);
        *im_out = r * cos(sx);
        return true;
    }
    if (proj == DOMAIN_PROJ_STEREOGRAPHIC) {
        double rho = hypot(sx, sy);
        if (rho >= 0.9995) {
            *alpha_out = 0;
            return false;
        }
        if (rho > 0.992) {
            *alpha_out = (uint8_t)(((0.9995 - rho) / 0.0075) * 255.0);
        }
        if (rho < 1e-15) {
            *re_out = 0.0;
            *im_out = 0.0;
            return true;
        }
        double r = tan(rho * (3.14159265358979323846 * 0.5));
        *re_out = (sx / rho) * r;
        *im_out = (sy / rho) * r;
        return true;
    }
    if (proj == DOMAIN_PROJ_POINCARE) {
        double r2 = sx * sx + sy * sy;
        if (r2 >= 0.9992) {
            *alpha_out = 0;
            return false;
        }
        if (r2 > 0.988) {
            *alpha_out = (uint8_t)(((0.9992 - r2) / 0.0112) * 255.0);
        }
        double denom = 1.0 - r2;
        *re_out = (2.0 * sx) / denom;
        *im_out = (2.0 * sy) / denom;
        return true;
    }
    /* PLANAR and POLAR share Cartesian (x, y) -> z = x + i*y */
    *re_out = sx;
    *im_out = sy;
    return true;
}

static void *hot_domain_worker(void *arg) {
    HotDomainJob *j = (HotDomainJob *)arg;
    bool is_planar =
        (j->pspec.proj == DOMAIN_PROJ_PLANAR || j->pspec.proj == DOMAIN_PROJ_POLAR);
    double x0 = j->cx - j->half_w;
    double y0 = j->cy + j->half_h;
    double dx = (2.0 * j->half_w) / (double)j->width;
    double dy = (2.0 * j->half_h) / (double)j->height;

    pthread_rwlock_rdlock(&g_hot_lock);
    HotComplexSlotFn fn = g_complex_slot_fn;
    int max_s = g_complex_slots;
    if (fn && j->slot >= 0 && j->slot < max_s) {
        bool edge_aa = (j->scheme == 1 || j->scheme == 2 || j->scheme == 3 || j->scheme == 4 ||
                        j->scheme == 5);
        /* Interleaved scanlines balance fractal interior rows evenly across all threads! */
        for (int py = j->y_offset; py < j->height; py += j->y_stride) {
            double im_lin = y0 - ((double)py + 0.5) * dy;
            uint8_t *row = j->rgba + ((size_t)py * (size_t)j->width) * 4;
            uint8_t pr = 0, pg = 0, pb = 0;
            bool prev_valid = false;
            for (int px = 0; px < j->width; px++) {
                double re = 0.0, im = 0.0;
                uint8_t alpha = 255;
                if (is_planar) {
                    re = x0 + ((double)px + 0.5) * dx;
                    im = im_lin;
                } else {
                    if (!domain_pixel_to_z((double)px + 0.5, (double)py + 0.5, j, &re, &im,
                                           &alpha)) {
                        row[px * 4 + 0] = 0;
                        row[px * 4 + 1] = 0;
                        row[px * 4 + 2] = 0;
                        row[px * 4 + 3] = 0;
                        prev_valid = false;
                        continue;
                    }
                }
                double complex w = fn(j->slot, c_make(re, im), &j->params);
                uint8_t r, g, b;
                sampler_color_complex(w, j->scheme, &r, &g, &b);
                /* Selective 4x subpixel MSAA on high-contrast fractal filaments (works on ALL 6 projections!) */
                if (edge_aa && prev_valid) {
                    int diff =
                        abs((int)r - (int)pr) + abs((int)g - (int)pg) + abs((int)b - (int)pb);
                    if (diff > 40) {
                        int sr = r, sg = g, sb_acc = b, scnt = 1;
                        static const double offs[3][2] = {
                            {-0.28, -0.28}, {0.28, -0.28}, {0.0, 0.30}};
                        for (int s = 0; s < 3; s++) {
                            double sre = 0.0, sim = 0.0;
                            uint8_t sa = 255;
                            if (is_planar) {
                                sre = re + offs[s][0] * dx;
                                sim = im - offs[s][1] * dy;
                            } else if (!domain_pixel_to_z((double)px + 0.5 + offs[s][0],
                                                          (double)py + 0.5 + offs[s][1], j, &sre,
                                                          &sim, &sa)) {
                                continue;
                            }
                            double complex ws = fn(j->slot, c_make(sre, sim), &j->params);
                            uint8_t tr, tg, tb;
                            sampler_color_complex(ws, j->scheme, &tr, &tg, &tb);
                            sr += tr;
                            sg += tg;
                            sb_acc += tb;
                            scnt++;
                        }
                        r = (uint8_t)(sr / scnt);
                        g = (uint8_t)(sg / scnt);
                        b = (uint8_t)(sb_acc / scnt);
                    }
                }
                pr = r;
                pg = g;
                pb = b;
                prev_valid = true;
                row[px * 4 + 0] = r;
                row[px * 4 + 1] = g;
                row[px * 4 + 2] = b;
                row[px * 4 + 3] = alpha;
            }
        }
    } else {
        for (int py = j->y_offset; py < j->height; py += j->y_stride) {
            uint8_t *row = j->rgba + ((size_t)py * (size_t)j->width) * 4;
            for (int px = 0; px < j->width; px++) {
                row[px * 4 + 0] = 10;
                row[px * 4 + 1] = 14;
                row[px * 4 + 2] = 23;
                row[px * 4 + 3] = 255;
            }
        }
    }
    pthread_rwlock_unlock(&g_hot_lock);
    return NULL;
}

void hot_render_domain_slot_proj(int slot, const EvalParams *params, double cx, double cy,
                                 double half_w, double half_h, int width, int height, int scheme,
                                 const DomainProjSpec *pspec, uint8_t *rgba_out) {
    if (!rgba_out || width <= 0 || height <= 0) {
        return;
    }
    EvalParams p_copy = {{0}, 0};
    if (params) {
        p_copy = *params;
    }
    DomainProjSpec ps = {0};
    if (pspec) {
        ps = *pspec;
    }
    int nthreads = 1;
    if (height >= 32) {
        long ncpu = sysconf(_SC_NPROCESSORS_ONLN);
        if (ncpu < 4) {
            ncpu = 4;
        }
        if (ncpu > 16) {
            ncpu = 16;
        }
        nthreads = (int)ncpu;
        if (nthreads > height) {
            nthreads = height;
        }
    }
    if (nthreads > 1) {
        pthread_t threads[16];
        HotDomainJob jobs[16];
        int launched = 0;
        for (int t = 0; t < nthreads; t++) {
            jobs[t] = (HotDomainJob){.slot = slot,
                                     .params = p_copy,
                                     .cx = cx,
                                     .cy = cy,
                                     .half_w = half_w,
                                     .half_h = half_h,
                                     .width = width,
                                     .height = height,
                                     .y_offset = t,
                                     .y_stride = nthreads,
                                     .scheme = scheme,
                                     .pspec = ps,
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
                            .y_offset = 0,
                            .y_stride = 1,
                            .scheme = scheme,
                            .pspec = ps,
                            .rgba = rgba_out};
        hot_domain_worker(&job);
    }
}

void hot_render_domain_slot(int slot, const EvalParams *params, double cx, double cy, double half_w,
                            double half_h, int width, int height, int scheme, uint8_t *rgba_out) {
    hot_render_domain_slot_proj(slot, params, cx, cy, half_w, half_h, width, height, scheme, NULL,
                                rgba_out);
}

/* ============================================================================
 * 2D Vector Calculus Workspace Compiler & 4-Thread Evaluators
 * Supports:
 *   - Vector fields F(x, y) = (P(x, y), Q(x, y)) or multi-line C11 setting fx, fy
 *   - Scalar potentials phi(x, y) with automatic central-difference gradient
 *   - 4-thread grid [fx, fy, mag, div, curl, phi]
 *   - 4-thread bidirectional RK4 streamlines
 *   - Adaptive 8-point Gauss-Legendre Work (F.dr) & Outward Flux (F.n ds)
 * ============================================================================ */

static bool emit_vector_param_bindings(SrcBuf *sb, const char *const *param_names,
                                       size_t param_count, bool skip_fx_fy) {
    bool ok = true;
    for (size_t p = 0; p < param_count; p++) {
        const char *pn = param_names[p];
        if (!pn || !is_valid_ident(pn)) continue;
        if (strncmp(pn, "__cfvv_", 7) == 0) {
            size_t len = strlen(pn);
            if (len > 9 && strcmp(pn + len - 2, "_x") == 0) {
                char base[64];
                size_t blen = len - 9;
                if (blen > 0 && blen < sizeof(base)) {
                    memcpy(base, pn + 7, blen);
                    base[blen] = '\0';
                    char ykey[80];
                    snprintf(ykey, sizeof(ykey), "__cfvv_%s_y", base);
                    for (size_t q = 0; q < param_count; q++) {
                        if (param_names[q] && strcmp(param_names[q], ykey) == 0) {
                            if (is_valid_ident(base) && strcmp(base, "v") != 0 &&
                                (!skip_fx_fy || (strcmp(base, "fx") != 0 && strcmp(base, "fy") != 0 &&
                                                 strcmp(base, "phi") != 0))) {
                                ok &= sb_printf(sb, "    vec2 %s = vec(P->v[%zu], P->v[%zu]); (void)%s;\n",
                                                base, p, q, base);
                            }
                            break;
                        }
                    }
                }
            }
            continue;
        }
        if (strcmp(pn, "v") == 0) continue;
        if (skip_fx_fy && (strcmp(pn, "fx") == 0 || strcmp(pn, "fy") == 0 || strcmp(pn, "phi") == 0)) {
            continue;
        }
        ok &= sb_printf(sb, "    double %s = P->v[%zu]; (void)%s;\n", pn, p, pn);
    }
    return ok;
}

bool hot_compile_vector_workspace(const char *const *card_codes, const int *card_kinds,
                                  size_t card_count, const char *const *param_names,
                                  size_t param_count, char *diag_out, size_t diag_cap,
                                  double *elapsed_ms_out) {
    return hot_compile_vector_workspace_named(card_codes, card_kinds, NULL, card_count, param_names,
                                              param_count, diag_out, diag_cap, elapsed_ms_out);
}

bool hot_compile_vector_workspace_named(const char *const *card_codes, const int *card_kinds,
                                        const char *const *card_names, size_t card_count,
                                        const char *const *param_names, size_t param_count,
                                        char *diag_out, size_t diag_cap, double *elapsed_ms_out) {
    if (!card_codes || card_count == 0 || card_count > MAX_HOT_SLOTS) {
        snprintf(diag_out, diag_cap, "Vector workspace must contain 1 to %d C cards.",
                 MAX_HOT_SLOTS);
        return false;
    }
    if (param_count > MAX_EVAL_PARAMS) {
        param_count = MAX_EVAL_PARAMS;
    }

    double t0 = now_ms();
    SrcBuf sb = {0};
    bool ok_gen = true;
    ok_gen &= sb_printf(&sb, "#include <math.h>\n");
    ok_gen &= sb_printf(&sb, "#include <stdbool.h>\n");
    ok_gen &= sb_printf(&sb, "#include <stdlib.h>\n");
    ok_gen &= sb_printf(&sb, "#include \"real_math.h\"\n");
    ok_gen &= sb_printf(&sb, "#include \"hot_compile.h\"\n\n");
    ok_gen &= sb_printf(&sb, "#ifndef M_PI\n#define M_PI 3.14159265358979323846\n#endif\n");
    ok_gen &= sb_printf(&sb, "#ifndef M_E\n#define M_E 2.71828182845904523536\n#endif\n\n");
    ok_gen &= sb_printf(
        &sb,
        "#define CFV_FN static inline __attribute__((unused))\n"
        "typedef struct { double x, y; } vec2;\n"
        "typedef struct { double a, b; } row2;\n"
        "typedef struct { double a, b, c, d; } mat2;\n"
        "CFV_FN vec2 vec(double x, double y) { vec2 r = {x, y}; return r; }\n"
        "CFV_FN row2 row(double a, double b) { row2 r = {a, b}; return r; }\n"
        "CFV_FN mat2 mat(double a, double b, double c, double d) { mat2 m = {a, b, c, d}; return m; }\n"
        "CFV_FN vec2 vadd(vec2 u, vec2 w) { return vec(u.x + w.x, u.y + w.y); }\n"
        "CFV_FN vec2 vsub(vec2 u, vec2 w) { return vec(u.x - w.x, u.y - w.y); }\n"
        "CFV_FN vec2 vscale(double k, vec2 u) { return vec(k * u.x, k * u.y); }\n"
        "CFV_FN double vdot(vec2 u, vec2 w) { return u.x * w.x + u.y * w.y; }\n"
        "CFV_FN double vcross(vec2 u, vec2 w) { return u.x * w.y - u.y * w.x; }\n"
        "CFV_FN double vlen(vec2 u) { return hypot(u.x, u.y); }\n"
        "CFV_FN vec2 vnorm(vec2 u) { double l = hypot(u.x, u.y); return l > 1e-12 ? vec(u.x/l, u.y/l) : vec(0, 0); }\n"
        "CFV_FN vec2 vperp(vec2 u) { return vec(-u.y, u.x); }\n"
        "CFV_FN vec2 vrot(vec2 u, double th) { double c = cos(th), s = sin(th); return vec(c*u.x - s*u.y, s*u.x + c*u.y); }\n"
        "CFV_FN double vangle(vec2 u, vec2 w) { double d = vlen(u)*vlen(w); return d > 1e-12 ? acos(fmax(-1.0, fmin(1.0, vdot(u,w)/d))) : 0.0; }\n"
        "CFV_FN vec2 vproj(vec2 u, vec2 w) { double d = vdot(w, w); return d > 1e-12 ? vscale(vdot(u, w)/d, w) : vec(0, 0); }\n"
        "CFV_FN double vdist(vec2 u, vec2 w) { return hypot(u.x - w.x, u.y - w.y); }\n"
        "CFV_FN vec2 vlerp(vec2 u, vec2 w, double t) { return vec(u.x + t*(w.x - u.x), u.y + t*(w.y - u.y)); }\n");
    ok_gen &= sb_printf(
        &sb,
        "CFV_FN row2 radd(row2 p, row2 q) { return row(p.a + q.a, p.b + q.b); }\n"
        "CFV_FN row2 rsub(row2 p, row2 q) { return row(p.a - q.a, p.b - q.b); }\n"
        "CFV_FN row2 rscale(double k, row2 p) { return row(k * p.a, k * p.b); }\n"
        "CFV_FN double rv(row2 r, vec2 u) { return r.a * u.x + r.b * u.y; }\n"
        "CFV_FN row2 rm(row2 r, mat2 m) { return row(r.a * m.a + r.b * m.c, r.a * m.b + r.b * m.d); }\n"
        "CFV_FN mat2 vr(vec2 u, row2 r) { return mat(u.x * r.a, u.x * r.b, u.y * r.a, u.y * r.b); }\n"
        "CFV_FN mat2 mouter(vec2 u, vec2 w) { return mat(u.x*w.x, u.x*w.y, u.y*w.x, u.y*w.y); }\n"
        "CFV_FN vec2 rtrans(row2 r) { return vec(r.a, r.b); }\n"
        "CFV_FN row2 vtrans(vec2 u) { return row(u.x, u.y); }\n"
        "CFV_FN vec2 mv(mat2 m, vec2 u) { return vec(m.a*u.x + m.b*u.y, m.c*u.x + m.d*u.y); }\n"
        "CFV_FN mat2 mm(mat2 A, mat2 B) { return mat(A.a*B.a + A.b*B.c, A.a*B.b + A.b*B.d, A.c*B.a + A.d*B.c, A.c*B.b + A.d*B.d); }\n"
        "CFV_FN mat2 madd(mat2 A, mat2 B) { return mat(A.a+B.a, A.b+B.b, A.c+B.c, A.d+B.d); }\n"
        "CFV_FN mat2 msub(mat2 A, mat2 B) { return mat(A.a-B.a, A.b-B.b, A.c-B.c, A.d-B.d); }\n"
        "CFV_FN mat2 mscale_k(double k, mat2 A) { return mat(k*A.a, k*A.b, k*A.c, k*A.d); }\n"
        "CFV_FN mat2 mrot(double th) { double c = cos(th), s = sin(th); return mat(c, -s, s, c); }\n"
        "CFV_FN mat2 mscale(double sx, double sy) { return mat(sx, 0.0, 0.0, sy); }\n"
        "CFV_FN mat2 mdiag(double a, double b) { return mat(a, 0.0, 0.0, b); }\n"
        "CFV_FN mat2 mshear(double kx, double ky) { return mat(1.0, kx, ky, 1.0); }\n"
        "CFV_FN mat2 mreflect(double th) { double c = cos(2.0*th), s = sin(2.0*th); return mat(c, s, s, -c); }\n"
        "CFV_FN mat2 mproj(double th) { double c = cos(th), s = sin(th); return mat(c*c, c*s, c*s, s*s); }\n"
        "CFV_FN mat2 meye(void) { return mat(1.0, 0.0, 0.0, 1.0); }\n"
        "CFV_FN double mdet(mat2 m) { return m.a*m.d - m.b*m.c; }\n"
        "CFV_FN double mtr(mat2 m) { return m.a + m.d; }\n"
        "CFV_FN mat2 mtrans(mat2 m) { return mat(m.a, m.c, m.b, m.d); }\n"
        "CFV_FN mat2 madj(mat2 m) { return mat(m.d, -m.b, -m.c, m.a); }\n"
        "CFV_FN mat2 minv(mat2 m) { double d = mdet(m); if (fabs(d) < 1e-12) return mat(NAN,NAN,NAN,NAN); return mat(m.d/d, -m.b/d, -m.c/d, m.a/d); }\n"
        "CFV_FN double meig1(mat2 m) { double tr = mtr(m), disc = tr*tr - 4.0*mdet(m); return disc >= 0.0 ? 0.5*(tr + sqrt(disc)) : NAN; }\n"
        "CFV_FN double meig2(mat2 m) { double tr = mtr(m), disc = tr*tr - 4.0*mdet(m); return disc >= 0.0 ? 0.5*(tr - sqrt(disc)) : NAN; }\n"
        "CFV_FN double mcond(mat2 m) { double d = fabs(mdet(m)); if (d < 1e-12) return INFINITY; double f2 = m.a*m.a + m.b*m.b + m.c*m.c + m.d*m.d; double disc = sqrt(fmax(0.0, f2*f2 - 4.0*d*d)); double s1 = sqrt(0.5*(f2 + disc)), s2 = sqrt(fmax(1e-18, 0.5*(f2 - disc))); return s1 / s2; }\n"
        "CFV_FN mat2 mpow(mat2 m, double dn) { int n = (int)llround(dn); mat2 base = n < 0 ? minv(m) : m; int k = abs(n); if (k > 64) k = 64; mat2 acc = meye(); for (int i = 0; i < k; i++) acc = mm(acc, base); return acc; }\n\n");

    for (size_t i = 0; i < card_count; i++) {
        int ck = card_kinds ? card_kinds[i] : 0;
        if (ck == 1) {
            ok_gen &= sb_printf(
                &sb, "static double cfv_vphi_%zu(double x, double y, const EvalParams *P);\n", i);
        } else if (ck == 2) {
            ok_gen &= sb_printf(
                &sb, "static mat2 cfv_vmat_%zu(const EvalParams *P);\n", i);
        } else if (ck == 3) {
            ok_gen &= sb_printf(
                &sb, "static row2 cfv_vrow_%zu(const EvalParams *P);\n", i);
        } else if (ck == 4) {
            ok_gen &= sb_printf(
                &sb, "static vec2 cfv_vcurve_%zu(double t, const EvalParams *P);\n", i);
        } else if (ck == 5) {
            ok_gen &= sb_printf(
                &sb, "static double cfv_vs2s_%zu(double t, const EvalParams *P);\n", i);
        }
        ok_gen &= sb_printf(&sb,
                            "static void cfv_vcard_%zu(double x, double y, const EvalParams *P, "
                            "double *fx_out, double *fy_out, double *phi_out);\n",
                            i);
        ok_gen &= sb_printf(
            &sb,
            "CFV_FN vec2 cfv_vfn_%zu(vec2 u_, const EvalParams *P) { "
            "double rx_ = 0.0, ry_ = 0.0; cfv_vcard_%zu(u_.x, u_.y, P, &rx_, &ry_, NULL); return vec(rx_, ry_); }\n",
            i, i);
        if (ck == 0 || ck == 2) {
            ok_gen &= sb_printf(
                &sb,
                "CFV_FN double cfv_vdiv_%zu(double ax_, double ay_, const EvalParams *P) { "
                "double h = 1e-4 * fmax(1.0, hypot(ax_, ay_)); double fx1, fx2, fy1, fy2; "
                "cfv_vcard_%zu(ax_+h, ay_, P, &fx1, NULL, NULL); cfv_vcard_%zu(ax_-h, ay_, P, &fx2, NULL, NULL); "
                "cfv_vcard_%zu(ax_, ay_+h, P, NULL, &fy1, NULL); cfv_vcard_%zu(ax_, ay_-h, P, NULL, &fy2, NULL); "
                "return (fx1 - fx2 + fy1 - fy2) / (2.0 * h); }\n"
                "CFV_FN double cfv_vcurl_%zu(double ax_, double ay_, const EvalParams *P) { "
                "double h = 1e-4 * fmax(1.0, hypot(ax_, ay_)); double fx1, fx2, fy1, fy2; "
                "cfv_vcard_%zu(ax_+h, ay_, P, NULL, &fy1, NULL); cfv_vcard_%zu(ax_-h, ay_, P, NULL, &fy2, NULL); "
                "cfv_vcard_%zu(ax_, ay_+h, P, &fx1, NULL, NULL); cfv_vcard_%zu(ax_, ay_-h, P, &fx2, NULL, NULL); "
                "return ((fy1 - fy2) - (fx1 - fx2)) / (2.0 * h); }\n"
                "CFV_FN mat2 cfv_vjac_%zu(double ax_, double ay_, const EvalParams *P) { "
                "double h = 1e-4 * fmax(1.0, hypot(ax_, ay_)); double fxp, fxm, fyp, fym, gxp, gxm, gyp, gym; "
                "cfv_vcard_%zu(ax_+h, ay_, P, &fxp, &gyp, NULL); cfv_vcard_%zu(ax_-h, ay_, P, &fxm, &gym, NULL); "
                "cfv_vcard_%zu(ax_, ay_+h, P, &fyp, &gxp, NULL); cfv_vcard_%zu(ax_, ay_-h, P, &fym, &gxm, NULL); "
                "return mat((fxp-fxm)/(2.0*h), (fyp-fym)/(2.0*h), (gyp-gym)/(2.0*h), (gxp-gxm)/(2.0*h)); }\n",
                i, i, i, i, i, i, i, i, i, i, i, i, i, i, i);
        } else if (ck == 1) {
            ok_gen &= sb_printf(
                &sb,
                "CFV_FN vec2 cfv_vgrad_%zu(double ax_, double ay_, const EvalParams *P) { "
                "double h = 1e-4 * fmax(1.0, hypot(ax_, ay_)); "
                "return vec((cfv_vphi_%zu(ax_+h, ay_, P) - cfv_vphi_%zu(ax_-h, ay_, P))/(2.0*h), "
                "(cfv_vphi_%zu(ax_, ay_+h, P) - cfv_vphi_%zu(ax_, ay_-h, P))/(2.0*h)); }\n"
                "CFV_FN double cfv_vlap_%zu(double ax_, double ay_, const EvalParams *P) { "
                "double h = 1e-3 * fmax(1.0, hypot(ax_, ay_)); double c0 = cfv_vphi_%zu(ax_, ay_, P); "
                "return (cfv_vphi_%zu(ax_+h, ay_, P) + cfv_vphi_%zu(ax_-h, ay_, P) + cfv_vphi_%zu(ax_, ay_+h, P) + cfv_vphi_%zu(ax_, ay_-h, P) - 4.0*c0) / (h*h); }\n",
                i, i, i, i, i, i, i, i, i, i, i);
        }
    }
    ok_gen &= sb_printf(&sb, "\n");
    size_t mat_seq = 0;
    for (size_t i = 0; i < card_count; i++) {
        int ck = card_kinds ? card_kinds[i] : 0;
        const char *cn = (card_names && card_names[i] && is_valid_ident(card_names[i])) ? card_names[i] : NULL;
        if (ck == 1) {
            ok_gen &= sb_printf(&sb, "#define phi%zu(ax_, ay_) cfv_vphi_%zu((ax_), (ay_), P)\n", i + 1, i);
            ok_gen &= sb_printf(&sb, "#define f%zu(ax_, ay_) cfv_vphi_%zu((ax_), (ay_), P)\n", i + 1, i);
            if (cn) {
                char d1[32], d2[32];
                snprintf(d1, sizeof(d1), "phi%zu", i + 1);
                snprintf(d2, sizeof(d2), "f%zu", i + 1);
                if (strcmp(cn, d1) != 0 && strcmp(cn, d2) != 0) {
                    ok_gen &= sb_printf(&sb, "#define %s(ax_, ay_) cfv_vphi_%zu((ax_), (ay_), P)\n", cn, i);
                }
                ok_gen &= sb_printf(&sb, "#define __cfv_grad_%s(ax_, ay_) cfv_vgrad_%zu((ax_), (ay_), P)\n", cn, i);
                ok_gen &= sb_printf(&sb, "#define __cfv_lap_%s(ax_, ay_) cfv_vlap_%zu((ax_), (ay_), P)\n", cn, i);
            }
        } else if (ck == 2 || ck == 3) {
            mat_seq++;
            const char *fn_pfx = (ck == 3) ? "cfv_vrow" : "cfv_vmat";
            ok_gen &= sb_printf(&sb, "#define M%zu %s_%zu(P)\n", mat_seq, fn_pfx, i);
            if (mat_seq == 1) {
                ok_gen &= sb_printf(&sb, "#define M %s_%zu(P)\n#define A %s_%zu(P)\n", fn_pfx, i, fn_pfx, i);
            } else if (mat_seq == 2) {
                ok_gen &= sb_printf(&sb, "#define B %s_%zu(P)\n", fn_pfx, i);
            }
            if (cn) {
                char dm[32];
                snprintf(dm, sizeof(dm), "M%zu", mat_seq);
                if (strcmp(cn, dm) != 0 && strcmp(cn, "M") != 0 && strcmp(cn, "A") != 0 && strcmp(cn, "B") != 0) {
                    ok_gen &= sb_printf(&sb, "#define %s %s_%zu(P)\n", cn, fn_pfx, i);
                }
            }
        } else if (ck == 4) {
            if (cn) {
                ok_gen &= sb_printf(&sb, "#define %s(at_) cfv_vcurve_%zu((at_), P)\n", cn, i);
            }
        } else if (ck == 5) {
            if (cn) {
                ok_gen &= sb_printf(&sb, "#define %s(at_) cfv_vs2s_%zu((at_), P)\n", cn, i);
            }
        } else if (ck == 0) {
            if (cn) {
                char df[32], dt[32];
                snprintf(df, sizeof(df), "F%zu", i + 1);
                snprintf(dt, sizeof(dt), "T%zu", i + 1);
                if (strcmp(cn, df) != 0 && strcmp(cn, dt) != 0) {
                    ok_gen &= sb_printf(&sb, "#define %s(u_) cfv_vfn_%zu((u_), P)\n", cn, i);
                }
                ok_gen &= sb_printf(&sb, "#define __cfv_div_%s(ax_, ay_) cfv_vdiv_%zu((ax_), (ay_), P)\n", cn, i);
                ok_gen &= sb_printf(&sb, "#define __cfv_curl_%s(ax_, ay_) cfv_vcurl_%zu((ax_), (ay_), P)\n", cn, i);
                ok_gen &= sb_printf(&sb, "#define __cfv_jac_%s(ax_, ay_) cfv_vjac_%zu((ax_), (ay_), P)\n", cn, i);
            }
        }
        ok_gen &= sb_printf(
            &sb, "#define F%zu(ax_, ay_, px_, py_) cfv_vcard_%zu((ax_), (ay_), P, (px_), (py_), NULL)\n",
            i + 1, i);
        ok_gen &= sb_printf(
            &sb, "#define T%zu(u_) cfv_vfn_%zu((u_), P)\n", i + 1, i);
    }
    ok_gen &= sb_printf(&sb, "\n");

    for (size_t i = 0; i < card_count; i++) {
        int ck = card_kinds ? card_kinds[i] : 0;
        const char *code = card_codes[i];
        if (!code || !code[0]) {
            code = (ck == 1 || ck == 5) ? "0.0" : (ck == 2) ? "meye()" : (ck == 3) ? "row(1.0, 0.0)" : (ck == 4) ? "vec(cos(t), sin(t))" : "fx = 0.0; fy = 0.0;";
        }
        if (ck == 2) {
            ok_gen &= sb_printf(&sb, "static mat2 cfv_vmat_%zu(const EvalParams *P) {\n", i);
            ok_gen &= sb_printf(&sb, "    (void)P;\n");
            ok_gen &= emit_vector_param_bindings(&sb, param_names, param_count, false);
            ok_gen &= sb_printf(&sb, "#line 1 \"cfv_card_%zu\"\n", i);
            ok_gen &= sb_printf(&sb, "    return (%s);\n", code);
            ok_gen &= sb_printf(&sb, "#line 1000 \"cfv_generated.c\"\n}\n\n");
            ok_gen &= sb_printf(&sb,
                                "static void cfv_vcard_%zu(double x, double y, const EvalParams "
                                "*P, double *fx_out, double *fy_out, double *phi_out) {\n",
                                i);
            ok_gen &= sb_printf(&sb, "    vec2 r_ = mv(cfv_vmat_%zu(P), vec(x, y));\n", i);
            ok_gen &= sb_printf(&sb, "    if (fx_out) *fx_out = r_.x;\n");
            ok_gen &= sb_printf(&sb, "    if (fy_out) *fy_out = r_.y;\n");
            ok_gen &= sb_printf(&sb, "    if (phi_out) *phi_out = NAN;\n}\n\n");
        } else if (ck == 3) {
            ok_gen &= sb_printf(&sb, "static row2 cfv_vrow_%zu(const EvalParams *P) {\n", i);
            ok_gen &= sb_printf(&sb, "    (void)P;\n");
            ok_gen &= emit_vector_param_bindings(&sb, param_names, param_count, false);
            ok_gen &= sb_printf(&sb, "#line 1 \"cfv_card_%zu\"\n", i);
            ok_gen &= sb_printf(&sb, "    return (%s);\n", code);
            ok_gen &= sb_printf(&sb, "#line 1000 \"cfv_generated.c\"\n}\n\n");
            ok_gen &= sb_printf(&sb,
                                "static void cfv_vcard_%zu(double x, double y, const EvalParams "
                                "*P, double *fx_out, double *fy_out, double *phi_out) {\n",
                                i);
            ok_gen &= sb_printf(&sb, "    row2 r_ = cfv_vrow_%zu(P);\n", i);
            ok_gen &= sb_printf(&sb, "    if (fx_out) *fx_out = r_.a;\n");
            ok_gen &= sb_printf(&sb, "    if (fy_out) *fy_out = r_.b;\n");
            ok_gen &= sb_printf(&sb, "    if (phi_out) *phi_out = rv(r_, vec(x, y));\n}\n\n");
        } else if (ck == 4) {
            ok_gen &= sb_printf(&sb, "static vec2 cfv_vcurve_%zu(double t, const EvalParams *P) {\n", i);
            ok_gen &= sb_printf(&sb, "    (void)P; (void)t;\n");
            ok_gen &= emit_vector_param_bindings(&sb, param_names, param_count, false);
            ok_gen &= sb_printf(&sb, "#line 1 \"cfv_card_%zu\"\n", i);
            ok_gen &= sb_printf(&sb, "    return (%s);\n", code);
            ok_gen &= sb_printf(&sb, "#line 1000 \"cfv_generated.c\"\n}\n\n");
            ok_gen &= sb_printf(&sb,
                                "static void cfv_vcard_%zu(double x, double y, const EvalParams "
                                "*P, double *fx_out, double *fy_out, double *phi_out) {\n",
                                i);
            ok_gen &= sb_printf(&sb, "    (void)y; vec2 r_ = cfv_vcurve_%zu(x, P);\n", i);
            ok_gen &= sb_printf(&sb, "    if (fx_out) *fx_out = r_.x;\n");
            ok_gen &= sb_printf(&sb, "    if (fy_out) *fy_out = r_.y;\n");
            ok_gen &= sb_printf(&sb, "    if (phi_out) *phi_out = NAN;\n}\n\n");
        } else if (ck == 5) {
            ok_gen &= sb_printf(&sb, "static double cfv_vs2s_%zu(double t, const EvalParams *P) {\n", i);
            ok_gen &= sb_printf(&sb, "    (void)P; (void)t; double x = t; (void)x;\n");
            ok_gen &= emit_vector_param_bindings(&sb, param_names, param_count, false);
            ok_gen &= sb_printf(&sb, "#line 1 \"cfv_card_%zu\"\n", i);
            if (looks_like_bare_expr(code)) {
                ok_gen &= sb_printf(&sb, "    return (%s);\n", code);
            } else {
                ok_gen &= sb_printf(&sb, "%s\n", code);
            }
            ok_gen &= sb_printf(&sb, "#line 1000 \"cfv_generated.c\"\n}\n\n");
            ok_gen &= sb_printf(&sb,
                                "static void cfv_vcard_%zu(double x, double y, const EvalParams "
                                "*P, double *fx_out, double *fy_out, double *phi_out) {\n",
                                i);
            ok_gen &= sb_printf(&sb, "    (void)y; double v0 = cfv_vs2s_%zu(x, P);\n", i);
            ok_gen &= sb_printf(&sb, "    if (fx_out) *fx_out = x;\n");
            ok_gen &= sb_printf(&sb, "    if (fy_out) *fy_out = v0;\n");
            ok_gen &= sb_printf(&sb, "    if (phi_out) *phi_out = v0;\n}\n\n");
        } else if (ck == 1) {
            ok_gen &= sb_printf(
                &sb, "static double cfv_vphi_%zu(double x, double y, const EvalParams *P) {\n", i);
            ok_gen &= sb_printf(&sb, "    (void)P; (void)x; (void)y;\n");
            ok_gen &= sb_printf(&sb, "    vec2 v = vec(x, y); (void)v;\n");
            ok_gen &= emit_vector_param_bindings(&sb, param_names, param_count, false);
            ok_gen &= sb_printf(&sb, "#line 1 \"cfv_card_%zu\"\n", i);
            if (looks_like_bare_expr(code)) {
                ok_gen &= sb_printf(&sb, "    return (%s);\n", code);
            } else if (strstr(code, "return") != NULL) {
                ok_gen &= sb_printf(&sb, "    double phi = 0.0; (void)phi;\n%s\n", code);
            } else {
                ok_gen &= sb_printf(&sb, "    double phi = 0.0; (void)phi;\n%s\n    return phi;\n", code);
            }
            ok_gen &= sb_printf(&sb, "#line 1000 \"cfv_generated.c\"\n}\n\n");

            ok_gen &= sb_printf(&sb,
                                "static void cfv_vcard_%zu(double x, double y, const EvalParams "
                                "*P, double *fx_out, double *fy_out, double *phi_out) {\n",
                                i);
            ok_gen &= sb_printf(&sb, "    double v0 = cfv_vphi_%zu(x, y, P);\n", i);
            ok_gen &= sb_printf(&sb, "    if (phi_out) *phi_out = v0;\n");
            ok_gen &= sb_printf(&sb, "    if (fx_out || fy_out) {\n");
            ok_gen &= sb_printf(&sb, "        double h = 1e-4 * fmax(1.0, hypot(x, y));\n");
            ok_gen &= sb_printf(&sb,
                                "        if (fx_out) *fx_out = (cfv_vphi_%zu(x + h, y, P) - "
                                "cfv_vphi_%zu(x - h, y, P)) / (2.0 * h);\n",
                                i, i);
            ok_gen &= sb_printf(&sb,
                                "        if (fy_out) *fy_out = (cfv_vphi_%zu(x, y + h, P) - "
                                "cfv_vphi_%zu(x, y - h, P)) / (2.0 * h);\n",
                                i, i);
            ok_gen &= sb_printf(&sb, "    }\n}\n\n");
        } else {
            ok_gen &= sb_printf(&sb,
                                "static void cfv_vcard_%zu(double x, double y, const EvalParams "
                                "*P, double *fx_out, double *fy_out, double *phi_out) {\n",
                                i);
            ok_gen &= sb_printf(&sb, "    (void)P; (void)x; (void)y;\n");
            ok_gen &= sb_printf(&sb, "    double fx = 0.0, fy = 0.0, phi = NAN;\n");
            ok_gen &= sb_printf(&sb, "    vec2 v = vec(x, y); (void)v; (void)phi;\n");
            ok_gen &= emit_vector_param_bindings(&sb, param_names, param_count, true);
            ok_gen &= sb_printf(&sb, "#line 1 \"cfv_card_%zu\"\n", i);
            ok_gen &= sb_printf(&sb, "%s\n", code);
            ok_gen &= sb_printf(&sb, "#line 1000 \"cfv_generated.c\"\n");
            ok_gen &= sb_printf(&sb, "    if (fx_out) *fx_out = fx;\n");
            ok_gen &= sb_printf(&sb, "    if (fy_out) *fy_out = fy;\n");
            ok_gen &= sb_printf(&sb, "    if (phi_out) *phi_out = phi;\n");
            ok_gen &= sb_printf(&sb, "}\n\n");
        }
    }

    ok_gen &= sb_printf(&sb,
                        "void cfv_dispatch_vector(int slot, double x, double y, const EvalParams "
                        "*P, double *fx_out, double *fy_out, double *phi_out) {\n");
    ok_gen &= sb_printf(&sb, "    switch (slot) {\n");
    for (size_t i = 0; i < card_count; i++) {
        ok_gen &= sb_printf(
            &sb, "    case %zu: cfv_vcard_%zu(x, y, P, fx_out, fy_out, phi_out); return;\n", i, i);
    }
    ok_gen &= sb_printf(&sb,
                        "    default: if (fx_out) *fx_out = NAN; if (fy_out) *fy_out = NAN; "
                        "if (phi_out) *phi_out = NAN; return;\n    }\n}\n");

    if (!ok_gen || !sb.data) {
        free(sb.data);
        snprintf(diag_out, diag_cap, "Out of memory generating vector C11 source.");
        return false;
    }

    uint64_t h = fnv1a_64(sb.data, sb.len);
    pthread_rwlock_wrlock(&g_hot_lock);
    for (int i = 0; i < HOT_CACHE_CAP; i++) {
        if (g_cache[i].used && g_cache[i].ws_kind == HOT_KIND_VECTOR && g_cache[i].hash == h &&
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
    snprintf(c_path, sizeof(c_path), "/tmp/cfv_vec_%d_%lu.c", (int)getpid(), seq);
    snprintf(so_path, sizeof(so_path), "/tmp/cfv_vec_%d_%lu.so", (int)getpid(), seq);

    FILE *fp = fopen(c_path, "wb");
    if (!fp) {
        free(sb.data);
        snprintf(diag_out, diag_cap, "Failed to create temporary vector source file.");
        return false;
    }
    if (fwrite(sb.data, 1, sb.len, fp) != sb.len) {
        fclose(fp);
        unlink(c_path);
        free(sb.data);
        snprintf(diag_out, diag_cap, "Failed writing temporary vector source file.");
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
    void *sym = dlsym(handle, "cfv_dispatch_vector");
    if (!sym) {
        dlclose(handle);
        unlink(so_path);
        free(sb.data);
        snprintf(diag_out, diag_cap, "Missing symbol cfv_dispatch_vector: %s", dlerror());
        return false;
    }

    pthread_rwlock_wrlock(&g_hot_lock);
    int dst = -1;
    for (int i = 0; i < HOT_CACHE_CAP; i++) {
        if (!g_cache[i].used) {
            dst = i;
            break;
        }
    }
    if (dst < 0) {
        unsigned long oldest = (unsigned long)-1;
        for (int i = 0; i < HOT_CACHE_CAP; i++) {
            if (i == g_active_complex_idx || i == g_active_real_idx || i == g_active_vector_idx) {
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
    e->ws_kind = HOT_KIND_VECTOR;
    e->hash = h;
    e->source = sb.data;
    e->source_len = sb.len;
    e->handle = handle;
    e->slots = (int)card_count;
    snprintf(e->so_path, sizeof(e->so_path), "%s", so_path);
    memcpy(&e->vector_fn, &sym, sizeof(e->vector_fn));
    activate_cached_locked(dst);
    pthread_rwlock_unlock(&g_hot_lock);
    return true;
}

bool hot_has_vector(void) {
    pthread_rwlock_rdlock(&g_hot_lock);
    bool ok = g_vector_slot_fn != NULL && g_vector_slots > 0;
    pthread_rwlock_unlock(&g_hot_lock);
    return ok;
}

int hot_vector_slot_count(void) {
    pthread_rwlock_rdlock(&g_hot_lock);
    int n = g_vector_slots;
    pthread_rwlock_unlock(&g_hot_lock);
    return n;
}

void hot_eval_vector_slot(int slot, double x, double y, const EvalParams *params, double *fx_out,
                          double *fy_out, double *phi_out) {
    static const EvalParams ZERO_P = {{0}, 0};
    const EvalParams *p = params ? params : &ZERO_P;
    pthread_rwlock_rdlock(&g_hot_lock);
    HotVectorSlotFn fn = g_vector_slot_fn;
    int max_s = g_vector_slots;
    if (fn && slot >= 0 && slot < max_s) {
        fn(slot, x, y, p, fx_out, fy_out, phi_out);
    } else {
        if (fx_out) {
            *fx_out = NAN;
        }
        if (fy_out) {
            *fy_out = NAN;
        }
        if (phi_out) {
            *phi_out = NAN;
        }
    }
    pthread_rwlock_unlock(&g_hot_lock);
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
} HotVecGridJob;

static void *hot_vec_grid_worker(void *arg) {
    HotVecGridJob *j = (HotVecGridJob *)arg;
    double dx = (j->nx > 1) ? (j->xmax - j->xmin) / (double)(j->nx - 1) : 0.0;
    double dy = (j->ny > 1) ? (j->ymax - j->ymin) / (double)(j->ny - 1) : 0.0;
    double h = fmax(1e-5, 1e-4 * hypot(j->xmax - j->xmin, j->ymax - j->ymin));
    double inv2h = 0.5 / h;

    pthread_rwlock_rdlock(&g_hot_lock);
    HotVectorSlotFn fn = g_vector_slot_fn;
    int max_s = g_vector_slots;
    if (fn && j->slot >= 0 && j->slot < max_s) {
        for (int row = j->y_start; row < j->y_end; row++) {
            double y = j->ymin + dy * (double)row;
            float *out_row = j->grid + (size_t)row * (size_t)j->nx * 6;
            for (int col = 0; col < j->nx; col++) {
                double x = j->xmin + dx * (double)col;
                double fx = 0.0, fy = 0.0, phi = NAN;
                fn(j->slot, x, y, &j->params, &fx, &fy, &phi);
                double fx_px = 0.0, fy_px = 0.0, fx_mx = 0.0, fy_mx = 0.0;
                double fx_py = 0.0, fy_py = 0.0, fx_my = 0.0, fy_my = 0.0;
                fn(j->slot, x + h, y, &j->params, &fx_px, &fy_px, NULL);
                fn(j->slot, x - h, y, &j->params, &fx_mx, &fy_mx, NULL);
                fn(j->slot, x, y + h, &j->params, &fx_py, &fy_py, NULL);
                fn(j->slot, x, y - h, &j->params, &fx_my, &fy_my, NULL);
                double div_v = (fx_px - fx_mx) * inv2h + (fy_py - fy_my) * inv2h;
                double curl_v = (fy_px - fy_mx) * inv2h - (fx_py - fx_my) * inv2h;
                double mag = hypot(fx, fy);
                float *cell = out_row + (size_t)col * 6;
                cell[0] = isfinite(fx) ? (float)fx : NAN;
                cell[1] = isfinite(fy) ? (float)fy : NAN;
                cell[2] = isfinite(mag) ? (float)mag : NAN;
                cell[3] = isfinite(div_v) ? (float)div_v : NAN;
                cell[4] = isfinite(curl_v) ? (float)curl_v : NAN;
                cell[5] = isfinite(phi) ? (float)phi : NAN;
            }
        }
    } else {
        for (int row = j->y_start; row < j->y_end; row++) {
            float *out_row = j->grid + (size_t)row * (size_t)j->nx * 6;
            for (int col = 0; col < j->nx * 6; col++) {
                out_row[col] = NAN;
            }
        }
    }
    pthread_rwlock_unlock(&g_hot_lock);
    return NULL;
}

void hot_sample_vector_grid(int slot, const EvalParams *params, double xmin, double xmax,
                            double ymin, double ymax, int nx, int ny, float *grid_out) {
    if (!grid_out || nx < 2 || ny < 2) {
        return;
    }
    EvalParams p_copy = {{0}, 0};
    if (params) {
        p_copy = *params;
    }
    const int nthreads = (ny >= 24) ? 4 : 1;
    if (nthreads > 1) {
        pthread_t threads[4];
        HotVecGridJob jobs[4];
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
            jobs[t] = (HotVecGridJob){.slot = slot,
                                      .params = p_copy,
                                      .xmin = xmin,
                                      .xmax = xmax,
                                      .ymin = ymin,
                                      .ymax = ymax,
                                      .nx = nx,
                                      .ny = ny,
                                      .y_start = ys,
                                      .y_end = ye,
                                      .grid = grid_out};
            if (pthread_create(&threads[t], NULL, hot_vec_grid_worker, &jobs[t]) == 0) {
                launched++;
            } else {
                hot_vec_grid_worker(&jobs[t]);
            }
        }
        for (int t = 0; t < launched; t++) {
            pthread_join(threads[t], NULL);
        }
    } else {
        HotVecGridJob job = {.slot = slot,
                             .params = p_copy,
                             .xmin = xmin,
                             .xmax = xmax,
                             .ymin = ymin,
                             .ymax = ymax,
                             .nx = nx,
                             .ny = ny,
                             .y_start = 0,
                             .y_end = ny,
                             .grid = grid_out};
        hot_vec_grid_worker(&job);
    }
}

typedef struct {
    int slot;
    EvalParams params;
    const double *seeds;
    size_t start;
    size_t end;
    double xmin;
    double xmax;
    double ymin;
    double ymax;
    int max_steps;
    float *out_xy;
    int *out_counts;
} HotStreamJob;

static bool eval_unit_dir(HotVectorSlotFn fn, int slot, const EvalParams *p, double x, double y,
                          double sign, double *ux, double *uy) {
    double fx = 0.0, fy = 0.0;
    fn(slot, x, y, p, &fx, &fy, NULL);
    if (!isfinite(fx) || !isfinite(fy)) {
        return false;
    }
    double m = hypot(fx, fy);
    if (m < 1e-9 || m > 1e8) {
        return false;
    }
    *ux = (fx / m) * sign;
    *uy = (fy / m) * sign;
    return true;
}

static void *hot_stream_worker(void *arg) {
    HotStreamJob *j = (HotStreamJob *)arg;
    double span = hypot(j->xmax - j->xmin, j->ymax - j->ymin);
    double ds = span * 0.011;
    double pad_x = 0.12 * (j->xmax - j->xmin);
    double pad_y = 0.12 * (j->ymax - j->ymin);
    int stride_pts = j->max_steps * 2 + 1;

    pthread_rwlock_rdlock(&g_hot_lock);
    HotVectorSlotFn fn = g_vector_slot_fn;
    int max_s = g_vector_slots;
    if (fn && j->slot >= 0 && j->slot < max_s) {
        float *tmp_back = malloc((size_t)j->max_steps * 2 * sizeof(float));
        float *tmp_fwd = malloc((size_t)j->max_steps * 2 * sizeof(float));
        if (tmp_back && tmp_fwd) {
            for (size_t i = j->start; i < j->end; i++) {
                double sx = j->seeds[2 * i];
                double sy = j->seeds[2 * i + 1];
                int nback = 0, nfwd = 0;
                for (int dir = 0; dir < 2; dir++) {
                    double sign = (dir == 0) ? -1.0 : 1.0;
                    float *buf = (dir == 0) ? tmp_back : tmp_fwd;
                    double x = sx, y = sy;
                    int cnt = 0;
                    for (int st = 0; st < j->max_steps; st++) {
                        double k1x, k1y, k2x, k2y, k3x, k3y, k4x, k4y;
                        if (!eval_unit_dir(fn, j->slot, &j->params, x, y, sign, &k1x, &k1y)) {
                            break;
                        }
                        if (!eval_unit_dir(fn, j->slot, &j->params, x + 0.5 * ds * k1x,
                                           y + 0.5 * ds * k1y, sign, &k2x, &k2y)) {
                            break;
                        }
                        if (!eval_unit_dir(fn, j->slot, &j->params, x + 0.5 * ds * k2x,
                                           y + 0.5 * ds * k2y, sign, &k3x, &k3y)) {
                            break;
                        }
                        if (!eval_unit_dir(fn, j->slot, &j->params, x + ds * k3x, y + ds * k3y,
                                           sign, &k4x, &k4y)) {
                            break;
                        }
                        double nx = x + (ds / 6.0) * (k1x + 2.0 * k2x + 2.0 * k3x + k4x);
                        double ny = y + (ds / 6.0) * (k1y + 2.0 * k2y + 2.0 * k3y + k4y);
                        if (!isfinite(nx) || !isfinite(ny) || nx < j->xmin - pad_x ||
                            nx > j->xmax + pad_x || ny < j->ymin - pad_y || ny > j->ymax + pad_y) {
                            break;
                        }
                        x = nx;
                        y = ny;
                        buf[2 * cnt] = (float)x;
                        buf[2 * cnt + 1] = (float)y;
                        cnt++;
                        /* Stop closed vortex loops cleanly */
                        if (cnt > 10 && hypot(x - sx, y - sy) < ds * 0.9) {
                            break;
                        }
                    }
                    if (dir == 0) {
                        nback = cnt;
                    } else {
                        nfwd = cnt;
                    }
                }
                float *dst = j->out_xy + i * (size_t)stride_pts * 2;
                int out_n = 0;
                for (int k = nback - 1; k >= 0; k--) {
                    dst[2 * out_n] = tmp_back[2 * k];
                    dst[2 * out_n + 1] = tmp_back[2 * k + 1];
                    out_n++;
                }
                dst[2 * out_n] = (float)sx;
                dst[2 * out_n + 1] = (float)sy;
                out_n++;
                for (int k = 0; k < nfwd; k++) {
                    dst[2 * out_n] = tmp_fwd[2 * k];
                    dst[2 * out_n + 1] = tmp_fwd[2 * k + 1];
                    out_n++;
                }
                j->out_counts[i] = out_n;
            }
        }
        free(tmp_back);
        free(tmp_fwd);
    } else {
        for (size_t i = j->start; i < j->end; i++) {
            j->out_counts[i] = 0;
        }
    }
    pthread_rwlock_unlock(&g_hot_lock);
    return NULL;
}

void hot_sample_vector_streamlines(int slot, const EvalParams *params, const double *seed_xy,
                                   size_t seed_count, double xmin, double xmax, double ymin,
                                   double ymax, int max_steps_each_dir, float *out_xy,
                                   int *out_counts) {
    if (!seed_xy || !out_xy || !out_counts || seed_count == 0 || max_steps_each_dir < 2) {
        return;
    }
    EvalParams p_copy = {{0}, 0};
    if (params) {
        p_copy = *params;
    }
    int nthreads = (seed_count >= 16) ? 4 : 1;
    if (nthreads > 1) {
        pthread_t threads[4];
        HotStreamJob jobs[4];
        size_t chunk = (seed_count + (size_t)nthreads - 1) / (size_t)nthreads;
        int launched = 0;
        for (int t = 0; t < nthreads; t++) {
            size_t s = (size_t)t * chunk;
            if (s >= seed_count) {
                break;
            }
            size_t e = s + chunk;
            if (e > seed_count) {
                e = seed_count;
            }
            jobs[t] = (HotStreamJob){.slot = slot,
                                     .params = p_copy,
                                     .seeds = seed_xy,
                                     .start = s,
                                     .end = e,
                                     .xmin = xmin,
                                     .xmax = xmax,
                                     .ymin = ymin,
                                     .ymax = ymax,
                                     .max_steps = max_steps_each_dir,
                                     .out_xy = out_xy,
                                     .out_counts = out_counts};
            if (pthread_create(&threads[t], NULL, hot_stream_worker, &jobs[t]) == 0) {
                launched++;
            } else {
                hot_stream_worker(&jobs[t]);
            }
        }
        for (int t = 0; t < launched; t++) {
            pthread_join(threads[t], NULL);
        }
    } else {
        HotStreamJob job = {.slot = slot,
                            .params = p_copy,
                            .seeds = seed_xy,
                            .start = 0,
                            .end = seed_count,
                            .xmin = xmin,
                            .xmax = xmax,
                            .ymin = ymin,
                            .ymax = ymax,
                            .max_steps = max_steps_each_dir,
                            .out_xy = out_xy,
                            .out_counts = out_counts};
        hot_stream_worker(&job);
    }
}

static const double VGL8_T[8] = {0.019855071751231884, 0.10166676129318663, 0.23723379504183550,
                                 0.40828267875217509,  0.59171732124782490, 0.76276620495816450,
                                 0.89833323870681337,  0.98014492824876812};
static const double VGL8_W[8] = {0.050614268145188130, 0.11119051722668724, 0.15685332293894364,
                                 0.18134189168918099,  0.18134189168918099, 0.15685332293894364,
                                 0.11119051722668724,  0.050614268145188130};

static void vec_gl8_seg(HotVectorSlotFn fn, int slot, const EvalParams *p, double ax, double ay,
                        double bx, double by, double *work_acc, double *flux_acc, int depth) {
    double dx = bx - ax, dy = by - ay;
    double w0 = 0.0, f0 = 0.0;
    for (int k = 0; k < 8; k++) {
        double x = ax + dx * VGL8_T[k];
        double y = ay + dy * VGL8_T[k];
        double fx = 0.0, fy = 0.0;
        fn(slot, x, y, p, &fx, &fy, NULL);
        if (isfinite(fx) && isfinite(fy)) {
            w0 += VGL8_W[k] * (fx * dx + fy * dy);
            f0 += VGL8_W[k] * (fx * dy - fy * dx);
        }
    }
    if (depth < 5 && hypot(dx, dy) > 1e-4) {
        double mx = 0.5 * (ax + bx), my = 0.5 * (ay + by);
        double wl = 0.0, fl = 0.0, wr = 0.0, fr = 0.0;
        for (int k = 0; k < 8; k++) {
            double xl = ax + (mx - ax) * VGL8_T[k], yl = ay + (my - ay) * VGL8_T[k];
            double xr = mx + (bx - mx) * VGL8_T[k], yr = my + (by - my) * VGL8_T[k];
            double fxl = 0.0, fyl = 0.0, fxr = 0.0, fyr = 0.0;
            fn(slot, xl, yl, p, &fxl, &fyl, NULL);
            fn(slot, xr, yr, p, &fxr, &fyr, NULL);
            if (isfinite(fxl) && isfinite(fyl)) {
                wl += VGL8_W[k] * (fxl * (mx - ax) + fyl * (my - ay));
                fl += VGL8_W[k] * (fxl * (my - ay) - fyl * (mx - ax));
            }
            if (isfinite(fxr) && isfinite(fyr)) {
                wr += VGL8_W[k] * (fxr * (bx - mx) + fyr * (by - my));
                fr += VGL8_W[k] * (fxr * (by - my) - fyr * (bx - mx));
            }
        }
        double err = fabs((wl + wr) - w0) + fabs((fl + fr) - f0);
        if (err > 1e-6 * (1.0 + fabs(w0) + fabs(f0))) {
            vec_gl8_seg(fn, slot, p, ax, ay, mx, my, work_acc, flux_acc, depth + 1);
            vec_gl8_seg(fn, slot, p, mx, my, bx, by, work_acc, flux_acc, depth + 1);
            return;
        }
        *work_acc += wl + wr;
        *flux_acc += fl + fr;
        return;
    }
    *work_acc += w0;
    *flux_acc += f0;
}

void hot_integrate_vector_curve(int slot, const EvalParams *params, const double *pts_xy,
                                size_t npts, bool closed, double *work_out, double *flux_out,
                                double *arc_len_out) {
    double work = 0.0, flux = 0.0, arc = 0.0;
    if (pts_xy && npts >= 2) {
        static const EvalParams ZERO_P = {{0}, 0};
        const EvalParams *p = params ? params : &ZERO_P;
        pthread_rwlock_rdlock(&g_hot_lock);
        HotVectorSlotFn fn = g_vector_slot_fn;
        int max_s = g_vector_slots;
        if (fn && slot >= 0 && slot < max_s) {
            size_t segs = closed ? npts : npts - 1;
            for (size_t i = 0; i < segs; i++) {
                size_t j = (i + 1) % npts;
                double ax = pts_xy[2 * i], ay = pts_xy[2 * i + 1];
                double bx = pts_xy[2 * j], by = pts_xy[2 * j + 1];
                double len = hypot(bx - ax, by - ay);
                if (len < 1e-12) {
                    continue;
                }
                arc += len;
                vec_gl8_seg(fn, slot, p, ax, ay, bx, by, &work, &flux, 0);
            }
        }
        pthread_rwlock_unlock(&g_hot_lock);
    }
    if (work_out) {
        *work_out = work;
    }
    if (flux_out) {
        *flux_out = flux;
    }
    if (arc_len_out) {
        *arc_len_out = arc;
    }
}
