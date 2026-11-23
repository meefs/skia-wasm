/// <reference types="@webgpu/types" />

/**
 * The Emscripten module built from src/cpp: the C exports of api.cpp, the
 * views on wasm memory and the WebGPU glue that hands over the page's
 * objects.
 */
export interface WasmModule {
  // Replaced by new arrays when wasm memory grows.
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
  WebGPU: {
    importJsDevice(device: GPUDevice): number;
    importJsTexture(texture: GPUTexture): number;
  };
  _malloc(bytes: number): number;
  _free(pointer: number): void;

  _sk_init(device: number): number;
  _sk_last_error(): number;
  _sk_effect_create(sksl: number): number;
  _sk_effect_describe(handle: number): number;
  _sk_image_decode(bytes: number, length: number): number;
  _sk_image_from_texture(texture: number, opaque: number): number;
  _sk_resource_release(handle: number): void;
  _sk_program_create(
    words: number,
    count: number,
    imports: number,
    importCount: number
  ): number;
  _sk_program_release(program: number): void;
  _sk_instance_create(program: number): number;
  _sk_instance_data(instance: number): number;
  _sk_instance_release(instance: number): void;
  _sk_draw(
    texture: number,
    r: number,
    g: number,
    b: number,
    a: number,
    instances: number,
    count: number
  ): number;
  _sk_draw_one(
    texture: number,
    r: number,
    g: number,
    b: number,
    a: number,
    instance: number
  ): number;
  _sk_tick(): number;
  _sk_stats_enable(enabled: number): void;
  _sk_stats_null_canvas(enabled: number): void;
  _sk_stats(): number;
}

export type ModuleFactory<M extends WasmModule = WasmModule> = () => Promise<M>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Copies a string into wasm memory, NUL-terminated. The caller frees it. */
export const allocateString = (module: WasmModule, text: string) => {
  const bytes = encoder.encode(text);
  const pointer = module._malloc(bytes.length + 1);
  module.HEAPU8.set(bytes, pointer);
  module.HEAPU8[pointer + bytes.length] = 0;
  return pointer;
};

export const readString = (module: WasmModule, pointer: number) => {
  const heap = module.HEAPU8;
  let end = pointer;
  while (heap[end] !== 0) {
    end++;
  }
  // A copy: decode() refuses views on memory that can grow.
  return decoder.decode(heap.slice(pointer, end));
};

export const lastError = (module: WasmModule) =>
  readString(module, module._sk_last_error());
