#define _POSIX_C_SOURCE 200809L

#include "sampler.h"
#include "complex_math.h"

#include <math.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static void curve_free(CurveResult *c) {
    free(c->in_pts);
    free(c->out_pts);
    free(c->out_valid);
    memset(c, 0, sizeof(*c));
}

void trace_result_free(TraceResult *res) {
    if (!res) {
        return;
    }
    curve_free(&res->boundary);
    for (size_t i = 0; i < res->mesh_count; i++) {
        curve_free(&res->mesh_lines[i]);
    }
    free(res->mesh_lines);
    memset(res, 0, sizeof(*res));
}

static bool curve_push(CurveResult *c, Point2D in_p, Point2D out_p, bool valid) {
    if (c->count == c->cap) {
        size_t new_cap = c->cap == 0 ? 128 : c->cap * 2;
        Point2D *ni = realloc(c->in_pts, new_cap * sizeof(Point2D));
        if (!ni) {
            return false;
        }
        c->in_pts = ni;
        Point2D *no = realloc(c->out_pts, new_cap * sizeof(Point2D));
        if (!no) {
            return false;
        }
        c->out_pts = no;
        bool *nv = realloc(c->out_valid, new_cap * sizeof(bool));
        if (!nv) {
            return false;
        }
        c->out_valid = nv;
        c->cap = new_cap;
    }
    c->in_pts[c->count] = in_p;
    c->out_pts[c->count] = out_p;
    c->out_valid[c->count] = valid;
    c->count++;
    return true;
}

typedef struct {
    ComplexFn eval;
    double max_in_step;
    double max_out_step;
    double clip_radius;
    size_t max_points;
    CurveResult *curve;
} SubdivCtx;

static bool eval_clipped(ComplexFn eval, double complex z, double clip_r, double complex *w_out) {
    double complex w = eval(z);
    if (!c_isfinite(w) || cabs(w) > clip_r) {
        *w_out = c_make(0.0, 0.0);
        return false;
    }
    *w_out = w;
    return true;
}

static void subdivide_seg(SubdivCtx *ctx, double complex za, double complex wa, bool va,
                          double complex zb, double complex wb, bool vb, int depth) {
    if (ctx->curve->count >= ctx->max_points) {
        return;
    }

    double in_dist = cabs(zb - za);
    double complex zm = 0.5 * (za + zb);
    double complex wm;
    bool vm = eval_clipped(ctx->eval, zm, ctx->clip_radius, &wm);

    bool need_split = false;
    if (depth < 7 && ctx->curve->count < ctx->max_points) {
        if (in_dist > ctx->max_in_step) {
            need_split = true;
        } else if (va && vb) {
            double out_dist = cabs(wb - wa);
            if (!vm) {
                need_split = true;
            } else if (out_dist > ctx->max_out_step) {
                need_split = true;
            } else if (depth < 5) {
                double complex lin_mid = 0.5 * (wa + wb);
                double sagitta = cabs(wm - lin_mid);
                if (sagitta > 0.18 * ctx->max_out_step) {
                    need_split = true;
                }
            }
        } else if (va != vb && depth < 5) {
            /* Refine near a pole / clip boundary so curves approach cleanly. */
            need_split = true;
        }
    }

    if (need_split) {
        subdivide_seg(ctx, za, wa, va, zm, wm, vm, depth + 1);
        subdivide_seg(ctx, zm, wm, vm, zb, wb, vb, depth + 1);
    } else {
        Point2D pi = {creal(zb), cimag(zb)};
        Point2D po = {creal(wb), cimag(wb)};
        curve_push(ctx->curve, pi, po, vb);
    }
}

