/*
 * Shared by the exports of the immediate API: canvas.cpp, paint.cpp,
 * path.cpp, text.cpp and image.cpp. They take numbers and pointers. An object
 * is a raw pointer that its JavaScript wrapper owns; an image or an effect is
 * a handle of the store, as in the display list.
 */
#pragma once

#include <cstdint>
#include <string>

#include "include/core/SkColor.h"
#include "include/core/SkImage.h"
#include "include/core/SkMatrix.h"
#include "include/core/SkPath.h"
#include "include/core/SkPathBuilder.h"
#include "include/core/SkRRect.h"
#include "include/core/SkSamplingOptions.h"

#include "context.h"

namespace skwasm {

// Where a function that returns several numbers leaves them, until the next
// call.
inline float gResult[64];
// The same for text.
inline std::string gText;

// Nine floats, row-major: the order of SkMatrix::MakeAll.
inline SkMatrix matrixOf(const float* m) {
  return SkMatrix::MakeAll(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7],
                           m[8]);
}

// For a matrix that the caller may leave out.
inline const SkMatrix* matrixOrNull(const float* m, SkMatrix* storage) {
  if (!m) {
    return nullptr;
  }
  *storage = matrixOf(m);
  return storage;
}

// 0: nearest. 1: linear. 2: linear between mipmaps. 3: Mitchell cubic.
// 4: Catmull-Rom cubic.
inline SkSamplingOptions samplingOf(int sampling) {
  switch (sampling) {
    case 0:
      return SkSamplingOptions(SkFilterMode::kNearest);
    case 2:
      return SkSamplingOptions(SkFilterMode::kLinear, SkMipmapMode::kLinear);
    case 3:
      return SkSamplingOptions(SkCubicResampler::Mitchell());
    case 4:
      return SkSamplingOptions(SkCubicResampler::CatmullRom());
    default:
      return SkSamplingOptions(SkFilterMode::kLinear);
  }
}

// The image of a store handle, or null: a released handle draws nothing.
inline sk_sp<SkImage> imageOf(uint32_t handle) {
  Resource* resource = Context::Get()->store().get(handle);
  if (!resource || resource->type() != Resource::Type::kImage) {
    return nullptr;
  }
  return sk_ref_sp(static_cast<ImageResource*>(resource)->image());
}

// Stores an image and returns its handle, or zero.
inline uint32_t storeImage(sk_sp<SkImage> image) {
  if (!image) {
    setError("Graphite did not create the image.");
    return 0;
  }
  return Context::Get()->store().add(
      sk_make_sp<ImageResource>(std::move(image)));
}

// Corner radii as eight floats: x and y for the top left, top right, bottom
// right and bottom left corners.
inline SkRRect roundedRectOf(float x,
                             float y,
                             float width,
                             float height,
                             const float* radii) {
  const SkVector corners[4] = {{radii[0], radii[1]},
                               {radii[2], radii[3]},
                               {radii[4], radii[5]},
                               {radii[6], radii[7]}};
  SkRRect rrect;
  rrect.setRectRadii(SkRect::MakeXYWH(x, y, width, height), corners);
  return rrect;
}

/*
 * A path as JavaScript sees it: one object that can be edited and drawn.
 * Skia separates the two, so this is a builder and the path last made from
 * it, made again only after an edit.
 */
struct PathObject {
  SkPathBuilder builder;
  SkPath snapshot;
  bool dirty = false;

  PathObject() = default;
  explicit PathObject(const SkPath& path) : builder(path), snapshot(path) {}

  const SkPath& path() {
    if (dirty) {
      snapshot = builder.snapshot();
      dirty = false;
    }
    return snapshot;
  }

  SkPathBuilder& edit() {
    dirty = true;
    return builder;
  }
};

constexpr float kDegrees = 180.0f / 3.14159265358979323846f;

}  // namespace skwasm
