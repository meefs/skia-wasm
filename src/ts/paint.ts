import { cachedColor } from "./color";
import type { Color, ColorInput } from "./color";
import { blendModes, paintStyles, strokeCaps, strokeJoins } from "./enums";
import type {
  BlendModeName,
  PaintStyleName,
  StrokeCap,
  StrokeJoin,
} from "./enums";
import type {
  ColorFilter,
  ImageFilter,
  MaskFilter,
  PathEffect,
  Shader,
} from "./effects";
import type { WasmModule } from "./module";
import { NativeObject, refOrNull } from "./native";

export interface PaintOptions {
  color?: ColorInput;
  /** Multiplies the alpha of the color. */
  alpha?: number;
  style?: PaintStyleName;
  strokeWidth?: number;
  strokeCap?: StrokeCap;
  strokeJoin?: StrokeJoin;
  strokeMiter?: number;
  blendMode?: BlendModeName;
  antiAlias?: boolean;
  dither?: boolean;
  shader?: Shader | null;
  colorFilter?: ColorFilter | null;
  imageFilter?: ImageFilter | null;
  maskFilter?: MaskFilter | null;
  pathEffect?: PathEffect | null;
}

/**
 * How something is drawn: its color or shader, whether it is filled or
 * stroked, how it blends, and the filters it goes through. Opaque black,
 * filled and antialiased at first.
 */
export class Paint extends NativeObject {
  private readonly rgba: [number, number, number, number] = [0, 0, 0, 1];
  private styleName: PaintStyleName = "fill";
  private width = 0;
  private cap: StrokeCap = "butt";
  private join: StrokeJoin = "miter";
  private miter = 4;
  private blend: BlendModeName = "srcOver";
  private aa = true;
  private dithered = false;
  private shaderObject: Shader | null = null;
  private colorFilterObject: ColorFilter | null = null;
  private imageFilterObject: ImageFilter | null = null;
  private maskFilterObject: MaskFilter | null = null;
  private pathEffectObject: PathEffect | null = null;

  /** Made by `sk.paint()`. */
  constructor(
    private readonly module: WasmModule,
    options?: PaintOptions,
    pointer = module._sk_paint_new()
  ) {
    super(pointer, module._sk_paint_delete, "paint");
    if (options) {
      this.set(options);
    }
  }

  /** Sets several properties at once. */
  set(options: PaintOptions) {
    const { alpha, ...others } = options;
    const self = this as unknown as Record<string, unknown>;
    for (const [name, value] of Object.entries(others)) {
      if (value !== undefined) {
        self[name] = value;
      }
    }
    // After the color, which carries an alpha of its own.
    if (alpha !== undefined) {
      this.alpha = alpha;
    }
    return this;
  }

  get color(): Color {
    return this.rgba;
  }
  set color(color: ColorInput) {
    const { rgba } = this;
    const [r, g, b, a = 1] =
      typeof color === "string" ? cachedColor(color) : color;
    rgba[0] = r;
    rgba[1] = g;
    rgba[2] = b;
    rgba[3] = a;
    this.module._sk_paint_set_color(this.pointer, r, g, b, a);
  }

  /** The alpha of the color. */
  get alpha() {
    return this.rgba[3];
  }
  set alpha(alpha: number) {
    this.rgba[3] = alpha;
    this.module._sk_paint_set_alpha(this.pointer, alpha);
  }

  get style() {
    return this.styleName;
  }
  set style(style: PaintStyleName) {
    this.styleName = style;
    this.module._sk_paint_set_style(this.pointer, paintStyles(style));
  }

  /** Zero is a hairline: one pixel wide whatever the transform. */
  get strokeWidth() {
    return this.width;
  }
  set strokeWidth(width: number) {
    this.width = width;
    this.module._sk_paint_set_stroke_width(this.pointer, width);
  }

  get strokeCap() {
    return this.cap;
  }
  set strokeCap(cap: StrokeCap) {
    this.cap = cap;
    this.module._sk_paint_set_stroke_cap(this.pointer, strokeCaps(cap));
  }

  get strokeJoin() {
    return this.join;
  }
  set strokeJoin(join: StrokeJoin) {
    this.join = join;
    this.module._sk_paint_set_stroke_join(this.pointer, strokeJoins(join));
  }

  /** How far a miter join may extend, in stroke widths. */
  get strokeMiter() {
    return this.miter;
  }
  set strokeMiter(limit: number) {
    this.miter = limit;
    this.module._sk_paint_set_stroke_miter(this.pointer, limit);
  }

  get blendMode() {
    return this.blend;
  }
  set blendMode(mode: BlendModeName) {
    this.blend = mode;
    this.module._sk_paint_set_blend_mode(this.pointer, blendModes(mode));
  }

  get antiAlias() {
    return this.aa;
  }
  set antiAlias(antiAlias: boolean) {
    this.aa = antiAlias;
    this.module._sk_paint_set_anti_alias(this.pointer, antiAlias ? 1 : 0);
  }

  get dither() {
    return this.dithered;
  }
  set dither(dither: boolean) {
    this.dithered = dither;
    this.module._sk_paint_set_dither(this.pointer, dither ? 1 : 0);
  }

  /** Replaces the color, which then only gives its alpha. */
  get shader() {
    return this.shaderObject;
  }
  set shader(shader: Shader | null) {
    this.shaderObject = shader;
    this.module._sk_paint_set_shader(this.pointer, refOrNull(shader));
  }

  get colorFilter() {
    return this.colorFilterObject;
  }
  set colorFilter(filter: ColorFilter | null) {
    this.colorFilterObject = filter;
    this.module._sk_paint_set_color_filter(this.pointer, refOrNull(filter));
  }

  get imageFilter() {
    return this.imageFilterObject;
  }
  set imageFilter(filter: ImageFilter | null) {
    this.imageFilterObject = filter;
    this.module._sk_paint_set_image_filter(this.pointer, refOrNull(filter));
  }

  get maskFilter() {
    return this.maskFilterObject;
  }
  set maskFilter(filter: MaskFilter | null) {
    this.maskFilterObject = filter;
    this.module._sk_paint_set_mask_filter(this.pointer, refOrNull(filter));
  }

  get pathEffect() {
    return this.pathEffectObject;
  }
  set pathEffect(effect: PathEffect | null) {
    this.pathEffectObject = effect;
    this.module._sk_paint_set_path_effect(this.pointer, refOrNull(effect));
  }

  /** A paint with the same properties. */
  copy() {
    const copy = new Paint(
      this.module,
      undefined,
      this.module._sk_paint_copy(this.pointer)
    );
    copy.rgba.splice(0, 4, ...this.rgba);
    copy.styleName = this.styleName;
    copy.width = this.width;
    copy.cap = this.cap;
    copy.join = this.join;
    copy.miter = this.miter;
    copy.blend = this.blend;
    copy.aa = this.aa;
    copy.dithered = this.dithered;
    copy.shaderObject = this.shaderObject;
    copy.colorFilterObject = this.colorFilterObject;
    copy.imageFilterObject = this.imageFilterObject;
    copy.maskFilterObject = this.maskFilterObject;
    copy.pathEffectObject = this.pathEffectObject;
    return copy;
  }
}
