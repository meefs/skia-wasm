/**
 * Writers for the data block. All of them are plain TypeScript on a typed
 * array: none calls into wasm.
 */
import { PathBuffer, Verb } from "./format";
import type { PathBufferRef, Slot } from "./slots";

export type Color = readonly [number, number, number, number?];

/* A matrix is nine floats, row-major: the order of SkMatrix::MakeAll. */

export const writeMatrix = (
  f32: Float32Array,
  m: Slot<"mat3">,
  scaleX: number,
  skewX: number,
  transX: number,
  skewY: number,
  scaleY: number,
  transY: number
) => {
  f32[m] = scaleX;
  f32[m + 1] = skewX;
  f32[m + 2] = transX;
  f32[m + 3] = skewY;
  f32[m + 4] = scaleY;
  f32[m + 5] = transY;
  f32[m + 6] = 0;
  f32[m + 7] = 0;
  f32[m + 8] = 1;
};

export const writeIdentity = (f32: Float32Array, m: Slot<"mat3">) =>
  writeMatrix(f32, m, 1, 0, 0, 0, 1, 0);

export const writeTranslate = (
  f32: Float32Array,
  m: Slot<"mat3">,
  x: number,
  y: number
) => writeMatrix(f32, m, 1, 0, x, 0, 1, y);

/** Scales around the pivot (px, py). */
export const writeScale = (
  f32: Float32Array,
  m: Slot<"mat3">,
  sx: number,
  sy = sx,
  px = 0,
  py = 0
) => writeMatrix(f32, m, sx, 0, px - sx * px, 0, sy, py - sy * py);

/** Rotates by `radians` around the pivot (px, py). */
export const writeRotate = (
  f32: Float32Array,
  m: Slot<"mat3">,
  radians: number,
  px = 0,
  py = 0
) => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  writeMatrix(f32, m, c, -s, px - c * px + s * py, s, c, py - s * px - c * py);
};

/** RGBA, unpremultiplied, each in [0, 1]. */
export const writeColor = (
  f32: Float32Array,
  color: Slot<"color" | "vec4">,
  r: number,
  g: number,
  b: number,
  a = 1
) => {
  f32[color] = r;
  f32[color + 1] = g;
  f32[color + 2] = b;
  f32[color + 3] = a;
};

/** Parses "#rgb", "#rgba", "#rrggbb" or "#rrggbbaa". */
export const parseColor = (css: string): [number, number, number, number] => {
  const hex = css.startsWith("#") ? css.slice(1) : "";
  const wide = hex.length === 6 || hex.length === 8;
  if (
    !/^[0-9a-f]+$/i.test(hex) ||
    !(wide || hex.length === 3 || hex.length === 4)
  ) {
    throw new Error(`Not a hex color: ${css}`);
  }
  const channel = (index: number) =>
    wide
      ? parseInt(hex.slice(index * 2, index * 2 + 2), 16) / 255
      : parseInt(hex[index], 16) / 15;
  const hasAlpha = hex.length === 4 || hex.length === 8;
  return [channel(0), channel(1), channel(2), hasAlpha ? channel(3) : 1];
};

export const toColor = (
  color: Color | string
): [number, number, number, number] =>
  typeof color === "string"
    ? parseColor(color)
    : [color[0], color[1], color[2], color[3] ?? 1];

/* A path buffer is two counts, its verbs, then its points. */

/** Copies points (x, y pairs) over those of the path; the verbs stay. */
export const writePoints = (
  f32: Float32Array,
  path: PathBufferRef,
  points: ArrayLike<number>
) => {
  if (points.length > path.maxPoints * 2) {
    throw new RangeError("More points than the path buffer holds.");
  }
  f32.set(points, path.points);
};

/** Makes the path one contour through `count` points, which it also writes. */
export const writePolyline = (
  f32: Float32Array,
  u32: Uint32Array,
  path: PathBufferRef,
  points: ArrayLike<number>,
  close = false
) => {
  const count = points.length >> 1;
  const verbs = count + (close ? 1 : 0);
  if (count > path.maxPoints || verbs > path.maxVerbs) {
    throw new RangeError("The polyline does not fit in the path buffer.");
  }
  writePolylineVerbs(u32, path, count, close);
  f32.set(points, path.points);
};

/** The verbs of a contour of `count` points, without touching the points. */
export const writePolylineVerbs = (
  u32: Uint32Array,
  path: PathBufferRef,
  count: number,
  close = false
) => {
  const verbs = count + (close ? 1 : 0);
  if (count > path.maxPoints || verbs > path.maxVerbs) {
    throw new RangeError("The polyline does not fit in the path buffer.");
  }
  u32[path.verbCount] = count === 0 ? 0 : verbs;
  u32[path.pointCount] = count;
  for (let i = 0; i < count; i++) {
    u32[path.verbs + i] = i === 0 ? Verb.Move : Verb.Line;
  }
  if (close && count > 0) {
    u32[path.verbs + count] = Verb.Close;
  }
};

/** Words a path buffer of this capacity takes in the data block. */
export const pathBufferWords = (maxVerbs: number, maxPoints: number) =>
  PathBuffer.Verbs + maxVerbs + 2 * maxPoints;
