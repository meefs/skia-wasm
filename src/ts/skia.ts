/// <reference types="@webgpu/types" />
import { Builder } from "./builder";
import { allocateString, lastError, readString } from "./module";
import type { ModuleFactory, WasmModule } from "./module";
import type { Instance } from "./program";
import { Effect, Image } from "./resources";
import type { UniformInfo, UniformKinds } from "./resources";
import type { SlotKind } from "./slots";

export interface InitOptions {
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
 * Where instances are drawn: a canvas, whose current texture changes every
 * frame, or one texture.
 */
export class Surface {
  private red = 0;
  private green = 0;
  private blue = 0;
  private alpha = 0;
  // Pointers of the instances of draw(scenes), in wasm memory.
  private scratch = 0;
  private capacity = 0;

  constructor(
    private readonly module: WasmModule,
    private readonly target: GPUCanvasContext | GPUTexture
  ) {}

  /** What the surface is cleared to before each draw. Transparent at first. */
  setClearColor(r: number, g: number, b: number, a = 1) {
    this.red = r;
    this.green = g;
    this.blue = b;
    this.alpha = a;
  }

  /**
   * Hands this frame's texture over to wasm. Used by draw(); public for code
   * that draws by other means, such as the benchmark baselines.
   */
  acquire() {
    const { target } = this;
    return this.module.WebGPU.importJsTexture(
      "getCurrentTexture" in target ? target.getCurrentTexture() : target
    );
  }

  /**
   * Clears the surface, plays the instances in order and submits: one call
   * into wasm, whatever the number of instances.
   */
  draw(scene: Instance | readonly Instance[]) {
    const { module } = this;
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
        pointer
      );
    }
    if (drawn === 0) {
      throw new Error(lastError(module));
    }
  }
}

/**
 * Skia Graphite on the page's GPUDevice: the context that resources,
 * programs and surfaces belong to.
 */
export class Skia {
  private canvasSurface: Surface | null = null;

  private constructor(
    /** The Emscripten module, for code that needs its other exports. */
    readonly module: WasmModule,
    readonly device: GPUDevice
  ) {}

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
      skia.canvasSurface = skia.makeSurface(options.canvas);
    }
    return skia;
  }

  /** The surface of the canvas given to init(). */
  get surface() {
    if (this.canvasSurface === null) {
      throw new Error("Skia.init() was not given a canvas.");
    }
    return this.canvasSurface;
  }

  /** A surface on a canvas, which it configures, or on a texture. */
  makeSurface(target: HTMLCanvasElement | OffscreenCanvas | GPUTexture) {
    if (!("getContext" in target)) {
      return new Surface(this.module, target);
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
    return new Surface(this.module, context);
  }

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
      module,
      handle,
      description.size / 4,
      uniforms as { readonly [K in keyof U]: UniformInfo }
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
    return new Image(module, handle);
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
    return new Image(module, handle);
  }

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
