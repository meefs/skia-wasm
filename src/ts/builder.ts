/**
 * Records a scene once. Every method that takes a value allocates it in the
 * data block and returns its slot; every drawing method appends a command that
 * names slots. `build()` freezes the result into a program.
 *
 * Nothing here calls into wasm until `build()`.
 */
import {
  BlendMode,
  Header,
  LinearGradient,
  MAGIC,
  Matrix,
  Op,
  OpWords,
  Paint,
  PaintStyle,
  PathBuffer,
  RESERVED_WORDS,
  RRect,
  Rect,
  ShaderKind,
  VERSION,
} from "./format";
import { pathBufferWords, toColor } from "./helpers";
import type { Color } from "./helpers";
import { lastError } from "./module";
import type { WasmModule } from "./module";
import { Program } from "./program";
import { Image } from "./resources";
import type { Effect, Resource, UniformKinds } from "./resources";
import { slot } from "./slots";
import type {
  GradientRef,
  PathBufferRef,
  ShaderRef,
  Slot,
  SlotKind,
  SlotTypes,
  StaticPathRef,
} from "./slots";
import type { Schema } from "./values";

export interface RectInit {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export interface RRectInit extends RectInit {
  /** Both radii, unless `rx` and `ry` are given. */
  r?: number;
  rx?: number;
  ry?: number;
}

export interface PaintInit {
  color?: Color | string;
  style?: "fill" | "stroke";
  strokeWidth?: number;
  blendMode?: Exclude<keyof typeof BlendMode, "Last">;
  shader?: ShaderRef<unknown> | GradientRef;
}

export interface GradientInit {
  start: readonly [number, number];
  end: readonly [number, number];
  /** Evenly spaced stops, two to sixteen. */
  colors: readonly (Color | string)[];
}

export type UniformValues<U> = {
  [K in keyof U]?: number | readonly number[];
};

const encoder = new TextEncoder();

const command = (name: keyof typeof Op) => Op[name] | (OpWords[name] << 16);

export class Builder implements SlotTypes {
  private buffer = new ArrayBuffer(4096);
  private floats = new Float32Array(this.buffer);
  private ints = new Uint32Array(this.buffer);
  private words = RESERVED_WORDS;
  private readonly commands: number[] = [];
  private readonly imports: Resource[] = [];
  private readonly importIndices = new Map<Resource, number>();
  private readonly paths: string[] = [];
  private readonly shaders: number[] = [];
  private readonly pathBuffers: number[] = [];
  private readonly slots: number[] = [];
  private readonly slotIndices = new Map<number, number>();
  private readonly kinds = new Map<number, SlotKind>();
  private readonly sizes = new Map<number, number>();
  private depth = 0;
  private built = false;

  constructor(private readonly module: WasmModule) {}

  // ---- Values: each returns the slot it allocated.

  f32(value = 0) {
    const offset = this.alloc("f32", 1);
    this.floats[offset] = value;
    return offset;
  }

  i32(value = 0) {
    const offset = this.alloc("i32", 1);
    this.ints[offset] = value;
    return offset;
  }

  vec2(x = 0, y = 0) {
    const offset = this.alloc("vec2", 2);
    this.floats.set([x, y], offset);
    return offset;
  }

  vec4(x = 0, y = 0, z = 0, w = 0) {
    const offset = this.alloc("vec4", 4);
    this.floats.set([x, y, z, w], offset);
    return offset;
  }

  color(color: Color | string = [0, 0, 0, 1]) {
    const offset = this.alloc("color", 4);
    this.floats.set(toColor(color), offset);
    return offset;
  }

  /**
   * A 3x3 matrix: nine floats, row-major. Identity unless `values` gives
   * the first two rows (scaleX, skewX, transX, skewY, scaleY, transY).
   */
  matrix(values: readonly number[] = [1, 0, 0, 0, 1, 0]) {
    if (values.length !== 6) {
      throw new RangeError("A matrix is given by its first two rows.");
    }
    const offset = this.alloc("mat3", Matrix.Words);
    this.floats.set([...values, 0, 0, 1], offset);
    return offset;
  }

  rect({ x = 0, y = 0, width, height }: RectInit) {
    const offset = this.alloc("rect", Rect.Words);
    this.floats.set([x, y, width, height], offset);
    return offset;
  }

  rrect({ x = 0, y = 0, width, height, r = 0, rx = r, ry = r }: RRectInit) {
    const offset = this.alloc("rrect", RRect.Words);
    this.floats.set([x, y, width, height, rx, ry], offset);
    return offset;
  }

  paint(init: PaintInit = {}) {
    const offset = this.alloc("paint", Paint.Words);
    // The slots that paintColor() and its siblings return.
    this.kinds.set(offset + Paint.StrokeWidth, "f32");
    this.kinds.set(offset + Paint.BlendMode, "i32");
    this.kinds.set(offset + Paint.Shader, "i32");
    this.kinds.set(offset + Paint.Color, "color");
    this.ints[offset + Paint.Style] =
      init.style === "stroke" ? PaintStyle.Stroke : PaintStyle.Fill;
    this.floats[offset + Paint.StrokeWidth] = init.strokeWidth ?? 1;
    this.ints[offset + Paint.BlendMode] =
      BlendMode[init.blendMode ?? "SrcOver"];
    this.ints[offset + Paint.Shader] = init.shader ? init.shader.index + 1 : 0;
    this.floats.set(toColor(init.color ?? [0, 0, 0, 1]), offset + Paint.Color);
    return offset;
  }

