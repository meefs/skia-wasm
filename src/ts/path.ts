import { fillTypes, pathOps, strokeCaps, strokeJoins } from "./enums";
import type { FillType, PathOp, StrokeCap, StrokeJoin } from "./enums";
import { NativeObject, readText, ref } from "./native";
import type { Matrix, Runtime } from "./native";

/** One radius for a corner, or one per axis. */
export type Radius = number | readonly [number, number];

/** A radius per corner. A corner that is left out is square. */
export interface CornerRadii {
  topLeft?: Radius;
  topRight?: Radius;
  bottomRight?: Radius;
  bottomLeft?: Radius;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StrokeOptions {
  width: number;
  cap?: StrokeCap;
  join?: StrokeJoin;
  miter?: number;
}

/** Writes eight floats, x and y per corner, and returns their address. */
export const writeRadii = (runtime: Runtime, radius: Radius | CornerRadii) => {
  const { module, scratch } = runtime;
  const pointer = scratch.alloc(32);
  const heap = module.HEAPF32;
  const corner = (index: number, value: Radius | undefined) => {
    const at = (pointer >> 2) + index * 2;
    if (value === undefined) {
      heap[at] = 0;
      heap[at + 1] = 0;
    } else if (typeof value === "number") {
      heap[at] = value;
      heap[at + 1] = value;
    } else {
      const [rx, ry] = value;
      heap[at] = rx;
      heap[at + 1] = ry;
    }
  };
  if (typeof radius === "number" || Array.isArray(radius)) {
    const all = radius as Radius;
    corner(0, all);
    corner(1, all);
    corner(2, all);
    corner(3, all);
  } else {
    const corners = radius as CornerRadii;
    corner(0, corners.topLeft);
    corner(1, corners.topRight);
    corner(2, corners.bottomRight);
    corner(3, corners.bottomLeft);
  }
  return pointer;
};

/**
 * A shape made of lines and curves. It is edited in place, and the methods
 * that edit it return it, so that they chain.
 */
export class Path extends NativeObject {
  private fill: FillType = "winding";

  /** Made by `sk.path()`. */
  constructor(
    private readonly runtime: Runtime,
    pointer = runtime.module._sk_path_new()
  ) {
    super(pointer, runtime.module._sk_path_delete, "path");
  }

  // ---- Segments.

  /** Starts a contour. */
  moveTo(x: number, y: number) {
    this.runtime.module._sk_path_move_to(ref(this), x, y);
    return this;
  }

  lineTo(x: number, y: number) {
    this.runtime.module._sk_path_line_to(ref(this), x, y);
    return this;
  }

  /** A quadratic curve, with one control point. */
  quadTo(cx: number, cy: number, x: number, y: number) {
    this.runtime.module._sk_path_quad_to(ref(this), cx, cy, x, y);
    return this;
  }

  /** A cubic curve, with two control points. */
  cubicTo(
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x: number,
    y: number
  ) {
    this.runtime.module._sk_path_cubic_to(ref(this), c1x, c1y, c2x, c2y, x, y);
    return this;
  }

  /**
   * A conic: a quadratic curve pulled toward its control point by a weight.
   * A weight of 1 is a quadratic, and of Math.SQRT1_2 a quarter of a circle.
   */
  conicTo(cx: number, cy: number, x: number, y: number, weight: number) {
    this.runtime.module._sk_path_conic_to(ref(this), cx, cy, x, y, weight);
    return this;
  }

  /**
   * A line toward (x1, y1) then an arc of this radius that ends tangent to
   * the line from (x1, y1) to (x2, y2): the arcTo() of Canvas 2D.
   */
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number) {
    this.runtime.module._sk_path_arc_to(ref(this), x1, y1, x2, y2, radius);
    return this;
  }

  /** Ends the contour with a line back to where it started. */
  close() {
    this.runtime.module._sk_path_close(ref(this));
    return this;
  }

  // ---- Shapes, each a contour of its own.

  addRect(x: number, y: number, width: number, height: number) {
    this.runtime.module._sk_path_add_rect(ref(this), x, y, width, height);
    return this;
  }

