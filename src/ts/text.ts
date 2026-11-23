/**
 * Text. There are no system fonts in this build: a typeface comes from the
 * bytes of a font file.
 */
import type { Canvas } from "./canvas";
import { cachedColor } from "./color";
import type { ColorInput } from "./color";
import { fontEdgings, lookup, textAligns, textDecorationStyles } from "./enums";
import type { FontEdging, TextAlign, TextDecorationStyle } from "./enums";
import { NativeObject, readText, ref, refOrNull } from "./native";
import type { Runtime } from "./native";
import type { Paint } from "./paint";
import type { Bounds } from "./path";

/** A font file, loaded. */
export class Typeface extends NativeObject {
  private family: string | undefined;

  constructor(
    private readonly runtime: Runtime,
    pointer: number
  ) {
    super(pointer, runtime.module._sk_unref, "typeface");
  }

  /** The family name that the font file gives. */
  get familyName() {
    if (this.family === undefined) {
      const { module } = this.runtime;
      this.family = readText(module, module._sk_typeface_family(ref(this)));
    }
    return this.family;
  }
}

/** Distances from the baseline: negative above it, positive below. */
export interface FontMetrics {
  /** Recommended distance above the baseline. Negative. */
  ascent: number;
  /** Recommended distance below the baseline. */
  descent: number;
  /** Recommended space between lines. */
  leading: number;
  /** Farthest any glyph goes above the baseline. Negative. */
  top: number;
  /** Farthest any glyph goes below the baseline. */
  bottom: number;
  xHeight: number;
  capHeight: number;
  averageCharacterWidth: number;
  maximumCharacterWidth: number;
  underlinePosition: number;
  underlineThickness: number;
  strikeoutPosition: number;
  strikeoutThickness: number;
  /** Recommended distance between baselines: descent - ascent + leading. */
  lineSpacing: number;
}

export interface TextMeasure {
  /** How far the text advances: where what follows would start. */
  width: number;
  /** The box around its glyphs, relative to where the text starts. */
  bounds: Bounds;
}

/** A typeface at a size, and how its glyphs are drawn. */
export class Font extends NativeObject {
  private face: Typeface | null;
  private points: number;
  private stretch = 1;
  private slant = 0;
  private bold = false;
  private subpixelPositions = true;
  private edge: FontEdging = "antiAlias";

  /** Made by `sk.font()`. */
  constructor(
    private readonly runtime: Runtime,
    typeface: Typeface | null,
    size: number
  ) {
    super(
      runtime.module._sk_font_new(refOrNull(typeface), size),
      runtime.module._sk_font_delete,
      "font"
    );
    this.face = typeface;
    this.points = size;
  }

  get typeface() {
    return this.face;
  }
  set typeface(typeface: Typeface | null) {
    this.face = typeface;
    this.runtime.module._sk_font_set_typeface(ref(this), refOrNull(typeface));
  }

  get size() {
    return this.points;
  }
  set size(size: number) {
    this.points = size;
    this.runtime.module._sk_font_set_size(ref(this), size);
  }

  /** Stretches glyphs horizontally. 1 at first. */
  get scaleX() {
    return this.stretch;
  }
  set scaleX(scale: number) {
    this.stretch = scale;
    this.runtime.module._sk_font_set_scale_x(ref(this), scale);
  }

  /** Slants glyphs: -0.25 looks italic. 0 at first. */
  get skewX() {
    return this.slant;
  }
  set skewX(skew: number) {
    this.slant = skew;
    this.runtime.module._sk_font_set_skew_x(ref(this), skew);
  }

  /** Thickens glyphs, for a typeface that has no bold. */
  get embolden() {
    return this.bold;
  }
  set embolden(embolden: boolean) {
    this.bold = embolden;
    this.runtime.module._sk_font_set_embolden(ref(this), embolden ? 1 : 0);
  }

  /** Places glyphs between pixels. On at first. */
  get subpixel() {
    return this.subpixelPositions;
  }
  set subpixel(subpixel: boolean) {
    this.subpixelPositions = subpixel;
    this.runtime.module._sk_font_set_subpixel(ref(this), subpixel ? 1 : 0);
  }

  get edging() {
    return this.edge;
  }
  set edging(edging: FontEdging) {
    this.edge = edging;
    this.runtime.module._sk_font_set_edging(ref(this), fontEdgings(edging));
  }

