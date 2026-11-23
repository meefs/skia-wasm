/// <reference types="@webgpu/types" />
import { Builder } from "./builder";
import { Canvas } from "./canvas";
import type { ColorInput } from "./color";
import {
  colorFilters,
  imageFilters,
  maskFilters,
  pathEffects,
  shaders,
} from "./effects";
import type {
  ConicalGradientOptions,
  LinearGradientOptions,
  NoiseOptions,
  RadialGradientOptions,
  Shader,
  SweepGradientOptions,
} from "./effects";
import type { BlendModeName } from "./enums";
import { allocateString, lastError, readString } from "./module";
import type { ModuleFactory, WasmModule } from "./module";
import { NativeObject, ref, Scratch } from "./native";
import type { Runtime } from "./native";
import { Paint } from "./paint";
import type { PaintOptions } from "./paint";
import { Path, pathFromSVG } from "./path";
import { PictureRecorder } from "./picture";
import type { Instance } from "./program";
import { Effect, Image } from "./resources";
import type { UniformInfo, UniformKinds } from "./resources";
import type { SlotKind } from "./slots";
import { Font, makeParagraph, Typeface } from "./text";
import type { ParagraphStyle, TextSpan } from "./text";

export interface SurfaceOptions {
  /**
   * How many pixels a unit of the drawing takes. A canvas on the page gets
   * what the screen needs if this is left out; an OffscreenCanvas and a
   * texture get 1.
   */
  pixelRatio?: number;
}

export interface InitOptions extends SurfaceOptions {
  device: GPUDevice;
  /** What `sk.surface` draws to. */
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  /**
   * The Emscripten module built from src/cpp: its URL or its factory.
   * Defaults to skia-wasm.js next to this file.
   */
  module?: string | ModuleFactory;
}

const kindOfUniform = (type: string, count: number): SlotKind => {
  if (count > 1) {
    return "floats";
  }
  switch (type) {
    case "float":
      return "f32";
    case "float2":
      return "vec2";
    case "float3":
      return "vec3";
    case "float4":
      return "vec4";
    case "int":
      return "i32";
    default:
      // Matrices are column-major in SkSL: not the "mat3" of concat().
      return "floats";
  }
};

/**
 * Where drawing ends up: a canvas of the page, whose current texture changes
 * every frame, or one texture.
 *
 * Immediate mode: `getCanvas()`, draw, `flush()`. Retained mode:
 * `draw(scene)`.
 *
 * A surface has a size, in the units of the drawing, and a density: how many
 * pixels each unit takes. Drawing is in units; the density is applied under
 * it, so that the same code is sharp on any screen.
 */
export class Surface {
  private red = 0;
  private green = 0;
  private blue = 0;
  private alpha = 0;
  // Pointers of the instances of draw(scenes), in wasm memory.
  private scratch = 0;
  private capacity = 0;
  // The frame that getCanvas() began, until flush().
  private frame = 0;
  private readonly canvas: Canvas;
  private readonly module: WasmModule;

  constructor(
    runtime: Runtime,
    private readonly target: GPUCanvasContext | GPUTexture,
    /** Its size, in the units of the drawing. */
    readonly width: number,
    readonly height: number,
    // Pixels per unit, on each axis.
    private readonly densityX = 1,
    private readonly densityY = densityX
  ) {
    this.module = runtime.module;
    this.canvas = new Canvas(runtime);
  }

  /** How many pixels a unit of the drawing takes. */
  get pixelRatio() {
    return this.densityX;
  }

  /**
   * What the surface is cleared to before anything is drawn. Transparent at
   * first.
   */
  setClearColor(r: number, g: number, b: number, a = 1) {
    this.red = r;
    this.green = g;
    this.blue = b;
    this.alpha = a;
  }

  /**
   * Hands this frame's texture over to wasm. Used by getCanvas() and draw();
   * public for code that draws by other means, such as the benchmark
   * baselines.
   */
  acquire() {
    const { target } = this;
    return this.module.WebGPU.importJsTexture(
      "getCurrentTexture" in target ? target.getCurrentTexture() : target
    );
  }

  /**
   * The canvas of the frame being drawn. The first call after a flush()
   * starts a frame, cleared to the clear color; the canvas is valid until
   * the next flush().
   */
  getCanvas() {
    if (this.frame === 0) {
      const { module } = this;
      const frame = module._sk_frame_begin(
        this.acquire(),
        this.red,
        this.green,
        this.blue,
        this.alpha
      );
      if (frame === 0) {
        throw new Error(lastError(module));
      }
      this.frame = frame;
      this.canvas.attach(
        module._sk_frame_canvas(frame),
        this.densityX,
        this.densityY
      );
    }
    return this.canvas;
  }

