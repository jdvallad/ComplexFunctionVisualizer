#define _POSIX_C_SOURCE 200809L

#include "web_server.h"
#include "complex_math.h"
#include "functions.h"
#include "hot_compile.h"
#include "real_functions.h"
#include "real_math.h"
#include "sampler.h"

#include <arpa/inet.h>
#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <math.h>
#include <netinet/in.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <unistd.h>

#define WORKER_THREADS 8
#define QUEUE_CAPACITY 128
#define MAX_HEADER_BYTES 16384
#define MAX_BODY_BYTES (4 * 1024 * 1024)

static volatile sig_atomic_t g_running = 1;
static ServerConfig g_cfg = {
    .host = "127.0.0.1",
    .port = 1738,
    .web_dir = "web",
    .enable_compile = true,
    .compile_token = NULL,
};

static bool const_time_eq(const char *a, const char *b) {
    if (!a || !b) {
        return false;
    }
    size_t la = strlen(a);
    size_t lb = strlen(b);
    if (la != lb || la == 0) {
        return false;
    }
    unsigned char diff = 0;
    for (size_t i = 0; i < la; i++) {
        diff |= (unsigned char)(a[i] ^ b[i]);
    }
    return diff == 0;
}

static void handle_signal(int sig) {
    (void)sig;
    g_running = 0;
}

/* ----------------------------------------------------------------------------
 * Dynamic String Builder
 * ---------------------------------------------------------------------------- */

typedef struct {
    char *data;
    size_t len;
    size_t cap;
} StrBuf;

static bool sb_reserve(StrBuf *sb, size_t extra) {
    if (sb->len + extra + 1 <= sb->cap) {
        return true;
    }
    size_t new_cap = sb->cap == 0 ? 4096 : sb->cap;
    while (new_cap < sb->len + extra + 1) {
        new_cap *= 2;
    }
    char *p = realloc(sb->data, new_cap);
    if (!p) {
        return false;
    }
    sb->data = p;
    sb->cap = new_cap;
    return true;
}

static bool sb_append_raw(StrBuf *sb, const char *s, size_t n) {
    if (!sb_reserve(sb, n)) {
        return false;
    }
    memcpy(sb->data + sb->len, s, n);
    sb->len += n;
    sb->data[sb->len] = '\0';
    return true;
}

static bool sb_append(StrBuf *sb, const char *s) { return sb_append_raw(sb, s, strlen(s)); }

static bool sb_printf(StrBuf *sb, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int needed = vsnprintf(NULL, 0, fmt, ap);
    va_end(ap);
    if (needed < 0) {
        return false;
    }
    if (!sb_reserve(sb, (size_t)needed)) {
        return false;
    }
    va_start(ap, fmt);
    vsnprintf(sb->data + sb->len, (size_t)needed + 1, fmt, ap);
    va_end(ap);
    sb->len += (size_t)needed;
    return true;
}

static bool sb_append_json_str(StrBuf *sb, const char *s) {
    if (!sb_append_raw(sb, "\"", 1)) {
        return false;
    }
    if (s) {
        for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
            switch (*p) {
            case '\"':
                sb_append(sb, "\\\"");
                break;
            case '\\':
                sb_append(sb, "\\\\");
                break;
            case '\n':
                sb_append(sb, "\\n");
                break;
            case '\r':
                sb_append(sb, "\\r");
                break;
            case '\t':
                sb_append(sb, "\\t");
                break;
            default:
                if (*p < 0x20) {
                    sb_printf(sb, "\\u%04x", (unsigned)*p);
                } else {
                    sb_append_raw(sb, (const char *)p, 1);
                }
                break;
            }
        }
    }
    return sb_append_raw(sb, "\"", 1);
}

static void sb_free(StrBuf *sb) {
    free(sb->data);
    sb->data = NULL;
    sb->len = 0;
    sb->cap = 0;
}

/* ----------------------------------------------------------------------------
 * Minimal JSON Field Extractors (zero external dependencies)
 * ---------------------------------------------------------------------------- */

static const char *json_find_key(const char *json, const char *key) {
    size_t klen = strlen(key);
    const char *p = json;
    while (p && *p) {
        const char *q = strchr(p, '"');
        if (!q) {
            return NULL;
        }
        q++;
        if (strncmp(q, key, klen) == 0 && q[klen] == '"') {
            const char *after = q + klen + 1;
            while (*after && isspace((unsigned char)*after)) {
                after++;
            }
            if (*after == ':') {
                after++;
                while (*after && isspace((unsigned char)*after)) {
                    after++;
                }
                return after;
            }
        }
        /* Skip to end of quoted string */
        while (*q && *q != '"') {
            if (*q == '\\' && q[1]) {
                q += 2;
            } else {
                q++;
            }
        }
        p = (*q == '"') ? q + 1 : q;
    }
    return NULL;
}

static bool json_get_double(const char *json, const char *key, double *out) {
    const char *v = json_find_key(json, key);
    if (!v) {
        return false;
    }
    char *end = NULL;
    double val = strtod(v, &end);
    if (end == v || !isfinite(val)) {
        return false;
    }
    *out = val;
    return true;
}

static bool json_get_int(const char *json, const char *key, int *out) {
    double d = 0.0;
    if (!json_get_double(json, key, &d)) {
        return false;
    }
    *out = (int)d;
    return true;
}

static bool json_get_bool(const char *json, const char *key, bool *out) {
    const char *v = json_find_key(json, key);
    if (!v) {
        return false;
    }
    if (strncmp(v, "true", 4) == 0) {
        *out = true;
        return true;
    }
    if (strncmp(v, "false", 5) == 0) {
        *out = false;
        return true;
    }
    return false;
}

static bool json_get_string(const char *json, const char *key, char *out, size_t out_cap) {
    const char *v = json_find_key(json, key);
    if (!v || *v != '"' || !out || out_cap == 0) {
        return false;
    }
    v++;
    size_t n = 0;
    while (*v && *v != '"' && n + 1 < out_cap) {
        if (*v == '\\' && v[1]) {
            v++;
            switch (*v) {
            case 'n':
                out[n++] = '\n';
                break;
            case 'r':
                out[n++] = '\r';
                break;
            case 't':
                out[n++] = '\t';
                break;
            case '"':
                out[n++] = '"';
                break;
            case '\\':
                out[n++] = '\\';
                break;
            default:
                out[n++] = *v;
                break;
            }
            v++;
        } else {
            out[n++] = *v++;
        }
    }
    out[n] = '\0';
    return true;
}

static _Thread_local int g_tls_slot = 0;
static _Thread_local EvalParams g_tls_params;
static _Thread_local int g_tls_dirichlet_n = 20;

static double complex eval_tls_complex_slot(double complex z) {
    return hot_eval_complex_slot(g_tls_slot, z, &g_tls_params);
}

static double complex eval_tls_dirichlet(double complex z) {
    return c_zeta_partial(z, g_tls_dirichlet_n);
}

static double eval_tls_real_slot(double x) {
    return hot_eval_real_slot(g_tls_slot, x, &g_tls_params);
}

static void json_get_double_array(const char *json, const char *key, double *out, size_t max_n,
                                  int *count_out) {
    *count_out = 0;
    const char *v = json_find_key(json, key);
    if (!v || *v != '[') {
        return;
    }
    v++;
    size_t n = 0;
    while (*v && n < max_n) {
        while (*v && (isspace((unsigned char)*v) || *v == ',')) {
            v++;
        }
        if (*v == ']') {
            break;
        }
        char *end = NULL;
        double num = strtod(v, &end);
        if (end == v) {
            break;
        }
        out[n++] = isfinite(num) ? num : 0.0;
        v = end;
    }
    *count_out = (int)n;
}

static size_t json_get_string_array(const char *json, const char *key, char **out_ptrs,
                                    size_t max_items, size_t max_item_len) {
    const char *v = json_find_key(json, key);
    if (!v || *v != '[') {
        return 0;
    }
    v++;
    size_t count = 0;
    while (*v && count < max_items) {
        while (*v && (isspace((unsigned char)*v) || *v == ',')) {
            v++;
        }
        if (*v == ']') {
            break;
        }
        if (*v != '"') {
            break;
        }
        v++;
        char *buf = malloc(max_item_len);
        if (!buf) {
            break;
        }
        size_t n = 0;
        while (*v && *v != '"' && n + 1 < max_item_len) {
            if (*v == '\\' && v[1]) {
                v++;
                switch (*v) {
                case 'n':
                    buf[n++] = '\n';
                    break;
                case 'r':
                    buf[n++] = '\r';
                    break;
                case 't':
                    buf[n++] = '\t';
                    break;
                case '"':
                    buf[n++] = '"';
                    break;
                case '\\':
                    buf[n++] = '\\';
                    break;
                default:
                    buf[n++] = *v;
                    break;
                }
                v++;
            } else {
                buf[n++] = *v++;
            }
        }
        buf[n] = '\0';
        while (*v && *v != '"') {
            if (*v == '\\' && v[1]) {
                v += 2;
            } else {
                v++;
            }
        }
        if (*v == '"') {
            v++;
        }
        out_ptrs[count++] = buf;
    }
    return count;
}

