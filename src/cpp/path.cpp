/*
 * Paths. JavaScript sees one object that it edits and draws: see PathObject.
 */
#include <cstdint>
#include <optional>

#include <emscripten/emscripten.h>

#include "include/core/SkContourMeasure.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPathTypes.h"
#include "include/core/SkPathUtils.h"
#include "include/core/SkString.h"
#include "include/pathops/SkPathOps.h"
#include "include/utils/SkParsePath.h"

#include "immediate.h"

using skwasm::PathObject;

extern "C" {

EMSCRIPTEN_KEEPALIVE PathObject* sk_path_new() { return new PathObject(); }

// Null if the string is not an SVG path.
EMSCRIPTEN_KEEPALIVE PathObject* sk_path_from_svg(const char* svg) {
  std::optional<SkPath> path = SkParsePath::FromSVGString(svg);
  if (!path) {
    skwasm::setError("Not an SVG path.");
    return nullptr;
  }
  return new PathObject(*path);
}

EMSCRIPTEN_KEEPALIVE PathObject* sk_path_copy(PathObject* path) {
  return new PathObject(path->path());
}

EMSCRIPTEN_KEEPALIVE void sk_path_delete(PathObject* path) { delete path; }

EMSCRIPTEN_KEEPALIVE void sk_path_reset(PathObject* path) {
  path->edit().reset();
}

// ---- Segments.

EMSCRIPTEN_KEEPALIVE void sk_path_move_to(PathObject* path, float x, float y) {
  path->edit().moveTo(x, y);
}

EMSCRIPTEN_KEEPALIVE void sk_path_line_to(PathObject* path, float x, float y) {
  path->edit().lineTo(x, y);
}

EMSCRIPTEN_KEEPALIVE void sk_path_quad_to(PathObject* path,
                                          float cx,
                                          float cy,
                                          float x,
                                          float y) {
  path->edit().quadTo(cx, cy, x, y);
}

EMSCRIPTEN_KEEPALIVE void sk_path_conic_to(PathObject* path,
                                           float cx,
                                           float cy,
                                           float x,
                                           float y,
                                           float weight) {
  path->edit().conicTo(cx, cy, x, y, weight);
}

EMSCRIPTEN_KEEPALIVE void sk_path_cubic_to(PathObject* path,
                                           float c1x,
                                           float c1y,
                                           float c2x,
                                           float c2y,
                                           float x,
                                           float y) {
  path->edit().cubicTo(c1x, c1y, c2x, c2y, x, y);
}

// A line to the tangent of a circle of this radius, then an arc of it: the
// arcTo() of Canvas 2D.
EMSCRIPTEN_KEEPALIVE void sk_path_arc_to(PathObject* path,
                                         float x1,
                                         float y1,
                                         float x2,
                                         float y2,
                                         float radius) {
  path->edit().arcTo({x1, y1}, {x2, y2}, radius);
}

EMSCRIPTEN_KEEPALIVE void sk_path_close(PathObject* path) {
  path->edit().close();
}

// ---- Shapes.

EMSCRIPTEN_KEEPALIVE void sk_path_add_rect(PathObject* path,
                                           float x,
                                           float y,
                                           float width,
                                           float height) {
  path->edit().addRect(SkRect::MakeXYWH(x, y, width, height));
}

// One radius per corner: see roundedRectOf().
EMSCRIPTEN_KEEPALIVE void sk_path_add_rounded_rect(PathObject* path,
                                                   float x,
                                                   float y,
                                                   float width,
                                                   float height,
                                                   const float* radii) {
  path->edit().addRRect(skwasm::roundedRectOf(x, y, width, height, radii));
}

EMSCRIPTEN_KEEPALIVE void sk_path_add_oval(PathObject* path,
                                           float x,
                                           float y,
                                           float width,
                                           float height) {
  path->edit().addOval(SkRect::MakeXYWH(x, y, width, height));
}

EMSCRIPTEN_KEEPALIVE void sk_path_add_circle(PathObject* path,
                                             float cx,
                                             float cy,
                                             float radius) {
  path->edit().addCircle(cx, cy, radius);
}

// An arc of the oval in the rect, as a new contour. Angles in radians.
EMSCRIPTEN_KEEPALIVE void sk_path_add_arc(PathObject* path,
                                          float x,
                                          float y,
                                          float width,
                                          float height,
                                          float start,
                                          float sweep) {
  path->edit().addArc(SkRect::MakeXYWH(x, y, width, height),
                      start * skwasm::kDegrees, sweep * skwasm::kDegrees);
}

// `points` is x, y pairs.
EMSCRIPTEN_KEEPALIVE void sk_path_add_polygon(PathObject* path,
                                              const SkPoint* points,
                                              int count,
                                              int close) {
  path->edit().addPolygon(SkSpan(points, count), close != 0);
}

// `matrix` is nine floats, or null.
EMSCRIPTEN_KEEPALIVE void sk_path_add_path(PathObject* path,
                                           PathObject* other,
                                           const float* matrix) {
  const SkPath& source = other->path();
  if (matrix) {
    path->edit().addPath(source, skwasm::matrixOf(matrix));
  } else {
    path->edit().addPath(source);
  }
}

// ---- The whole path.

// 0 winding, 1 even-odd, 2 inverse winding, 3 inverse even-odd.
EMSCRIPTEN_KEEPALIVE void sk_path_set_fill_type(PathObject* path, int type) {
  path->edit().setFillType(static_cast<SkPathFillType>(type));
}

EMSCRIPTEN_KEEPALIVE void sk_path_transform(PathObject* path,
                                            const float* matrix) {
  path->edit().transform(skwasm::matrixOf(matrix));
}

EMSCRIPTEN_KEEPALIVE void sk_path_offset(PathObject* path,
                                         float dx,
                                         float dy) {
  path->edit().offset(dx, dy);
}

// x, y, width and height, valid until the next call. `tight`: the bounds of
// the curves themselves, not of their control points.
EMSCRIPTEN_KEEPALIVE const float* sk_path_bounds(PathObject* path, int tight) {
  const SkRect bounds =
      tight ? path->path().computeTightBounds() : path->path().getBounds();
  skwasm::gResult[0] = bounds.x();
  skwasm::gResult[1] = bounds.y();
  skwasm::gResult[2] = bounds.width();
  skwasm::gResult[3] = bounds.height();
  return skwasm::gResult;
}

EMSCRIPTEN_KEEPALIVE int sk_path_contains(PathObject* path, float x, float y) {
  return path->path().contains(x, y) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int sk_path_is_empty(PathObject* path) {
  return path->path().isEmpty() ? 1 : 0;
}

// Valid until the next call.
EMSCRIPTEN_KEEPALIVE const char* sk_path_to_svg(PathObject* path) {
  skwasm::gText = SkParsePath::ToSVGString(path->path()).c_str();
  return skwasm::gText.c_str();
}

// ---- New paths from paths. Null when there is no result.

// 0 difference, 1 intersect, 2 union, 3 xor, 4 reverse difference.
EMSCRIPTEN_KEEPALIVE PathObject* sk_path_op(PathObject* one,
                                            PathObject* two,
                                            int op) {
  std::optional<SkPath> result =
      Op(one->path(), two->path(), static_cast<SkPathOp>(op));
  return result ? new PathObject(*result) : nullptr;
}

// The same area without overlapping contours.
EMSCRIPTEN_KEEPALIVE PathObject* sk_path_simplify(PathObject* path) {
  std::optional<SkPath> result = Simplify(path->path());
  return result ? new PathObject(*result) : nullptr;
}

// Null unless the two paths have the same verbs.
EMSCRIPTEN_KEEPALIVE PathObject* sk_path_interpolate(PathObject* from,
                                                     PathObject* to,
                                                     float t) {
  if (!from->path().isInterpolatable(to->path())) {
    return nullptr;
  }
  // Skia weighs the path it is called on: a weight of 1 is `this`.
  return new PathObject(to->path().makeInterpolate(from->path(), 1 - t));
}

// The outline that stroking the path would fill.
EMSCRIPTEN_KEEPALIVE PathObject* sk_path_stroke(PathObject* path,
                                                float width,
                                                int cap,
                                                int join,
                                                float miter) {
  SkPaint paint;
  paint.setStyle(SkPaint::kStroke_Style);
  paint.setStrokeWidth(width);
  paint.setStrokeCap(static_cast<SkPaint::Cap>(cap));
  paint.setStrokeJoin(static_cast<SkPaint::Join>(join));
  paint.setStrokeMiter(miter);
  return new PathObject(skpathutils::FillPathWithPaint(path->path(), paint));
}

// The part of every contour between two fractions of its length.
EMSCRIPTEN_KEEPALIVE PathObject* sk_path_trim(PathObject* path,
                                              float start,
                                              float stop) {
  PathObject* result = new PathObject();
  SkContourMeasureIter iterator(path->path(), false);
  while (sk_sp<SkContourMeasure> contour = iterator.next()) {
    const float length = contour->length();
    (void)contour->getSegment(start * length, stop * length,
                              &result->edit(), true);
  }
  return result;
}

// The length of all the contours.
EMSCRIPTEN_KEEPALIVE float sk_path_length(PathObject* path) {
  float length = 0;
  SkContourMeasureIter iterator(path->path(), false);
  while (sk_sp<SkContourMeasure> contour = iterator.next()) {
    length += contour->length();
  }
  return length;
}

// The point at a distance along the path and the tangent there: x, y, then
// the unit tangent, valid until the next call. Null past the end.
EMSCRIPTEN_KEEPALIVE const float* sk_path_point_at(PathObject* path,
                                                   float distance) {
  SkContourMeasureIter iterator(path->path(), false);
  while (sk_sp<SkContourMeasure> contour = iterator.next()) {
    const float length = contour->length();
    if (distance <= length) {
      SkPoint position;
      SkVector tangent;
      if (!contour->getPosTan(distance, &position, &tangent)) {
        return nullptr;
      }
      skwasm::gResult[0] = position.x();
      skwasm::gResult[1] = position.y();
      skwasm::gResult[2] = tangent.x();
      skwasm::gResult[3] = tangent.y();
      return skwasm::gResult;
    }
    distance -= length;
  }
  return nullptr;
}

}  // extern "C"
