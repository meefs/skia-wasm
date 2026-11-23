/*
 * Benchmark variant B: plain C exports, one call per drawing operation.
 * Objects are raw pointers used as integer handles: no wrapper objects, no
 * lookups. This is the cheapest a per-call binding can be.
 */
#include <cstdint>

#include <emscripten/emscripten.h>
#include <webgpu/webgpu_cpp.h>

#include "include/core/SkColorSpace.h"
#include "include/core/SkData.h"
#include "include/core/SkImage.h"
#include "include/core/SkMatrix.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPath.h"
#include "include/core/SkRRect.h"
#include "include/core/SkSamplingOptions.h"
#include "include/core/SkShader.h"
#include "include/core/SkSpan.h"
#include "include/core/SkString.h"
#include "include/effects/SkRuntimeEffect.h"
#include "include/gpu/graphite/BackendTexture.h"
#include "include/gpu/graphite/Image.h"
#include "include/gpu/graphite/dawn/DawnGraphiteTypes.h"

#include "context.h"
#include "frame.h"

using bench::gCanvas;

extern "C" {

EMSCRIPTEN_KEEPALIVE void bx_save() { gCanvas->save(); }

EMSCRIPTEN_KEEPALIVE void bx_restore() { gCanvas->restore(); }

EMSCRIPTEN_KEEPALIVE void bx_concat(float scaleX,
                                    float skewX,
                                    float transX,
                                    float skewY,
                                    float scaleY,
                                    float transY,
                                    float persp0,
                                    float persp1,
                                    float persp2) {
  gCanvas->concat(SkMatrix::MakeAll(scaleX, skewX, transX, skewY, scaleY,
                                    transY, persp0, persp1, persp2));
}

EMSCRIPTEN_KEEPALIVE SkPaint* bx_paint_new() {
  SkPaint* paint = new SkPaint();
  paint->setAntiAlias(true);
  return paint;
}

EMSCRIPTEN_KEEPALIVE void bx_paint_delete(SkPaint* paint) { delete paint; }

EMSCRIPTEN_KEEPALIVE void bx_paint_set_color(SkPaint* paint,
                                             float r,
                                             float g,
                                             float b,
                                             float a) {
  paint->setColor(SkColor4f{r, g, b, a});
}

EMSCRIPTEN_KEEPALIVE void bx_paint_set_stroke(SkPaint* paint, float width) {
  paint->setStyle(SkPaint::kStroke_Style);
  paint->setStrokeWidth(width);
}

EMSCRIPTEN_KEEPALIVE void bx_paint_set_shader(SkPaint* paint,
                                              SkShader* shader) {
  paint->setShader(sk_ref_sp(shader));
}

EMSCRIPTEN_KEEPALIVE void bx_draw_rect(float x,
                                       float y,
                                       float width,
                                       float height,
                                       const SkPaint* paint) {
  gCanvas->drawRect(SkRect::MakeXYWH(x, y, width, height), *paint);
}

EMSCRIPTEN_KEEPALIVE void bx_draw_rrect(float x,
                                        float y,
                                        float width,
                                        float height,
                                        float rx,
                                        float ry,
                                        const SkPaint* paint) {
  gCanvas->drawRRect(
      SkRRect::MakeRectXY(SkRect::MakeXYWH(x, y, width, height), rx, ry),
      *paint);
}

EMSCRIPTEN_KEEPALIVE SkRuntimeEffect* bx_effect_new(const char* sksl) {
  return SkRuntimeEffect::MakeForShader(SkString(sksl)).effect.release();
}

// `uniforms` is the uniform block of the effect; it is copied.
EMSCRIPTEN_KEEPALIVE SkShader* bx_effect_make_shader(SkRuntimeEffect* effect,
                                                     const void* uniforms) {
  return effect
      ->makeShader(SkData::MakeWithCopy(uniforms, effect->uniformSize()), {})
      .release();
}

EMSCRIPTEN_KEEPALIVE void bx_shader_release(SkShader* shader) {
  SkSafeUnref(shader);
}

EMSCRIPTEN_KEEPALIVE SkPath* bx_path_new() { return new SkPath(); }

EMSCRIPTEN_KEEPALIVE void bx_path_delete(SkPath* path) { delete path; }

// Replaces the path with one open contour through `count` points.
EMSCRIPTEN_KEEPALIVE void bx_path_set_polyline(SkPath* path,
                                               const SkPoint* points,
                                               int count) {
  *path = SkPath::Polygon(SkSpan(points, count), false,
                          SkPathFillType::kWinding, /*isVolatile=*/true);
}

EMSCRIPTEN_KEEPALIVE void bx_draw_path(const SkPath* path,
                                       const SkPaint* paint) {
  gCanvas->drawPath(*path, *paint);
}

// `texture` comes from WebGPU.importJsTexture(); its reference is taken over.
EMSCRIPTEN_KEEPALIVE SkImage* bx_image_from_texture(WGPUTexture cTexture) {
  wgpu::Texture texture = wgpu::Texture::Acquire(cTexture);
  return SkImages::WrapTexture(
             skwasm::Context::Get()->recorder(),
             skgpu::graphite::BackendTextures::MakeDawn(texture.Get()),
             kOpaque_SkAlphaType, SkColorSpace::MakeSRGB())
      .release();
}

EMSCRIPTEN_KEEPALIVE void bx_image_release(SkImage* image) {
  SkSafeUnref(image);
}

EMSCRIPTEN_KEEPALIVE void bx_effect_release(SkRuntimeEffect* effect) {
  SkSafeUnref(effect);
}

EMSCRIPTEN_KEEPALIVE void bx_draw_image_rect(const SkImage* image,
                                             float x,
                                             float y,
                                             float width,
                                             float height) {
  gCanvas->drawImageRect(image, SkRect::MakeXYWH(x, y, width, height),
                         SkSamplingOptions(SkFilterMode::kLinear));
}

}  // extern "C"