static const FunctionDef *resolve_complex_req(const char *body, FunctionDef *tmp_hot) {
    int slot = -1;
    if (json_get_int(body, "slot", &slot) && slot >= 0 && slot < hot_complex_slot_count()) {
        g_tls_slot = slot;
        memset(&g_tls_params, 0, sizeof(g_tls_params));
        json_get_double_array(body, "params", g_tls_params.v, MAX_EVAL_PARAMS, &g_tls_params.count);
        memset(tmp_hot, 0, sizeof(*tmp_hot));
        tmp_hot->id = "live_slot";
        tmp_hot->name = "Live C Card";
        tmp_hot->formula = "card(z)";
        tmp_hot->eval = eval_tls_complex_slot;
        return tmp_hot;
    }
    bool is_dirichlet = false;
    if (json_get_bool(body, "dirichlet", &is_dirichlet) && is_dirichlet) {
        int n = 20;
        json_get_int(body, "n", &n);
        if (n < 1) {
            n = 1;
        }
        if (n > 1000) {
            n = 1000;
        }
        g_tls_dirichlet_n = n;
        memset(tmp_hot, 0, sizeof(*tmp_hot));
        tmp_hot->id = "dirichlet";
        tmp_hot->name = "Dirichlet Partial Sum";
        tmp_hot->formula = "c_zeta_partial(s, N)";
        tmp_hot->eval = eval_tls_dirichlet;
        return tmp_hot;
    }
    int fn_idx = -1;
    if (!json_get_int(body, "fn", &fn_idx)) {
        return NULL;
    }
    if (fn_idx == -1 && hot_has_complex()) {
        g_tls_slot = 0;
        memset(&g_tls_params, 0, sizeof(g_tls_params));
        json_get_double_array(body, "params", g_tls_params.v, MAX_EVAL_PARAMS, &g_tls_params.count);
        memset(tmp_hot, 0, sizeof(*tmp_hot));
        tmp_hot->id = "live_c";
        tmp_hot->name = "Live C Function";
        tmp_hot->formula = "user_fn(z)";
        tmp_hot->eval = eval_tls_complex_slot;
        return tmp_hot;
    }
    if (fn_idx < 0) {
        return NULL;
    }
    return functions_get((size_t)fn_idx);
}

static const RealFunctionDef *resolve_real_fn(int fn_idx, RealFunctionDef *tmp_hot) {
    if (fn_idx == -1 && hot_has_real()) {
        g_tls_slot = 0;
        memset(&g_tls_params, 0, sizeof(g_tls_params));
        memset(tmp_hot, 0, sizeof(*tmp_hot));
        tmp_hot->id = "live_real_c";
        tmp_hot->name = "Live C Real Function";
        tmp_hot->formula = "user_real_fn(x)";
        tmp_hot->exact_fn = eval_tls_real_slot;
        return tmp_hot;
    }
    if (fn_idx < 0) {
        return NULL;
    }
    return real_functions_get((size_t)fn_idx);
}

static bool json_get_points(const char *json, const char *key, Point2D **pts_out,
                            size_t *count_out) {
    const char *v = json_find_key(json, key);
    if (!v || *v != '[') {
        return false;
    }
    v++;

    size_t cap = 64;
    size_t nvals = 0;
    double *vals = malloc(cap * sizeof(double));
    if (!vals) {
        return false;
    }

    while (*v) {
        while (*v && (isspace((unsigned char)*v) || *v == ',')) {
            v++;
        }
        if (*v == ']') {
            break;
        }
        char *end = NULL;
        double num = strtod(v, &end);
        if (end == v) {
            free(vals);
            return false;
        }
        if (nvals == cap) {
            if (cap >= 200000) {
                free(vals);
                return false;
            }
            cap *= 2;
            double *nv = realloc(vals, cap * sizeof(double));
            if (!nv) {
                free(vals);
                return false;
            }
            vals = nv;
        }
        vals[nvals++] = num;
        v = end;
    }

    size_t npts = nvals / 2;
    Point2D *pts = malloc((npts > 0 ? npts : 1) * sizeof(Point2D));
    if (!pts) {
        free(vals);
        return false;
    }
    for (size_t i = 0; i < npts; i++) {
        pts[i].x = vals[2 * i];
        pts[i].y = vals[2 * i + 1];
    }
    free(vals);
    *pts_out = pts;
    *count_out = npts;
    return true;
}

/* ----------------------------------------------------------------------------
 * HTTP Response Helpers
 * ---------------------------------------------------------------------------- */

static bool send_all(int fd, const void *buf, size_t len) {
    const uint8_t *p = (const uint8_t *)buf;
    size_t sent = 0;
    while (sent < len) {
        ssize_t n = send(fd, p + sent, len - sent, MSG_NOSIGNAL);
        if (n < 0) {
            if (errno == EINTR) {
                continue;
            }
            return false;
        }
        if (n == 0) {
            return false;
        }
        sent += (size_t)n;
    }
    return true;
}

static void send_response(int fd, int status, const char *status_text, const char *content_type,
                          const void *body, size_t body_len, bool keep_alive) {
    char header[640];
    int hlen =
        snprintf(header, sizeof(header),
                 "HTTP/1.1 %d %s\r\n"
                 "Content-Type: %s\r\n"
                 "Content-Length: %zu\r\n"
                 "Cache-Control: no-store, no-cache, must-revalidate\r\n"
                 "X-Content-Type-Options: nosniff\r\n"
                 "X-Frame-Options: SAMEORIGIN\r\n"
                 "Referrer-Policy: no-referrer\r\n"
                 "Connection: %s\r\n"
                 "\r\n",
                 status, status_text, content_type, body_len, keep_alive ? "keep-alive" : "close");
    if (hlen > 0) {
        if (send_all(fd, header, (size_t)hlen) && body_len > 0) {
            send_all(fd, body, body_len);
        }
    }
}

static void send_json_error(int fd, int status, const char *msg, bool keep_alive) {
    char body[256];
    int blen = snprintf(body, sizeof(body), "{\"error\":\"%s\"}", msg);
    send_response(fd, status, status == 400 ? "Bad Request" : "Not Found", "application/json", body,
                  blen > 0 ? (size_t)blen : 0, keep_alive);
}

/* ----------------------------------------------------------------------------
 * API Route Handlers
 * ---------------------------------------------------------------------------- */

static void handle_api_functions(int fd, bool keep_alive) {
    StrBuf sb = {0};
    sb_append(&sb, "{\"functions\":[");
    size_t count = functions_count();
    for (size_t i = 0; i < count; i++) {
        const FunctionDef *f = functions_get(i);
        if (i > 0) {
            sb_append(&sb, ",");
        }
        sb_printf(&sb, "{\"index\":%zu,\"id\":", i);
        sb_append_json_str(&sb, f->id);
        sb_append(&sb, ",\"name\":");
        sb_append_json_str(&sb, f->name);
        sb_append(&sb, ",\"formula\":");
        sb_append_json_str(&sb, f->formula);
        sb_append(&sb, ",\"description\":");
        sb_append_json_str(&sb, f->description);
        sb_append(&sb, ",\"c_source\":");
        sb_append_json_str(&sb, f->c_source);
        sb_printf(&sb,
                  ",\"in_view\":{\"cx\":%.6g,\"cy\":%.6g,\"r\":%.6g},"
                  "\"out_view\":{\"cx\":%.6g,\"cy\":%.6g,\"r\":%.6g},\"landmarks\":[",
                  f->in_cx, f->in_cy, f->in_radius, f->out_cx, f->out_cy, f->out_radius);
        for (size_t j = 0; j < f->landmark_count; j++) {
            if (j > 0) {
                sb_append(&sb, ",");
            }
            sb_printf(&sb, "{\"x\":%.10g,\"y\":%.10g,\"label\":", f->landmarks[j].x,
                      f->landmarks[j].y);
            sb_append_json_str(&sb, f->landmarks[j].label);
            sb_append(&sb, ",\"kind\":");
            sb_append_json_str(&sb, f->landmarks[j].kind);
            sb_append(&sb, "}");
        }
        sb_append(&sb, "]}");
    }
    sb_append(&sb, "]}");
    send_response(fd, 200, "OK", "application/json", sb.data, sb.len, keep_alive);
    sb_free(&sb);
}

static void handle_api_eval(int fd, const char *body, bool keep_alive) {
    FunctionDef tmp_hot;
    const FunctionDef *fn = resolve_complex_req(body, &tmp_hot);
    if (!fn) {
        send_json_error(fd, 400, "Invalid function index", keep_alive);
        return;
    }

    Point2D *pts = NULL;
    size_t npts = 0;
    if (!json_get_points(body, "points", &pts, &npts)) {
        send_json_error(fd, 400, "Missing or invalid points array", keep_alive);
        return;
    }

    StrBuf sb = {0};
    sb_append(&sb, "{\"out\":[");
    for (size_t i = 0; i < npts; i++) {
        if (i > 0) {
            sb_append(&sb, ",");
        }
        double complex w = fn->eval(c_make(pts[i].x, pts[i].y));
        if (c_isfinite(w) && cabs(w) < 1e12) {
            sb_printf(&sb, "%.10g,%.10g", creal(w), cimag(w));
        } else {
            sb_append(&sb, "null,null");
        }
    }
    sb_append(&sb, "]}");

    free(pts);
    send_response(fd, 200, "OK", "application/json", sb.data, sb.len, keep_alive);
    sb_free(&sb);
}

static void append_curve_json(StrBuf *sb, const CurveResult *c) {
    sb_append(sb, "{\"in\":[");
    for (size_t i = 0; i < c->count; i++) {
        if (i > 0) {
            sb_append(sb, ",");
        }
        sb_printf(sb, "%.7g,%.7g", c->in_pts[i].x, c->in_pts[i].y);
    }
    sb_append(sb, "],\"out\":[");
    for (size_t i = 0; i < c->count; i++) {
        if (i > 0) {
            sb_append(sb, ",");
        }
        if (c->out_valid[i]) {
            sb_printf(sb, "%.7g,%.7g", c->out_pts[i].x, c->out_pts[i].y);
        } else {
            sb_append(sb, "null,null");
        }
    }
    sb_append(sb, "]}");
}

