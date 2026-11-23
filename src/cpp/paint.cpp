/*
 * The immediate API: paints and what a paint refers to. Shaders, filters and
 * path effects are immutable and counted: a factory returns one reference,
 * which sk_unref() gives up. A paint keeps its own.
 */
#include <cstdint>

#include <emscripten/emscripten.h>

#include "include/core/SkBlendMode.h"
#include "include/core/SkBlurTypes.h"
#include "include/core/SkColorFilter.h"
#include "include/core/SkColorSpace.h"
#include "include/core/SkData.h"
#include "include/core/SkImageFilter.h"
#include "include/core/SkMaskFilter.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPathEffect.h"
#include "include/core/SkShader.h"
#include "include/core/SkTileMode.h"
#include "include/effects/Sk1DPathEffect.h"
#include "include/effects/SkCornerPathEffect.h"
#include "include/effects/SkDashPathEffect.h"
#include "include/effects/SkDiscretePathEffect.h"
#include "include/effects/SkGradient.h"
#include "include/effects/SkImageFilters.h"
#include "include/effects/SkLumaColorFilter.h"
#include "include/effects/SkPerlinNoiseShader.h"
#include "include/effects/SkRuntimeEffect.h"
#include "include/effects/SkTrimPathEffect.h"

#include "immediate.h"

namespace skwasm {

// Colors are RGBA floats, unpremultiplied; `positions` may be null for
// evenly spaced stops.
inline SkGradient gradientOf(const float* colors,
                             const float* positions,
                             int count,
                             int tileMode) {
  const SkSpan<const SkColor4f> stops(
      reinterpret_cast<const SkColor4f*>(colors), count);
  const SkSpan<const float> offsets =
      positions ? SkSpan<const float>(positions, count) : SkSpan<const float>();
  return SkGradient(
      SkGradient::Colors(stops, offsets, static_cast<SkTileMode>(tileMode)),
      SkGradient::Interpolation());
}

}  // namespace skwasm

