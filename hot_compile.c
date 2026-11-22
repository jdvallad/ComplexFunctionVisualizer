#define _POSIX_C_SOURCE 200809L

#include "hot_compile.h"
#include "complex_math.h"

#include <dlfcn.h>
#include <fcntl.h>
#include <math.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

typedef double complex (*HotComplexFn)(double complex z);
typedef double (*HotRealFn)(double x);

static pthread_rwlock_t g_hot_lock = PTHREAD_RWLOCK_INITIALIZER;
static void *g_complex_handle = NULL;
static void *g_real_handle = NULL;
static HotComplexFn g_complex_fn = NULL;
static HotRealFn g_real_fn = NULL;
static char g_complex_so[128] = {0};
static char g_real_so[128] = {0};
static char g_complex_src[4096] = {0};
static char g_real_src[4096] = {0};
static unsigned long g_build_seq = 0;

void hot_init(void) { /* Static PTHREAD_RWLOCK_INITIALIZER is already ready. */
}

void hot_cleanup(void) {
    pthread_rwlock_wrlock(&g_hot_lock);
    if (g_complex_handle) {
        dlclose(g_complex_handle);
        g_complex_handle = NULL;
        g_complex_fn = NULL;
    }
    if (g_complex_so[0]) {
        unlink(g_complex_so);
        g_complex_so[0] = '\0';
    }
    if (g_real_handle) {
        dlclose(g_real_handle);
        g_real_handle = NULL;
        g_real_fn = NULL;
    }
    if (g_real_so[0]) {
        unlink(g_real_so);
        g_real_so[0] = '\0';
    }
    pthread_rwlock_unlock(&g_hot_lock);
}

static double now_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec * 1e-6;
}

bool hot_compile_code(bool is_real, const char *code, char *diag_out, size_t diag_cap,
                      double *elapsed_ms_out) {
    if (!code || !code[0] || strlen(code) > 3800) {
        snprintf(diag_out, diag_cap, "Code must be non-empty and under 3800 characters.");
        return false;
    }

    double t0 = now_ms();

    pthread_rwlock_wrlock(&g_hot_lock);
    unsigned long seq = ++g_build_seq;
    pthread_rwlock_unlock(&g_hot_lock);

    char c_path[128];
    char so_path[128];
    snprintf(c_path, sizeof(c_path), "/tmp/cfv_hot_%d_%lu.c", (int)getpid(), seq);
    snprintf(so_path, sizeof(so_path), "/tmp/cfv_hot_%d_%lu.so", (int)getpid(), seq);

    FILE *fp = fopen(c_path, "wb");
    if (!fp) {
        snprintf(diag_out, diag_cap, "Failed to create temporary source file.");
        return false;
    }

    fprintf(fp, "#include <complex.h>\n");
    fprintf(fp, "#include <math.h>\n");
    fprintf(fp, "#include <stdbool.h>\n");
    fprintf(fp, "#include \"complex_math.h\"\n");
    fprintf(fp, "#include \"real_math.h\"\n\n");
    fprintf(fp, "#ifndef M_PI\n#define M_PI 3.14159265358979323846\n#endif\n\n");

    if (!is_real) {
        /* If user wrote full function signature containing user_fn, use it directly; else wrap. */
        if (strstr(code, "user_fn") != NULL) {
            fprintf(fp, "%s\n", code);
        } else {
            fprintf(fp, "double complex user_fn(double complex z) {\n    (void)z;\n%s\n}\n", code);
        }
    } else {
        if (strstr(code, "user_real_fn") != NULL) {
            fprintf(fp, "%s\n", code);
        } else {
            fprintf(fp, "double user_real_fn(double x) {\n    (void)x;\n%s\n}\n", code);
        }
    }
    fclose(fp);

    int pipefd[2];
    if (pipe(pipefd) != 0) {
        unlink(c_path);
        snprintf(diag_out, diag_cap, "Failed to create compiler pipe.");
        return false;
    }

    pid_t pid = fork();
    if (pid < 0) {
        close(pipefd[0]);
        close(pipefd[1]);
        unlink(c_path);
        snprintf(diag_out, diag_cap, "Failed to fork clang compiler.");
        return false;
    }

    if (pid == 0) {
        close(pipefd[0]);
        dup2(pipefd[1], STDOUT_FILENO);
        dup2(pipefd[1], STDERR_FILENO);
        close(pipefd[1]);
        char *argv[] = {"clang", "-O2",  "-shared", "-fPIC", "-Wall", "-Wextra",
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
        if (diag_out && diag_out[0] == '\0') {
            snprintf(diag_out, diag_cap, "clang exited with error status %d.", WEXITSTATUS(status));
        }
        return false;
    }

    void *handle = dlopen(so_path, RTLD_NOW | RTLD_LOCAL);
    if (!handle) {
        unlink(so_path);
        snprintf(diag_out, diag_cap, "dlopen failed: %s", dlerror());
        return false;
    }

    const char *sym_name = is_real ? "user_real_fn" : "user_fn";
    void *sym = dlsym(handle, sym_name);
    if (!sym) {
        dlclose(handle);
        unlink(so_path);
        snprintf(diag_out, diag_cap, "Missing symbol '%s': %s", sym_name, dlerror());
        return false;
    }

    pthread_rwlock_wrlock(&g_hot_lock);
    if (!is_real) {
        if (g_complex_handle) {
            dlclose(g_complex_handle);
        }
        if (g_complex_so[0]) {
            unlink(g_complex_so);
        }
        g_complex_handle = handle;
        memcpy(&g_complex_fn, &sym, sizeof(g_complex_fn));
        snprintf(g_complex_so, sizeof(g_complex_so), "%s", so_path);
        snprintf(g_complex_src, sizeof(g_complex_src), "%s", code);
    } else {
        if (g_real_handle) {
            dlclose(g_real_handle);
        }
        if (g_real_so[0]) {
            unlink(g_real_so);
        }
        g_real_handle = handle;
        memcpy(&g_real_fn, &sym, sizeof(g_real_fn));
        snprintf(g_real_so, sizeof(g_real_so), "%s", so_path);
        snprintf(g_real_src, sizeof(g_real_src), "%s", code);
    }
    pthread_rwlock_unlock(&g_hot_lock);

    return true;
}

bool hot_has_complex(void) {
    pthread_rwlock_rdlock(&g_hot_lock);
    bool ok = g_complex_fn != NULL;
    pthread_rwlock_unlock(&g_hot_lock);
    return ok;
}

bool hot_has_real(void) {
    pthread_rwlock_rdlock(&g_hot_lock);
    bool ok = g_real_fn != NULL;
    pthread_rwlock_unlock(&g_hot_lock);
    return ok;
}

double complex hot_eval_complex(double complex z) {
    pthread_rwlock_rdlock(&g_hot_lock);
    HotComplexFn fn = g_complex_fn;
    double complex res = fn ? fn(z) : c_zeta(z);
    pthread_rwlock_unlock(&g_hot_lock);
    return res;
}

double hot_eval_real(double x) {
    pthread_rwlock_rdlock(&g_hot_lock);
    HotRealFn fn = g_real_fn;
    double res = fn ? fn(x) : sin(x);
    pthread_rwlock_unlock(&g_hot_lock);
    return res;
}

void hot_get_source(bool is_real, char *out, size_t out_cap) {
    if (!out || out_cap == 0) {
        return;
    }
    pthread_rwlock_rdlock(&g_hot_lock);
    const char *src = is_real ? g_real_src : g_complex_src;
    snprintf(out, out_cap, "%s", src);
    pthread_rwlock_unlock(&g_hot_lock);
}
