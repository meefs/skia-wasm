/**
 * What the wrappers share: the lifetime of an object that lives in wasm memory,
 * and scratch memory to pass arrays and text.
 */
import type { WasmModule } from "./module";

type Release = (pointer: number) => void;

interface Held {
  release: Release;
  pointer: number;
}

// The safety net: an object that was never disposed is freed when it is
// collected.
const registry = new FinalizationRegistry<Held>((held) =>
  held.release(held.pointer)
);

export const disposeSymbol: typeof Symbol.dispose =
  Symbol.dispose ?? (Symbol.for("Symbol.dispose") as typeof Symbol.dispose);

/**
 * An object that lives in wasm memory. `dispose()` frees it now, and a
 * `using` declaration does it at the end of a scope. One that is forgotten is
 * freed when the garbage collector finds it, which may be much later.
 */
export abstract class NativeObject {
  /** Its address. Zero once disposed. */
  pointer: number;
  private readonly release: Release;

  protected constructor(pointer: number, release: Release, kind: string) {
    if (pointer === 0) {
      throw new Error(`Skia did not create the ${kind}.`);
    }
    this.pointer = pointer;
    this.release = release;
    registry.register(this, { release, pointer }, this);
  }

  dispose() {
    if (this.pointer !== 0) {
      registry.unregister(this);
      this.release(this.pointer);
      this.pointer = 0;
    }
  }

  [disposeSymbol]() {
    this.dispose();
  }
}

/** The address of an object, for a call into wasm. */
export const ref = (object: NativeObject) => {
  const { pointer } = object;
  if (pointer === 0) {
    throw new Error(`The ${object.constructor.name} was disposed.`);
  }
  return pointer;
};

/** The same for an object that may be left out: zero is "none". */
export const refOrNull = (object: NativeObject | null | undefined) =>
  object === null || object === undefined ? 0 : ref(object);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Memory for the arguments of one call: arrays and text are copied here and
 * passed as pointers. Everything is valid until the next `reset()`.
 */
export class Scratch {
  private block = 0;
  private size = 0;
  private used = 0;
  private retired: number[] = [];
  /** Byte length of the last text written. */
  length = 0;

  constructor(private readonly module: WasmModule) {}

  reset() {
    this.used = 0;
    if (this.retired.length > 0) {
      this.retired.forEach((block) => this.module._free(block));
      this.retired.length = 0;
    }
  }

  alloc(bytes: number) {
    const aligned = (bytes + 7) & ~7;
    if (this.used + aligned > this.size) {
      // What was handed out since the last reset stays where it is.
      if (this.block !== 0) {
        this.retired.push(this.block);
      }
      this.size = Math.max(1024, this.size * 2, aligned);
      this.block = this.module._malloc(this.size);
      this.used = 0;
    }
    const pointer = this.block + this.used;
    this.used += aligned;
    return pointer;
  }

  floats(values: ArrayLike<number>) {
    const pointer = this.alloc(values.length * 4);
    this.module.HEAPF32.set(values, pointer >> 2);
    return pointer;
  }

  /** The same, or zero for an array that was left out. */
  floatsOrNull(values: ArrayLike<number> | null | undefined) {
    return values === null || values === undefined ? 0 : this.floats(values);
  }

  uint16s(values: ArrayLike<number>) {
    const pointer = this.alloc(values.length * 2);
    new Uint16Array(this.module.HEAPU8.buffer, pointer, values.length).set(
      values
    );
    return pointer;
  }

  uint32s(values: ArrayLike<number>) {
    const pointer = this.alloc(values.length * 4);
    this.module.HEAPU32.set(values, pointer >> 2);
    return pointer;
  }

  /** UTF-8, NUL-terminated. Its byte length is left in `length`. */
  text(text: string) {
    const bytes = encoder.encode(text);
    const pointer = this.alloc(bytes.length + 1);
    const heap = this.module.HEAPU8;
    heap.set(bytes, pointer);
    heap[pointer + bytes.length] = 0;
    this.length = bytes.length;
    return pointer;
  }

  /**
   * A matrix given by its first two rows (six numbers) or by all three
   * (nine), row-major, as nine floats. Zero for a matrix that was left out.
   */
  matrix(matrix: Matrix | null | undefined) {
    if (matrix === null || matrix === undefined) {
      return 0;
    }
    if (matrix.length !== 6 && matrix.length !== 9) {
      throw new RangeError("A matrix is six or nine numbers.");
    }
    const pointer = this.alloc(36);
    const heap = this.module.HEAPF32;
    const base = pointer >> 2;
    heap.set(matrix, base);
    if (matrix.length === 6) {
      heap[base + 6] = 0;
      heap[base + 7] = 0;
      heap[base + 8] = 1;
    }
    return pointer;
  }
}

/**
 * A 3x3 matrix, row-major: scaleX, skewX, transX, skewY, scaleY, transY, and
 * optionally the perspective row.
 */
export type Matrix = readonly number[];

/** Reads NUL-terminated UTF-8 text from wasm memory. */
export const readText = (module: WasmModule, pointer: number) => {
  const heap = module.HEAPU8;
  let end = pointer;
  while (heap[end] !== 0) {
    end++;
  }
  // A copy: decode() refuses views on memory that can grow.
  return decoder.decode(heap.slice(pointer, end));
};

/** What a wrapper needs to call into wasm. */
export interface Runtime {
  readonly module: WasmModule;
  readonly scratch: Scratch;
}