extern "C" {

// ---- Paints.

EMSCRIPTEN_KEEPALIVE SkPaint* sk_paint_new() {
  SkPaint* paint = new SkPaint();
  paint->setAntiAlias(true);
  return paint;
}

EMSCRIPTEN_KEEPALIVE SkPaint* sk_paint_copy(const SkPaint* paint) {
  return new SkPaint(*paint);
}

EMSCRIPTEN_KEEPALIVE void sk_paint_delete(SkPaint* paint) { delete paint; }

EMSCRIPTEN_KEEPALIVE void sk_paint_set_color(SkPaint* paint,
                                             float r,
                                             float g,
                                             float b,
                                             float a) {
  paint->setColor(SkColor4f{r, g, b, a});
}

EMSCRIPTEN_KEEPALIVE void sk_paint_set_alpha(SkPaint* paint, float alpha) {
  paint->setAlphaf(alpha);
}

// 0 for fill, 1 for stroke.
EMSCRIPTEN_KEEPALIVE void sk_paint_set_style(SkPaint* paint, int style) {
  paint->setStyle(static_cast<SkPaint::Style>(style));
}

EMSCRIPTEN_KEEPALIVE void sk_paint_set_stroke_width(SkPaint* paint,
                                                    float width) {
  paint->setStrokeWidth(width);
}

EMSCRIPTEN_KEEPALIVE void sk_paint_set_stroke_cap(SkPaint* paint, int cap) {
  paint->setStrokeCap(static_cast<SkPaint::Cap>(cap));
}

EMSCRIPTEN_KEEPALIVE void sk_paint_set_stroke_join(SkPaint* paint, int join) {
  paint->setStrokeJoin(static_cast<SkPaint::Join>(join));
}

EMSCRIPTEN_KEEPALIVE void sk_paint_set_stroke_miter(SkPaint* paint,
                                                    float limit) {
  paint->setStrokeMiter(limit);
}

EMSCRIPTEN_KEEPALIVE void sk_paint_set_blend_mode(SkPaint* paint, int mode) {
  paint->setBlendMode(static_cast<SkBlendMode>(mode));
}

EMSCRIPTEN_KEEPALIVE void sk_paint_set_anti_alias(SkPaint* paint,
                                                  int antiAlias) {
  paint->setAntiAlias(antiAlias != 0);
}

EMSCRIPTEN_KEEPALIVE void sk_paint_set_dither(SkPaint* paint, int dither) {
  paint->setDither(dither != 0);
}

// Null removes it. The same for the four that follow.
EMSCRIPTEN_KEEPALIVE void sk_paint_set_shader(SkPaint* paint,
                                              SkShader* shader) {
  paint->setShader(sk_ref_sp(shader));
}

EMSCRIPTEN_KEEPALIVE void sk_paint_set_color_filter(SkPaint* paint,
                                                    SkColorFilter* filter) {
  paint->setColorFilter(sk_ref_sp(filter));
}

EMSCRIPTEN_KEEPALIVE void sk_paint_set_image_filter(SkPaint* paint,
                                                    SkImageFilter* filter) {
  paint->setImageFilter(sk_ref_sp(filter));
}

EMSCRIPTEN_KEEPALIVE void sk_paint_set_mask_filter(SkPaint* paint,
                                                   SkMaskFilter* filter) {
  paint->setMaskFilter(sk_ref_sp(filter));
}

EMSCRIPTEN_KEEPALIVE void sk_paint_set_path_effect(SkPaint* paint,
                                                   SkPathEffect* effect) {
  paint->setPathEffect(sk_ref_sp(effect));
}

// ---- Shaders. `matrix` is a local matrix of nine floats, or null.

EMSCRIPTEN_KEEPALIVE SkShader* sk_shader_color(float r,
                                               float g,
                                               float b,
                                               float a) {
  return SkShaders::Color(SkColor4f{r, g, b, a}, nullptr).release();
}

EMSCRIPTEN_KEEPALIVE SkShader* sk_shader_linear_gradient(
    float x0,
    float y0,
    float x1,
    float y1,
    const float* colors,
    const float* positions,
    int count,
    int tileMode,
    const float* matrix) {
  const SkPoint points[2] = {{x0, y0}, {x1, y1}};
  SkMatrix storage;
  return SkShaders::LinearGradient(
             points, skwasm::gradientOf(colors, positions, count, tileMode),
             skwasm::matrixOrNull(matrix, &storage))
      .release();
}

EMSCRIPTEN_KEEPALIVE SkShader* sk_shader_radial_gradient(
    float cx,
    float cy,
    float radius,
    const float* colors,
    const float* positions,
    int count,
    int tileMode,
    const float* matrix) {
  SkMatrix storage;
  return SkShaders::RadialGradient(
             {cx, cy}, radius,
             skwasm::gradientOf(colors, positions, count, tileMode),
             skwasm::matrixOrNull(matrix, &storage))
      .release();
}

// From a circle to another.
EMSCRIPTEN_KEEPALIVE SkShader* sk_shader_conical_gradient(
    float x0,
    float y0,
    float r0,
    float x1,
    float y1,
    float r1,
    const float* colors,
    const float* positions,
    int count,
    int tileMode,
    const float* matrix) {
  SkMatrix storage;
  return SkShaders::TwoPointConicalGradient(
             {x0, y0}, r0, {x1, y1}, r1,
             skwasm::gradientOf(colors, positions, count, tileMode),
             skwasm::matrixOrNull(matrix, &storage))
      .release();
}

// Angles in radians.
EMSCRIPTEN_KEEPALIVE SkShader* sk_shader_sweep_gradient(
    float cx,
    float cy,
    float start,
    float end,
    const float* colors,
    const float* positions,
    int count,
    int tileMode,
    const float* matrix) {
  SkMatrix storage;
  return SkShaders::SweepGradient(
             {cx, cy}, start * skwasm::kDegrees, end * skwasm::kDegrees,
             skwasm::gradientOf(colors, positions, count, tileMode),
             skwasm::matrixOrNull(matrix, &storage))
      .release();
}

// `image` is a store handle.
EMSCRIPTEN_KEEPALIVE SkShader* sk_shader_image(uint32_t image,
                                               int tileX,
                                               int tileY,
                                               int sampling,
                                               const float* matrix) {
  sk_sp<SkImage> source = skwasm::imageOf(image);
  if (!source) {
    skwasm::setError("The image was released.");
    return nullptr;
  }
  SkMatrix storage;
  return source
      ->makeShader(static_cast<SkTileMode>(tileX),
                   static_cast<SkTileMode>(tileY),
                   skwasm::samplingOf(sampling),
                   skwasm::matrixOrNull(matrix, &storage))
      .release();
}

EMSCRIPTEN_KEEPALIVE SkShader* sk_shader_blend(int mode,
                                               SkShader* destination,
                                               SkShader* source) {
  return SkShaders::Blend(static_cast<SkBlendMode>(mode),
                          sk_ref_sp(destination), sk_ref_sp(source))
      .release();
}

// `turbulence`: 0 for fractal noise. A tile of zero size does not repeat.
EMSCRIPTEN_KEEPALIVE SkShader* sk_shader_noise(int turbulence,
                                               float frequencyX,
                                               float frequencyY,
                                               int octaves,
                                               float seed,
                                               int tileWidth,
                                               int tileHeight) {
  const SkISize tile = SkISize::Make(tileWidth, tileHeight);
  const SkISize* tileSize = tile.isEmpty() ? nullptr : &tile;
  return (turbulence ? SkShaders::MakeTurbulence(frequencyX, frequencyY,
                                                 octaves, seed, tileSize)
                     : SkShaders::MakeFractalNoise(frequencyX, frequencyY,
                                                   octaves, seed, tileSize))
      .release();
}

EMSCRIPTEN_KEEPALIVE SkShader* sk_shader_with_local_matrix(
    SkShader* shader,
    const float* matrix) {
  return shader->makeWithLocalMatrix(skwasm::matrixOf(matrix)).release();
}

EMSCRIPTEN_KEEPALIVE SkShader* sk_shader_with_color_filter(
    SkShader* shader,
    SkColorFilter* filter) {
  return shader->makeWithColorFilter(sk_ref_sp(filter)).release();
}

// `effect` is a store handle. `uniforms` is the uniform block of the effect,
// which is copied; `children` are the shaders of its child slots, in order.
EMSCRIPTEN_KEEPALIVE SkShader* sk_effect_make_shader(uint32_t effect,
                                                     const void* uniforms,
                                                     SkShader* const* children,
                                                     int childCount,
                                                     const float* matrix) {
  skwasm::Resource* resource = skwasm::Context::Get()->store().get(effect);
  if (!resource || resource->type() != skwasm::Resource::Type::kEffect) {
    skwasm::setError("The effect was released.");
    return nullptr;
  }
  SkRuntimeEffect* runtime =
      static_cast<skwasm::EffectResource*>(resource)->effect();
  if (static_cast<size_t>(childCount) != runtime->children().size()) {
    skwasm::setError("The effect was not given all of its children.");
    return nullptr;
  }
  SkRuntimeEffect::ChildPtr slots[16];
  if (childCount > 16) {
    skwasm::setError("An effect has at most sixteen children here.");
    return nullptr;
  }
  for (int i = 0; i < childCount; i++) {
    slots[i] = sk_ref_sp(children[i]);
  }
  SkMatrix storage;
  sk_sp<SkShader> shader = runtime->makeShader(
      SkData::MakeWithCopy(uniforms, runtime->uniformSize()),
      SkSpan<const SkRuntimeEffect::ChildPtr>(slots, childCount),
      skwasm::matrixOrNull(matrix, &storage));
  if (!shader) {
    skwasm::setError("The effect did not make a shader.");
  }
  return shader.release();
}

// ---- Color filters.

// Twenty floats, row-major: RGBA out from RGBA in and a constant, in [0, 1].
EMSCRIPTEN_KEEPALIVE SkColorFilter* sk_color_filter_matrix(
    const float* matrix) {
  return SkColorFilters::Matrix(matrix).release();
}

EMSCRIPTEN_KEEPALIVE SkColorFilter* sk_color_filter_blend(float r,
                                                          float g,
                                                          float b,
                                                          float a,
                                                          int mode) {
  return SkColorFilters::Blend(SkColor4f{r, g, b, a}, nullptr,
                               static_cast<SkBlendMode>(mode))
      .release();
}

EMSCRIPTEN_KEEPALIVE SkColorFilter* sk_color_filter_compose(
    SkColorFilter* outer,
    SkColorFilter* inner) {
  return SkColorFilters::Compose(sk_ref_sp(outer), sk_ref_sp(inner)).release();
}

EMSCRIPTEN_KEEPALIVE SkColorFilter* sk_color_filter_lerp(
    float t,
    SkColorFilter* destination,
    SkColorFilter* source) {
  return SkColorFilters::Lerp(t, sk_ref_sp(destination), sk_ref_sp(source))
      .release();
}

// 0: luminance to alpha. 1: linear to sRGB gamma. 2: sRGB to linear gamma.
EMSCRIPTEN_KEEPALIVE SkColorFilter* sk_color_filter_builtin(int kind) {
  switch (kind) {
    case 1:
      return SkColorFilters::LinearToSRGBGamma().release();
    case 2:
      return SkColorFilters::SRGBToLinearGamma().release();
    default:
      return SkLumaColorFilter::Make().release();
  }
}

// ---- Image filters. An `input` of null is the source being drawn.

EMSCRIPTEN_KEEPALIVE SkImageFilter* sk_image_filter_blur(float sigmaX,
                                                         float sigmaY,
                                                         int tileMode,
                                                         SkImageFilter* input) {
  return SkImageFilters::Blur(sigmaX, sigmaY,
                              static_cast<SkTileMode>(tileMode),
                              sk_ref_sp(input))
      .release();
}

EMSCRIPTEN_KEEPALIVE SkImageFilter* sk_image_filter_color_filter(
    SkColorFilter* filter,
    SkImageFilter* input) {
  return SkImageFilters::ColorFilter(sk_ref_sp(filter), sk_ref_sp(input))
      .release();
}

EMSCRIPTEN_KEEPALIVE SkImageFilter* sk_image_filter_offset(
    float dx,
    float dy,
    SkImageFilter* input) {
  return SkImageFilters::Offset(dx, dy, sk_ref_sp(input)).release();
}

// `shadowOnly`: leaves the source out.
EMSCRIPTEN_KEEPALIVE SkImageFilter* sk_image_filter_drop_shadow(
    float dx,
    float dy,
    float sigmaX,
    float sigmaY,
    float r,
    float g,
    float b,
    float a,
    int shadowOnly,
    SkImageFilter* input) {
  const SkColor color = SkColor4f{r, g, b, a}.toSkColor();
  return (shadowOnly
              ? SkImageFilters::DropShadowOnly(dx, dy, sigmaX, sigmaY, color,
                                               sk_ref_sp(input))
              : SkImageFilters::DropShadow(dx, dy, sigmaX, sigmaY, color,
                                           sk_ref_sp(input)))
      .release();
}

// `erode`: 0 to dilate.
EMSCRIPTEN_KEEPALIVE SkImageFilter* sk_image_filter_morphology(
    int erode,
    float radiusX,
    float radiusY,
    SkImageFilter* input) {
  return (erode
              ? SkImageFilters::Erode(radiusX, radiusY, sk_ref_sp(input))
              : SkImageFilters::Dilate(radiusX, radiusY, sk_ref_sp(input)))
      .release();
}

EMSCRIPTEN_KEEPALIVE SkImageFilter* sk_image_filter_compose(
    SkImageFilter* outer,
    SkImageFilter* inner) {
  return SkImageFilters::Compose(sk_ref_sp(outer), sk_ref_sp(inner)).release();
}

EMSCRIPTEN_KEEPALIVE SkImageFilter* sk_image_filter_blend(
    int mode,
    SkImageFilter* background,
    SkImageFilter* foreground) {
  return SkImageFilters::Blend(static_cast<SkBlendMode>(mode),
                               sk_ref_sp(background), sk_ref_sp(foreground))
      .release();
}

EMSCRIPTEN_KEEPALIVE SkImageFilter* sk_image_filter_shader(SkShader* shader) {
  return SkImageFilters::Shader(sk_ref_sp(shader)).release();
}

// Channels: 0 for red, 1 for green, 2 for blue, 3 for alpha.
EMSCRIPTEN_KEEPALIVE SkImageFilter* sk_image_filter_displacement_map(
    int channelX,
    int channelY,
    float scale,
    SkImageFilter* displacement,
    SkImageFilter* input) {
  return SkImageFilters::DisplacementMap(
             static_cast<SkColorChannel>(channelX),
             static_cast<SkColorChannel>(channelY), scale,
             sk_ref_sp(displacement), sk_ref_sp(input))
      .release();
}

EMSCRIPTEN_KEEPALIVE SkImageFilter* sk_image_filter_matrix_transform(
    const float* matrix,
    int sampling,
    SkImageFilter* input) {
  return SkImageFilters::MatrixTransform(skwasm::matrixOf(matrix),
                                         skwasm::samplingOf(sampling),
                                         sk_ref_sp(input))
      .release();
}

// ---- Mask filters.

// `style`: 0 normal, 1 solid, 2 outer, 3 inner.
EMSCRIPTEN_KEEPALIVE SkMaskFilter* sk_mask_filter_blur(int style,
                                                       float sigma,
                                                       int respectMatrix) {
  return SkMaskFilter::MakeBlur(static_cast<SkBlurStyle>(style), sigma,
                                respectMatrix != 0)
      .release();
}

// ---- Path effects.

EMSCRIPTEN_KEEPALIVE SkPathEffect* sk_path_effect_dash(const float* intervals,
                                                       int count,
                                                       float phase) {
  return SkDashPathEffect::Make(SkSpan(intervals, count), phase).release();
}

EMSCRIPTEN_KEEPALIVE SkPathEffect* sk_path_effect_corner(float radius) {
  return SkCornerPathEffect::Make(radius).release();
}

EMSCRIPTEN_KEEPALIVE SkPathEffect* sk_path_effect_discrete(float length,
                                                           float deviation,
                                                           uint32_t seed) {
  return SkDiscretePathEffect::Make(length, deviation, seed).release();
}

// `inverted`: keeps what is outside of [start, stop], each in [0, 1].
EMSCRIPTEN_KEEPALIVE SkPathEffect* sk_path_effect_trim(float start,
                                                       float stop,
                                                       int inverted) {
  return SkTrimPathEffect::Make(start, stop,
                                inverted ? SkTrimPathEffect::Mode::kInverted
                                         : SkTrimPathEffect::Mode::kNormal)
      .release();
}

// Stamps a path along the one being drawn. `style`: 0 translate, 1 rotate,
// 2 morph.
EMSCRIPTEN_KEEPALIVE SkPathEffect* sk_path_effect_stamp(
    skwasm::PathObject* path,
    float advance,
    float phase,
    int style) {
  return SkPath1DPathEffect::Make(
             path->path(), advance, phase,
             static_cast<SkPath1DPathEffect::Style>(style))
      .release();
}

EMSCRIPTEN_KEEPALIVE SkPathEffect* sk_path_effect_compose(SkPathEffect* outer,
                                                          SkPathEffect* inner) {
  return SkPathEffect::MakeCompose(sk_ref_sp(outer), sk_ref_sp(inner))
      .release();
}

EMSCRIPTEN_KEEPALIVE SkPathEffect* sk_path_effect_sum(SkPathEffect* first,
                                                      SkPathEffect* second) {
  return SkPathEffect::MakeSum(sk_ref_sp(first), sk_ref_sp(second)).release();
}

}  // extern "C"