  /** Sends what was drawn since getCanvas() to the GPU, and ends the frame. */
  flush() {
    const { frame, module } = this;
    if (frame === 0) {
      return;
    }
    this.frame = 0;
    this.canvas.attach(0);
    if (module._sk_frame_end(frame) === 0) {
      throw new Error(lastError(module));
    }
  }

  /**
   * Clears the surface, plays the instances in order and submits: one call
   * into wasm, whatever the number of instances.
   */
  draw(scene: Instance | readonly Instance[]) {
    const { module } = this;
    if (this.frame !== 0) {
      throw new Error("A frame is being drawn: flush() it first.");
    }
    let drawn: number;
    if (Array.isArray(scene)) {
      const scenes: readonly Instance[] = scene;
      const count = scenes.length;
      if (count > this.capacity) {
        module._free(this.scratch);
        this.capacity = Math.max(count, this.capacity * 2, 16);
        this.scratch = module._malloc(this.capacity * 4);
      }
      const heap = module.HEAPU32;
      const base = this.scratch >> 2;
      for (let i = 0; i < count; i++) {
        const { pointer } = scenes[i];
        if (pointer === 0) {
          throw new Error("An instance was disposed.");
        }
        heap[base + i] = pointer;
      }
      // Acquired last: nothing is handed over if an instance is refused, and
      // the allocation it makes can replace the views used above.
      drawn = module._sk_draw(
        this.acquire(),
        this.red,
        this.green,
        this.blue,
        this.alpha,
        this.densityX,
        this.densityY,
        this.scratch,
        count
      );
    } else {
      const { pointer } = scene as Instance;
      if (pointer === 0) {
        throw new Error("The instance was disposed.");
      }
      drawn = module._sk_draw_one(
        this.acquire(),
        this.red,
        this.green,
        this.blue,
        this.alpha,
        this.densityX,
        this.densityY,
        pointer
      );
    }
    if (drawn === 0) {
      throw new Error(lastError(module));
    }
  }
}

/**
 * A surface whose texture Skia owns: for drawing something once and using
 * the result as an image.
 */
export class OffscreenSurface extends NativeObject {
  private readonly canvas: Canvas;

  constructor(
    private readonly runtime: Runtime,
    /** Its size, in the units of the drawing. */
    readonly width: number,
    readonly height: number,
    /** How many pixels a unit of the drawing takes. */
    readonly pixelRatio = 1
  ) {
    const { module } = runtime;
    super(
      module._sk_offscreen_new(
        Math.max(1, Math.round(width * pixelRatio)),
        Math.max(1, Math.round(height * pixelRatio))
      ),
      module._sk_unref,
      "surface"
    );
    this.canvas = new Canvas(runtime);
    // Once: the canvas of this surface keeps its state from flush to flush.
    this.canvas.attach(module._sk_offscreen_canvas(this.pointer), pixelRatio);
  }

  /** Always the same canvas. Nothing clears it: what was drawn stays. */
  getCanvas() {
    ref(this);
    return this.canvas;
  }

  /** Sends what was drawn to the GPU. */
  flush() {
    const { module } = this.runtime;
    if (module._sk_submit() === 0) {
      throw new Error(lastError(module));
    }
  }

  /**
   * What the surface holds now, as an image. An image is measured in pixels:
   * with a pixel ratio, it is that many times the size of the surface.
   */
  snapshot() {
    const { module } = this.runtime;
    const handle = module._sk_offscreen_snapshot(ref(this));
    if (handle === 0) {
      throw new Error(lastError(module));
    }
    return new Image(this.runtime, handle);
  }

  dispose() {
    this.canvas.attach(0);
    super.dispose();
  }
}

/**
 * Skia Graphite on the page's GPUDevice: the context that everything else
 * comes from.
 */
export class Skia {
  private canvasSurface: Surface | null = null;
  private readonly runtime: Runtime;
  private readonly shaders: ReturnType<typeof shaders>;

  /** Color filters: `sk.colorFilter.matrix(...)`. */
  readonly colorFilter: ReturnType<typeof colorFilters>;
  /** Image filters: `sk.imageFilter.blur(8)`. */
  readonly imageFilter: ReturnType<typeof imageFilters>;
  /** Mask filters: `sk.maskFilter.blur(4)`. */
  readonly maskFilter: ReturnType<typeof maskFilters>;
  /** Path effects: `sk.pathEffect.dash([8, 4])`. */
  readonly pathEffect: ReturnType<typeof pathEffects>;

  private constructor(
    /** The Emscripten module, for code that needs its other exports. */
    readonly module: WasmModule,
    readonly device: GPUDevice
  ) {
    this.runtime = { module, scratch: new Scratch(module) };
    this.shaders = shaders(this.runtime);
    this.colorFilter = colorFilters(this.runtime);
    this.imageFilter = imageFilters(this.runtime);
    this.maskFilter = maskFilters(this.runtime);
    this.pathEffect = pathEffects(this.runtime);
  }

