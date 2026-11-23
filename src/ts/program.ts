import type { WasmModule } from "./module";
import type { Image } from "./resources";
import type { Slot, SlotTypes } from "./slots";
import { compileValues } from "./values";
import type { DataOwner, Schema, Values, ValuesClass } from "./values";

const Detached = new Float32Array(0);
const DetachedWords = new Uint32Array(0);

/**
 * A recorded scene: immutable commands that name where their operands are in
 * a data block. It retains the context resources it uses and owns its static
 * paths. It draws nothing by itself: instances do.
 */
export class Program<S extends Schema = Schema> {
  private readonly Values: ValuesClass;
  private pointer: number;

  /** Built by `Builder.build()`. */
  constructor(
    private readonly module: WasmModule,
    pointer: number,
    /** Size of the data block of an instance, in words. */
    readonly dataWords: number,
    schema: S | undefined,
    types: SlotTypes
  ) {
    this.pointer = pointer;
    this.Values = compileValues(schema ?? {}, types);
  }

  /** A data block for this program, initialized as the scene was recorded. */
  instantiate(): Instance<S> {
    if (this.pointer === 0) {
      throw new Error("The program was disposed.");
    }
    return new Instance<S>(
      this.module,
      this.module._sk_instance_create(this.pointer),
      this.dataWords,
      this.Values
    );
  }

  /** Instances made before keep working: they hold the program. */
  dispose() {
    if (this.pointer !== 0) {
      this.module._sk_program_release(this.pointer);
      this.pointer = 0;
    }
  }
}

/**
 * A program and its data block: the only thing touched per frame. Animating
 * is writing numbers into `f32` (or through `values`), then drawing.
 */
export class Instance<S extends Schema = Schema> implements DataOwner {
  /** The typed accessors of the schema given to `build()`. */
  readonly values: Values<S>;
  /** For `Surface.draw()`: zero once disposed. */
  pointer: number;
  private readonly data: number;
  private floats: Float32Array;
  private words: Uint32Array;

  constructor(
    private readonly module: WasmModule,
    pointer: number,
    private readonly dataWords: number,
    ValuesOfProgram: ValuesClass
  ) {
    this.pointer = pointer;
    this.data = module._sk_instance_data(pointer);
    this.floats = Detached;
    this.words = DetachedWords;
    this.refresh();
    this.values = new ValuesOfProgram(this) as Values<S>;
  }

  /**
   * The data block as floats, indexed by slot. Read it again every frame:
   * when wasm memory grows, the previous view is detached.
   */
  get f32() {
    const view = this.floats;
    // A view on a detached buffer has no length.
    return view.length === 0 ? this.refresh().floats : view;
  }

  /** The same words as integers: counts, verbs, styles and resource slots. */
  get u32() {
    const view = this.words;
    return view.length === 0 ? this.refresh().words : view;
  }

  /**
   * Points a slot at a resource: one integer write. The instance retains the
   * resource the next time it is drawn.
   */
  bind(target: Slot<"image">, image: Image | null) {
    this.u32[target] = image === null ? 0 : image.handle;
  }

  dispose() {
    if (this.pointer !== 0) {
      this.module._sk_instance_release(this.pointer);
      this.pointer = 0;
      this.floats = Detached;
      this.words = DetachedWords;
    }
  }

  private refresh() {
    if (this.pointer === 0) {
      throw new Error("The instance was disposed.");
    }
    const { buffer } = this.module.HEAPU8;
    this.floats = new Float32Array(buffer, this.data, this.dataWords);
    this.words = new Uint32Array(buffer, this.data, this.dataWords);
    return this;
  }
}
