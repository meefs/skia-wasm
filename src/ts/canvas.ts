import { cachedColor } from "./color";
import type { ColorInput } from "./color";
import type { ImageFilter } from "./effects";
import { blendModes, clipOps, pointModes, samplings } from "./enums";
import type { BlendModeName, ClipOp, PointMode, Sampling } from "./enums";
import { ref, refOrNull } from "./native";
import type { Runtime } from "./native";
import type { Paint } from "./paint";
import { writeRadii } from "./path";
import type { CornerRadii, Path, Radius } from "./path";
import type { Picture } from "./picture";
import type { Image } from "./resources";
import type { Font, Paragraph, TextBlob } from "./text";

export interface SaveLayerOptions {
  /** Applied to the layer when it is drawn back: its alpha, blend mode, filters. */
  paint?: Paint | null;
  /** A hint of what the layer covers: x, y, width and height. */
  bounds?: readonly [number, number, number, number];
  /** Filters what is behind the layer into it: a backdrop blur, for instance. */
  backdrop?: ImageFilter | null;
}

export interface DrawImageOptions {
  /** "linear" if left out. */
  sampling?: Sampling;
  /** For its alpha, blend mode and filters. */
  paint?: Paint | null;
}

/**
 * Where drawing happens. Positions, sizes and radii are plain numbers; angles
 * are in radians.
 *
 * A canvas comes from a surface or from a picture recorder, and is only valid
 * until that surface is flushed or that recording is finished.
 */
export class Canvas {
  /** Its address. Zero when there is nothing to draw to. */
  pointer = 0;
  // The density of what it draws to: pixels per unit of the drawing. It is
  // a scale under every transform, which setMatrix() does not replace.
  private densityX = 1;
  private densityY = 1;

  constructor(private readonly runtime: Runtime) {}

  /**
   * Called by what owns the canvas when it becomes valid, with the density
   * of its surface.
   */
  attach(pointer: number, densityX = 1, densityY = densityX) {
    this.pointer = pointer;
    this.densityX = densityX;
    this.densityY = densityY;
    if (pointer !== 0 && (densityX !== 1 || densityY !== 1)) {
      this.runtime.module._sk_canvas_scale(pointer, densityX, densityY);
    }
  }

  private get address() {
    const { pointer } = this;
    if (pointer === 0) {
      throw new Error(
        "This canvas is no longer valid: ask for it again with getCanvas()."
      );
    }
    return pointer;
  }

  // ---- State.

  /** Saves the transform and the clip. Returns the count to restore to. */
  save() {
    return this.runtime.module._sk_canvas_save(this.address);
  }

  /**
   * Saves, and sends what is drawn until restore() to a layer of its own,
   * which is then drawn back as a whole.
   */
  saveLayer(options: SaveLayerOptions = {}) {
    const { module, scratch } = this.runtime;
    scratch.reset();
    return module._sk_canvas_save_layer(
      this.address,
      refOrNull(options.paint),
      scratch.floatsOrNull(options.bounds),
      refOrNull(options.backdrop)
    );
  }

  restore() {
    this.runtime.module._sk_canvas_restore(this.address);
  }

  /** Restores until the count that a save() returned. */
  restoreToCount(count: number) {
    this.runtime.module._sk_canvas_restore_to_count(this.address, count);
  }

  get saveCount() {
    return this.runtime.module._sk_canvas_save_count(this.address);
  }

  translate(dx: number, dy: number) {
    this.runtime.module._sk_canvas_translate(this.address, dx, dy);
  }

  scale(sx: number, sy = sx) {
    this.runtime.module._sk_canvas_scale(this.address, sx, sy);
  }

  /** Rotates by radians around a pivot. */
  rotate(radians: number, px = 0, py = 0) {
    this.runtime.module._sk_canvas_rotate(this.address, radians, px, py);
  }

  skew(sx: number, sy: number) {
    this.runtime.module._sk_canvas_skew(this.address, sx, sy);
  }

  /** Multiplies the transform by a matrix, given row by row. */
  concat(
    scaleX: number,
    skewX: number,
    transX: number,
    skewY: number,
    scaleY: number,
    transY: number,
    persp0 = 0,
    persp1 = 0,
    persp2 = 1
  ) {
    this.runtime.module._sk_canvas_concat(
      this.address,
      scaleX,
      skewX,
      transX,
      skewY,
      scaleY,
      transY,
      persp0,
      persp1,
      persp2
    );
  }