static void handle_api_trace(int fd, const char *body, bool keep_alive) {
    FunctionDef tmp_hot;
    const FunctionDef *fn = resolve_complex_req(body, &tmp_hot);
    if (!fn) {
        send_json_error(fd, 400, "Invalid function index", keep_alive);
        return;
    }

    Point2D *pts = NULL;
    size_t npts = 0;
    if (!json_get_points(body, "points", &pts, &npts) || npts == 0) {
        free(pts);
        send_json_error(fd, 400, "Missing points array", keep_alive);
        return;
    }

    TraceOptions opts = {
        .closed = false,
        .with_mesh = true,
        .max_in_step = 0.25,
        .max_out_step = 0.14,
        .clip_radius = 120.0,
        .max_points = 10000,
    };
    json_get_bool(body, "closed", &opts.closed);
    json_get_bool(body, "with_mesh", &opts.with_mesh);
    json_get_double(body, "max_in_step", &opts.max_in_step);
    json_get_double(body, "max_out_step", &opts.max_out_step);
    json_get_double(body, "clip_radius", &opts.clip_radius);

    if (opts.max_in_step < 1e-4) {
        opts.max_in_step = 1e-4;
    }
    if (opts.max_out_step < 1e-4) {
        opts.max_out_step = 1e-4;
    }
    if (opts.clip_radius < 1.0) {
        opts.clip_radius = 1.0;
    }

    TraceResult res;
    sampler_trace(fn, pts, npts, &opts, &res);
    free(pts);

    StrBuf sb = {0};
    sb_append(&sb, "{\"boundary\":");
    append_curve_json(&sb, &res.boundary);
    if (res.has_winding) {
        sb_printf(&sb, ",\"winding\":%d", res.winding);
    } else {
        sb_append(&sb, ",\"winding\":null");
    }
    sb_append(&sb, ",\"mesh\":[");
    for (size_t i = 0; i < res.mesh_count; i++) {
        if (i > 0) {
            sb_append(&sb, ",");
        }
        append_curve_json(&sb, &res.mesh_lines[i]);
    }
    sb_append(&sb, "]}");

    trace_result_free(&res);
    send_response(fd, 200, "OK", "application/json", sb.data, sb.len, keep_alive);
    sb_free(&sb);
}

static int parse_domain_scheme(const char *body) {
    char scheme[64];
    if (!json_get_string(body, "scheme", scheme, sizeof(scheme))) {
        return DOMAIN_SCHEME_CLASSIC;
    }
    if (strcmp(scheme, "smooth_escape") == 0 || strcmp(scheme, "mandelbrot") == 0) {
        return DOMAIN_SCHEME_SMOOTH_ESCAPE;
    }
    if (strcmp(scheme, "inferno") == 0) {
        return DOMAIN_SCHEME_INFERNO;
    }
    if (strcmp(scheme, "ocean") == 0) {
        return DOMAIN_SCHEME_OCEAN;
    }
    if (strcmp(scheme, "neon_prism") == 0 || strcmp(scheme, "neon") == 0) {
        return DOMAIN_SCHEME_NEON_PRISM;
    }
    if (strcmp(scheme, "grayscale") == 0 || strcmp(scheme, "grayscale_contour") == 0) {
        return DOMAIN_SCHEME_GRAYSCALE;
    }
    return DOMAIN_SCHEME_CLASSIC;
}

static void handle_api_domain(int fd, const char *body, bool keep_alive) {
    double cx = 0.0, cy = 0.0, half_w = 4.0, half_h = 4.0;
    int width = 200, height = 200;

    json_get_double(body, "cx", &cx);
    json_get_double(body, "cy", &cy);
    json_get_double(body, "half_w", &half_w);
    json_get_double(body, "half_h", &half_h);
    json_get_int(body, "width", &width);
    json_get_int(body, "height", &height);
    int scheme = parse_domain_scheme(body);

    int slot = -1;
    bool is_slot =
        json_get_int(body, "slot", &slot) && slot >= 0 && slot < hot_complex_slot_count();
    bool is_dirichlet = false;
    json_get_bool(body, "dirichlet", &is_dirichlet);

    FunctionDef tmp_hot;
    const FunctionDef *fn = resolve_complex_req(body, &tmp_hot);
    if (!fn || width < 16 || height < 16 || width > 2400 || height > 2400 ||
        (size_t)width * (size_t)height > 4200000 || half_w <= 0.0 || half_h <= 0.0) {
        send_json_error(fd, 400, "Invalid domain parameters", keep_alive);
        return;
    }

    size_t nbytes = (size_t)width * (size_t)height * 4;
    uint8_t *rgba = malloc(nbytes);
    if (!rgba) {
        send_json_error(fd, 500, "Out of memory", keep_alive);
        return;
    }

    if (is_slot) {
        EvalParams ep = {{0}, 0};
        json_get_double_array(body, "params", ep.v, MAX_EVAL_PARAMS, &ep.count);
        hot_render_domain_slot(slot, &ep, cx, cy, half_w, half_h, width, height, scheme, rgba);
    } else if (is_dirichlet || fn == &tmp_hot) {
        /* Render TLS-backed evaluator on current thread so EvalParams/slot/N stay thread-safe. */
        double x0 = cx - half_w;
        double y0 = cy + half_h;
        double dx = (2.0 * half_w) / (double)width;
        double dy = (2.0 * half_h) / (double)height;
        for (int py = 0; py < height; py++) {
            double im = y0 - ((double)py + 0.5) * dy;
            for (int px = 0; px < width; px++) {
                double re = x0 + ((double)px + 0.5) * dx;
                double complex w = fn->eval(c_make(re, im));
                size_t idx = ((size_t)py * (size_t)width + (size_t)px) * 4;
                uint8_t r, g, b;
                sampler_color_complex(w, scheme, &r, &g, &b);
                rgba[idx + 0] = r;
                rgba[idx + 1] = g;
                rgba[idx + 2] = b;
                rgba[idx + 3] = 255;
            }
        }
    } else {
        sampler_render_domain_ex(fn, cx, cy, half_w, half_h, width, height, scheme, rgba);
    }
    send_response(fd, 200, "OK", "application/octet-stream", rgba, nbytes, keep_alive);
    free(rgba);
}

static void handle_api_integrate(int fd, const char *body, bool keep_alive) {
    FunctionDef tmp_hot;
    const FunctionDef *fn = resolve_complex_req(body, &tmp_hot);
    if (!fn) {
        send_json_error(fd, 400, "Invalid function index", keep_alive);
        return;
    }

    Point2D *pts = NULL;
    size_t npts = 0;
    if (!json_get_points(body, "points", &pts, &npts) || npts < 2) {
        free(pts);
        send_json_error(fd, 400, "Need at least 2 contour points", keep_alive);
        return;
    }

    bool closed = false;
    double max_in_step = 0.25;
    json_get_bool(body, "closed", &closed);
    json_get_double(body, "max_in_step", &max_in_step);

    IntegralResult res;
    sampler_integrate(fn, pts, npts, closed, max_in_step, &res);
    free(pts);

    /* Divide total integral by 2*pi*i: (a + bi) / (2*pi*i) = (b - a*i) / (2*pi) */
    const double inv_2pi = 1.0 / (2.0 * 3.14159265358979323846);
    double res_re = res.total_im * inv_2pi;
    double res_im = -res.total_re * inv_2pi;

    StrBuf sb = {0};
    sb_append(&sb, "{\"in\":[");
    for (size_t i = 0; i < res.count; i++) {
        if (i > 0) {
            sb_append(&sb, ",");
        }
        sb_printf(&sb, "%.7g,%.7g", res.in_pts[i].x, res.in_pts[i].y);
    }
    sb_append(&sb, "],\"cum\":[");
    for (size_t i = 0; i < res.count; i++) {
        if (i > 0) {
            sb_append(&sb, ",");
        }
        sb_printf(&sb, "%.8g,%.8g", res.cum_pts[i].x, res.cum_pts[i].y);
    }
    sb_printf(&sb,
              "],\"total\":[%.12g,%.12g],\"div_2pii\":[%.12g,%.12g],"
              "\"arc_length\":%.9g,\"orientation\":%d,\"singular\":%s}",
              res.total_re, res.total_im, res_re, res_im, res.arc_length, res.orientation,
              res.singular ? "true" : "false");

    integral_result_free(&res);
    send_response(fd, 200, "OK", "application/json", sb.data, sb.len, keep_alive);
    sb_free(&sb);
}

/* ----------------------------------------------------------------------------
 * 2D Real-Valued Functions API Routes
 * ---------------------------------------------------------------------------- */

