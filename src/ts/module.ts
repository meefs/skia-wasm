/// <reference types="@webgpu/types" preserve="true" />
import type { Exports } from "./exports";

/**
 * The Emscripten module built from src/cpp: its C exports, the views on wasm
 * memory and the WebGPU glue that hands over the page's objects.
 */
export interface WasmModule extends Exports {
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
