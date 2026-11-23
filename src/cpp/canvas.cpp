/*
 * The immediate API: surfaces, canvases and pictures. One export per
 * operation, the canvas first, then plain numbers.
 */
#include <cstdint>

#include <emscripten/emscripten.h>
#include <webgpu/webgpu_cpp.h>

#include "include/core/SkBlendMode.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkClipOp.h"
#include "include/core/SkColorSpace.h"
#include "include/core/SkFont.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPicture.h"
#include "include/core/SkPictureRecorder.h"
#include "include/core/SkSurface.h"
#include "include/core/SkTextBlob.h"
#include "include/gpu/graphite/BackendTexture.h"
#include "include/gpu/graphite/Surface.h"
#include "include/gpu/graphite/dawn/DawnGraphiteTypes.h"

#include "immediate.h"

using skwasm::Context;
using skwasm::PathObject;

namespace skwasm {

// What a surface draws to between getCanvas() and flush(): a texture of the
// page, wrapped for as long as the frame lasts.
struct Frame {
  wgpu::Texture texture;
  sk_sp<SkSurface> surface;
};

}  // namespace skwasm

using skwasm::Frame;

extern "C" {

// ---- Frames and surfaces.

// Wraps the texture (from WebGPU.importJsTexture(), reference taken over)
// and clears it. Null is a failure: see sk_last_error().
EMSCRIPTEN_KEEPALIVE Frame* sk_frame_begin(WGPUTexture cTexture,
                                           float r,
                                           float g,
                                           float b,
                                           float a) {
  Context* context = Context::Get();
  context->tick();
  Frame* frame = new Frame();
  frame->texture = wgpu::Texture::Acquire(cTexture);
  frame->surface = SkSurfaces::WrapBackendTexture(
      context->recorder(),
      skgpu::graphite::BackendTextures::MakeDawn(frame->texture.Get()),
      SkColorSpace::MakeSRGB(), nullptr);
  if (!frame->surface) {
    delete frame;
    skwasm::setError("Graphite cannot draw into this texture.");
    return nullptr;
  }
  frame->surface->getCanvas()->clear(SkColor4f{r, g, b, a});
  return frame;
}

EMSCRIPTEN_KEEPALIVE SkCanvas* sk_frame_canvas(Frame* frame) {
  return frame->surface->getCanvas();
}

// Submits what was drawn and gives the texture back.
EMSCRIPTEN_KEEPALIVE int sk_frame_end(Frame* frame) {
  const bool submitted = Context::Get()->submit();
  delete frame;
  return submitted ? 1 : 0;
}

// A surface that Graphite owns the texture of.
EMSCRIPTEN_KEEPALIVE SkSurface* sk_offscreen_new(int width, int height) {
  sk_sp<SkSurface> surface = SkSurfaces::RenderTarget(
      Context::Get()->recorder(),
      SkImageInfo::Make(width, height, kRGBA_8888_SkColorType,
                        kPremul_SkAlphaType, SkColorSpace::MakeSRGB()));
  if (!surface) {
    skwasm::setError("Graphite did not create the surface.");
  }
  return surface.release();
}

EMSCRIPTEN_KEEPALIVE SkCanvas* sk_offscreen_canvas(SkSurface* surface) {
  return surface->getCanvas();
}

// The content of the surface as an image: a store handle, or zero.
EMSCRIPTEN_KEEPALIVE uint32_t sk_offscreen_snapshot(SkSurface* surface) {
  return skwasm::storeImage(surface->makeImageSnapshot());
}

EMSCRIPTEN_KEEPALIVE int sk_submit() {
  return Context::Get()->submit() ? 1 : 0;
}

// Gives up one reference of any object that derives from SkRefCnt: shaders,
// filters, path effects, pictures, typefaces, offscreen surfaces.
EMSCRIPTEN_KEEPALIVE void sk_unref(SkRefCnt* object) { SkSafeUnref(object); }

// ---- State.

EMSCRIPTEN_KEEPALIVE int sk_canvas_save(SkCanvas* canvas) {
  return canvas->save();
}

// `bounds` is four floats or null; `paint` and `backdrop` may be null.
EMSCRIPTEN_KEEPALIVE int sk_canvas_save_layer(SkCanvas* canvas,
                                              const SkPaint* paint,
                                              const float* bounds,
                                              SkImageFilter* backdrop) {
  SkRect rect;
  if (bounds) {
    rect = SkRect::MakeXYWH(bounds[0], bounds[1], bounds[2], bounds[3]);
  }
  return canvas->saveLayer(
      SkCanvas::SaveLayerRec(bounds ? &rect : nullptr, paint, backdrop, 0));
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_restore(SkCanvas* canvas) {
  canvas->restore();
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_restore_to_count(SkCanvas* canvas,
                                                     int count) {
  canvas->restoreToCount(count);
}

EMSCRIPTEN_KEEPALIVE int sk_canvas_save_count(SkCanvas* canvas) {
  return canvas->getSaveCount();
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_translate(SkCanvas* canvas,
                                              float dx,
                                              float dy) {
  canvas->translate(dx, dy);
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_scale(SkCanvas* canvas,
                                          float sx,
                                          float sy) {
  canvas->scale(sx, sy);
}

// Radians, around the pivot.
EMSCRIPTEN_KEEPALIVE void sk_canvas_rotate(SkCanvas* canvas,
                                           float radians,
                                           float px,
                                           float py) {
  canvas->rotate(radians * skwasm::kDegrees, px, py);
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_skew(SkCanvas* canvas,
                                         float sx,
                                         float sy) {
  canvas->skew(sx, sy);
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_concat(SkCanvas* canvas,
                                           float scaleX,
                                           float skewX,
                                           float transX,
                                           float skewY,
                                           float scaleY,
                                           float transY,
                                           float persp0,
                                           float persp1,
                                           float persp2) {
  canvas->concat(SkMatrix::MakeAll(scaleX, skewX, transX, skewY, scaleY,
                                   transY, persp0, persp1, persp2));
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_set_matrix(SkCanvas* canvas,
                                               float scaleX,
                                               float skewX,
                                               float transX,
                                               float skewY,
                                               float scaleY,
                                               float transY,
                                               float persp0,
                                               float persp1,
                                               float persp2) {
  canvas->setMatrix(SkMatrix::MakeAll(scaleX, skewX, transX, skewY, scaleY,
                                      transY, persp0, persp1, persp2));
}

// Nine floats, row-major, valid until the next call.
EMSCRIPTEN_KEEPALIVE const float* sk_canvas_matrix(SkCanvas* canvas) {
  canvas->getLocalToDeviceAs3x3().get9(skwasm::gResult);
  return skwasm::gResult;
}

// `op`: 0 for difference, 1 for intersect.
EMSCRIPTEN_KEEPALIVE void sk_canvas_clip_rect(SkCanvas* canvas,
                                              float x,
                                              float y,
                                              float width,
                                              float height,
                                              int op,
                                              int antiAlias) {
  canvas->clipRect(SkRect::MakeXYWH(x, y, width, height),
                   static_cast<SkClipOp>(op), antiAlias != 0);
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_clip_rounded_rect(SkCanvas* canvas,
                                                      float x,
                                                      float y,
                                                      float width,
                                                      float height,
                                                      const float* radii,
                                                      int op,
                                                      int antiAlias) {
  canvas->clipRRect(skwasm::roundedRectOf(x, y, width, height, radii),
                    static_cast<SkClipOp>(op), antiAlias != 0);
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_clip_path(SkCanvas* canvas,
                                              PathObject* path,
                                              int op,
                                              int antiAlias) {
  canvas->clipPath(path->path(), static_cast<SkClipOp>(op), antiAlias != 0);
}

// ---- Drawing.

EMSCRIPTEN_KEEPALIVE void sk_canvas_clear(SkCanvas* canvas,
                                          float r,
                                          float g,
                                          float b,
                                          float a) {
  canvas->clear(SkColor4f{r, g, b, a});
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_draw_color(SkCanvas* canvas,
                                               float r,
                                               float g,
                                               float b,
                                               float a,
                                               int blendMode) {
  canvas->drawColor(SkColor4f{r, g, b, a},
                    static_cast<SkBlendMode>(blendMode));
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_draw_paint(SkCanvas* canvas,
                                               const SkPaint* paint) {
  canvas->drawPaint(*paint);
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_draw_rect(SkCanvas* canvas,
                                              float x,
                                              float y,
                                              float width,
                                              float height,
                                              const SkPaint* paint) {
  canvas->drawRect(SkRect::MakeXYWH(x, y, width, height), *paint);
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_draw_rounded_rect(SkCanvas* canvas,
                                                      float x,
                                                      float y,
                                                      float width,
                                                      float height,
                                                      float rx,
                                                      float ry,
                                                      const SkPaint* paint) {
  canvas->drawRRect(
      SkRRect::MakeRectXY(SkRect::MakeXYWH(x, y, width, height), rx, ry),
      *paint);
}

// One radius per corner: see roundedRectOf().
EMSCRIPTEN_KEEPALIVE void sk_canvas_draw_rounded_rect_corners(
    SkCanvas* canvas,
    float x,
    float y,
    float width,
    float height,
    const float* radii,
    const SkPaint* paint) {
  canvas->drawRRect(skwasm::roundedRectOf(x, y, width, height, radii), *paint);
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_draw_circle(SkCanvas* canvas,
                                                float cx,
                                                float cy,
                                                float radius,
                                                const SkPaint* paint) {
  canvas->drawCircle(cx, cy, radius, *paint);
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_draw_oval(SkCanvas* canvas,
                                              float x,
                                              float y,
                                              float width,
                                              float height,
                                              const SkPaint* paint) {
  canvas->drawOval(SkRect::MakeXYWH(x, y, width, height), *paint);
}

// Angles in radians, clockwise from the positive x axis.
EMSCRIPTEN_KEEPALIVE void sk_canvas_draw_arc(SkCanvas* canvas,
                                             float x,
                                             float y,
                                             float width,
                                             float height,
                                             float start,
                                             float sweep,
                                             int useCenter,
                                             const SkPaint* paint) {
  canvas->drawArc(SkRect::MakeXYWH(x, y, width, height),
                  start * skwasm::kDegrees, sweep * skwasm::kDegrees,
                  useCenter != 0, *paint);
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_draw_line(SkCanvas* canvas,
                                              float x0,
                                              float y0,
                                              float x1,
                                              float y1,
                                              const SkPaint* paint) {
  canvas->drawLine(x0, y0, x1, y1, *paint);
}

// `mode`: 0 for points, 1 for lines, 2 for a polygon. `points` is x, y pairs.
EMSCRIPTEN_KEEPALIVE void sk_canvas_draw_points(SkCanvas* canvas,
                                                int mode,
                                                const SkPoint* points,
                                                int count,
                                                const SkPaint* paint) {
  canvas->drawPoints(static_cast<SkCanvas::PointMode>(mode),
                     SkSpan(points, count), *paint);
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_draw_path(SkCanvas* canvas,
                                              PathObject* path,
                                              const SkPaint* paint) {
  canvas->drawPath(path->path(), *paint);
}

// `image` is a store handle; `paint` may be null.
EMSCRIPTEN_KEEPALIVE void sk_canvas_draw_image(SkCanvas* canvas,
                                               uint32_t image,
                                               float x,
                                               float y,
                                               float width,
                                               float height,
                                               int sampling,
                                               const SkPaint* paint) {
  if (sk_sp<SkImage> source = skwasm::imageOf(image)) {
    canvas->drawImageRect(source.get(), SkRect::MakeXYWH(x, y, width, height),
                          skwasm::samplingOf(sampling), paint);
  }
}

// A part of the image, into a rect.
EMSCRIPTEN_KEEPALIVE void sk_canvas_draw_image_rect(SkCanvas* canvas,
                                                    uint32_t image,
                                                    float sx,
                                                    float sy,
                                                    float sw,
                                                    float sh,
                                                    float dx,
                                                    float dy,
                                                    float dw,
                                                    float dh,
                                                    int sampling,
                                                    const SkPaint* paint) {
  if (sk_sp<SkImage> source = skwasm::imageOf(image)) {
    canvas->drawImageRect(source.get(), SkRect::MakeXYWH(sx, sy, sw, sh),
                          SkRect::MakeXYWH(dx, dy, dw, dh),
                          skwasm::samplingOf(sampling), paint,
                          SkCanvas::kStrict_SrcRectConstraint);
  }
}

// UTF-8 text on a baseline that starts at (x, y).
EMSCRIPTEN_KEEPALIVE void sk_canvas_draw_text(SkCanvas* canvas,
                                              const char* text,
                                              int byteLength,
                                              float x,
                                              float y,
                                              const SkFont* font,
                                              const SkPaint* paint) {
  canvas->drawSimpleText(text, byteLength, SkTextEncoding::kUTF8, x, y, *font,
                         *paint);
}

EMSCRIPTEN_KEEPALIVE void sk_canvas_draw_text_blob(SkCanvas* canvas,
                                                   const SkTextBlob* blob,
                                                   float x,
                                                   float y,
                                                   const SkPaint* paint) {
  canvas->drawTextBlob(blob, x, y, *paint);
}

// `positions` is one x, y pair per glyph, relative to (x, y).
EMSCRIPTEN_KEEPALIVE void sk_canvas_draw_glyphs(SkCanvas* canvas,
                                                const uint16_t* glyphs,
                                                const SkPoint* positions,
                                                int count,
                                                float x,
                                                float y,
                                                const SkFont* font,
                                                const SkPaint* paint) {
  canvas->drawGlyphs(SkSpan(glyphs, count), SkSpan(positions, count), {x, y},
                     *font, *paint);
}

// `paint` may be null.
EMSCRIPTEN_KEEPALIVE void sk_canvas_draw_picture(SkCanvas* canvas,
                                                 const SkPicture* picture,
                                                 const SkPaint* paint) {
  canvas->drawPicture(picture, nullptr, paint);
}

// ---- Pictures.

EMSCRIPTEN_KEEPALIVE SkPictureRecorder* sk_picture_recorder_new() {
  return new SkPictureRecorder();
}

EMSCRIPTEN_KEEPALIVE void sk_picture_recorder_delete(
    SkPictureRecorder* recorder) {
  delete recorder;
}

EMSCRIPTEN_KEEPALIVE SkCanvas* sk_picture_recorder_begin(
    SkPictureRecorder* recorder,
    float x,
    float y,
    float width,
    float height) {
  return recorder->beginRecording(SkRect::MakeXYWH(x, y, width, height));
}

// One reference, given up with sk_unref().
EMSCRIPTEN_KEEPALIVE SkPicture* sk_picture_recorder_finish(
    SkPictureRecorder* recorder) {
  return recorder->finishRecordingAsPicture().release();
}

// `tile` is the rect to repeat, as four floats, or null for the cull rect of
// the picture. `filter`: 0 for nearest, 1 for linear.
EMSCRIPTEN_KEEPALIVE SkShader* sk_picture_make_shader(SkPicture* picture,
                                                      int tileX,
                                                      int tileY,
                                                      int filter,
                                                      const float* matrix,
                                                      const float* tile) {
  SkMatrix storage;
  SkRect rect;
  if (tile) {
    rect = SkRect::MakeXYWH(tile[0], tile[1], tile[2], tile[3]);
  }
  return picture
      ->makeShader(static_cast<SkTileMode>(tileX),
                   static_cast<SkTileMode>(tileY),
                   filter ? SkFilterMode::kLinear : SkFilterMode::kNearest,
                   skwasm::matrixOrNull(matrix, &storage),
                   tile ? &rect : nullptr)
      .release();
}

}  // extern "C"