static void handle_api_real_functions(int fd, bool keep_alive) {
    StrBuf sb = {0};
    sb_append(&sb, "{\"functions\":[");
    size_t count = real_functions_count();
    for (size_t i = 0; i < count; i++) {
        const RealFunctionDef *f = real_functions_get(i);
        if (i > 0) {
            sb_append(&sb, ",");
        }
        sb_printf(&sb, "{\"index\":%zu,\"id\":", i);
        sb_append_json_str(&sb, f->id);
        sb_append(&sb, ",\"name\":");
        sb_append_json_str(&sb, f->name);
        sb_append(&sb, ",\"formula\":");
        sb_append_json_str(&sb, f->formula);
        sb_append(&sb, ",\"description\":");
        sb_append_json_str(&sb, f->description);
        sb_append(&sb, ",\"c_source\":");
        sb_append_json_str(&sb, f->c_source);
        sb_printf(&sb, ",\"has_approx\":%s,\"has_baseline\":%s,\"baseline_label\":",
                  f->approx_fn ? "true" : "false", f->baseline_fn ? "true" : "false");
        sb_append_json_str(&sb, f->baseline_label ? f->baseline_label : "");
        sb_printf(&sb,
                  ",\"is_step_exact\":%s,\"show_primes\":%s,\"show_zeros\":%s,"
                  "\"max_k\":%d,\"k_unit\":",
                  f->is_step_exact ? "true" : "false", f->show_primes ? "true" : "false",
                  f->show_zeros ? "true" : "false", f->max_k);
        sb_append_json_str(&sb, f->k_unit ? f->k_unit : "");
        sb_append(&sb, ",\"default_ks\":[");
        for (int j = 0; j < f->default_k_count; j++) {
            if (j > 0) {
                sb_append(&sb, ",");
            }
            sb_printf(&sb, "%d", f->default_ks[j]);
        }
        sb_printf(&sb, "],\"view\":{\"xmin\":%.6g,\"xmax\":%.6g,\"ymin\":%.6g,\"ymax\":%.6g}}",
                  f->xmin, f->xmax, f->ymin, f->ymax);
    }
    sb_append(&sb, "],\"zeros\":[");
    for (int i = 0; i < 40 && i < RIEMANN_ZERO_COUNT; i++) {
        if (i > 0) {
            sb_append(&sb, ",");
        }
        sb_printf(&sb, "%.7g", RIEMANN_ZEROS[i]);
    }
    sb_append(&sb, "]}");
    send_response(fd, 200, "OK", "application/json", sb.data, sb.len, keep_alive);
    sb_free(&sb);
}

static bool json_get_int_array(const char *json, const char *key, int *out, size_t max_n,
                               size_t *count_out) {
    const char *v = json_find_key(json, key);
    if (!v || *v != '[') {
        *count_out = 0;
        return false;
    }
    v++;
    size_t n = 0;
    while (*v && n < max_n) {
        while (*v && (isspace((unsigned char)*v) || *v == ',')) {
            v++;
        }
        if (*v == ']') {
            break;
        }
        char *end = NULL;
        long val = strtol(v, &end, 10);
        if (end == v) {
            break;
        }
        out[n++] = (int)val;
        v = end;
    }
    *count_out = n;
    return true;
}

static void append_double_array_json(StrBuf *sb, const double *arr, size_t n) {
    sb_append(sb, "[");
    for (size_t i = 0; i < n; i++) {
        if (i > 0) {
            sb_append(sb, ",");
        }
        if (isfinite(arr[i]) && fabs(arr[i]) < 1e12) {
            sb_printf(sb, "%.7g", arr[i]);
        } else {
            sb_append(sb, "null");
        }
    }
    sb_append(sb, "]");
}

static void handle_api_real_sample(int fd, const char *body, bool keep_alive) {
    int fn_idx = 0;
    double xmin = 1.8, xmax = 40.0;
    int samples = 450;
    bool inc_exact = true;
    bool inc_baseline = false;

    json_get_int(body, "fn", &fn_idx);
    json_get_double(body, "xmin", &xmin);
    json_get_double(body, "xmax", &xmax);
    json_get_int(body, "samples", &samples);
    json_get_bool(body, "exact", &inc_exact);
    json_get_bool(body, "baseline", &inc_baseline);

    RealFunctionDef tmp_hot;
    const RealFunctionDef *fn = resolve_real_fn(fn_idx, &tmp_hot);
    if (!fn || xmax <= xmin || samples < 8) {
        send_json_error(fd, 400, "Invalid real sample parameters", keep_alive);
        return;
    }
    if (samples > 1200) {
        samples = 1200;
    }

    int ks[16];
    size_t k_count = 0;
    json_get_int_array(body, "ks", ks, 16, &k_count);

    double *xs = malloc((size_t)samples * sizeof(double));
    double *ys = malloc((size_t)samples * sizeof(double));
    if (!xs || !ys) {
        free(xs);
        free(ys);
        send_json_error(fd, 500, "Out of memory", keep_alive);
        return;
    }

    for (int i = 0; i < samples; i++) {
        xs[i] = xmin + (xmax - xmin) * ((double)i / (double)(samples - 1));
    }

    StrBuf sb = {0};
    sb_append(&sb, "{\"xs\":");
    append_double_array_json(&sb, xs, (size_t)samples);

    if (inc_exact && fn->exact_fn) {
        real_sample_series(fn, 0, 0, xs, (size_t)samples, ys);
        sb_append(&sb, ",\"exact\":");
        append_double_array_json(&sb, ys, (size_t)samples);
    }

    if (inc_baseline && fn->baseline_fn) {
        real_sample_series(fn, 1, 0, xs, (size_t)samples, ys);
        sb_append(&sb, ",\"baseline\":");
        append_double_array_json(&sb, ys, (size_t)samples);
    }

    sb_append(&sb, ",\"approx\":[");
    if (fn->approx_fn) {
        for (size_t j = 0; j < k_count; j++) {
            if (j > 0) {
                sb_append(&sb, ",");
            }
            real_sample_series(fn, 2, ks[j], xs, (size_t)samples, ys);
            sb_printf(&sb, "{\"k\":%d,\"ys\":", ks[j]);
            append_double_array_json(&sb, ys, (size_t)samples);
            sb_append(&sb, "}");
        }
    }
    sb_append(&sb, "]}");

    free(xs);
    free(ys);
    send_response(fd, 200, "OK", "application/json", sb.data, sb.len, keep_alive);
    sb_free(&sb);
}

/* ----------------------------------------------------------------------------
 * Analysis Lab & Live C Hot-Compiler Endpoints
 * ---------------------------------------------------------------------------- */

static void handle_api_config(int fd, bool keep_alive) {
    bool has_tok = g_cfg.compile_token != NULL && g_cfg.compile_token[0] != '\0';
    char body[160];
    int len = snprintf(body, sizeof(body), "{\"compile_enabled\":%s,\"compile_requires_token\":%s}",
                       g_cfg.enable_compile ? "true" : "false", has_tok ? "true" : "false");
    send_response(fd, 200, "OK", "application/json", body, len > 0 ? (size_t)len : 0, keep_alive);
}

static void handle_api_compile(int fd, const char *body, const char *provided_token,
                               bool keep_alive) {
    if (!g_cfg.enable_compile) {
        const char *msg =
            "{\"ok\":false,\"diagnostics\":\"Live C compilation is disabled in public mode.\"}";
        send_response(fd, 403, "Forbidden", "application/json", msg, strlen(msg), keep_alive);
        return;
    }
    if (g_cfg.compile_token && g_cfg.compile_token[0] != '\0') {
        if (!const_time_eq(provided_token, g_cfg.compile_token)) {
            const char *msg =
                "{\"ok\":false,\"diagnostics\":\"Invalid or missing X-Compile-Token access key.\"}";
            send_response(fd, 401, "Unauthorized", "application/json", msg, strlen(msg),
                          keep_alive);
            return;
        }
    }

    char kind[32] = "complex";
    char *code = malloc(4096);
    char *diag = malloc(4096);
    if (!code || !diag) {
        free(code);
        free(diag);
        send_json_error(fd, 500, "Out of memory", keep_alive);
        return;
    }
    json_get_string(body, "kind", kind, sizeof(kind));
    if (!json_get_string(body, "code", code, 4096)) {
        free(code);
        free(diag);
        send_json_error(fd, 400, "Missing C code string", keep_alive);
        return;
    }

    bool is_real = strcmp(kind, "real") == 0;
    double elapsed_ms = 0.0;
    diag[0] = '\0';
    bool ok = hot_compile_code(is_real, code, diag, 4096, &elapsed_ms);

    StrBuf sb = {0};
    sb_printf(&sb, "{\"ok\":%s,\"elapsed_ms\":%.1f,\"fn_index\":-1,\"diagnostics\":",
              ok ? "true" : "false", elapsed_ms);
    sb_append_json_str(&sb, diag);
    sb_append(&sb, "}");

    free(code);
    free(diag);
    send_response(fd, 200, "OK", "application/json", sb.data, sb.len, keep_alive);
    sb_free(&sb);
}