static void sample_polyline(ComplexFn eval, const Point2D *pts, size_t n, bool closed,
                            double max_in_step, double max_out_step, double clip_radius,
                            size_t max_points, CurveResult *out) {
    if (n == 0) {
        return;
    }

    SubdivCtx ctx = {
        .eval = eval,
        .max_in_step = max_in_step,
        .max_out_step = max_out_step,
        .clip_radius = clip_radius,
        .max_points = max_points,
        .curve = out,
    };

    double complex z0 = c_make(pts[0].x, pts[0].y);
    double complex w0;
    bool v0 = eval_clipped(eval, z0, clip_radius, &w0);
    Point2D po0 = {creal(w0), cimag(w0)};
    curve_push(out, pts[0], po0, v0);

    size_t seg_count = closed ? n : (n > 1 ? n - 1 : 0);
    double complex z_prev = z0;
    double complex w_prev = w0;
    bool v_prev = v0;

    for (size_t i = 0; i < seg_count; i++) {
        size_t next_idx = (i + 1) % n;
        double complex z_next = c_make(pts[next_idx].x, pts[next_idx].y);
        double complex w_next;
        bool v_next = eval_clipped(eval, z_next, clip_radius, &w_next);

        if (cabs(z_next - z_prev) > 1e-12) {
            subdivide_seg(&ctx, z_prev, w_prev, v_prev, z_next, w_next, v_next, 0);
        }

        z_prev = z_next;
        w_prev = w_next;
        v_prev = v_next;
    }
}

static int cmp_double(const void *a, const void *b) {
    double da = *(const double *)a;
    double db = *(const double *)b;
    return (da > db) - (da < db);
}

static bool push_mesh_line(TraceResult *res, const CurveResult *line) {
    if (res->mesh_count == res->mesh_cap) {
        size_t new_cap = res->mesh_cap == 0 ? 32 : res->mesh_cap * 2;
        CurveResult *arr = realloc(res->mesh_lines, new_cap * sizeof(CurveResult));
        if (!arr) {
            return false;
        }
        res->mesh_lines = arr;
        res->mesh_cap = new_cap;
    }
    res->mesh_lines[res->mesh_count++] = *line;
    return true;
}

static void build_interior_mesh(const FunctionDef *fn, const Point2D *poly, size_t n,
                                const TraceOptions *opts, TraceResult *res) {
    if (n < 3) {
        return;
    }

    double xmin = poly[0].x, xmax = poly[0].x;
    double ymin = poly[0].y, ymax = poly[0].y;
    for (size_t i = 1; i < n; i++) {
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

    double width = xmax - xmin;
    double height = ymax - ymin;
    if (width < 1e-9 || height < 1e-9) {
        return;
    }

    const int grid_lines = 7;
    double *hits = malloc((n + 2) * sizeof(double));
    if (!hits) {
        return;
    }

    double mesh_in_step = fmax(width, height) / 32.0;
    double mesh_out_step = opts->max_out_step * 1.6;

    /* Horizontal scanlines inside the polygon */
    for (int g = 1; g <= grid_lines; g++) {
        double y = ymin + height * ((double)g / (double)(grid_lines + 1));
        size_t hit_count = 0;
        for (size_t i = 0; i < n; i++) {
            Point2D a = poly[i];
            Point2D b = poly[(i + 1) % n];
            if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
                double t = (y - a.y) / (b.y - a.y);
                hits[hit_count++] = a.x + t * (b.x - a.x);
            }
        }
        if (hit_count < 2) {
            continue;
        }
        qsort(hits, hit_count, sizeof(double), cmp_double);
        for (size_t h = 0; h + 1 < hit_count; h += 2) {
            if (hits[h + 1] - hits[h] < 1e-9) {
                continue;
            }
            Point2D seg[2] = {{hits[h], y}, {hits[h + 1], y}};
            CurveResult line = {0};
            sample_polyline(fn->eval, seg, 2, false, mesh_in_step, mesh_out_step, opts->clip_radius,
                            350, &line);
            if (!push_mesh_line(res, &line)) {
                curve_free(&line);
            }
        }
    }

    /* Vertical scanlines inside the polygon */
    for (int g = 1; g <= grid_lines; g++) {
        double x = xmin + width * ((double)g / (double)(grid_lines + 1));
        size_t hit_count = 0;
        for (size_t i = 0; i < n; i++) {
            Point2D a = poly[i];
            Point2D b = poly[(i + 1) % n];
            if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) {
                double t = (x - a.x) / (b.x - a.x);
                hits[hit_count++] = a.y + t * (b.y - a.y);
            }
        }
        if (hit_count < 2) {
            continue;
        }
        qsort(hits, hit_count, sizeof(double), cmp_double);
        for (size_t h = 0; h + 1 < hit_count; h += 2) {
            if (hits[h + 1] - hits[h] < 1e-9) {
                continue;
            }
            Point2D seg[2] = {{x, hits[h]}, {x, hits[h + 1]}};
            CurveResult line = {0};
            sample_polyline(fn->eval, seg, 2, false, mesh_in_step, mesh_out_step, opts->clip_radius,
                            350, &line);
            if (!push_mesh_line(res, &line)) {
                curve_free(&line);
            }
        }
    }

    free(hits);
}