  get metrics(): FontMetrics {
    const { module } = this.runtime;
    const at = module._sk_font_metrics(ref(this)) >> 2;
    const m = module.HEAPF32;
    return {
      ascent: m[at],
      descent: m[at + 1],
      leading: m[at + 2],
      top: m[at + 3],
      bottom: m[at + 4],
      xHeight: m[at + 5],
      capHeight: m[at + 6],
      averageCharacterWidth: m[at + 7],
      maximumCharacterWidth: m[at + 8],
      underlinePosition: m[at + 9],
      underlineThickness: m[at + 10],
      strikeoutPosition: m[at + 11],
      strikeoutThickness: m[at + 12],
      lineSpacing: m[at + 13],
    };
  }

  /** The width of a text on one line, and the box around its glyphs. */
  measureText(text: string, paint?: Paint | null): TextMeasure {
    const { module, scratch } = this.runtime;
    scratch.reset();
    const pointer = scratch.text(text);
    const at =
      module._sk_font_measure_text(
        ref(this),
        pointer,
        scratch.length,
        refOrNull(paint)
      ) >> 2;
    const m = module.HEAPF32;
    return {
      width: m[at],
      bounds: {
        x: m[at + 1],
        y: m[at + 2],
        width: m[at + 3],
        height: m[at + 4],
      },
    };
  }

  /** The glyph of each character. Zero is a character the font lacks. */
  glyphs(text: string) {
    const { module, scratch } = this.runtime;
    scratch.reset();
    const pointer = scratch.text(text);
    const byteLength = scratch.length;
    // A glyph per byte at most.
    const glyphs = scratch.alloc(byteLength * 2);
    const count = module._sk_font_glyphs(
      ref(this),
      pointer,
      byteLength,
      glyphs,
      byteLength
    );
    return new Uint16Array(module.HEAPU8.buffer, glyphs, count).slice();
  }

  /** How far each glyph advances. */
  glyphWidths(glyphs: ArrayLike<number>) {
    const { module, scratch } = this.runtime;
    scratch.reset();
    const widths = scratch.alloc(glyphs.length * 4);
    module._sk_font_glyph_widths(
      ref(this),
      scratch.uint16s(glyphs),
      glyphs.length,
      widths
    );
    return module.HEAPF32.slice(widths >> 2, (widths >> 2) + glyphs.length);
  }

  /** A text shaped once, to draw many times. */
  textBlob(text: string) {
    const { module, scratch } = this.runtime;
    scratch.reset();
    const pointer = scratch.text(text);
    return new TextBlob(
      this.runtime,
      module._sk_text_blob_from_text(pointer, scratch.length, ref(this))
    );
  }

  /** Glyphs placed one by one: `positions` is an x, y pair per glyph. */
  glyphBlob(glyphs: ArrayLike<number>, positions: ArrayLike<number>) {
    if (positions.length !== glyphs.length * 2) {
      throw new RangeError("One x, y pair per glyph.");
    }
    const { module, scratch } = this.runtime;
    scratch.reset();
    return new TextBlob(
      this.runtime,
      module._sk_text_blob_from_glyphs(
        scratch.uint16s(glyphs),
        scratch.floats(positions),
        glyphs.length,
        ref(this)
      )
    );
  }

  /**
   * Glyphs rotated and scaled one by one, to follow a curve for instance.
   * `transforms` is four numbers per glyph: scale times the cosine of its
   * angle, scale times the sine, then its x and y.
   */
  transformedGlyphBlob(
    glyphs: ArrayLike<number>,
    transforms: ArrayLike<number>
  ) {
    if (transforms.length !== glyphs.length * 4) {
      throw new RangeError("Four numbers per glyph.");
    }
    const { module, scratch } = this.runtime;
    scratch.reset();
    return new TextBlob(
      this.runtime,
      module._sk_text_blob_from_transforms(
        scratch.uint16s(glyphs),
        scratch.floats(transforms),
        glyphs.length,
        ref(this)
      )
    );
  }
}

/** Glyphs and where they go, ready to draw. */
export class TextBlob extends NativeObject {
  constructor(runtime: Runtime, pointer: number) {
    super(pointer, runtime.module._sk_text_blob_unref, "text blob");
  }
}

// ---- Paragraphs.

export type FontWeight =
  | "thin"
  | "light"
  | "normal"
  | "medium"
  | "semiBold"
  | "bold"
  | "black"
  | number;