static void handle_api_workspace_compile(int fd, const char *body, const char *provided_token,
                                         bool keep_alive) {
    if (!g_cfg.enable_compile) {
        const char *msg =
            "{\"ok\":false,\"diagnostics\":\"Live C compilation is disabled in public mode.\"}";
        send_response(fd, 403, "Forbidden", "application/json", msg, strlen(msg), keep_alive);
        return;
    }
    if (g_cfg.compile_token && g_cfg.compile_token[0] != '\0') {
        if (!const_time_eq(provided_token, g_cfg.compile_token)) {
            const char *msg =
                "{\"ok\":false,\"diagnostics\":\"Invalid or missing X-Compile-Token access key.\"}";
            send_response(fd, 401, "Unauthorized", "application/json", msg, strlen(msg),
                          keep_alive);
            return;
        }
    }

    char kind[32] = "complex";
    json_get_string(body, "kind", kind, sizeof(kind));
    bool is_real = strcmp(kind, "real") == 0;

    char *cards[MAX_HOT_SLOTS] = {0};
    char *pnames[MAX_EVAL_PARAMS] = {0};
    size_t card_count = json_get_string_array(body, "cards", cards, MAX_HOT_SLOTS, 4096);
    size_t param_count = json_get_string_array(body, "param_names", pnames, MAX_EVAL_PARAMS, 32);

    if (card_count == 0) {
        for (size_t i = 0; i < param_count; i++) {
            free(pnames[i]);
        }
        send_json_error(fd, 400, "No C cards provided", keep_alive);
        return;
    }

    char *diag = malloc(4096);
    if (!diag) {
        for (size_t i = 0; i < card_count; i++) {
            free(cards[i]);
        }
        for (size_t i = 0; i < param_count; i++) {
            free(pnames[i]);
        }
        send_json_error(fd, 500, "Out of memory", keep_alive);
        return;
    }
    diag[0] = '\0';

    double elapsed_ms = 0.0;
    bool ok =
        hot_compile_workspace(is_real, (const char *const *)cards, card_count,
                              (const char *const *)pnames, param_count, diag, 4096, &elapsed_ms);

    for (size_t i = 0; i < card_count; i++) {
        free(cards[i]);
    }
    for (size_t i = 0; i < param_count; i++) {
        free(pnames[i]);
    }

    StrBuf sb = {0};
    sb_printf(&sb, "{\"ok\":%s,\"elapsed_ms\":%.1f,\"slots\":%zu,\"diagnostics\":",
              ok ? "true" : "false", elapsed_ms, ok ? card_count : 0);
    sb_append_json_str(&sb, diag);
    sb_append(&sb, "}");
    free(diag);
    send_response(fd, 200, "OK", "application/json", sb.data, sb.len, keep_alive);
    sb_free(&sb);
}

static void handle_api_workspace_real_sample(int fd, const char *body, bool keep_alive) {
    double xmin = 1.8, xmax = 40.0;
    int samples = 450;
    json_get_double(body, "xmin", &xmin);
    json_get_double(body, "xmax", &xmax);
    json_get_int(body, "samples", &samples);
    if (xmax <= xmin || samples < 8) {
        send_json_error(fd, 400, "Invalid range", keep_alive);
        return;
    }
    if (samples > 1200) {
        samples = 1200;
    }

    int slots[MAX_HOT_SLOTS];
    size_t slot_count = 0;
    json_get_int_array(body, "slots", slots, MAX_HOT_SLOTS, &slot_count);

    EvalParams params;
    memset(&params, 0, sizeof(params));
    json_get_double_array(body, "params", params.v, MAX_EVAL_PARAMS, &params.count);

    double *xs = malloc((size_t)samples * sizeof(double));
    double *ys = malloc((size_t)samples * sizeof(double));
    if (!xs || !ys) {
        free(xs);
        free(ys);
        send_json_error(fd, 500, "Out of memory", keep_alive);
        return;
    }
    for (int i = 0; i < samples; i++) {
        xs[i] = xmin + (xmax - xmin) * ((double)i / (double)(samples - 1));
    }

    StrBuf sb = {0};
    sb_append(&sb, "{\"xs\":");
    append_double_array_json(&sb, xs, (size_t)samples);
    sb_append(&sb, ",\"series\":[");
    for (size_t j = 0; j < slot_count; j++) {
        if (j > 0) {
            sb_append(&sb, ",");
        }
        hot_sample_real_slot(slots[j], &params, xs, (size_t)samples, ys);
        sb_printf(&sb, "{\"slot\":%d,\"ys\":", slots[j]);
        append_double_array_json(&sb, ys, (size_t)samples);
        sb_append(&sb, "}");
    }
    sb_append(&sb, "]}");

    free(xs);
    free(ys);
    send_response(fd, 200, "OK", "application/json", sb.data, sb.len, keep_alive);
    sb_free(&sb);
}

static void handle_api_workspace_implicit(int fd, const char *body, bool keep_alive) {
    int slot = 0;
    double xmin = -10.0, xmax = 10.0, ymin = -10.0, ymax = 10.0;
    int nx = 110, ny = 80;
    json_get_int(body, "slot", &slot);
    json_get_double(body, "xmin", &xmin);
    json_get_double(body, "xmax", &xmax);
    json_get_double(body, "ymin", &ymin);
    json_get_double(body, "ymax", &ymax);
    json_get_int(body, "nx", &nx);
    json_get_int(body, "ny", &ny);

    if (xmax <= xmin || ymax <= ymin || slot < 0 || slot >= hot_real_slot_count()) {
        send_json_error(fd, 400, "Invalid implicit parameters", keep_alive);
        return;
    }
    if (nx < 8) {
        nx = 8;
    }
    if (nx > 220) {
        nx = 220;
    }
    if (ny < 8) {
        ny = 8;
    }
    if (ny > 180) {
        ny = 180;
    }

    EvalParams params;
    memset(&params, 0, sizeof(params));
    json_get_double_array(body, "params", params.v, MAX_EVAL_PARAMS, &params.count);

    size_t count = (size_t)nx * (size_t)ny;
    float *grid = malloc(count * sizeof(float));
    if (!grid) {
        send_json_error(fd, 500, "Out of memory", keep_alive);
        return;
    }
    hot_sample_implicit_slot(slot, &params, xmin, xmax, ymin, ymax, nx, ny, grid);
    send_response(fd, 200, "OK", "application/octet-stream", grid, count * sizeof(float),
                  keep_alive);
    free(grid);
}

static void handle_api_workspace_parametric(int fd, const char *body, bool keep_alive) {
    int slot = 0;
    double tmin = 0.0, tmax = 6.283185307179586;
    int samples = 600;
    json_get_int(body, "slot", &slot);
    json_get_double(body, "tmin", &tmin);
    json_get_double(body, "tmax", &tmax);
    json_get_int(body, "samples", &samples);

    if (tmax <= tmin || slot < 0 || slot >= hot_real_slot_count()) {
        send_json_error(fd, 400, "Invalid parametric parameters", keep_alive);
        return;
    }
    if (samples < 16) {
        samples = 16;
    }
    if (samples > 4800) {
        samples = 4800;
    }

    EvalParams params;
    memset(&params, 0, sizeof(params));
    json_get_double_array(body, "params", params.v, MAX_EVAL_PARAMS, &params.count);

    size_t nfloats = (size_t)samples * 2;
    float *xy = malloc(nfloats * sizeof(float));
    if (!xy) {
        send_json_error(fd, 500, "Out of memory", keep_alive);
        return;
    }
    hot_sample_parametric_slot(slot, &params, tmin, tmax, (size_t)samples, xy);
    send_response(fd, 200, "OK", "application/octet-stream", xy, nfloats * sizeof(float),
                  keep_alive);
    free(xy);
}

static void handle_api_real_seed(int fd, const char *body, bool keep_alive) {
    Point2D *pts = NULL;
    size_t npts = 0;
    if (strstr(body, "\"cells\"") != NULL && json_get_points(body, "cells", &pts, &npts)) {
        int *xy = NULL;
        if (npts > 0) {
            xy = malloc(npts * 2 * sizeof(int));
            if (xy) {
                for (size_t i = 0; i < npts; i++) {
                    xy[i * 2] = (int)floor(pts[i].x + 0.5);
                    xy[i * 2 + 1] = (int)floor(pts[i].y + 0.5);
                }
            }
        }
        real_seed_set_cells(xy, xy ? npts : 0);
        free(xy);
        free(pts);
    } else {
        char *hex_rows[64] = {0};
        size_t n = json_get_string_array(body, "rows", hex_rows, 64, 32);
        uint64_t rows[64];
        memset(rows, 0, sizeof(rows));
        for (size_t i = 0; i < n && i < 64; i++) {
            if (hex_rows[i]) {
                rows[i] = strtoull(hex_rows[i], NULL, 16);
                free(hex_rows[i]);
            }
        }
        real_seed_set_rows(rows, n);
    }
    char resp[64];
    int len = snprintf(resp, sizeof(resp), "{\"ok\":true,\"count\":%d}", real_seed_count());
    send_response(fd, 200, "OK", "application/json", resp, (size_t)(len > 0 ? len : 0), keep_alive);
}

static void handle_api_find_zeros(int fd, const char *body, bool keep_alive) {
    double xmin = -4.0, xmax = 4.0, ymin = -4.0, ymax = 4.0;
    json_get_double(body, "xmin", &xmin);
    json_get_double(body, "xmax", &xmax);
    json_get_double(body, "ymin", &ymin);
    json_get_double(body, "ymax", &ymax);

    FunctionDef tmp_hot;
    const FunctionDef *fn = resolve_complex_req(body, &tmp_hot);
    if (!fn) {
        send_json_error(fd, 400, "Invalid function index", keep_alive);
        return;
    }

    Point2D *poly = NULL;
    size_t npts = 0;
    json_get_points(body, "points", &poly, &npts);
    if (npts >= 3) {
        xmin = xmax = poly[0].x;
        ymin = ymax = poly[0].y;
        for (size_t i = 1; i < npts; i++) {
            if (poly[i].x < xmin) {
                xmin = poly[i].x;
            }
            if (poly[i].x > xmax) {
                xmax = poly[i].x;
            }
            if (poly[i].y < ymin) {
                ymin = poly[i].y;
            }
            if (poly[i].y > ymax) {
                ymax = poly[i].y;
            }
        }
    }

    FoundZero found[64];
    size_t count = sampler_find_zeros(fn, poly, npts, xmin, xmax, ymin, ymax, found, 64);
    free(poly);

    StrBuf sb = {0};
    sb_append(&sb, "{\"zeros\":[");
    for (size_t i = 0; i < count; i++) {
        if (i > 0) {
            sb_append(&sb, ",");
        }
        sb_printf(&sb, "{\"x\":%.12g,\"y\":%.12g,\"res\":%.3e}", found[i].x, found[i].y,
                  found[i].residual);
    }
    sb_append(&sb, "]}");
    send_response(fd, 200, "OK", "application/json", sb.data, sb.len, keep_alive);
    sb_free(&sb);
}

