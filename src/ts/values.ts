/**
 * The typed helper over raw writes: `scene.values`, generated from the schema
 * given to `build()`.
 *
 * One class is generated per program. Number slots are accessors on its
 * prototype; vector, matrix and path slots are small objects created once per
 * instance. Nothing here allocates when a value is set.
 */
import { Paint, RRect, Rect } from "./format";
import {
  writeIdentity,
  writeMatrix,
  writePoints,
  writePolyline,
  writeRotate,
  writeScale,
  writeTranslate,
} from "./helpers";
import type { Image } from "./resources";
import { slot } from "./slots";
import type { PathBufferRef, Slot, SlotKind, SlotTypes } from "./slots";

/** What the accessors write through: an instance. */
export interface DataOwner {
  /** Views on the data block, valid until wasm memory grows. */
  readonly f32: Float32Array;
  readonly u32: Uint32Array;
}

abstract class Value {
  constructor(
    protected readonly owner: DataOwner,
    protected readonly offset: number
  ) {}
}

export class Vec2Value extends Value {
  set(x: number, y: number) {
    const { f32 } = this.owner;
    const o = this.offset;
    f32[o] = x;
    f32[o + 1] = y;
  }
}

export class Vec3Value extends Value {
  set(x: number, y: number, z: number) {
    const { f32 } = this.owner;
    const o = this.offset;
    f32[o] = x;
    f32[o + 1] = y;
    f32[o + 2] = z;
  }
}

/** Four floats: a vector or an RGBA color. */
export class Vec4Value extends Value {
  set(x: number, y: number, z: number, w: number) {
    const { f32 } = this.owner;
    const o = this.offset;
    f32[o] = x;
    f32[o + 1] = y;
    f32[o + 2] = z;
    f32[o + 3] = w;
  }
}

export class RectValue extends Value {
  set(x: number, y: number, width: number, height: number) {
    const { f32 } = this.owner;
    const o = this.offset;
    f32[o + Rect.X] = x;
    f32[o + Rect.Y] = y;
    f32[o + Rect.Width] = width;
    f32[o + Rect.Height] = height;
  }
}

export class RRectValue extends Value {
  set(
    x: number,
    y: number,
    width: number,
    height: number,
    rx: number,
    ry = rx
  ) {
    const { f32 } = this.owner;
    const o = this.offset;
    f32[o + RRect.X] = x;
    f32[o + RRect.Y] = y;
    f32[o + RRect.Width] = width;
    f32[o + RRect.Height] = height;
    f32[o + RRect.Rx] = rx;
    f32[o + RRect.Ry] = ry;
  }
}

export class Mat3Value extends Value {
  private get slot() {
    return slot<"mat3">(this.offset);
  }
  /** The first two rows, in the order of SkMatrix::MakeAll. */
  set(
    scaleX: number,
    skewX: number,
    transX: number,
    skewY: number,
    scaleY: number,
    transY: number
  ) {
    writeMatrix(
      this.owner.f32,
      this.slot,
      scaleX,
      skewX,
      transX,
      skewY,
      scaleY,
      transY
    );
  }
  setIdentity() {
    writeIdentity(this.owner.f32, this.slot);
  }
  setTranslate(x: number, y: number) {
    writeTranslate(this.owner.f32, this.slot, x, y);
  }
  setScale(sx: number, sy = sx, px = 0, py = 0) {
    writeScale(this.owner.f32, this.slot, sx, sy, px, py);
  }
  setRotate(radians: number, px = 0, py = 0) {
    writeRotate(this.owner.f32, this.slot, radians, px, py);
  }
}

export class PaintValue extends Value {
  readonly color: Vec4Value;
  constructor(owner: DataOwner, offset: number) {
    super(owner, offset);
    this.color = new Vec4Value(owner, offset + Paint.Color);
  }
  get strokeWidth() {
    return this.owner.f32[this.offset + Paint.StrokeWidth];
  }
  set strokeWidth(width: number) {
    this.owner.f32[this.offset + Paint.StrokeWidth] = width;
  }
  /** A value of PaintStyle. */
  get style() {
    return this.owner.u32[this.offset + Paint.Style];
  }
  set style(style: number) {
    this.owner.u32[this.offset + Paint.Style] = style;
  }
  /** A value of BlendMode. */
  get blendMode() {
    return this.owner.u32[this.offset + Paint.BlendMode];
  }
  set blendMode(mode: number) {
    this.owner.u32[this.offset + Paint.BlendMode] = mode;
  }
}

