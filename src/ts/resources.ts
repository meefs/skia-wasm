import type { WasmModule } from "./module";
import type { SlotKind } from "./slots";

/** A uniform of an effect: where it is in the uniform block, in words. */
export interface UniformInfo {
  readonly offset: number;
  readonly size: number;
  readonly kind: SlotKind;
  /** The SkSL type: "float", "float4", "int", "float3x3"... */
  readonly type: string;
  readonly count: number;
}

/** The kind of each uniform, for effects whose uniforms are typed by hand. */
export type UniformKinds = Record<string, SlotKind>;

/**
 * A context resource: an immutable Skia object shared by programs. A handle
 * is one reference. Programs and instances that use the resource hold their
 * own, so `release()` is safe as soon as the handle is no longer needed.
 */
export abstract class Resource {
  private live = true;

  constructor(
    protected readonly module: WasmModule,
    /** What a slot of the data block holds to refer to this resource. */
    readonly handle: number
  ) {}

  release() {
    if (this.live) {
      this.live = false;
      this.module._sk_resource_release(this.handle);
    }
  }
}

/** A compiled runtime effect. */
export class Effect<U extends UniformKinds = UniformKinds> extends Resource {
  constructor(
    module: WasmModule,
    handle: number,
    /** Size of the uniform block in words. */
    readonly size: number,
    readonly uniforms: { readonly [K in keyof U]: UniformInfo }
  ) {
    super(module, handle);
  }
}

/** A GPU image: decoded and uploaded, or wrapping a texture of the page. */
export class Image extends Resource {}