static void handle_api_taylor(int fd, const char *body, bool keep_alive) {
    double x0 = 2.0, y0 = 0.0;
    int degree = 12;
    json_get_double(body, "x0", &x0);
    json_get_double(body, "y0", &y0);
    json_get_int(body, "degree", &degree);

    FunctionDef tmp_hot;
    const FunctionDef *fn = resolve_complex_req(body, &tmp_hot);
    if (!fn) {
        send_json_error(fd, 400, "Invalid function index", keep_alive);
        return;
    }

    TaylorResult tr;
    sampler_taylor(fn, x0, y0, degree, &tr);

    StrBuf sb = {0};
    sb_printf(&sb, "{\"valid\":%s,\"z0\":[%.10g,%.10g],\"radius\":%.8g,\"degree\":%d,\"coeffs\":[",
              tr.valid ? "true" : "false", tr.z0_re, tr.z0_im, tr.radius, tr.degree);
    if (tr.valid) {
        for (int i = 0; i <= tr.degree; i++) {
            if (i > 0) {
                sb_append(&sb, ",");
            }
            sb_printf(&sb, "%.10g,%.10g", tr.coeff_re[i], tr.coeff_im[i]);
        }
    }
    sb_append(&sb, "]}");
    send_response(fd, 200, "OK", "application/json", sb.data, sb.len, keep_alive);
    sb_free(&sb);
}

static void handle_api_dirichlet(int fd, const char *body, bool keep_alive) {
    int N = 15;
    json_get_int(body, "n", &N);
    if (N < 1) {
        N = 1;
    }
    if (N > 1000) {
        N = 1000;
    }

    Point2D *pts = NULL;
    size_t npts = 0;
    if (!json_get_points(body, "points", &pts, &npts) || npts < 2) {
        free(pts);
        send_json_error(fd, 400, "Missing points array", keep_alive);
        return;
    }

    TraceOptions opts = {
        .closed = false,
        .with_mesh = false,
        .max_in_step = 0.25,
        .max_out_step = 0.22,
        .clip_radius = 120.0,
        .max_points = 4000,
    };
    json_get_bool(body, "closed", &opts.closed);
    json_get_double(body, "max_in_step", &opts.max_in_step);
    json_get_double(body, "max_out_step", &opts.max_out_step);

    TraceResult res;
    sampler_trace_dirichlet(N, pts, npts, &opts, &res);
    free(pts);

    StrBuf sb = {0};
    sb_append(&sb, "{\"boundary\":");
    append_curve_json(&sb, &res.boundary);
    sb_append(&sb, "}");
    trace_result_free(&res);
    send_response(fd, 200, "OK", "application/json", sb.data, sb.len, keep_alive);
    sb_free(&sb);
}

static void handle_api_real_calculus(int fd, const char *body, bool keep_alive) {
    int fn_idx = 0;
    double xmin = 1.8, xmax = 40.0, a = 5.0, b = 20.0;
    int samples = 360;
    bool want_deriv = false;
    bool want_int = false;

    json_get_int(body, "fn", &fn_idx);
    json_get_double(body, "xmin", &xmin);
    json_get_double(body, "xmax", &xmax);
    json_get_double(body, "a", &a);
    json_get_double(body, "b", &b);
    json_get_int(body, "samples", &samples);
    json_get_bool(body, "deriv", &want_deriv);
    json_get_bool(body, "integral", &want_int);

    int slot = -1;
    RealFunctionDef tmp_hot;
    const RealFunctionDef *fn = NULL;
    if (json_get_int(body, "slot", &slot) && slot >= 0 && slot < hot_real_slot_count()) {
        g_tls_slot = slot;
        memset(&g_tls_params, 0, sizeof(g_tls_params));
        json_get_double_array(body, "params", g_tls_params.v, MAX_EVAL_PARAMS, &g_tls_params.count);
        memset(&tmp_hot, 0, sizeof(tmp_hot));
        tmp_hot.exact_fn = eval_tls_real_slot;
        fn = &tmp_hot;
    } else {
        fn = resolve_real_fn(fn_idx, &tmp_hot);
    }
    if (!fn || !fn->exact_fn || xmax <= xmin) {
        send_json_error(fd, 400, "Invalid calculus parameters", keep_alive);
        return;
    }
    if (samples < 16) {
        samples = 16;
    }
    if (samples > 800) {
        samples = 800;
    }

    double integral_val = want_int ? real_integrate_interval(fn->exact_fn, a, b) : 0.0;

    StrBuf sb = {0};
    sb_printf(&sb, "{\"integral\":%.10g,\"a\":%.8g,\"b\":%.8g",
              isfinite(integral_val) ? integral_val : 0.0, a, b);

    if (want_deriv) {
        double *xs = malloc((size_t)samples * sizeof(double));
        double *dys = malloc((size_t)samples * sizeof(double));
        if (xs && dys) {
            double h = fmax(1e-5, (xmax - xmin) * 1e-4);
            for (int i = 0; i < samples; i++) {
                double x = xmin + (xmax - xmin) * ((double)i / (double)(samples - 1));
                xs[i] = x;
                double f1 = fn->exact_fn(x + h);
                double f0 = fn->exact_fn(x - h);
                double d = (isfinite(f1) && isfinite(f0)) ? (f1 - f0) / (2.0 * h) : NAN;
                dys[i] = (isfinite(d) && fabs(d) < 1e4) ? d : NAN;
            }
            sb_append(&sb, ",\"xs\":");
            append_double_array_json(&sb, xs, (size_t)samples);
            sb_append(&sb, ",\"deriv\":");
            append_double_array_json(&sb, dys, (size_t)samples);
        }
        free(xs);
        free(dys);
    }

    sb_append(&sb, "}");
    send_response(fd, 200, "OK", "application/json", sb.data, sb.len, keep_alive);
    sb_free(&sb);
}

static void handle_api_real_harmonics(int fd, const char *body, bool keep_alive) {
    double xmin = 1.8, xmax = 40.0;
    int samples = 280;
    int max_waves = 8;
    json_get_double(body, "xmin", &xmin);
    json_get_double(body, "xmax", &xmax);
    json_get_int(body, "samples", &samples);
    json_get_int(body, "count", &max_waves);

    if (xmax <= xmin || samples < 16) {
        send_json_error(fd, 400, "Invalid harmonic parameters", keep_alive);
        return;
    }
    if (samples > 500) {
        samples = 500;
    }
    if (max_waves < 1) {
        max_waves = 1;
    }
    if (max_waves > 16) {
        max_waves = 16;
    }

    double *xs = malloc((size_t)samples * sizeof(double));
    double *ys = malloc((size_t)samples * sizeof(double));
    if (!xs || !ys) {
        free(xs);
        free(ys);
        send_json_error(fd, 500, "Out of memory", keep_alive);
        return;
    }
    for (int i = 0; i < samples; i++) {
        xs[i] = xmin + (xmax - xmin) * ((double)i / (double)(samples - 1));
    }

    StrBuf sb = {0};
    sb_append(&sb, "{\"xs\":");
    append_double_array_json(&sb, xs, (size_t)samples);
    sb_append(&sb, ",\"waves\":[");
    for (int k = 0; k < max_waves; k++) {
        if (k > 0) {
            sb_append(&sb, ",");
        }
        for (int i = 0; i < samples; i++) {
            ys[i] = real_zero_wave(xs[i], k);
        }
        sb_printf(&sb, "{\"index\":%d,\"gamma\":%.8f,\"ys\":", k + 1, RIEMANN_ZEROS[k]);
        append_double_array_json(&sb, ys, (size_t)samples);
        sb_append(&sb, "}");
    }
    sb_append(&sb, "]}");

    free(xs);
    free(ys);
    send_response(fd, 200, "OK", "application/json", sb.data, sb.len, keep_alive);
    sb_free(&sb);
}

/* ----------------------------------------------------------------------------
 * Persistent Repo-Backed User Projects Storage (projects/<id>.json)
 * ---------------------------------------------------------------------------- */

static pthread_mutex_t g_projects_mu = PTHREAD_MUTEX_INITIALIZER;

static bool sanitize_project_id(const char *raw, char *out, size_t out_cap) {
    if (!raw || !out || out_cap < 4) {
        return false;
    }
    size_t n = 0;
    for (const char *p = raw; *p && n + 1 < out_cap && n < 96; p++) {
        unsigned char c = (unsigned char)*p;
        if (isalnum(c) || c == '_' || c == '-') {
            out[n++] = (char)c;
        } else if (c == ' ') {
            out[n++] = '_';
        }
    }
    out[n] = '\0';
    return n > 0;
}

