import { Canvas } from "./canvas";
import { Shader } from "./effects";
import { tileModes } from "./enums";
import type { TileMode } from "./enums";
import { NativeObject, ref } from "./native";
import type { Matrix, Runtime } from "./native";

export interface PictureShaderOptions {
  tileX?: TileMode;
  tileY?: TileMode;
  /** How the picture is filtered when it is scaled. "linear" if left out. */
  filter?: "nearest" | "linear";
  matrix?: Matrix;
  /** The rect to repeat: x, y, width and height. The bounds of the picture if left out. */
  tile?: readonly [number, number, number, number];
}

/** Drawing commands that were recorded, to be drawn any number of times. */
export class Picture extends NativeObject {
  constructor(
    private readonly runtime: Runtime,
    pointer: number
  ) {
    super(pointer, runtime.module._sk_unref, "picture");
  }

  /** The picture as a shader. */
  shader(options: PictureShaderOptions = {}) {
    const { module, scratch } = this.runtime;
    scratch.reset();
    return new Shader(
      this.runtime,
      module._sk_picture_make_shader(
        ref(this),
        tileModes(options.tileX ?? "clamp"),
        tileModes(options.tileY ?? "clamp"),
        options.filter === "nearest" ? 0 : 1,
        scratch.matrix(options.matrix),
        scratch.floatsOrNull(options.tile)
      )
    );
  }
}

/** Records what is drawn to its canvas into a picture. */
export class PictureRecorder extends NativeObject {
  private readonly canvas: Canvas;

  /** Made by `sk.pictureRecorder()`. */
  constructor(private readonly runtime: Runtime) {
    super(
      runtime.module._sk_picture_recorder_new(),
      runtime.module._sk_picture_recorder_delete,
      "picture recorder"
    );
    this.canvas = new Canvas(runtime);
  }

  /**
   * Starts a recording and returns its canvas. The rect bounds what will be
   * drawn: what is outside of it may be left out.
   */
  begin(x: number, y: number, width: number, height: number) {
    this.canvas.attach(
      this.runtime.module._sk_picture_recorder_begin(
        ref(this),
        x,
        y,
        width,
        height
      )
    );
    return this.canvas;
  }

  /** Ends the recording. The canvas is no longer valid. */
  finish() {
    if (this.canvas.pointer === 0) {
      throw new Error("Nothing is being recorded: call begin() first.");
    }
    this.canvas.attach(0);
    return new Picture(
      this.runtime,
      this.runtime.module._sk_picture_recorder_finish(ref(this))
    );
  }
}