  /**
   * A shader made from an effect. Its uniform block lives in the data block,
   * at the layout the effect reports: each uniform is a slot.
   */
  shader<U extends UniformKinds>(
    effect: Effect<U>,
    values: UniformValues<U> = {}
  ): ShaderRef<{ readonly [K in keyof U]: Slot<U[K]> }> {
    const base = this.words;
    this.reserve(effect.size);
    const uniforms: Record<string, Slot> = {};
    for (const [name, info] of Object.entries(effect.uniforms)) {
      const offset = base + info.offset;
      this.kinds.set(offset, info.kind);
      this.sizes.set(offset, info.size);
      uniforms[name] = slot(offset);
      const value = values[name];
      if (typeof value === "number") {
        this.write(info.kind, offset, value);
      } else if (value !== undefined) {
        if (value.length > info.size) {
          throw new RangeError(`Too many values for the uniform ${name}.`);
        }
        value.forEach((item, i) => this.write(info.kind, offset + i, item));
      }
    }
    const index = this.shaders.length / 4;
    this.shaders.push(
      ShaderKind.RuntimeEffect,
      this.importIndex(effect),
      base,
      effect.size
    );
    return {
      kind: "shader",
      index,
      uniforms: uniforms as { readonly [K in keyof U]: Slot<U[K]> },
    };
  }

  linearGradient({ start, end, colors }: GradientInit): GradientRef {
    if (colors.length < 2 || colors.length > 16) {
      throw new RangeError("A gradient has two to sixteen colors.");
    }
    const words = LinearGradient.Colors + 4 * colors.length;
    const base = this.words;
    this.reserve(words);
    this.kinds.set(base + LinearGradient.Start, "vec2");
    this.kinds.set(base + LinearGradient.End, "vec2");
    this.floats.set(start, base + LinearGradient.Start);
    this.floats.set(end, base + LinearGradient.End);
    const stops = colors.map((color, i) => {
      const offset = base + LinearGradient.Colors + 4 * i;
      this.kinds.set(offset, "color");
      this.floats.set(toColor(color), offset);
      return slot<"color">(offset);
    });
    const index = this.shaders.length / 4;
    this.shaders.push(ShaderKind.LinearGradient, colors.length, base, words);
    return {
      kind: "shader",
      index,
      start: slot(base + LinearGradient.Start),
      end: slot(base + LinearGradient.End),
      colors: stops,
    };
  }

  /**
   * A path whose verbs and points live in the data block, with a capacity
   * fixed here. It is empty until written.
   */
  pathBuffer({
    maxVerbs,
    maxPoints,
  }: {
    maxVerbs: number;
    maxPoints: number;
  }): PathBufferRef {
    const base = this.words;
    this.reserve(pathBufferWords(maxVerbs, maxPoints));
    this.kinds.set(base + PathBuffer.VerbCount, "i32");
    this.kinds.set(base + PathBuffer.PointCount, "i32");
    const index = this.pathBuffers.length / 3;
    this.pathBuffers.push(base, maxVerbs, maxPoints);
    return {
      kind: "pathBuffer",
      index,
      verbCount: slot(base + PathBuffer.VerbCount),
      pointCount: slot(base + PathBuffer.PointCount),
      verbs: base + PathBuffer.Verbs,
      points: base + PathBuffer.Verbs + maxVerbs,
      maxVerbs,
      maxPoints,
    };
  }

  /** A static path from an SVG path string, parsed once and owned by the program. */
  path(svg: string): StaticPathRef {
    this.paths.push(svg);
    return { kind: "path", index: this.paths.length - 1 };
  }

  /**
   * A resource slot: one word of the data block naming an image, rebound per
   * instance and per frame with `scene.bind()`.
   */
  slot(image: Image | null = null) {
    const offset = this.alloc("image", 1);
    this.ints[offset] = image === null ? 0 : image.handle;
    this.slotIndices.set(offset, this.slots.length);
    this.slots.push(offset);
    return offset;
  }

  // ---- Commands.

  save() {
    this.depth++;
    this.commands.push(command("Save"));
  }

  restore() {
    if (this.depth === 0) {
      throw new Error("restore() without a matching save().");
    }
    this.depth--;
    this.commands.push(command("Restore"));
  }

  concat(matrix: Slot<"mat3">) {
    this.commands.push(command("Concat"), matrix);
  }

  clipRect(rect: Slot<"rect"> | RectInit) {
    this.commands.push(command("ClipRect"), this.rectOf(rect));
  }

  drawRect(rect: Slot<"rect"> | RectInit, paint: Slot<"paint"> | PaintInit) {
    this.commands.push(
      command("DrawRect"),
      this.rectOf(rect),
      this.paintOf(paint)
    );
  }

