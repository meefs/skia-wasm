import { imageShader, Shader } from "./effects";
import type { ImageShaderOptions } from "./effects";
import { lastError } from "./module";
import type { WasmModule } from "./module";
import { disposeSymbol, ref } from "./native";
import type { Matrix, Runtime } from "./native";
import { imageFormats } from "./enums";
import type { ImageFormat } from "./enums";

/** What a uniform holds: a number, a vector, or anything else as floats. */
export type UniformKind = "f32" | "i32" | "vec2" | "vec3" | "vec4" | "floats";

/** A uniform of an effect: where it is in the uniform block, in words. */
export interface UniformInfo {
  readonly offset: number;
  readonly size: number;
  readonly kind: UniformKind;
  /** The SkSL type: "float", "float4", "int", "float3x3"... */
  readonly type: string;
  readonly count: number;
}

/** The kind of each uniform, for effects whose uniforms are typed by hand. */
export type UniformKinds = Record<string, UniformKind>;

/** A value per uniform: a number, or the numbers of a vector, matrix or array. */
export type UniformValues<U> = {
  [K in keyof U]?: number | readonly number[];
};

/**
 * A context resource: an immutable Skia object that the module keeps in a
 * table and that calls refer to by number. A handle is one reference: what
 * was made from the resource, a shader for instance, holds its own, so
 * `dispose()` is safe as soon as the handle is no longer needed. Nothing
 * else frees it: the garbage collector does not.
 */
export abstract class Resource {
  private live = true;

  constructor(
    protected readonly module: WasmModule,
    /** The number that refers to this resource in a call into wasm. */
    readonly handle: number
  ) {}

  release() {
    if (this.live) {
      this.live = false;
      this.module._sk_resource_release(this.handle);
    }
  }

  /** Frees the resource: the same as release(). */
  dispose() {
    this.release();
  }

  [disposeSymbol]() {
    this.release();
  }
}

/** A compiled runtime effect. */
export class Effect<U extends UniformKinds = UniformKinds> extends Resource {
  constructor(
    private readonly runtime: Runtime,
    handle: number,
    /** Size of the uniform block in words. */
    readonly size: number,
    readonly uniforms: { readonly [K in keyof U]: UniformInfo },
    /** The names of the shaders it samples, in the order it declares them. */
    readonly children: readonly string[]
  ) {
    super(runtime.module, handle);
  }

  /**
   * A shader with these values for the uniforms, zero for those left out,
   * and a shader for each child of the effect.
   */
  shader(
    values: UniformValues<U> = {},
    children: Readonly<Record<string, Shader>> = {},
    matrix?: Matrix
  ) {
    const { module, scratch } = this.runtime;
    scratch.reset();
    const block = scratch.alloc(this.size * 4);
    module.HEAPU32.fill(0, block >> 2, (block >> 2) + this.size);
    for (const [name, info] of Object.entries<UniformInfo>(this.uniforms)) {
      const value = values[name];
      if (value === undefined) {
        continue;
      }
      const heap = info.type.startsWith("int")
        ? module.HEAPU32
        : module.HEAPF32;
      const at = (block >> 2) + info.offset;
      if (typeof value === "number") {
        heap[at] = value;
      } else if (value.length > info.size) {
        throw new RangeError(`Too many values for the uniform ${name}.`);
      } else {
        heap.set(value, at);
      }
    }
    const pointers = this.children.map((name) => {
      const child = children[name];
      if (child === undefined) {
        throw new Error(`The effect needs a shader for its child ${name}.`);
      }
      return ref(child);
    });
    const shader = module._sk_effect_make_shader(
      this.handle,
      block,
      scratch.uint32s(pointers),
      pointers.length,
      scratch.matrix(matrix)
    );
    return new Shader(this.runtime, shader);
  }
}

/** A GPU image: decoded and uploaded, or wrapping a texture of the page. */
export class Image extends Resource {
  readonly width: number;
  readonly height: number;

  constructor(
    private readonly runtime: Runtime,
    handle: number
  ) {
    super(runtime.module, handle);
    const { module } = runtime;
    const at = module._sk_image_size(handle) >> 2;
    this.width = module.HEAPF32[at];
    this.height = module.HEAPF32[at + 1];
  }

  /** The image as a shader: tiled, sampled and transformed as asked. */
  shader(options?: ImageShaderOptions) {
    return imageShader(this.runtime, this.handle, options);
  }

  /**
   * Its pixels: RGBA, unpremultiplied, row by row. The GPU answers later,
   * hence the promise.
   */
  async readPixels() {
    const { module } = this.runtime;
    const request = module._sk_image_read_pixels(this.handle);
    if (request === 0) {
      throw new Error(lastError(module));
    }
    try {
      for (;;) {
        // The answer arrives through the event loop of the browser.
        await new Promise((resolve) => setTimeout(resolve, 0));
        module._sk_tick();
        const status = module._sk_readback_status(request);
        if (status === 2) {
          throw new Error("The pixels of the image could not be read.");
        }
        if (status === 1) {
          const pixels = module._sk_readback_pixels(request);
          return module.HEAPU8.slice(
            pixels,
            pixels + this.width * this.height * 4
          );
        }
      }
    } finally {
      module._sk_readback_free(request);
    }
  }

  /** The image as a PNG, JPEG or WebP file. Quality is from 0 to 100. */
  async encode(format: ImageFormat = "png", quality = 90) {
    const code = imageFormats(format);
    const { module } = this.runtime;
    const pixels = await this.readPixels();
    const pointer = module._malloc(pixels.length);
    module.HEAPU8.set(pixels, pointer);
    const data = module._sk_encode(
      pointer,
      this.width,
      this.height,
      code,
      quality
    );
    module._free(pointer);
    if (data === 0) {
      throw new Error(lastError(module));
    }
    const bytes = module._sk_data_bytes(data);
    const file = module.HEAPU8.slice(bytes, bytes + module._sk_data_size(data));
    module._sk_data_unref(data);
    return file;
  }
}
