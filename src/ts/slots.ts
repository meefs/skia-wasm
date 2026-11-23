import { Paint } from "./format";

/**
 * What a slot of the data block holds. A slot is the offset of its first
 * word: a plain number at run time, branded so that writing a color where a
 * matrix lives is a type error.
 */
export type SlotKind =
  | "f32"
  | "i32"
  | "vec2"
  | "vec3"
  | "vec4"
  | "color"
  | "rect"
  | "rrect"
  | "mat3"
  | "paint"
  | "image"
  | "floats";

declare const slotKind: unique symbol;

export type Slot<K extends SlotKind = SlotKind> = number & {
  readonly [slotKind]: K;
};

export const slot = <K extends SlotKind>(offset: number) => offset as Slot<K>;

/** The slots inside a paint. Its style is at `paint + Paint.Style`. */
export const paintColor = (paint: Slot<"paint">) =>
  slot<"color">(paint + Paint.Color);
export const paintStrokeWidth = (paint: Slot<"paint">) =>
  slot<"f32">(paint + Paint.StrokeWidth);
export const paintBlendMode = (paint: Slot<"paint">) =>
  slot<"i32">(paint + Paint.BlendMode);
export const paintShader = (paint: Slot<"paint">) =>
  slot<"i32">(paint + Paint.Shader);

/** A path of fixed capacity in the data block, animated by writing to it. */
export interface PathBufferRef {
  readonly kind: "pathBuffer";
  /** Index of the buffer in the program. */
  readonly index: number;
  readonly verbCount: Slot<"i32">;
  readonly pointCount: Slot<"i32">;
  /** Offset of the first verb: one word each. */
  readonly verbs: number;
  /** Offset of the first point: two floats each. */
  readonly points: number;
  readonly maxVerbs: number;
  readonly maxPoints: number;
}

/** A path parsed once and owned by the program. */
export interface StaticPathRef {
  readonly kind: "path";
  readonly index: number;
}

/** A shader of the program; its inputs are slots of the data block. */
export interface ShaderRef<U = Record<string, Slot>> {
  readonly kind: "shader";
  /** Index of the shader in the program. A paint stores it plus one. */
  readonly index: number;
  readonly uniforms: U;
}

export interface GradientRef {
  readonly kind: "shader";
  readonly index: number;
  readonly start: Slot<"vec2">;
  readonly end: Slot<"vec2">;
  readonly colors: readonly Slot<"color">[];
}

/** The kind of each slot a builder handed out, for `build(schema)`. */
export interface SlotTypes {
  kindOf(offset: number): SlotKind | undefined;
  /** Length in words of a "floats" slot. */
  wordsOf(offset: number): number;
}
