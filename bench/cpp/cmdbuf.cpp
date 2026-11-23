/*
 * Benchmark variant C: a command buffer. JavaScript encodes the whole frame,
 * values included, into wasm memory every frame; one call decodes it.
 *
 * Unlike the display list it has no program and no instance: nothing is
 * known ahead of the frame, so nothing is cached between frames.
 */
#include <cstdint>
#include <cstring>

#include <emscripten/emscripten.h>

#include "include/core/SkData.h"
#include "include/core/SkImage.h"
#include "include/core/SkMatrix.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPath.h"
#include "include/core/SkRRect.h"
#include "include/core/SkSamplingOptions.h"
#include "include/core/SkSpan.h"
#include "include/effects/SkRuntimeEffect.h"

#include "frame.h"

namespace {

// bench/variants.ts encodes these.
enum Command : uint32_t {
  kSave = 1,
  kRestore = 2,
  // 9 floats
  kConcat = 3,
  // x, y, width, height, rx, ry, then r, g, b, a
  kDrawRRect = 4,
  // x, y, width, height, effect, count of uniform words, the uniforms
  kDrawRectEffect = 5,
  // count of points, stroke width, r, g, b, a, the points
  kDrawPolyline = 6,
  // image, x, y, width, height
  kDrawImage = 7,
};

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE void cb_play(const uint32_t* words, uint32_t count) {
  SkCanvas* canvas = bench::gCanvas;
  const SkSamplingOptions sampling(SkFilterMode::kLinear);
  const uint32_t* pc = words;
  const uint32_t* const end = words + count;
  while (pc < end) {
    const float* f = reinterpret_cast<const float*>(pc);
    switch (pc[0]) {
      case kSave:
        canvas->save();
        pc += 1;
        break;
      case kRestore:
        canvas->restore();
        pc += 1;
        break;
      case kConcat:
        canvas->concat(SkMatrix::MakeAll(f[1], f[2], f[3], f[4], f[5], f[6],
                                         f[7], f[8], f[9]));
        pc += 10;
        break;
      case kDrawRRect: {
        SkPaint paint;
        paint.setAntiAlias(true);
        paint.setColor(SkColor4f{f[7], f[8], f[9], f[10]});
        canvas->drawRRect(
            SkRRect::MakeRectXY(SkRect::MakeXYWH(f[1], f[2], f[3], f[4]), f[5],
                                f[6]),
            paint);
        pc += 11;
        break;
      }
      case kDrawRectEffect: {
        const SkRuntimeEffect* effect =
            reinterpret_cast<const SkRuntimeEffect*>(pc[5]);
        const uint32_t uniformWords = pc[6];
        SkPaint paint;
        paint.setAntiAlias(true);
        paint.setShader(effect->makeShader(
            SkData::MakeWithCopy(pc + 7, uniformWords * sizeof(uint32_t)),
            {}));
        canvas->drawRect(SkRect::MakeXYWH(f[1], f[2], f[3], f[4]), paint);
        pc += 7 + uniformWords;
        break;
      }
      case kDrawPolyline: {
        const uint32_t points = pc[1];
        SkPaint paint;
        paint.setAntiAlias(true);
        paint.setStyle(SkPaint::kStroke_Style);
        paint.setStrokeWidth(f[2]);
        paint.setColor(SkColor4f{f[3], f[4], f[5], f[6]});
        canvas->drawPath(
            SkPath::Polygon(
                SkSpan(reinterpret_cast<const SkPoint*>(pc + 7), points), false,
                SkPathFillType::kWinding, /*isVolatile=*/true),
            paint);
        pc += 7 + 2 * points;
        break;
      }
      case kDrawImage:
        canvas->drawImageRect(reinterpret_cast<const SkImage*>(pc[1]),
                              SkRect::MakeXYWH(f[2], f[3], f[4], f[5]),
                              sampling);
        pc += 6;
        break;
      default:
        // Not a command: the buffer is corrupt, and its sizes with it.
        return;
    }
  }
}

}  // extern "C"