  /** Replaces the transform. The identity if nothing is given. */
  setMatrix(
    scaleX = 1,
    skewX = 0,
    transX = 0,
    skewY = 0,
    scaleY = 1,
    transY = 0,
    persp0 = 0,
    persp1 = 0,
    persp2 = 1
  ) {
    const { densityX, densityY } = this;
    this.runtime.module._sk_canvas_set_matrix(
      this.address,
      densityX * scaleX,
      densityX * skewX,
      densityX * transX,
      densityY * skewY,
      densityY * scaleY,
      densityY * transY,
      persp0,
      persp1,
      persp2
    );
  }

  /** The transform as nine numbers, row by row. */
  getMatrix() {
    const { module } = this.runtime;
    const at = module._sk_canvas_matrix(this.address) >> 2;
    const matrix = Array.from(module.HEAPF32.subarray(at, at + 9));
    // Without the density of the surface, which is not the caller's.
    for (let i = 0; i < 3; i++) {
      matrix[i] /= this.densityX;
      matrix[i + 3] /= this.densityY;
    }
    return matrix;
  }

  clipRect(
    x: number,
    y: number,
    width: number,
    height: number,
    op: ClipOp = "intersect",
    antiAlias = true
  ) {
    this.runtime.module._sk_canvas_clip_rect(
      this.address,
      x,
      y,
      width,
      height,
      clipOps(op),
      antiAlias ? 1 : 0
    );
  }

