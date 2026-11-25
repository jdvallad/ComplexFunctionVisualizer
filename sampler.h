#ifndef SAMPLER_H
#define SAMPLER_H

#include "functions.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
    double x;
    double y;
} Point2D;

typedef struct {
    Point2D *in_pts;
    Point2D *out_pts;
    bool *out_valid;
    size_t count;
    size_t cap;
} CurveResult;

typedef struct {
    CurveResult boundary;
    CurveResult *mesh_lines;
    size_t mesh_count;
    size_t mesh_cap;
    bool has_winding;
    int winding;
} TraceResult;

typedef struct {
    bool closed;
    bool with_mesh;
    double max_in_step;
    double max_out_step;
    double clip_radius;
    size_t max_points;
} TraceOptions;

void trace_result_free(TraceResult *res);

/*
 * Adaptively samples an input polyline or closed shape through fn->eval,
 * subdividing wherever output curvature or step length is large, computing
 * the winding number around w = 0 for closed loops, and optionally generating
 * a conformal interior grid clipped to the closed polygon.
 */
bool sampler_trace(const FunctionDef *fn, const Point2D *input_pts, size_t input_count,
                   const TraceOptions *opts, TraceResult *out);

typedef enum {
    DOMAIN_SCHEME_CLASSIC = 0,
    DOMAIN_SCHEME_SMOOTH_ESCAPE = 1,
    DOMAIN_SCHEME_INFERNO = 2,
    DOMAIN_SCHEME_OCEAN = 3,
    DOMAIN_SCHEME_NEON_PRISM = 4,
    DOMAIN_SCHEME_GRAYSCALE = 5
} DomainColorScheme;

/* Maps a complex value w to an RGB triple using the chosen DomainColorScheme. */
void sampler_color_complex(double complex w, int scheme, uint8_t *r, uint8_t *g, uint8_t *b);

/*
 * Renders a domain-coloring RGBA buffer (width * height * 4 bytes) over the
 * rectangle [cx - half_w, cx + half_w] x [cy - half_h, cy + half_h] using
 * pthreads for parallel evaluation.
 */
bool sampler_render_domain(const FunctionDef *fn, double cx, double cy, double half_w,
                           double half_h, int width, int height, uint8_t *rgba_out);

bool sampler_render_domain_ex(const FunctionDef *fn, double cx, double cy, double half_w,
                              double half_h, int width, int height, int scheme, uint8_t *rgba_out);

typedef struct {
    Point2D *in_pts;
    Point2D *cum_pts;
    size_t count;
    size_t cap;
    double total_re;
    double total_im;
    double arc_length;
    int orientation; /* +1 CCW, -1 CW, 0 open/degenerate */
    bool singular;
} IntegralResult;

void integral_result_free(IntegralResult *res);

/*
 * Computes the complex contour integral \int_\gamma f(z) dz via adaptive
 * 8-point Gauss-Legendre quadrature, recording the cumulative partial integral
 * trajectory I(t) = \int_0^t f(\gamma(\tau)) \gamma'(\tau) d\tau.
 */
bool sampler_integrate(const FunctionDef *fn, const Point2D *input_pts, size_t input_count,
                       bool closed, double max_in_step, IntegralResult *out);

/* Trace a polyline through the partial Dirichlet sum S_N(s) = sum_{n=1}^N n^(-s). */
bool sampler_trace_dirichlet(int N, const Point2D *input_pts, size_t input_count,
                             const TraceOptions *opts, TraceResult *out);

typedef struct {
    double x;
    double y;
    double residual;
} FoundZero;

/*
 * Hunts for zeros of fn->eval inside a closed polygon (or bounding box when
 * poly_count == 0) using multi-seed damped complex Newton-Raphson + deduplication.
 * Returns number of zeros written (up to max_zeros).
 */
size_t sampler_find_zeros(const FunctionDef *fn, const Point2D *poly, size_t poly_count,
                          double xmin, double xmax, double ymin, double ymax, FoundZero *zeros_out,
                          size_t max_zeros);

/*
 * Bidirectional Output -> Input Newton Pullback: solves f(z) = target_w
 * from optional seed points plus a viewport grid to locate preimages z in f^{-1}(w).
 */
size_t sampler_pullback(const FunctionDef *fn, double target_re, double target_im,
                        const Point2D *seeds, size_t seed_count, double xmin, double xmax,
                        double ymin, double ymax, FoundZero *out, size_t max_out);

#define MAX_TAYLOR_DEGREE 24

typedef struct {
    double z0_re;
    double z0_im;
    double radius; /* Estimated radius of convergence R to nearest pole */
    int degree;
    double coeff_re[MAX_TAYLOR_DEGREE + 1];
    double coeff_im[MAX_TAYLOR_DEGREE + 1];
    bool valid;
} TaylorResult;

/*
 * Computes Taylor series coefficients a_0 .. a_degree of fn->eval centered at z0
 * via Cauchy's Integral Formula on a small circle around z0, plus estimates the
 * radius of convergence R to the nearest singularity.
 */
bool sampler_taylor(const FunctionDef *fn, double z0_re, double z0_im, int degree,
                    TaylorResult *out);

#endif /* SAMPLER_H */