static void compute_winding(TraceResult *res) {
    const CurveResult *b = &res->boundary;
    if (b->count < 3) {
        res->has_winding = false;
        res->winding = 0;
        return;
    }

    double total_angle = 0.0;
    for (size_t i = 0; i < b->count - 1; i++) {
        if (!b->out_valid[i] || !b->out_valid[i + 1]) {
            res->has_winding = false;
            res->winding = 0;
            return;
        }
        double x1 = b->out_pts[i].x, y1 = b->out_pts[i].y;
        double x2 = b->out_pts[i + 1].x, y2 = b->out_pts[i + 1].y;
        double r1 = hypot(x1, y1);
        double r2 = hypot(x2, y2);
        if (r1 < 1e-9 || r2 < 1e-9) {
            res->has_winding = false;
            res->winding = 0;
            return;
        }
        double dot = x1 * x2 + y1 * y2;
        double cross = x1 * y2 - y1 * x2;
        total_angle += atan2(cross, dot);
    }

    double turns = total_angle / (2.0 * M_PI);
    double rounded = round(turns);
    if (fabs(turns - rounded) < 0.25) {
        res->has_winding = true;
        res->winding = (int)llround(rounded);
    } else {
        res->has_winding = false;
        res->winding = 0;
    }
}

bool sampler_trace(const FunctionDef *fn, const Point2D *input_pts, size_t input_count,
                   const TraceOptions *opts, TraceResult *out) {
    memset(out, 0, sizeof(*out));
    if (!fn || !input_pts || input_count == 0 || !opts) {
        return false;
    }

    double max_in = opts->max_in_step > 0.0 ? opts->max_in_step : 0.2;
    double max_out = opts->max_out_step > 0.0 ? opts->max_out_step : 0.12;
    double clip_r = opts->clip_radius > 0.0 ? opts->clip_radius : 80.0;
    size_t max_pts = opts->max_points > 0 ? opts->max_points : 10000;

    sample_polyline(fn->eval, input_pts, input_count, opts->closed, max_in, max_out, clip_r,
                    max_pts, &out->boundary);

    if (opts->closed) {
        compute_winding(out);
        if (opts->with_mesh) {
            build_interior_mesh(fn, input_pts, input_count, opts, out);
        }
    }

    return true;
}

/* ----------------------------------------------------------------------------
 * Multi-threaded Domain Coloring Renderer
 * ---------------------------------------------------------------------------- */

typedef struct {
    ComplexFn eval;
    double cx;
    double cy;
    double half_w;
    double half_h;
    int width;
    int height;
    int y_start;
    int y_end;
    uint8_t *rgba;
} DomainJob;

static void hsv_to_rgb(double h, double s, double v, uint8_t *r, uint8_t *g, uint8_t *b) {
    double c = v * s;
    double hp = fmod(h * 6.0, 6.0);
    if (hp < 0.0) {
        hp += 6.0;
    }
    double x = c * (1.0 - fabs(fmod(hp, 2.0) - 1.0));
    double m = v - c;
    double rf = 0.0, gf = 0.0, bf = 0.0;

    if (hp < 1.0) {
        rf = c;
        gf = x;
    } else if (hp < 2.0) {
        rf = x;
        gf = c;
    } else if (hp < 3.0) {
        gf = c;
        bf = x;
    } else if (hp < 4.0) {
        gf = x;
        bf = c;
    } else if (hp < 5.0) {
        rf = x;
        bf = c;
    } else {
        rf = c;
        bf = x;
    }

    *r = (uint8_t)fmin(255.0, fmax(0.0, (rf + m) * 255.0));
    *g = (uint8_t)fmin(255.0, fmax(0.0, (gf + m) * 255.0));
    *b = (uint8_t)fmin(255.0, fmax(0.0, (bf + m) * 255.0));
}