static void handle_api_projects_list(int fd, bool keep_alive) {
    pthread_mutex_lock(&g_projects_mu);
    (void)mkdir("projects", 0755);

    StrBuf sb = {0};
    sb_append(&sb, "{\"projects\":[");

    DIR *dir = opendir("projects");
    size_t count = 0;
    if (dir) {
        struct dirent *ent = NULL;
        while ((ent = readdir(dir)) != NULL) {
            const char *name = ent->d_name;
            if (!name || name[0] == '.') {
                continue;
            }
            size_t nlen = strlen(name);
            if (nlen <= 5 || strcmp(name + nlen - 5, ".json") != 0) {
                continue;
            }
            char path[512];
            int pn = snprintf(path, sizeof(path), "projects/%s", name);
            if (pn <= 0 || (size_t)pn >= sizeof(path)) {
                continue;
            }
            FILE *fp = fopen(path, "rb");
            if (!fp) {
                continue;
            }
            if (fseek(fp, 0, SEEK_END) != 0) {
                fclose(fp);
                continue;
            }
            long fsize = ftell(fp);
            if (fsize <= 2 || fsize > 2 * 1024 * 1024) {
                fclose(fp);
                continue;
            }
            rewind(fp);
            char *buf = malloc((size_t)fsize + 1);
            if (!buf) {
                fclose(fp);
                continue;
            }
            size_t nread = fread(buf, 1, (size_t)fsize, fp);
            fclose(fp);
            buf[nread] = '\0';

            const char *s = buf;
            while (*s && isspace((unsigned char)*s)) {
                s++;
            }
            if (*s == '{') {
                if (count > 0) {
                    sb_append(&sb, ",");
                }
                sb_append_raw(&sb, buf, nread);
                count++;
            }
            free(buf);
        }
        closedir(dir);
    }

    sb_append(&sb, "]}");
    pthread_mutex_unlock(&g_projects_mu);

    send_response(fd, 200, "OK", "application/json", sb.data, sb.len, keep_alive);
    sb_free(&sb);
}

static void handle_api_projects_save(int fd, const char *body, bool keep_alive) {
    if (!body) {
        send_json_error(fd, 400, "Empty body", keep_alive);
        return;
    }
    const char *s = body;
    while (*s && isspace((unsigned char)*s)) {
        s++;
    }
    if (*s != '{') {
        send_json_error(fd, 400, "Expected JSON project object", keep_alive);
        return;
    }

    char raw_id[128] = {0};
    char safe_id[128] = {0};
    if (!json_get_string(body, "id", raw_id, sizeof(raw_id)) ||
        !sanitize_project_id(raw_id, safe_id, sizeof(safe_id))) {
        send_json_error(fd, 400, "Missing or invalid project id", keep_alive);
        return;
    }

    char final_path[256];
    char tmp_path[256];
    snprintf(final_path, sizeof(final_path), "projects/%s.json", safe_id);
    snprintf(tmp_path, sizeof(tmp_path), "projects/%s.json.tmp", safe_id);

    pthread_mutex_lock(&g_projects_mu);
    (void)mkdir("projects", 0755);
    FILE *fp = fopen(tmp_path, "wb");
    if (!fp) {
        pthread_mutex_unlock(&g_projects_mu);
        send_json_error(fd, 500, "Failed to open project file for writing", keep_alive);
        return;
    }
    size_t blen = strlen(body);
    size_t written = fwrite(body, 1, blen, fp);
    fclose(fp);
    if (written != blen || rename(tmp_path, final_path) != 0) {
        (void)unlink(tmp_path);
        pthread_mutex_unlock(&g_projects_mu);
        send_json_error(fd, 500, "Failed to save project file", keep_alive);
        return;
    }
    pthread_mutex_unlock(&g_projects_mu);

    StrBuf sb = {0};
    sb_append(&sb, "{\"ok\":true,\"id\":");
    sb_append_json_str(&sb, safe_id);
    sb_append(&sb, ",\"path\":");
    sb_append_json_str(&sb, final_path);
    sb_append(&sb, "}");
    send_response(fd, 200, "OK", "application/json", sb.data, sb.len, keep_alive);
    sb_free(&sb);
}

static void handle_api_projects_delete(int fd, const char *body, bool keep_alive) {
    char raw_id[128] = {0};
    char safe_id[128] = {0};
    if (!body || !json_get_string(body, "id", raw_id, sizeof(raw_id)) ||
        !sanitize_project_id(raw_id, safe_id, sizeof(safe_id))) {
        send_json_error(fd, 400, "Missing or invalid project id", keep_alive);
        return;
    }

    char final_path[256];
    snprintf(final_path, sizeof(final_path), "projects/%s.json", safe_id);

    pthread_mutex_lock(&g_projects_mu);
    int rc = unlink(final_path);
    pthread_mutex_unlock(&g_projects_mu);

    const char *resp = (rc == 0) ? "{\"ok\":true,\"deleted\":true}" : "{\"ok\":true,\"deleted\":false}";
    send_response(fd, 200, "OK", "application/json", resp, strlen(resp), keep_alive);
}

/* ----------------------------------------------------------------------------
 * Static File Serving
 * ---------------------------------------------------------------------------- */

static const char *mime_for_path(const char *path) {
    const char *dot = strrchr(path, '.');
    if (!dot) {
        return "application/octet-stream";
    }
    if (strcmp(dot, ".html") == 0) {
        return "text/html; charset=utf-8";
    }
    if (strcmp(dot, ".css") == 0) {
        return "text/css; charset=utf-8";
    }
    if (strcmp(dot, ".js") == 0) {
        return "application/javascript; charset=utf-8";
    }
    if (strcmp(dot, ".svg") == 0) {
        return "image/svg+xml";
    }
    return "application/octet-stream";
}

static void handle_static(int fd, const char *req_path, bool keep_alive) {
    const char *rel = (strcmp(req_path, "/") == 0 || strcmp(req_path, "/map") == 0 ||
                       strcmp(req_path, "/integral") == 0 || strcmp(req_path, "/real") == 0)
                          ? "index.html"
                          : req_path + 1;
    if (strstr(rel, "..") != NULL || strchr(rel, '\\') != NULL) {
        send_json_error(fd, 403, "Forbidden", keep_alive);
        return;
    }

    char full_path[512];
    const char *wdir = (g_cfg.web_dir && g_cfg.web_dir[0]) ? g_cfg.web_dir : "web";
    int n = snprintf(full_path, sizeof(full_path), "%s/%s", wdir, rel);
    if (n <= 0 || (size_t)n >= sizeof(full_path)) {
        send_json_error(fd, 404, "Not found", keep_alive);
        return;
    }

    FILE *fp = fopen(full_path, "rb");
    if (!fp) {
        send_json_error(fd, 404, "Not found", keep_alive);
        return;
    }
    if (fseek(fp, 0, SEEK_END) != 0) {
        fclose(fp);
        send_json_error(fd, 500, "Read error", keep_alive);
        return;
    }
    long fsize = ftell(fp);
    if (fsize < 0 || fsize > 4 * 1024 * 1024) {
        fclose(fp);
        send_json_error(fd, 500, "File too large", keep_alive);
        return;
    }
    rewind(fp);

    uint8_t *buf = malloc((size_t)fsize + 1);
    if (!buf) {
        fclose(fp);
        send_json_error(fd, 500, "Out of memory", keep_alive);
        return;
    }
    size_t nread = fread(buf, 1, (size_t)fsize, fp);
    fclose(fp);

    send_response(fd, 200, "OK", mime_for_path(full_path), buf, nread, keep_alive);
    free(buf);
}

/* ----------------------------------------------------------------------------
 * HTTP Connection Loop (supports HTTP/1.1 Keep-Alive)
 * ---------------------------------------------------------------------------- */

static bool header_value_ci(const char *headers, const char *name, char *out, size_t out_sz) {
    size_t nlen = strlen(name);
    const char *line = headers;
    while (line && *line) {
        const char *eol = strstr(line, "\r\n");
        size_t llen = eol ? (size_t)(eol - line) : strlen(line);
        if (llen > nlen + 1 && line[nlen] == ':') {
            bool match = true;
            for (size_t i = 0; i < nlen; i++) {
                if (tolower((unsigned char)line[i]) != tolower((unsigned char)name[i])) {
                    match = false;
                    break;
                }
            }
            if (match) {
                const char *val = line + nlen + 1;
                const char *end = line + llen;
                while (val < end && isspace((unsigned char)*val)) {
                    val++;
                }
                size_t vlen = (size_t)(end - val);
                if (vlen >= out_sz) {
                    vlen = out_sz - 1;
                }
                memcpy(out, val, vlen);
                out[vlen] = '\0';
                return true;
            }
        }
        if (!eol) {
            break;
        }
        line = eol + 2;
    }
    return false;
}

