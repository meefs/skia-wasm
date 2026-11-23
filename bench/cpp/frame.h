/*
 * What the benchmark baselines share: the frame being drawn. Every variant
 * draws into the canvas of the same Graphite context, between the same
 * beginFrame() and endFrame() as the display list, so that only the way the
 * drawing calls arrive differs.
 */
#pragma once

#include "include/core/SkCanvas.h"

namespace bench {

// Valid between bench_begin() and bench_end().
extern SkCanvas* gCanvas;

}  // namespace bench