  addRoundedRect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: Radius | CornerRadii
  ) {
    const { module, scratch } = this.runtime;
    scratch.reset();
    module._sk_path_add_rounded_rect(
      ref(this),
      x,
      y,
      width,
      height,
      writeRadii(this.runtime, radius)
    );
    return this;
  }

  addCircle(cx: number, cy: number, radius: number) {
    this.runtime.module._sk_path_add_circle(ref(this), cx, cy, radius);
    return this;
  }

  /** The oval inscribed in a rect. */
  addOval(x: number, y: number, width: number, height: number) {
    this.runtime.module._sk_path_add_oval(ref(this), x, y, width, height);
    return this;
  }

  /**
   * An arc of the oval inscribed in a rect. Angles are in radians, clockwise
   * from the positive x axis.
   */
  addArc(
    x: number,
    y: number,
    width: number,
    height: number,
    startAngle: number,
    sweepAngle: number
  ) {
    this.runtime.module._sk_path_add_arc(
      ref(this),
      x,
      y,
      width,
      height,
      startAngle,
      sweepAngle
    );
    return this;
  }

  /** Lines through points given as x, y pairs. */
  addPolygon(points: ArrayLike<number>, close = false) {
    const { module, scratch } = this.runtime;
    scratch.reset();
    module._sk_path_add_polygon(
      ref(this),
      scratch.floats(points),
      points.length >> 1,
      close ? 1 : 0
    );
    return this;
  }

  addPath(path: Path, matrix?: Matrix) {
    const { module, scratch } = this.runtime;
    scratch.reset();
    module._sk_path_add_path(ref(this), ref(path), scratch.matrix(matrix));
    return this;
  }

  // ---- The whole path.

  /** Which side of the contours is inside. */
  get fillType() {
    return this.fill;
  }
  set fillType(type: FillType) {
    this.fill = type;
    this.runtime.module._sk_path_set_fill_type(ref(this), fillTypes(type));
  }

  transform(matrix: Matrix) {
    const { module, scratch } = this.runtime;
    scratch.reset();
    module._sk_path_transform(ref(this), scratch.matrix(matrix));
    return this;
  }

  offset(dx: number, dy: number) {
    this.runtime.module._sk_path_offset(ref(this), dx, dy);
    return this;
  }

  /** Removes every contour. */
  reset() {
    this.runtime.module._sk_path_reset(ref(this));
    return this;
  }

  /**
   * The rect around the points of the path. With `tight`, around the curves
   * themselves, which is slower.
   */
  bounds(tight = false): Bounds {
    const { module } = this.runtime;
    const at = module._sk_path_bounds(ref(this), tight ? 1 : 0) >> 2;
    const heap = module.HEAPF32;
    return {
      x: heap[at],
      y: heap[at + 1],
      width: heap[at + 2],
      height: heap[at + 3],
    };
  }

  /** Whether a point is inside the filled path. */
  contains(x: number, y: number) {
    return this.runtime.module._sk_path_contains(ref(this), x, y) !== 0;
  }

  get isEmpty() {
    return this.runtime.module._sk_path_is_empty(ref(this)) !== 0;
  }

  /** The length of all the contours. */
  get length() {
    return this.runtime.module._sk_path_length(ref(this));
  }

  /**
   * The point at a distance along the path and the unit tangent there, or
   * null past the end.
   */
  pointAt(distance: number) {
    const { module } = this.runtime;
    const pointer = module._sk_path_point_at(ref(this), distance);
    if (pointer === 0) {
      return null;
    }
    const heap = module.HEAPF32;
    const at = pointer >> 2;
    return {
      x: heap[at],
      y: heap[at + 1],
      tangentX: heap[at + 2],
      tangentY: heap[at + 3],
    };
  }

  /** The path as an SVG path string. */
  toSVG() {
    const { module } = this.runtime;
    return readText(module, module._sk_path_to_svg(ref(this)));
  }

  // ---- New paths.

  copy() {
    const copy = this.make(this.runtime.module._sk_path_copy(ref(this)));
    copy.fill = this.fill;
    return copy;
  }

  /** Combines the areas of two paths, or null if Skia finds no result. */
  op(other: Path, op: PathOp) {
    return this.makeOrNull(
      this.runtime.module._sk_path_op(ref(this), ref(other), pathOps(op))
    );
  }

  /** The same area without contours that overlap. */
  simplify() {
    return this.makeOrNull(this.runtime.module._sk_path_simplify(ref(this)));
  }

  /**
   * Between this path and another: `t` of zero is this one. Null unless the
   * two are made of the same segments.
   */
  interpolate(to: Path, t: number) {
    return this.makeOrNull(
      this.runtime.module._sk_path_interpolate(ref(this), ref(to), t)
    );
  }

  /** The outline that stroking this path would fill. */
  stroke(options: StrokeOptions) {
    return this.make(
      this.runtime.module._sk_path_stroke(
        ref(this),
        options.width,
        strokeCaps(options.cap ?? "butt"),
        strokeJoins(options.join ?? "miter"),
        options.miter ?? 4
      )
    );
  }

  /** The part of each contour between two fractions of its length. */
  trim(start: number, stop: number) {
    return this.make(this.runtime.module._sk_path_trim(ref(this), start, stop));
  }

  private make(pointer: number) {
    return new Path(this.runtime, pointer);
  }

  private makeOrNull(pointer: number) {
    return pointer === 0 ? null : new Path(this.runtime, pointer);
  }
}

/** A path from an SVG path string. */
export const pathFromSVG = (runtime: Runtime, svg: string) => {
  const { module, scratch } = runtime;
  scratch.reset();
  const pointer = module._sk_path_from_svg(scratch.text(svg));
  if (pointer === 0) {
    throw new Error(`Not an SVG path: ${svg}`);
  }
  return new Path(runtime, pointer);
};