  static async init(options: InitOptions) {
    let factory: ModuleFactory;
    if (typeof options.module === "function") {
      factory = options.module;
    } else {
      const url =
        options.module ?? new URL("./skia-wasm.js", import.meta.url).href;
      factory = (await import(/* @vite-ignore */ url)).default;
    }
    const module = await factory();
    if (!module._sk_init(module.WebGPU.importJsDevice(options.device))) {
      throw new Error(lastError(module));
    }
    const skia = new Skia(module, options.device);
    if (options.canvas) {
      skia.canvasSurface = skia.makeSurface(options.canvas, options);
    }
    return skia;
  }

  // ---- Surfaces.

  /** The surface of the canvas given to init(). */
  get surface() {
    if (this.canvasSurface === null) {
      throw new Error("Skia.init() was not given a canvas.");
    }
    return this.canvasSurface;
  }

  /**
   * A surface on a canvas, which it configures, or on a texture.
   *
   * The size of a canvas, its `width` and `height`, is the size of the
   * drawing. A canvas on the page is then given the pixels that the screen
   * needs for the place it takes: twice as many each way on a screen with a
   * device pixel ratio of 2. Pass `pixelRatio: 1` to leave the canvas alone.
   */
  makeSurface(
    target: HTMLCanvasElement | OffscreenCanvas | GPUTexture,
    options: SurfaceOptions = {}
  ) {
    const { pixelRatio } = options;
    if (!("getContext" in target)) {
      // The pixels of a texture are what they are: only the units change.
      const ratio = pixelRatio ?? 1;
      return new Surface(
        this.runtime,
        target,
        target.width / ratio,
        target.height / ratio,
        ratio
      );
    }
    const { width, height } = target;
    let pixelsX = width * (pixelRatio ?? 1);
    let pixelsY = height * (pixelRatio ?? 1);
    if ("clientWidth" in target) {
      const onPageX = target.clientWidth;
      const onPageY = target.clientHeight;
      const shown = onPageX > 0 && onPageY > 0;
      if (pixelRatio === undefined) {
        // What the screen shows of it, whatever CSS made of its size.
        pixelsX = (shown ? onPageX : width) * devicePixelRatio;
        pixelsY = (shown ? onPageY : height) * devicePixelRatio;
      }
      pixelsX = Math.max(1, Math.round(pixelsX));
      pixelsY = Math.max(1, Math.round(pixelsY));
      if (target.width !== pixelsX || target.height !== pixelsY) {
        target.width = pixelsX;
        target.height = pixelsY;
        // A canvas that CSS gives no size takes the one of its pixels: it
        // just grew on the page. It keeps the size it had.
        if (
          !shown ||
          target.clientWidth !== onPageX ||
          target.clientHeight !== onPageY
        ) {
          target.style.width = `${shown ? onPageX : width}px`;
          target.style.height = `${shown ? onPageY : height}px`;
        }
      }
    } else {
      // Not on a page, or in a worker: nothing says what the screen needs.
      target.width = Math.max(1, Math.round(pixelsX));
      target.height = Math.max(1, Math.round(pixelsY));
    }
    const context = target.getContext("webgpu") as GPUCanvasContext | null;
    if (context === null) {
      throw new Error("The canvas has no WebGPU context.");
    }
    context.configure({
      device: this.device,
      format: navigator.gpu.getPreferredCanvasFormat(),
      // Graphite samples its targets for some blends; COPY_SRC lets the page
      // read the canvas back.
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
      alphaMode: "premultiplied",
    });
    return new Surface(
      this.runtime,
      context,
      width,
      height,
      target.width / width,
      target.height / height
    );
  }

  /** A surface that is not shown: draw to it, then take a snapshot. */
  makeOffscreenSurface(
    width: number,
    height: number,
    options: SurfaceOptions = {}
  ) {
    return new OffscreenSurface(
      this.runtime,
      width,
      height,
      options.pixelRatio
    );
  }

  /** Records what is drawn to its canvas into a picture. */
  pictureRecorder() {
    return new PictureRecorder(this.runtime);
  }

  // ---- Immediate mode: what is drawn with.

  paint(options?: PaintOptions) {
    return new Paint(this.module, options);
  }

  /** An empty path, or the path of an SVG path string. */
  path(svg?: string) {
    return svg === undefined
      ? new Path(this.runtime)
      : pathFromSVG(this.runtime, svg);
  }

  linearGradient(options: LinearGradientOptions) {
    return this.shaders.linearGradient(options);
  }

  radialGradient(options: RadialGradientOptions) {
    return this.shaders.radialGradient(options);
  }

  /** A gradient from one circle to another. */
  conicalGradient(options: ConicalGradientOptions) {
    return this.shaders.conicalGradient(options);
  }

