/*
 * Benchmark variant A: wrapper classes through embind, in the style of
 * CanvasKit. Paint, Path, Shader, RuntimeEffect and Image are JavaScript
 * objects backed by C++ ones, and every drawing operation is a method call
 * that embind marshals.
 *
 * As in CanvasKit, Skia classes are bound directly, smart pointers hold the
 * reference-counted ones, and arrays (a matrix, a rounded rect, uniforms)
 * are passed as pointers into wasm memory that the caller filled.
 */
#include <cstdint>
#include <string>
#include <utility>

#include <emscripten/bind.h>
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

using namespace emscripten;

namespace {

// The canvas of the frame changes with every frame, since each frame wraps
// a new texture. This object stays and forwards to the current one, so that
// the page keeps a single wrapper as it would with a CanvasKit surface.
struct Canvas {};

// A path object the page keeps and refills.
struct Path {
  SkPath path;
};

}  // namespace

EMSCRIPTEN_BINDINGS(bench) {
  class_<SkShader>("Shader").smart_ptr<sk_sp<SkShader>>("sk_sp<Shader>");

  class_<SkImage>("Image").smart_ptr<sk_sp<SkImage>>("sk_sp<Image>");

  class_<SkRuntimeEffect>("RuntimeEffect")
      .smart_ptr<sk_sp<SkRuntimeEffect>>("sk_sp<RuntimeEffect>")
      .class_function("Make",
                      optional_override(
                          [](std::string sksl) -> sk_sp<SkRuntimeEffect> {
                            return SkRuntimeEffect::MakeForShader(
                                       SkString(sksl.c_str()))
                                .effect;
                          }))
      // `uniforms` points to the uniform block, which is copied.
      .function("_makeShader",
                optional_override(
                    [](SkRuntimeEffect& self,
                       uintptr_t uniforms) -> sk_sp<SkShader> {
                      return self.makeShader(
                          SkData::MakeWithCopy(
                              reinterpret_cast<const void*>(uniforms),
                              self.uniformSize()),
                          {});
                    }));

  class_<SkPaint>("Paint")
      .constructor<>()
      .function("setAntiAlias",
                optional_override([](SkPaint& self, bool antiAlias) {
                  self.setAntiAlias(antiAlias);
                }))
      .function("setColorComponents",
                optional_override(
                    [](SkPaint& self, float r, float g, float b, float a) {
                      self.setColor(SkColor4f{r, g, b, a});
                    }))
      .function("setStroke", optional_override([](SkPaint& self, float width) {
                  self.setStyle(SkPaint::kStroke_Style);
                  self.setStrokeWidth(width);
                }))
      .function("setShader",
                optional_override([](SkPaint& self, sk_sp<SkShader> shader) {
                  self.setShader(std::move(shader));
                }));

  class_<Path>("Path")
      .constructor<>()
      // `points` points to `count` pairs of floats.
      .function("_setPolyline",
                optional_override([](Path& self, uintptr_t points, int count) {
                  self.path = SkPath::Polygon(
                      SkSpan(reinterpret_cast<const SkPoint*>(points), count),
                      false, SkPathFillType::kWinding, /*isVolatile=*/true);
                }));

  class_<Canvas>("Canvas")
      .constructor<>()
      .function("save",
                optional_override([](Canvas&) { bench::gCanvas->save(); }))
      .function("restore",
                optional_override([](Canvas&) { bench::gCanvas->restore(); }))
      // `matrix` points to nine floats, row-major.
      .function("_concat", optional_override([](Canvas&, uintptr_t matrix) {
                  const float* m = reinterpret_cast<const float*>(matrix);
                  bench::gCanvas->concat(SkMatrix::MakeAll(
                      m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]));
                }))
      .function("drawRect4f",
                optional_override([](Canvas&, float left, float top,
                                     float right, float bottom,
                                     const SkPaint& paint) {
                  bench::gCanvas->drawRect(
                      SkRect::MakeLTRB(left, top, right, bottom), paint);
                }))
      // `rrect` points to x, y, width, height, rx, ry.
      .function("_drawRRect", optional_override([](Canvas&, uintptr_t rrect,
                                                   const SkPaint& paint) {
                  const float* r = reinterpret_cast<const float*>(rrect);
                  bench::gCanvas->drawRRect(
                      SkRRect::MakeRectXY(
                          SkRect::MakeXYWH(r[0], r[1], r[2], r[3]), r[4], r[5]),
                      paint);
                }))
      .function("drawPath", optional_override([](Canvas&, const Path& path,
                                                 const SkPaint& paint) {
                  bench::gCanvas->drawPath(path.path, paint);
                }))
      .function("drawImageRect4f",
                optional_override([](Canvas&, sk_sp<SkImage> image, float x,
                                     float y, float width, float height) {
                  bench::gCanvas->drawImageRect(
                      image, SkRect::MakeXYWH(x, y, width, height),
                      SkSamplingOptions(SkFilterMode::kLinear));
                }));

  // `texture` comes from WebGPU.importJsTexture(); its reference is taken
  // over.
  function("_MakeImageFromTexture",
           optional_override([](uintptr_t cTexture) -> sk_sp<SkImage> {
             wgpu::Texture texture = wgpu::Texture::Acquire(
                 reinterpret_cast<WGPUTexture>(cTexture));
             return SkImages::WrapTexture(
                 skwasm::Context::Get()->recorder(),
                 skgpu::graphite::BackendTextures::MakeDawn(texture.Get()),
                 kOpaque_SkAlphaType, SkColorSpace::MakeSRGB());
           }));
}