static void *domain_worker(void *arg) {
    DomainJob *job = (DomainJob *)arg;
    double x0 = job->cx - job->half_w;
    double y0 = job->cy + job->half_h; /* Top pixel row is max Im */
    double dx = (2.0 * job->half_w) / (double)job->width;
    double dy = (2.0 * job->half_h) / (double)job->height;

    for (int py = job->y_start; py < job->y_end; py++) {
        double im = y0 - ((double)py + 0.5) * dy;
        for (int px = 0; px < job->width; px++) {
            double re = x0 + ((double)px + 0.5) * dx;
            double complex w = job->eval(c_make(re, im));
            size_t idx = ((size_t)py * (size_t)job->width + (size_t)px) * 4;

            if (!c_isfinite(w)) {
                job->rgba[idx + 0] = 240;
                job->rgba[idx + 1] = 245;
                job->rgba[idx + 2] = 255;
                job->rgba[idx + 3] = 255;
                continue;
            }

            double mag = cabs(w);
            double arg = carg(w);
            double hue = (arg + M_PI) / (2.0 * M_PI);

            /* Dark-mode friendly domain coloring with subtle log2 contour bands */
            double log2_mag = log2(mag + 1e-18);
            double frac = log2_mag - floor(log2_mag);
            double contour = 0.78 + 0.22 * frac;

            /* Smooth luminance: zeros go dark, large magnitudes glow bright */
            double lightness = 0.16 + 0.76 * (1.0 - 1.0 / (1.0 + 0.45 * pow(mag, 0.45)));
            double val = fmin(0.96, lightness * contour);
            double sat = 0.72 * (1.0 / (1.0 + 0.06 * log1p(mag)));

            uint8_t r, g, b;
            hsv_to_rgb(hue, sat, val, &r, &g, &b);
            job->rgba[idx + 0] = r;
            job->rgba[idx + 1] = g;
            job->rgba[idx + 2] = b;
            job->rgba[idx + 3] = 255;
        }
    }
    return NULL;
}

bool sampler_render_domain(const FunctionDef *fn, double cx, double cy, double half_w,
                           double half_h, int width, int height, uint8_t *rgba_out) {
    if (!fn || !rgba_out || width <= 0 || height <= 0) {
        return false;
    }

    const int num_threads = 4;
    pthread_t threads[4];
    DomainJob jobs[4];

    int rows_per = (height + num_threads - 1) / num_threads;
    int launched = 0;

    for (int t = 0; t < num_threads; t++) {
        int ys = t * rows_per;
        int ye = ys + rows_per;
        if (ys >= height) {
            break;
        }
        if (ye > height) {
            ye = height;
        }
        jobs[t] = (DomainJob){
            .eval = fn->eval,
            .cx = cx,
            .cy = cy,
            .half_w = half_w,
            .half_h = half_h,
            .width = width,
            .height = height,
            .y_start = ys,
            .y_end = ye,
            .rgba = rgba_out,
        };
        if (pthread_create(&threads[t], NULL, domain_worker, &jobs[t]) == 0) {
            launched++;
        } else {
            domain_worker(&jobs[t]);
        }
    }

    for (int t = 0; t < launched; t++) {
        pthread_join(threads[t], NULL);
    }

    return true;
}

/* ----------------------------------------------------------------------------
 * Adaptive 8-Point Gauss-Legendre Complex Contour Integration
 * ---------------------------------------------------------------------------- */

static const double GL8_X[8] = {-0.96028985649753623168, -0.79666647741362673959,
                                -0.52553240991632898582, -0.18343464249564980494,
                                0.18343464249564980494,  0.52553240991632898582,
                                0.79666647741362673959,  0.96028985649753623168};

static const double GL8_W[8] = {
    0.10122853629037625915, 0.22238103445337447054, 0.31370664587788728734, 0.36268378337836198297,
    0.36268378337836198297, 0.31370664587788728734, 0.22238103445337447054, 0.10122853629037625915};

void integral_result_free(IntegralResult *res) {
    if (!res) {
        return;
    }
    free(res->in_pts);
    free(res->cum_pts);
    memset(res, 0, sizeof(*res));
}

static bool integral_push(IntegralResult *res, Point2D in_p, double complex cum_val) {
    if (res->count == res->cap) {
        size_t new_cap = res->cap == 0 ? 256 : res->cap * 2;
        Point2D *ni = realloc(res->in_pts, new_cap * sizeof(Point2D));
        if (!ni) {
            return false;
        }
        res->in_pts = ni;
        Point2D *nc = realloc(res->cum_pts, new_cap * sizeof(Point2D));
        if (!nc) {
            return false;
        }
        res->cum_pts = nc;
        res->cap = new_cap;
    }
    res->in_pts[res->count] = in_p;
    res->cum_pts[res->count] = (Point2D){creal(cum_val), cimag(cum_val)};
    res->count++;
    return true;
}