  /** A gradient around a center. */
  sweepGradient(options: SweepGradientOptions) {
    return this.shaders.sweepGradient(options);
  }

  /** A shader of one color. */
  colorShader(color: ColorInput) {
    return this.shaders.color(color);
  }

  /** The source shader blended over the destination shader. */
  blendShader(mode: BlendModeName, destination: Shader, source: Shader) {
    return this.shaders.blend(mode, destination, source);
  }

  /** Perlin noise, as smooth clouds. */
  fractalNoise(options: NoiseOptions) {
    return this.shaders.fractalNoise(options);
  }

  /** Perlin noise, as ridges. */
  turbulence(options: NoiseOptions) {
    return this.shaders.turbulence(options);
  }

  // ---- Text.

  /** Loads a font file: TrueType, OpenType, or a collection of them. */
  typeface(bytes: ArrayBuffer | Uint8Array) {
    const { module } = this;
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const pointer = module._malloc(data.length);
    module.HEAPU8.set(data, pointer);
    const typeface = module._sk_typeface_from_data(pointer, data.length);
    module._free(pointer);
    if (typeface === 0) {
      throw new Error(lastError(module));
    }
    return new Typeface(this.runtime, typeface);
  }

  /** A typeface at a size, for drawText() and for measuring. */
  font(typeface: Typeface | null, size = 12) {
    return new Font(this.runtime, typeface, size);
  }

  /**
   * Makes a typeface available to paragraphs, under a family name or, if
   * none is given, under its own. The first one registered is what text
   * falls back to.
   */
  registerFont(typeface: Typeface, family?: string) {
    const { module } = this;
    const { scratch } = this.runtime;
    scratch.reset();
    module._sk_fonts_register(
      ref(typeface),
      family === undefined ? 0 : scratch.text(family)
    );
  }

  /**
   * Text to lay out in lines: one text, or spans with styles of their own
   * over the style of the whole.
   */
  paragraph(spans: TextSpan | readonly TextSpan[], style?: ParagraphStyle) {
    return makeParagraph(this.runtime, spans, style);
  }

  // ---- Resources, shared by both modes.

  /**
   * Compiles a runtime shader, or returns the one already compiled from the
   * same source. `U` names the kind of each uniform for the type checker;
   * the layout itself comes from the compiled effect.
   */
  effect<U extends UniformKinds = UniformKinds>(sksl: string): Effect<U> {
    const { module } = this;
    const source = allocateString(module, sksl);
    const handle = module._sk_effect_create(source);
    module._free(source);
    if (handle === 0) {
      throw new Error(`The effect did not compile: ${lastError(module)}`);
    }
    const description = JSON.parse(
      readString(module, module._sk_effect_describe(handle))
    ) as {
      size: number;
      uniforms: {
        name: string;
        type: string;
        offset: number;
        count: number;
        size: number;
      }[];
      children: string[];
    };
    const uniforms: Record<string, UniformInfo> = {};
    for (const uniform of description.uniforms) {
      uniforms[uniform.name] = {
        offset: uniform.offset / 4,
        size: uniform.size / 4,
        kind: kindOfUniform(uniform.type, uniform.count),
        type: uniform.type,
        count: uniform.count,
      };
    }
    return new Effect<U>(
      this.runtime,
      handle,
      description.size / 4,
      uniforms as { readonly [K in keyof U]: UniformInfo },
      description.children
    );
  }

  /** Decodes an encoded image (PNG, JPEG, WebP) and uploads it to the GPU. */
  async image(encoded: ArrayBuffer | Uint8Array) {
    const { module } = this;
    const bytes =
      encoded instanceof Uint8Array ? encoded : new Uint8Array(encoded);
    const pointer = module._malloc(bytes.length);
    module.HEAPU8.set(bytes, pointer);
    const handle = module._sk_image_decode(pointer, bytes.length);
    module._free(pointer);
    if (handle === 0) {
      throw new Error(lastError(module));
    }
    return new Image(this.runtime, handle);
  }

  /**
   * Wraps a texture of the page as an image, without a copy. The texture
   * needs the TEXTURE_BINDING usage, and premultiplied alpha unless opaque.
   */
  texture(texture: GPUTexture, { opaque = false } = {}) {
    const { module } = this;
    const handle = module._sk_image_from_texture(
      module.WebGPU.importJsTexture(texture),
      opaque ? 1 : 0
    );
    if (handle === 0) {
      throw new Error(lastError(module));
    }
    return new Image(this.runtime, handle);
  }

  // ---- Retained mode.

  /** Starts recording a program. */
  builder() {
    return new Builder(this.module);
  }

  /**
   * Lets Graphite notice finished GPU work. Drawing does it too; this is for
   * a page that stopped drawing. Returns whether some work is pending.
   */
  tick() {
    return this.module._sk_tick() !== 0;
  }
}