const weights = new Map<string, number>([
  ["thin", 100],
  ["light", 300],
  ["normal", 400],
  ["medium", 500],
  ["semiBold", 600],
  ["bold", 700],
  ["black", 900],
]);
const weightOf = (weight: FontWeight) => {
  const value = typeof weight === "number" ? weight : weights.get(weight);
  if (value === undefined) {
    throw new TypeError(`Not a font weight: ${weight}.`);
  }
  return value;
};

export type TextDecoration = "underline" | "overline" | "lineThrough";
// A bit each: underline 1, overline 2, lineThrough 4.
const decorations = lookup("text decoration", [
  "underline",
  "overline",
  "lineThrough",
]);

export interface TextShadow {
  color: ColorInput;
  dx: number;
  dy: number;
  /** The sigma of its blur. */
  blur: number;
}

/** How a run of text looks. What is left out comes from the paragraph. */
export interface TextStyle {
  color?: ColorInput;
  /** Draws the text instead of the color: a gradient, a stroke. */
  foreground?: Paint | null;
  /** Family names, the first that is registered wins. */
  fontFamilies?: readonly string[];
  fontSize?: number;
  fontWeight?: FontWeight;
  italic?: boolean;
  letterSpacing?: number;
  wordSpacing?: number;
  /** The height of a line, as a multiple of the font size. */
  lineHeight?: number;
  decoration?: TextDecoration | readonly TextDecoration[];
  decorationStyle?: TextDecorationStyle;
  /** The color of the text if left out. */
  decorationColor?: ColorInput;
  /** A multiple of the thickness the font asks for. */
  decorationThickness?: number;
  backgroundColor?: ColorInput;
  shadow?: TextShadow;
}

export interface ParagraphStyle extends TextStyle {
  align?: TextAlign;
  direction?: "ltr" | "rtl";
  /** Lines past this one are left out. */
  maxLines?: number;
  /** What ends the last line when lines are left out: "…" for instance. */
  ellipsis?: string;
}

/** A piece of a paragraph: a text, or a text with a style of its own. */
export type TextSpan = string | ({ text: string } & TextStyle);

export interface LineMetrics {
  /** Where the line starts and ends in the text. */
  start: number;
  end: number;
  left: number;
  width: number;
  height: number;
  /** The y of its baseline, from the top of the paragraph. */
  baseline: number;
  ascent: number;
  descent: number;
}

// Writes a style as the floats sk_paragraph_builder_new() and _push() read,
// and returns [floats, families, foreground].
const writeStyle = (runtime: Runtime, style: TextStyle) => {
  const { module, scratch } = runtime;
  const pointer = scratch.alloc(30 * 4);
  const s = module.HEAPF32.subarray(pointer >> 2, (pointer >> 2) + 30);
  const rgba = (at: number, color: ColorInput | undefined) => {
    if (color === undefined) {
      s[at + 3] = -1;
      return;
    }
    const [r, g, b, a = 1] =
      typeof color === "string" ? cachedColor(color) : color;
    s[at] = r;
    s[at + 1] = g;
    s[at + 2] = b;
    s[at + 3] = a;
  };
  rgba(0, style.color ?? "black");
  s[4] = style.fontSize ?? 14;
  s[5] = weightOf(style.fontWeight ?? "normal");
  s[6] = 5;
  s[7] = style.italic ? 1 : 0;
  s[8] = style.letterSpacing ?? 0;
  s[9] = style.wordSpacing ?? 0;
  s[10] = style.lineHeight ?? 0;
  const { decoration } = style;
  const list: readonly TextDecoration[] =
    typeof decoration === "string" ? [decoration] : (decoration ?? []);
  s[11] = list.reduce((flags, name) => flags | (1 << decorations(name)), 0);
  s[12] = textDecorationStyles(style.decorationStyle ?? "solid");
  s[13] = style.decorationThickness ?? 1;
  rgba(14, style.decorationColor);
  rgba(18, style.backgroundColor);
  s[22] = 0;
  rgba(23, style.shadow?.color);
  s[27] = style.shadow?.dx ?? 0;
  s[28] = style.shadow?.dy ?? 0;
  s[29] = style.shadow?.blur ?? 0;
  const families = style.fontFamilies?.length
    ? scratch.text(style.fontFamilies.join(","))
    : 0;
  return [pointer, families, refOrNull(style.foreground)] as const;
};