static bool gl8_panel(ComplexFn eval, double complex za, double complex zb,
                      double complex *out_val) {
    double complex mid = 0.5 * (za + zb);
    double complex half = 0.5 * (zb - za);
    double complex sum = c_make(0.0, 0.0);

    for (int i = 0; i < 8; i++) {
        double complex z = mid + half * GL8_X[i];
        double complex fz = eval(z);
        if (!c_isfinite(fz) || cabs(fz) > 1e9) {
            *out_val = c_make(0.0, 0.0);
            return false;
        }
        sum += GL8_W[i] * fz;
    }
    *out_val = half * sum;
    return true;
}

typedef struct {
    ComplexFn eval;
    double max_in_step;
    double tol;
    size_t max_points;
    double complex running;
    IntegralResult *res;
} IntCtx;

static void integrate_seg(IntCtx *ctx, double complex za, double complex zb, double complex whole,
                          bool whole_ok, int depth) {
    double seg_len = cabs(zb - za);
    double complex zm = 0.5 * (za + zb);
    double complex left = c_make(0.0, 0.0), right = c_make(0.0, 0.0);
    bool left_ok = gl8_panel(ctx->eval, za, zm, &left);
    bool right_ok = gl8_panel(ctx->eval, zm, zb, &right);

    bool ok = whole_ok && left_ok && right_ok;
    double err = ok ? cabs((left + right) - whole) : INFINITY;

    bool should_split = false;
    if (ctx->res->count < ctx->max_points && depth < 9) {
        if (!ok && depth < 5) {
            should_split = true;
        } else if (seg_len > ctx->max_in_step) {
            should_split = true;
        } else if (ok && err > ctx->tol) {
            should_split = true;
        } else if (ok && cabs(left + right) > 0.35 && depth < 5) {
            /* Keep cumulative trajectory smooth when integral changes rapidly. */
            should_split = true;
        }
    }

    if (should_split) {
        integrate_seg(ctx, za, zm, left, left_ok, depth + 1);
        integrate_seg(ctx, zm, zb, right, right_ok, depth + 1);
    } else {
        if (!ok) {
            ctx->res->singular = true;
        } else {
            ctx->running += left + right;
        }
        Point2D pb = {creal(zb), cimag(zb)};
        integral_push(ctx->res, pb, ctx->running);
    }
}

bool sampler_integrate(const FunctionDef *fn, const Point2D *input_pts, size_t input_count,
                       bool closed, double max_in_step, IntegralResult *out) {
    memset(out, 0, sizeof(*out));
    if (!fn || !input_pts || input_count < 2) {
        return false;
    }

    double step = max_in_step > 1e-4 ? max_in_step : 0.25;
    size_t seg_count = closed ? input_count : input_count - 1;

    /* Compute arc length & orientation (shoelace signed area for closed loops). */
    double arc = 0.0;
    double area2 = 0.0;
    for (size_t i = 0; i < seg_count; i++) {
        Point2D a = input_pts[i];
        Point2D b = input_pts[(i + 1) % input_count];
        arc += hypot(b.x - a.x, b.y - a.y);
        if (closed) {
            area2 += a.x * b.y - b.x * a.y;
        }
    }
    out->arc_length = arc;
    if (closed && fabs(area2) > 1e-12) {
        out->orientation = area2 > 0.0 ? 1 : -1;
    } else {
        out->orientation = 0;
    }

    IntCtx ctx = {
        .eval = fn->eval,
        .max_in_step = step,
        .tol = 1e-9,
        .max_points = 8000,
        .running = c_make(0.0, 0.0),
        .res = out,
    };

    integral_push(out, input_pts[0], ctx.running);

    for (size_t i = 0; i < seg_count; i++) {
        Point2D a = input_pts[i];
        Point2D b = input_pts[(i + 1) % input_count];
        double complex za = c_make(a.x, a.y);
        double complex zb = c_make(b.x, b.y);
        if (cabs(zb - za) < 1e-12) {
            continue;
        }
        double complex whole = c_make(0.0, 0.0);
        bool ok = gl8_panel(fn->eval, za, zb, &whole);
        integrate_seg(&ctx, za, zb, whole, ok, 0);
    }

    out->total_re = creal(ctx.running);
    out->total_im = cimag(ctx.running);
    return true;
}

