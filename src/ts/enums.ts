/**
 * The enumerations of the immediate API: strings in TypeScript, the values of
 * Skia's enums in wasm. Each export turns a name into its value, and throws
 * for a name it does not know: from plain JavaScript nothing else would.
 */

export const lookup = <K extends string>(kind: string, names: readonly K[]) => {
  const values = new Map<string, number>(
    names.map((name, value) => [name, value])
  );
  return (name: K) => {
    const value = values.get(name);
    if (value === undefined) {
      throw new TypeError(
        `Not a ${kind}: ${String(name)}. Expected one of: ${names.join(", ")}.`
      );
    }
    return value;
  };
};

/** The values of SkBlendMode, in order. */
export const blendModes = lookup("blend mode", [
  "clear",
  "src",
  "dst",
  "srcOver",
  "dstOver",
  "srcIn",
  "dstIn",
  "srcOut",
  "dstOut",
  "srcAtop",
  "dstAtop",
  "xor",
  "plus",
  "modulate",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "colorDodge",
  "colorBurn",
  "hardLight",
  "softLight",
  "difference",
  "exclusion",
  "multiply",
  "hue",
  "saturation",
  "color",
  "luminosity",
]);
export type BlendModeName = Parameters<typeof blendModes>[0];

export const paintStyles = lookup("paint style", ["fill", "stroke"]);
export type PaintStyleName = Parameters<typeof paintStyles>[0];

export const strokeCaps = lookup("stroke cap", ["butt", "round", "square"]);
export type StrokeCap = Parameters<typeof strokeCaps>[0];

export const strokeJoins = lookup("stroke join", ["miter", "round", "bevel"]);
export type StrokeJoin = Parameters<typeof strokeJoins>[0];

export const tileModes = lookup("tile mode", [
  "clamp",
  "repeat",
  "mirror",
  "decal",
]);
export type TileMode = Parameters<typeof tileModes>[0];

export const fillTypes = lookup("fill type", [
  "winding",
  "evenOdd",
  "inverseWinding",
  "inverseEvenOdd",
]);
export type FillType = Parameters<typeof fillTypes>[0];

export const clipOps = lookup("clip operation", ["difference", "intersect"]);
export type ClipOp = Parameters<typeof clipOps>[0];

export const pathOps = lookup("path operation", [
  "difference",
  "intersect",
  "union",
  "xor",
  "reverseDifference",
]);
export type PathOp = Parameters<typeof pathOps>[0];

export const pointModes = lookup("point mode", ["points", "lines", "polygon"]);
export type PointMode = Parameters<typeof pointModes>[0];

/** How an image is sampled when it is scaled. */
export const samplings = lookup("sampling", [
  "nearest",
  "linear",
  "mipmap",
  "mitchell",
  "catmullRom",
]);
export type Sampling = Parameters<typeof samplings>[0];

export const blurStyles = lookup("blur style", [
  "normal",
  "solid",
  "outer",
  "inner",
]);
export type BlurStyle = Parameters<typeof blurStyles>[0];

export const colorChannels = lookup("color channel", [
  "red",
  "green",
  "blue",
  "alpha",
]);
export type ColorChannel = Parameters<typeof colorChannels>[0];

/** How a path stamped along another follows it. */
export const stampStyles = lookup("stamp style", [
  "translate",
  "rotate",
  "morph",
]);
export type StampStyle = Parameters<typeof stampStyles>[0];

export const fontEdgings = lookup("font edging", [
  "alias",
  "antiAlias",
  "subpixelAntiAlias",
]);
export type FontEdging = Parameters<typeof fontEdgings>[0];

export const textAligns = lookup("text alignment", [
  "left",
  "right",
  "center",
  "justify",
  "start",
  "end",
]);
export type TextAlign = Parameters<typeof textAligns>[0];

export const textDecorationStyles = lookup("decoration style", [
  "solid",
  "double",
  "dotted",
  "dashed",
  "wavy",
]);
export type TextDecorationStyle = Parameters<typeof textDecorationStyles>[0];

export const imageFormats = lookup("image format", ["png", "jpeg", "webp"]);
export type ImageFormat = Parameters<typeof imageFormats>[0];