/**
 * Text laid out in lines: wrapped, aligned and styled span by span. Lay it
 * out to a width before drawing it or asking for its size.
 */
export class Paragraph extends NativeObject {
  constructor(
    private readonly runtime: Runtime,
    pointer: number
  ) {
    super(pointer, runtime.module._sk_paragraph_delete, "paragraph");
  }

  /** Breaks the text into lines no wider than this. */
  layout(width: number) {
    this.runtime.module._sk_paragraph_layout(ref(this), width);
    return this;
  }

  private metric(index: number) {
    const { module } = this.runtime;
    return module.HEAPF32[
      (module._sk_paragraph_metrics(ref(this)) >> 2) + index
    ];
  }

  get height() {
    return this.metric(0);
  }

  /** The width of its widest line. */
  get longestLine() {
    return this.metric(1);
  }

  /** The width it was laid out to. */
  get maxWidth() {
    return this.metric(2);
  }

  /** The width under which a word would be cut. */
  get minIntrinsicWidth() {
    return this.metric(3);
  }

  /** The width it would take on one line. */
  get maxIntrinsicWidth() {
    return this.metric(4);
  }

  /** The y of the baseline of the first line. */
  get alphabeticBaseline() {
    return this.metric(5);
  }

  get ideographicBaseline() {
    return this.metric(6);
  }

  /** Whether `maxLines` left lines out. */
  get didExceedMaxLines() {
    return this.metric(7) !== 0;
  }

  get lineCount() {
    return this.metric(8);
  }

  /** The boxes around a range of the text, one per line it spans. */
  rectsForRange(start: number, end: number): Bounds[] {
    const { module } = this.runtime;
    const at = module._sk_paragraph_rects(ref(this), start, end) >> 2;
    const m = module.HEAPF32;
    return Array.from({ length: m[at] }, (_, i) => ({
      x: m[at + 1 + i * 4],
      y: m[at + 2 + i * 4],
      width: m[at + 3 + i * 4],
      height: m[at + 4 + i * 4],
    }));
  }

  /** The index in the text of what is closest to a point. */
  positionAt(x: number, y: number) {
    return this.runtime.module._sk_paragraph_position_at(ref(this), x, y);
  }

  lines(): LineMetrics[] {
    const { module } = this.runtime;
    const at = module._sk_paragraph_lines(ref(this)) >> 2;
    const m = module.HEAPF32;
    return Array.from({ length: m[at] }, (_, i) => {
      const line = at + 1 + i * 8;
      return {
        start: m[line],
        end: m[line + 1],
        left: m[line + 2],
        width: m[line + 3],
        height: m[line + 4],
        baseline: m[line + 5],
        ascent: m[line + 6],
        descent: m[line + 7],
      };
    });
  }

  /** Draws it with its top left corner at (x, y). */
  draw(canvas: Canvas, x: number, y: number) {
    canvas.drawParagraph(this, x, y);
  }
}

/** Builds a paragraph from spans, each styled over the style of the whole. */
export const makeParagraph = (
  runtime: Runtime,
  spans: TextSpan | readonly TextSpan[],
  style: ParagraphStyle = {}
) => {
  const { module, scratch } = runtime;
  scratch.reset();
  const ellipsis =
    style.ellipsis === undefined ? 0 : scratch.text(style.ellipsis);
  const builder = module._sk_paragraph_builder_new(
    textAligns(style.align ?? "start"),
    style.direction === "rtl" ? 1 : 0,
    style.maxLines ?? 0,
    ellipsis,
    ...writeStyle(runtime, style)
  );
  const list: readonly TextSpan[] =
    typeof spans === "string" || !Array.isArray(spans)
      ? [spans as TextSpan]
      : spans;
  for (const span of list) {
    scratch.reset();
    if (typeof span === "string") {
      const text = scratch.text(span);
      module._sk_paragraph_builder_add_text(builder, text, scratch.length);
    } else {
      // The span over the paragraph: what it leaves out is inherited.
      module._sk_paragraph_builder_push(
        builder,
        ...writeStyle(runtime, { ...style, ...span })
      );
      const text = scratch.text(span.text);
      module._sk_paragraph_builder_add_text(builder, text, scratch.length);
      module._sk_paragraph_builder_pop(builder);
    }
  }
  const paragraph = module._sk_paragraph_builder_build(builder);
  module._sk_paragraph_builder_delete(builder);
  return new Paragraph(runtime, paragraph);
};