/* ----------------------------------------------------------------------------
 * Dirichlet Partial Sum Tracer S_N(s) = sum_{n=1}^N n^(-s)
 * ---------------------------------------------------------------------------- */

static _Thread_local int g_dirichlet_N = 10;

static double complex eval_dirichlet_tls(double complex s) {
    return c_zeta_partial(s, g_dirichlet_N);
}

bool sampler_trace_dirichlet(int N, const Point2D *input_pts, size_t input_count,
                             const TraceOptions *opts, TraceResult *out) {
    g_dirichlet_N = N;
    FunctionDef tmp = {0};
    tmp.eval = eval_dirichlet_tls;
    return sampler_trace(&tmp, input_pts, input_count, opts, out);
}

/* ----------------------------------------------------------------------------
 * Complex Zero Hunter (Multi-Seed Damped Newton-Raphson + Point-in-Polygon)
 * ---------------------------------------------------------------------------- */

static bool pt_in_poly(double x, double y, const Point2D *poly, size_t n) {
    if (!poly || n < 3) {
        return true;
    }
    bool inside = false;
    for (size_t i = 0, j = n - 1; i < n; j = i++) {
        double xi = poly[i].x, yi = poly[i].y;
        double xj = poly[j].x, yj = poly[j].y;
        bool cross = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-30) + xi);
        if (cross) {
            inside = !inside;
        }
    }
    return inside;
}

size_t sampler_find_zeros(const FunctionDef *fn, const Point2D *poly, size_t poly_count,
                          double xmin, double xmax, double ymin, double ymax, FoundZero *zeros_out,
                          size_t max_zeros) {
    if (!fn || !zeros_out || max_zeros == 0 || xmax <= xmin || ymax <= ymin) {
        return 0;
    }

    size_t found = 0;
    const int gx = 11;
    const int gy = 11;
    double span = hypot(xmax - xmin, ymax - ymin);
    double max_step = 0.35 * span;

    for (int iy = 0; iy < gy && found < max_zeros; iy++) {
        double sy = ymin + (ymax - ymin) * ((double)iy + 0.5) / (double)gy;
        for (int ix = 0; ix < gx && found < max_zeros; ix++) {
            double sx = xmin + (xmax - xmin) * ((double)ix + 0.5) / (double)gx;
            if (poly_count >= 3 && !pt_in_poly(sx, sy, poly, poly_count)) {
                continue;
            }

            double complex z = c_make(sx, sy);
            bool converged = false;
            double res = INFINITY;

            for (int iter = 0; iter < 24; iter++) {
                double complex fz = fn->eval(z);
                if (!c_isfinite(fz)) {
                    break;
                }
                res = cabs(fz);
                if (res < 1e-11) {
                    converged = true;
                    break;
                }
                double h = 1e-6 * fmax(1.0, cabs(z));
                double complex df = (fn->eval(z + h) - fn->eval(z - h)) / (2.0 * h);
                if (!c_isfinite(df) || cabs(df) < 1e-14) {
                    break;
                }
                double complex step = fz / df;
                double smag = cabs(step);
                if (smag > max_step) {
                    step *= (max_step / smag);
                }
                z -= step;
                if (creal(z) < xmin - 0.15 * (xmax - xmin) ||
                    creal(z) > xmax + 0.15 * (xmax - xmin) ||
                    cimag(z) < ymin - 0.15 * (ymax - ymin) ||
                    cimag(z) > ymax + 0.15 * (ymax - ymin)) {
                    break;
                }
            }

            if (!converged) {
                double complex fz = fn->eval(z);
                if (c_isfinite(fz) && cabs(fz) < 1e-8) {
                    converged = true;
                    res = cabs(fz);
                }
            }

            if (!converged) {
                continue;
            }

            double zx = creal(z);
            double zy = cimag(z);
            if (zx < xmin || zx > xmax || zy < ymin || zy > ymax) {
                continue;
            }
            if (poly_count >= 3 && !pt_in_poly(zx, zy, poly, poly_count)) {
                continue;
            }

            /* Deduplicate */
            bool dup = false;
            for (size_t k = 0; k < found; k++) {
                if (hypot(zeros_out[k].x - zx, zeros_out[k].y - zy) < 1e-4) {
                    dup = true;
                    break;
                }
            }
            if (!dup) {
                zeros_out[found++] = (FoundZero){.x = zx, .y = zy, .residual = res};
            }
        }
    }

    return found;
}