/** A run of floats: a uniform array or matrix. */
export class FloatsValue extends Value {
  constructor(
    owner: DataOwner,
    offset: number,
    readonly length: number
  ) {
    super(owner, offset);
  }
  set(index: number, value: number) {
    this.owner.f32[this.offset + index] = value;
  }
  copy(values: ArrayLike<number>) {
    if (values.length > this.length) {
      throw new RangeError("More values than the slot holds.");
    }
    this.owner.f32.set(values, this.offset);
  }
}

/** Number slots given as an array in the schema. */
export class ScalarsValue {
  readonly length: number;
  constructor(
    private readonly owner: DataOwner,
    private readonly offsets: Int32Array,
    private readonly integer: boolean
  ) {
    this.length = offsets.length;
  }
  set(index: number, value: number) {
    if (this.integer) {
      this.owner.u32[this.offsets[index]] = value;
    } else {
      this.owner.f32[this.offsets[index]] = value;
    }
  }
  get(index: number) {
    return this.integer
      ? this.owner.u32[this.offsets[index]] | 0
      : this.owner.f32[this.offsets[index]];
  }
}

/** Resource slots given as an array in the schema. */
export class ImagesValue {
  readonly length: number;
  constructor(
    private readonly owner: DataOwner,
    private readonly offsets: Int32Array
  ) {
    this.length = offsets.length;
  }
  /** Rebinds a slot: one integer write. */
  set(index: number, image: Image | null) {
    this.owner.u32[this.offsets[index]] = image === null ? 0 : image.handle;
  }
}

export class PathValue {
  constructor(
    private readonly owner: DataOwner,
    private readonly path: PathBufferRef
  ) {}
  /** Copies points (x, y pairs) over those of the path; the verbs stay. */
  setPoints(points: ArrayLike<number>) {
    writePoints(this.owner.f32, this.path, points);
  }
  /** Makes the path one contour through the points. */
  setPolyline(points: ArrayLike<number>, close = false) {
    writePolyline(this.owner.f32, this.owner.u32, this.path, points, close);
  }
  get pointCount() {
    return this.owner.u32[this.path.pointCount];
  }
  get verbCount() {
    return this.owner.u32[this.path.verbCount];
  }
}

export type SchemaEntry =
  Slot | PathBufferRef | readonly Slot[] | readonly PathBufferRef[];

/** The slots worth animating, by name. */
export type Schema = Record<string, SchemaEntry>;

type ArrayValueOf<E> =
  E extends Slot<"f32" | "i32">
    ? ScalarsValue
    : E extends Slot<"image">
      ? ImagesValue
      : readonly ValueOf<E>[];

export type ValueOf<S> = S extends PathBufferRef
  ? PathValue
  : S extends readonly (infer E)[]
    ? ArrayValueOf<E>
    : S extends Slot<"f32" | "i32">
      ? number
      : S extends Slot<"vec2">
        ? Vec2Value
        : S extends Slot<"vec3">
          ? Vec3Value
          : S extends Slot<"vec4" | "color">
            ? Vec4Value
            : S extends Slot<"rect">
              ? RectValue
              : S extends Slot<"rrect">
                ? RRectValue
                : S extends Slot<"mat3">
                  ? Mat3Value
                  : S extends Slot<"paint">
                    ? PaintValue
                    : S extends Slot<"image">
                      ? Image | null
                      : S extends Slot<"floats">
                        ? FloatsValue
                        : never;

export type Values<S> = { -readonly [K in keyof S]: ValueOf<S[K]> };

export type ValuesClass = new (owner: DataOwner) => object;

type Maker = (owner: DataOwner) => unknown;

const kindOf = (types: SlotTypes, offset: number, name: string) => {
  const kind = types.kindOf(offset);
  if (kind === undefined) {
    throw new Error(`"${name}" in the schema is not a slot of this builder.`);
  }
  return kind;
};

