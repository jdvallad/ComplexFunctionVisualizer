#ifndef FUNCTIONS_H
#define FUNCTIONS_H

#include <complex.h>
#include <stddef.h>

typedef double complex (*ComplexFn)(double complex z);

typedef struct {
    double x;
    double y;
    const char *label;
    const char *kind; /* "pole", "zero", "landmark" */
} SpecialPoint;

typedef struct {
    const char *id;
    const char *name;
    const char *formula;
    const char *description;
    const char *c_source;
    ComplexFn eval;

    /* Suggested initial viewport centers & half-widths (re, im, scale). */
    double in_cx;
    double in_cy;
    double in_radius;
    double out_cx;
    double out_cy;
    double out_radius;

    /* Optional landmarks shown on the input plane (poles, zeros, etc.). */
    const SpecialPoint *landmarks;
    size_t landmark_count;
} FunctionDef;

size_t functions_count(void);
const FunctionDef *functions_get(size_t index);

#endif /* FUNCTIONS_H */