static void serve_client(int fd) {
    struct timeval tv = {.tv_sec = 5, .tv_usec = 0};
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

    char *hdr_buf = malloc(MAX_HEADER_BYTES + 1);
    if (!hdr_buf) {
        close(fd);
        return;
    }

    size_t carry_len = 0;

    while (g_running) {
        /* Read until we find \r\n\r\n */
        char *hdr_end = NULL;
        while (carry_len < MAX_HEADER_BYTES) {
            hdr_buf[carry_len] = '\0';
            hdr_end = strstr(hdr_buf, "\r\n\r\n");
            if (hdr_end) {
                break;
            }
            ssize_t r = recv(fd, hdr_buf + carry_len, MAX_HEADER_BYTES - carry_len, 0);
            if (r <= 0) {
                goto done;
            }
            carry_len += (size_t)r;
        }
        if (!hdr_end) {
            goto done;
        }

        size_t hdr_len = (size_t)(hdr_end - hdr_buf) + 4;
        *hdr_end = '\0';

        /* Parse request line */
        char method[16] = {0};
        char path[256] = {0};
        if (sscanf(hdr_buf, "%15s %255s", method, path) != 2) {
            goto done;
        }
        /* Strip query string if any */
        char *qmark = strchr(path, '?');
        if (qmark) {
            *qmark = '\0';
        }

        char cl_str[32] = {0};
        size_t content_len = 0;
        if (header_value_ci(hdr_buf, "Content-Length", cl_str, sizeof(cl_str))) {
            long parsed = strtol(cl_str, NULL, 10);
            if (parsed < 0 || parsed > MAX_BODY_BYTES) {
                goto done;
            }
            content_len = (size_t)parsed;
        }

        char conn_str[32] = {0};
        bool keep_alive = true;
        if (header_value_ci(hdr_buf, "Connection", conn_str, sizeof(conn_str))) {
            for (char *c = conn_str; *c; c++) {
                *c = (char)tolower((unsigned char)*c);
            }
            if (strstr(conn_str, "close") != NULL) {
                keep_alive = false;
            }
        }

        /* Collect body bytes */
        char *body = malloc(content_len + 1);
        if (!body) {
            goto done;
        }

        size_t already = carry_len - hdr_len;
        size_t copy_now = already < content_len ? already : content_len;
        if (copy_now > 0) {
            memcpy(body, hdr_buf + hdr_len, copy_now);
        }

        /* Shift any extra pipelined bytes back to start of hdr_buf */
        if (already > content_len) {
            size_t leftover = already - content_len;
            memmove(hdr_buf, hdr_buf + hdr_len + content_len, leftover);
            carry_len = leftover;
        } else {
            carry_len = 0;
        }

        size_t have = copy_now;
        while (have < content_len) {
            ssize_t r = recv(fd, body + have, content_len - have, 0);
            if (r <= 0) {
                free(body);
                goto done;
            }
            have += (size_t)r;
        }
        body[content_len] = '\0';

        char tok_str[256] = {0};
        header_value_ci(hdr_buf, "X-Compile-Token", tok_str, sizeof(tok_str));

        /* Dispatch */
        if (strcmp(method, "GET") == 0 && strcmp(path, "/healthz") == 0) {
            const char *ok_json = "{\"status\":\"ok\"}";
            send_response(fd, 200, "OK", "application/json", ok_json, strlen(ok_json), keep_alive);
        } else if (strcmp(method, "GET") == 0 && strcmp(path, "/api/config") == 0) {
            handle_api_config(fd, keep_alive);
        } else if (strcmp(method, "GET") == 0 && strcmp(path, "/api/functions") == 0) {
            handle_api_functions(fd, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/eval") == 0) {
            handle_api_eval(fd, body, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/trace") == 0) {
            handle_api_trace(fd, body, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/domain") == 0) {
            handle_api_domain(fd, body, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/integrate") == 0) {
            handle_api_integrate(fd, body, keep_alive);
        } else if (strcmp(method, "GET") == 0 && strcmp(path, "/api/real/functions") == 0) {
            handle_api_real_functions(fd, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/real/sample") == 0) {
            handle_api_real_sample(fd, body, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/compile") == 0) {
            handle_api_compile(fd, body, tok_str, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/workspace/compile") == 0) {
            handle_api_workspace_compile(fd, body, tok_str, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/workspace/real_sample") == 0) {
            handle_api_workspace_real_sample(fd, body, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/workspace/implicit") == 0) {
            handle_api_workspace_implicit(fd, body, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/workspace/parametric") == 0) {
            handle_api_workspace_parametric(fd, body, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/find_zeros") == 0) {
            handle_api_find_zeros(fd, body, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/taylor") == 0) {
            handle_api_taylor(fd, body, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/dirichlet") == 0) {
            handle_api_dirichlet(fd, body, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/real/calculus") == 0) {
            handle_api_real_calculus(fd, body, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/real/harmonics") == 0) {
            handle_api_real_harmonics(fd, body, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/real/seed") == 0) {
            handle_api_real_seed(fd, body, keep_alive);
        } else if (strcmp(method, "GET") == 0 && strcmp(path, "/api/projects") == 0) {
            handle_api_projects_list(fd, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/projects/save") == 0) {
            handle_api_projects_save(fd, body, keep_alive);
        } else if (strcmp(method, "POST") == 0 && strcmp(path, "/api/projects/delete") == 0) {
            handle_api_projects_delete(fd, body, keep_alive);
        } else if (strcmp(method, "GET") == 0) {
            handle_static(fd, path, keep_alive);
        } else {
            send_json_error(fd, 405, "Method not allowed", keep_alive);
        }

        free(body);
        if (!keep_alive) {
            break;
        }
    }

done:
    free(hdr_buf);
    close(fd);
}

/* ----------------------------------------------------------------------------
 * Fixed Worker Thread Pool (clean Valgrind shutdown)
 * ---------------------------------------------------------------------------- */

typedef struct {
    int fds[QUEUE_CAPACITY];
    int head;
    int tail;
    int count;
    bool shutdown;
    pthread_mutex_t mu;
    pthread_cond_t not_empty;
    pthread_cond_t not_full;
} ConnQueue;

static void queue_init(ConnQueue *q) {
    memset(q, 0, sizeof(*q));
    pthread_mutex_init(&q->mu, NULL);
    pthread_cond_init(&q->not_empty, NULL);
    pthread_cond_init(&q->not_full, NULL);
}

static void queue_destroy(ConnQueue *q) {
    pthread_mutex_destroy(&q->mu);
    pthread_cond_destroy(&q->not_empty);
    pthread_cond_destroy(&q->not_full);
}

static bool queue_push(ConnQueue *q, int fd) {
    pthread_mutex_lock(&q->mu);
    while (q->count == QUEUE_CAPACITY && !q->shutdown) {
        pthread_cond_wait(&q->not_full, &q->mu);
    }
    if (q->shutdown) {
        pthread_mutex_unlock(&q->mu);
        return false;
    }
    q->fds[q->tail] = fd;
    q->tail = (q->tail + 1) % QUEUE_CAPACITY;
    q->count++;
    pthread_cond_signal(&q->not_empty);
    pthread_mutex_unlock(&q->mu);
    return true;
}

static int queue_pop(ConnQueue *q) {
    pthread_mutex_lock(&q->mu);
    while (q->count == 0 && !q->shutdown) {
        pthread_cond_wait(&q->not_empty, &q->mu);
    }
    if (q->count == 0 && q->shutdown) {
        pthread_mutex_unlock(&q->mu);
        return -1;
    }
    int fd = q->fds[q->head];
    q->head = (q->head + 1) % QUEUE_CAPACITY;
    q->count--;
    pthread_cond_signal(&q->not_full);
    pthread_mutex_unlock(&q->mu);
    return fd;
}

static void *worker_main(void *arg) {
    ConnQueue *q = (ConnQueue *)arg;
    for (;;) {
        int fd = queue_pop(q);
        if (fd < 0) {
            break;
        }
        serve_client(fd);
    }
    return NULL;
}

int web_server_run(const ServerConfig *cfg) {
    if (cfg) {
        g_cfg = *cfg;
    }
    const char *host = g_cfg.host ? g_cfg.host : "127.0.0.1";
    int port = g_cfg.port > 0 ? g_cfg.port : 1738;

    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = handle_signal;
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);
    signal(SIGPIPE, SIG_IGN);

    int listen_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (listen_fd < 0) {
        perror("socket");
        return 1;
    }

    int opt = 1;
    setsockopt(listen_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons((uint16_t)port);
    if (inet_pton(AF_INET, host, &addr.sin_addr) != 1) {
        fprintf(stderr, "Invalid bind address: %s\n", host);
        close(listen_fd);
        return 1;
    }

    if (bind(listen_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("bind");
        close(listen_fd);
        return 1;
    }

    if (listen(listen_fd, 64) < 0) {
        perror("listen");
        close(listen_fd);
        return 1;
    }

    ConnQueue queue;
    queue_init(&queue);

    pthread_t workers[WORKER_THREADS];
    for (int i = 0; i < WORKER_THREADS; i++) {
        pthread_create(&workers[i], NULL, worker_main, &queue);
    }

    const char *compile_mode = !g_cfg.enable_compile ? "disabled (public-safe mode)"
                               : (g_cfg.compile_token && g_cfg.compile_token[0])
                                   ? "enabled (token-protected)"
                                   : "enabled (local)";

    printf("\n");
    printf("  Complex & Real Function Visualizer (C11 + Clang)\n");
    printf("  ------------------------------------------------\n");
    printf("  URL:       http://%s:%d\n", host, port);
    printf("  Default:   %s  [ %s ]\n", functions_get(0)->name, functions_get(0)->formula);
    printf("  Functions: %zu complex, %zu 2D real\n", functions_count(), real_functions_count());
    printf("  C Compile: %s\n", compile_mode);
    printf("  Press Ctrl+C to stop.\n\n");
    fflush(stdout);

    while (g_running) {
        struct pollfd pfd = {.fd = listen_fd, .events = POLLIN, .revents = 0};
        int ready = poll(&pfd, 1, 200);
        if (ready < 0) {
            if (errno == EINTR) {
                continue;
            }
            break;
        }
        if (ready == 0) {
            continue;
        }
        if (pfd.revents & POLLIN) {
            int client_fd = accept(listen_fd, NULL, NULL);
            if (client_fd >= 0) {
                if (!queue_push(&queue, client_fd)) {
                    close(client_fd);
                }
            }
        }
    }

    printf("\nShutting down cleanly...\n");
    close(listen_fd);

    pthread_mutex_lock(&queue.mu);
    queue.shutdown = true;
    pthread_cond_broadcast(&queue.not_empty);
    pthread_cond_broadcast(&queue.not_full);
    pthread_mutex_unlock(&queue.mu);

    for (int i = 0; i < WORKER_THREADS; i++) {
        pthread_join(workers[i], NULL);
    }
    queue_destroy(&queue);
    hot_cleanup();
    return 0;
}