  clipRoundedRect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: Radius | CornerRadii,
    op: ClipOp = "intersect",
    antiAlias = true
  ) {
    const { module, scratch } = this.runtime;
    scratch.reset();
    module._sk_canvas_clip_rounded_rect(
      this.address,
      x,
      y,
      width,
      height,
      writeRadii(this.runtime, radius),
      clipOps(op),
      antiAlias ? 1 : 0
    );
  }

  clipPath(path: Path, op: ClipOp = "intersect", antiAlias = true) {
    this.runtime.module._sk_canvas_clip_path(
      this.address,
      ref(path),
      clipOps(op),
      antiAlias ? 1 : 0
    );
  }

  // ---- Drawing.

  /** Replaces everything in the clip with a color. Transparent if left out. */
  clear(color: ColorInput = "transparent") {
    const rgba = typeof color === "string" ? cachedColor(color) : color;
    this.runtime.module._sk_canvas_clear(
      this.address,
      rgba[0],
      rgba[1],
      rgba[2],
      rgba[3] ?? 1
    );
  }

  /** Fills the clip with a color, blended over what is there. */
  drawColor(color: ColorInput, blendMode: BlendModeName = "srcOver") {
    const rgba = typeof color === "string" ? cachedColor(color) : color;
    this.runtime.module._sk_canvas_draw_color(
      this.address,
      rgba[0],
      rgba[1],
      rgba[2],
      rgba[3] ?? 1,
      blendModes(blendMode)
    );
  }

  /** Fills the clip with a paint. */
  drawPaint(paint: Paint) {
    this.runtime.module._sk_canvas_draw_paint(this.address, ref(paint));
  }

  drawRect(x: number, y: number, width: number, height: number, paint: Paint) {
    this.runtime.module._sk_canvas_draw_rect(
      this.address,
      x,
      y,
      width,
      height,
      ref(paint)
    );
  }

  /** One radius for every corner, or an object with one per corner. */
  drawRoundedRect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: Radius | CornerRadii,
    paint: Paint
  ) {
    const { module, scratch } = this.runtime;
    if (typeof radius === "number") {
      module._sk_canvas_draw_rounded_rect(
        this.address,
        x,
        y,
        width,
        height,
        radius,
        radius,
        ref(paint)
      );
      return;
    }
    scratch.reset();
    module._sk_canvas_draw_rounded_rect_corners(
      this.address,
      x,
      y,
      width,
      height,
      writeRadii(this.runtime, radius),
      ref(paint)
    );
  }

  drawCircle(cx: number, cy: number, radius: number, paint: Paint) {
    this.runtime.module._sk_canvas_draw_circle(
      this.address,
      cx,
      cy,
      radius,
      ref(paint)
    );
  }

  /** The oval inscribed in a rect. */
  drawOval(x: number, y: number, width: number, height: number, paint: Paint) {
    this.runtime.module._sk_canvas_draw_oval(
      this.address,
      x,
      y,
      width,
      height,
      ref(paint)
    );
  }

  /**
   * An arc of the oval inscribed in a rect, clockwise from the positive x
   * axis. With `useCenter`, a wedge: the arc closed through the center.
   */
  drawArc(
    x: number,
    y: number,
    width: number,
    height: number,
    startAngle: number,
    sweepAngle: number,
    useCenter: boolean,
    paint: Paint
  ) {
    this.runtime.module._sk_canvas_draw_arc(
      this.address,
      x,
      y,
      width,
      height,
      startAngle,
      sweepAngle,
      useCenter ? 1 : 0,
      ref(paint)
    );
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, paint: Paint) {
    this.runtime.module._sk_canvas_draw_line(
      this.address,
      x0,
      y0,
      x1,
      y1,
      ref(paint)
    );
  }

  /**
   * Points given as x, y pairs: each one on its own, as pairs that make
   * lines, or as one polygon.
   */
  drawPoints(mode: PointMode, points: ArrayLike<number>, paint: Paint) {
    const { module, scratch } = this.runtime;
    scratch.reset();
    module._sk_canvas_draw_points(
      this.address,
      pointModes(mode),
      scratch.floats(points),
      points.length >> 1,
      ref(paint)
    );
  }

  drawPath(path: Path, paint: Paint) {
    this.runtime.module._sk_canvas_draw_path(
      this.address,
      ref(path),
      ref(paint)
    );
  }

  /** At its own size, unless a width and a height are given. */
  drawImage(
    image: Image,
    x: number,
    y: number,
    width = image.width,
    height = image.height,
    options?: DrawImageOptions
  ) {
    this.runtime.module._sk_canvas_draw_image(
      this.address,
      image.handle,
      x,
      y,
      width,
      height,
      samplings(options?.sampling ?? "linear"),
      refOrNull(options?.paint)
    );
  }

  /** A part of an image, the source rect, into a destination rect. */
  drawImageRect(
    image: Image,
    sourceX: number,
    sourceY: number,
    sourceWidth: number,
    sourceHeight: number,
    x: number,
    y: number,
    width: number,
    height: number,
    options?: DrawImageOptions
  ) {
    this.runtime.module._sk_canvas_draw_image_rect(
      this.address,
      image.handle,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      x,
      y,
      width,
      height,
      samplings(options?.sampling ?? "linear"),
      refOrNull(options?.paint)
    );
  }

  /** One line of text, on a baseline that starts at (x, y). */
  drawText(text: string, x: number, y: number, font: Font, paint: Paint) {
    const { module, scratch } = this.runtime;
    scratch.reset();
    const pointer = scratch.text(text);
    module._sk_canvas_draw_text(
      this.address,
      pointer,
      scratch.length,
      x,
      y,
      ref(font),
      ref(paint)
    );
  }

  drawTextBlob(blob: TextBlob, x: number, y: number, paint: Paint) {
    this.runtime.module._sk_canvas_draw_text_blob(
      this.address,
      ref(blob),
      x,
      y,
      ref(paint)
    );
  }

  /** Glyphs at positions given as x, y pairs, relative to (x, y). */
  drawGlyphs(
    glyphs: ArrayLike<number>,
    positions: ArrayLike<number>,
    x: number,
    y: number,
    font: Font,
    paint: Paint
  ) {
    if (positions.length !== glyphs.length * 2) {
      throw new RangeError("One x, y pair per glyph.");
    }
    const { module, scratch } = this.runtime;
    scratch.reset();
    module._sk_canvas_draw_glyphs(
      this.address,
      scratch.uint16s(glyphs),
      scratch.floats(positions),
      glyphs.length,
      x,
      y,
      ref(font),
      ref(paint)
    );
  }

  /** A paragraph that was laid out, with its top left corner at (x, y). */
  drawParagraph(paragraph: Paragraph, x: number, y: number) {
    this.runtime.module._sk_paragraph_paint(ref(paragraph), this.address, x, y);
  }

  /** A paint, if given, applies its alpha, blend mode and filters. */
  drawPicture(picture: Picture, paint?: Paint | null) {
    this.runtime.module._sk_canvas_draw_picture(
      this.address,
      ref(picture),
      refOrNull(paint)
    );
  }
}
