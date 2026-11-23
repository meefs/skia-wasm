/**
 * The binary format of a display list: the one definition both sides share.
 *
 * The TypeScript encoder imports this file. scripts/generate-format.ts turns
 * it into src/cpp/generated/format.h, and src/cpp/layout.h checks the C++
 * structs against those constants with static asserts.
 *
 * Every value is a 32-bit little-endian word. Offsets are in words, relative
 * to the start of an instance's data block.
 */

/** "SKDL" */
export const MAGIC = 0x4c444b53;
export const VERSION = 1;

/**
 * A program is one block of words: this header, then the sections in the
 * order of their counts, then the commands, then the initial data block.
 */
export const Header = {
  Magic: 0,
  Version: 1,
  /** Size of an instance's data block. */
  DataWords: 2,
  /** Context resources the program retains, passed next to the block. */
  ImportCount: 3,
  /** Paths the program owns, stored in the block as SVG strings. */
  PathCount: 4,
  ShaderCount: 5,
  PathBufferCount: 6,
  SlotCount: 7,
  CommandWords: 8,
  Words: 9,
} as const;

/**
 * A command is a header word, opcode in the low 16 bits and size in words
 * (header included) in the high 16 bits, followed by its operands. Operands
 * are offsets in the data block or indices in a table: never values.
 */
export const Op = {
  Save: 1,
  Restore: 2,
  /** matrix */
  Concat: 3,
  /** rect */
  ClipRect: 4,
  /** rect, paint */
  DrawRect: 5,
  /** rrect, paint */
  DrawRRect: 6,
  /** index of a program path, paint */
  DrawPath: 7,
  /** index of a path buffer, paint */
  DrawPathBuffer: 8,
  /** index of an imported image, rect */
  DrawImage: 9,
  /** index of a slot, rect */
  DrawImageSlot: 10,
} as const;

/** Size of each command in words, header included. */
export const OpWords = {
  Save: 1,
  Restore: 1,
  Concat: 2,
  ClipRect: 2,
  DrawRect: 3,
  DrawRRect: 3,
  DrawPath: 3,
  DrawPathBuffer: 3,
  DrawImage: 3,
  DrawImageSlot: 3,
} as const;

/** Row-major 3x3, the order of SkMatrix::MakeAll. */
export const Matrix = { Words: 9 } as const;

export const Rect = { X: 0, Y: 1, Width: 2, Height: 3, Words: 4 } as const;

export const RRect = {
  X: 0,
  Y: 1,
  Width: 2,
  Height: 3,
  Rx: 4,
  Ry: 5,
  Words: 6,
} as const;

export const Paint = {
  Style: 0,
  StrokeWidth: 1,
  BlendMode: 2,
  /** 0 for none, otherwise the index of a shader plus one. */
  Shader: 3,
  /** RGBA, unpremultiplied. */
  Color: 4,
  Words: 8,
} as const;

export const PaintStyle = { Fill: 0, Stroke: 1 } as const;

/** The values of SkBlendMode. */
export const BlendMode = {
  Clear: 0,
  Src: 1,
  Dst: 2,
  SrcOver: 3,
  DstOver: 4,
  SrcIn: 5,
  DstIn: 6,
  SrcOut: 7,
  DstOut: 8,
  SrcATop: 9,
  DstATop: 10,
  Xor: 11,
  Plus: 12,
  Modulate: 13,
  Screen: 14,
  Overlay: 15,
  Darken: 16,
  Lighten: 17,
  ColorDodge: 18,
  ColorBurn: 19,
  HardLight: 20,
  SoftLight: 21,
  Difference: 22,
  Exclusion: 23,
  Multiply: 24,
  Hue: 25,
  Saturation: 26,
  Color: 27,
  Luminosity: 28,
  Last: 28,
} as const;

/**
 * A path buffer in the data block: two counts, then `maxVerbs` verbs (one
 * word each), then `maxPoints` points (two floats each).
 */
export const PathBuffer = {
  VerbCount: 0,
  PointCount: 1,
  Verbs: 2,
} as const;

/** The values of SkPathVerb. Conics (3) are not supported. */
export const Verb = {
  Move: 0,
  Line: 1,
  Quad: 2,
  Cubic: 4,
  Close: 5,
} as const;

/** A shader is declared in the program and derived from the data block. */
export const ShaderDecl = {
  Kind: 0,
  /** RuntimeEffect: index of the imported effect. LinearGradient: stops. */
  Arg: 1,
  DataOffset: 2,
  DataWords: 3,
  Words: 4,
} as const;

export const ShaderKind = { RuntimeEffect: 1, LinearGradient: 2 } as const;

/** Data of a linear gradient: two points, then one RGBA color per stop. */
export const LinearGradient = { Start: 0, End: 2, Colors: 4 } as const;

export const PathBufferDecl = {
  DataOffset: 0,
  MaxVerbs: 1,
  MaxPoints: 2,
  Words: 3,
} as const;

/** A slot is one word of the data block holding a resource handle. */
export const SlotDecl = { DataOffset: 0, Words: 1 } as const;

/**
 * Word 0 of every data block is reserved, so that no slot has offset 0 and a
 * zero operand can mean "none".
 */
export const RESERVED_WORDS = 1;

/** What scripts/generate-format.ts exports to C++. */
export const tables = {
  Header,
  OpWords,
  Matrix,
  Rect,
  RRect,
  Paint,
  PaintStyle,
  BlendMode,
  PathBuffer,
  Verb,
  ShaderDecl,
  ShaderKind,
  LinearGradient,
  PathBufferDecl,
  SlotDecl,
} as const;