const makerOf = (kind: SlotKind, offset: number, types: SlotTypes): Maker => {
  switch (kind) {
    case "vec2":
      return (owner) => new Vec2Value(owner, offset);
    case "vec3":
      return (owner) => new Vec3Value(owner, offset);
    case "vec4":
    case "color":
      return (owner) => new Vec4Value(owner, offset);
    case "rect":
      return (owner) => new RectValue(owner, offset);
    case "rrect":
      return (owner) => new RRectValue(owner, offset);
    case "mat3":
      return (owner) => new Mat3Value(owner, offset);
    case "paint":
      return (owner) => new PaintValue(owner, offset);
    case "floats": {
      const words = types.wordsOf(offset);
      return (owner) => new FloatsValue(owner, offset, words);
    }
    default:
      throw new Error(`A ${kind} slot has no accessor object.`);
  }
};

/**
 * Generates the class of `scene.values` for a program. Every instance gets
 * the same properties in the same order, so they share one hidden class.
 */
export const compileValues = (
  schema: Schema,
  types: SlotTypes
): ValuesClass => {
  // Properties created per instance, in schema order.
  const makers: [string, Maker][] = [];

  class ValuesImpl {
    readonly $owner: DataOwner;
    constructor(owner: DataOwner) {
      this.$owner = owner;
      const self = this as unknown as Record<string, unknown>;
      for (let i = 0; i < makers.length; i++) {
        self[makers[i][0]] = makers[i][1](owner);
      }
    }
  }

  for (const [name, entry] of Object.entries(schema)) {
    if (typeof entry === "number") {
      const offset: number = entry;
      const kind = kindOf(types, offset, name);
      if (kind === "f32") {
        Object.defineProperty(ValuesImpl.prototype, name, {
          enumerable: true,
          get(this: ValuesImpl) {
            return this.$owner.f32[offset];
          },
          set(this: ValuesImpl, value: number) {
            this.$owner.f32[offset] = value;
          },
        });
      } else if (kind === "i32") {
        Object.defineProperty(ValuesImpl.prototype, name, {
          enumerable: true,
          get(this: ValuesImpl) {
            return this.$owner.u32[offset] | 0;
          },
          set(this: ValuesImpl, value: number) {
            this.$owner.u32[offset] = value;
          },
        });
      } else if (kind === "image") {
        // What was last assigned, kept so that the getter can return it.
        const bound = `$${name}`;
        makers.push([bound, () => null]);
        Object.defineProperty(ValuesImpl.prototype, name, {
          enumerable: true,
          get(this: ValuesImpl) {
            return (this as unknown as Record<string, unknown>)[bound];
          },
          set(this: ValuesImpl, image: Image | null) {
            (this as unknown as Record<string, unknown>)[bound] = image;
            this.$owner.u32[offset] = image === null ? 0 : image.handle;
          },
        });
      } else {
        makers.push([name, makerOf(kind, offset, types)]);
      }
    } else if (Array.isArray(entry)) {
      const list: readonly (Slot | PathBufferRef)[] = entry;
      if (list.length > 0 && typeof list[0] !== "number") {
        const paths = list as readonly PathBufferRef[];
        makers.push([
          name,
          (owner) => paths.map((path) => new PathValue(owner, path)),
        ]);
        continue;
      }
      const offsets = Int32Array.from(list as readonly number[]);
      const kind = offsets.length > 0 ? kindOf(types, offsets[0], name) : "f32";
      for (const offset of offsets) {
        if (kindOf(types, offset, name) !== kind) {
          throw new Error(`"${name}" in the schema mixes kinds of slots.`);
        }
      }
      if (kind === "f32" || kind === "i32") {
        makers.push([
          name,
          (owner) => new ScalarsValue(owner, offsets, kind === "i32"),
        ]);
      } else if (kind === "image") {
        makers.push([name, (owner) => new ImagesValue(owner, offsets)]);
      } else {
        const each = Array.from(offsets, (offset) =>
          makerOf(kind, offset, types)
        );
        makers.push([name, (owner) => each.map((make) => make(owner))]);
      }
    } else {
      const path = entry as PathBufferRef;
      makers.push([name, (owner) => new PathValue(owner, path)]);
    }
  }
  return ValuesImpl;
};