/* ----------------------------------------------------------------------------
 * Taylor Series Expansion via Cauchy's Integral Formula
 * ---------------------------------------------------------------------------- */

bool sampler_taylor(const FunctionDef *fn, double z0_re, double z0_im, int degree,
                    TaylorResult *out) {
    memset(out, 0, sizeof(*out));
    if (!fn) {
        return false;
    }
    if (degree < 1) {
        degree = 1;
    }
    if (degree > MAX_TAYLOR_DEGREE) {
        degree = MAX_TAYLOR_DEGREE;
    }

    double complex z0 = c_make(z0_re, z0_im);
    double complex f0 = fn->eval(z0);
    if (!c_isfinite(f0) || cabs(f0) > 1e8) {
        out->valid = false;
        return false;
    }

    /* Check distance to any known pole landmarks for exact radius of convergence. */
    double known_pole_dist = INFINITY;
    for (size_t i = 0; i < fn->landmark_count; i++) {
        if (strcmp(fn->landmarks[i].kind, "pole") == 0) {
            double d = hypot(z0_re - fn->landmarks[i].x, z0_im - fn->landmarks[i].y);
            if (d < known_pole_dist) {
                known_pole_dist = d;
            }
        }
    }

    /* Choose Cauchy integration circle radius safely inside convergence disk. */
    double r = 0.28;
    if (isfinite(known_pole_dist)) {
        r = fmin(r, 0.42 * known_pole_dist);
    }
    if (r < 1e-3) {
        r = 1e-3;
    }

    const int M = 64;
    double complex samples[64];

    /* Shrink circle if any sample approaches a pole. */
    for (int attempt = 0; attempt < 6; attempt++) {
        bool ok = true;
        for (int j = 0; j < M; j++) {
            double ang = (2.0 * M_PI * (double)j) / (double)M;
            double complex z = z0 + r * c_make(cos(ang), sin(ang));
            double complex val = fn->eval(z);
            if (!c_isfinite(val) || cabs(val) > 1e7) {
                ok = false;
                break;
            }
            samples[j] = val;
        }
        if (ok) {
            break;
        }
        r *= 0.5;
    }

    /* Cauchy DFT: a_n = (1 / (M * r^n)) * sum_{j=0}^{M-1} f(z0 + r*e^{i*theta_j}) e^{-i*n*theta_j}
     */
    double r_pow = 1.0;
    for (int n = 0; n <= degree; n++) {
        double complex sum = c_make(0.0, 0.0);
        for (int j = 0; j < M; j++) {
            double ang = (-2.0 * M_PI * (double)n * (double)j) / (double)M;
            sum += samples[j] * c_make(cos(ang), sin(ang));
        }
        double complex an = sum / ((double)M * r_pow);
        out->coeff_re[n] = creal(an);
        out->coeff_im[n] = cimag(an);
        r_pow *= r;
    }

    /* Estimate radius of convergence: exact pole distance if known, else ratio estimate. */
    double est_R = known_pole_dist;
    if (!isfinite(est_R)) {
        /* Ratio estimate from last non-negligible coefficients (entire functions get large R). */
        double sum_ratio = 0.0;
        int ratio_cnt = 0;
        for (int n = 3; n < degree; n++) {
            double c0 = hypot(out->coeff_re[n], out->coeff_im[n]);
            double c1 = hypot(out->coeff_re[n + 1], out->coeff_im[n + 1]);
            if (c0 > 1e-10 && c1 > 1e-10) {
                sum_ratio += c0 / c1;
                ratio_cnt++;
            }
        }
        est_R = ratio_cnt > 0 ? (sum_ratio / (double)ratio_cnt) : 100.0;
    }

    out->z0_re = z0_re;
    out->z0_im = z0_im;
    out->degree = degree;
    out->radius = est_R > 100.0 ? 100.0 : est_R;
    out->valid = true;
    return true;
}