  drawRRect(
    rrect: Slot<"rrect"> | RRectInit,
    paint: Slot<"paint"> | PaintInit
  ) {
    this.commands.push(
      command("DrawRRect"),
      typeof rrect === "number" ? rrect : this.rrect(rrect),
      this.paintOf(paint)
    );
  }

  drawPath(
    path: StaticPathRef | PathBufferRef,
    paint: Slot<"paint"> | PaintInit
  ) {
    this.commands.push(
      command(path.kind === "path" ? "DrawPath" : "DrawPathBuffer"),
      path.index,
      this.paintOf(paint)
    );
  }

  /** Draws the image of a slot, or a context image, into a rect. */
  drawImage(image: Slot<"image"> | Image, rect: Slot<"rect"> | RectInit) {
    if (image instanceof Image) {
      this.commands.push(
        command("DrawImage"),
        this.importIndex(image),
        this.rectOf(rect)
      );
      return;
    }
    const index = this.slotIndices.get(image);
    if (index === undefined) {
      throw new Error("Not a resource slot of this builder.");
    }
    this.commands.push(command("DrawImageSlot"), index, this.rectOf(rect));
  }

  // ---- The program.

  /**
   * Freezes the recording. `schema` names the slots worth animating: each
   * instance exposes them as typed properties of `scene.values`.
   */
  build<S extends Schema = Record<string, never>>(schema?: S): Program<S> {
    if (this.built) {
      throw new Error("The builder already built its program.");
    }
    if (this.depth !== 0) {
      throw new Error("save() without a matching restore().");
    }
    this.built = true;
    const { module } = this;
    const paths = this.paths.map((svg) => encoder.encode(svg));
    const pathWords = paths.reduce(
      (sum, bytes) => sum + 1 + Math.ceil(bytes.length / 4),
      0
    );
    const count =
      Header.Words +
      pathWords +
      this.shaders.length +
      this.pathBuffers.length +
      this.slots.length +
      this.commands.length +
      this.words;
    const block = new Uint32Array(count);
    block[Header.Magic] = MAGIC;
    block[Header.Version] = VERSION;
    block[Header.DataWords] = this.words;
    block[Header.ImportCount] = this.imports.length;
    block[Header.PathCount] = paths.length;
    block[Header.ShaderCount] = this.shaders.length / 4;
    block[Header.PathBufferCount] = this.pathBuffers.length / 3;
    block[Header.SlotCount] = this.slots.length;
    block[Header.CommandWords] = this.commands.length;
    let cursor: number = Header.Words;
    const bytes = new Uint8Array(block.buffer);
    for (const path of paths) {
      block[cursor++] = path.length;
      bytes.set(path, cursor * 4);
      cursor += Math.ceil(path.length / 4);
    }
    for (const section of [
      this.shaders,
      this.pathBuffers,
      this.slots,
      this.commands,
    ]) {
      block.set(section, cursor);
      cursor += section.length;
    }
    block.set(this.ints.subarray(0, this.words), cursor);

    // The block, then the handles of the imports.
    const pointer = module._malloc((count + this.imports.length) * 4);
    const heap = module.HEAPU32;
    heap.set(block, pointer >> 2);
    this.imports.forEach((resource, i) => {
      heap[(pointer >> 2) + count + i] = resource.handle;
    });
    const program = module._sk_program_create(
      pointer,
      count,
      pointer + count * 4,
      this.imports.length
    );
    module._free(pointer);
    if (program === 0) {
      throw new Error(lastError(module));
    }
    return new Program<S>(module, program, this.words, schema, this);
  }

  // ---- SlotTypes, for the schema of build().

  kindOf(offset: number) {
    return this.kinds.get(offset);
  }

  wordsOf(offset: number) {
    return this.sizes.get(offset) ?? 1;
  }

  private alloc<K extends SlotKind>(kind: K, words: number) {
    const offset = this.words;
    this.reserve(words);
    this.kinds.set(offset, kind);
    return slot<K>(offset);
  }

  private reserve(words: number) {
    const needed = (this.words + words) * 4;
    if (needed > this.buffer.byteLength) {
      let capacity = this.buffer.byteLength;
      while (capacity < needed) {
        capacity *= 2;
      }
      const buffer = new ArrayBuffer(capacity);
      new Uint32Array(buffer).set(this.ints.subarray(0, this.words));
      this.buffer = buffer;
      this.floats = new Float32Array(buffer);
      this.ints = new Uint32Array(buffer);
    }
    this.words += words;
  }

  private write(kind: SlotKind, offset: number, value: number) {
    if (kind === "i32") {
      this.ints[offset] = value;
    } else {
      this.floats[offset] = value;
    }
  }

  private importIndex(resource: Resource) {
    let index = this.importIndices.get(resource);
    if (index === undefined) {
      index = this.imports.length;
      this.imports.push(resource);
      this.importIndices.set(resource, index);
    }
    return index;
  }

  private rectOf(rect: Slot<"rect"> | RectInit) {
    return typeof rect === "number" ? rect : this.rect(rect);
  }

  private paintOf(paint: Slot<"paint"> | PaintInit) {
    return typeof paint === "number" ? paint : this.paint(paint);
  }
}
