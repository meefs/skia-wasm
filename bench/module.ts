import type { WasmModule } from "../src/ts";

/** An object embind made: a JavaScript wrapper that owns a C++ object. */
interface Embound {
  delete(): void;
}

export type EbShader = Embound;
export type EbImage = Embound;

export interface EbEffect extends Embound {
  _makeShader(uniforms: number): EbShader;
}

export interface EbPaint extends Embound {
  setAntiAlias(antiAlias: boolean): void;
  setColorComponents(r: number, g: number, b: number, a: number): void;
  setStroke(width: number): void;
  setShader(shader: EbShader): void;
}

export interface EbPath extends Embound {
  _setPolyline(points: number, count: number): void;
}

export interface EbCanvas extends Embound {
  save(): void;
  restore(): void;
  _concat(matrix: number): void;
  drawRect4f(
    left: number,
    top: number,
    right: number,
    bottom: number,
    paint: EbPaint
  ): void;
  _drawRRect(rrect: number, paint: EbPaint): void;
  drawPath(path: EbPath, paint: EbPaint): void;
  drawImageRect4f(
    image: EbImage,
    x: number,
    y: number,
    width: number,
    height: number
  ): void;
}

/**
 * The benchmark module: the display list of src/cpp plus the three baselines
 * of bench/cpp.
 */
export interface BenchModule extends WasmModule {
  // The frame every baseline draws into: bench/cpp/frame.cpp.
  _bench_begin(
    texture: number,
    r: number,
    g: number,
    b: number,
    a: number
  ): number;
  _bench_end(): number;

  // Variant A, embind: bench/cpp/embind.cpp.
  Paint: new () => EbPaint;
  Path: new () => EbPath;
  Canvas: new () => EbCanvas;
  RuntimeEffect: { Make(sksl: string): EbEffect };
  _MakeImageFromTexture(texture: number): EbImage;

  // Variant B, C exports: bench/cpp/cexports.cpp. Objects are pointers.
  _bx_save(): void;
  _bx_restore(): void;
  _bx_concat(
    scaleX: number,
    skewX: number,
    transX: number,
    skewY: number,
    scaleY: number,
    transY: number,
    persp0: number,
    persp1: number,
    persp2: number
  ): void;
  _bx_paint_new(): number;
  _bx_paint_delete(paint: number): void;
  _bx_paint_set_color(
    paint: number,
    r: number,
    g: number,
    b: number,
    a: number
  ): void;
  _bx_paint_set_stroke(paint: number, width: number): void;
  _bx_paint_set_shader(paint: number, shader: number): void;
  _bx_draw_rect(
    x: number,
    y: number,
    width: number,
    height: number,
    paint: number
  ): void;
  _bx_draw_rrect(
    x: number,
    y: number,
    width: number,
    height: number,
    rx: number,
    ry: number,
    paint: number
  ): void;
  _bx_effect_new(sksl: number): number;
  _bx_effect_release(effect: number): void;
  _bx_effect_make_shader(effect: number, uniforms: number): number;
  _bx_shader_release(shader: number): void;
  _bx_path_new(): number;
  _bx_path_delete(path: number): void;
  _bx_path_set_polyline(path: number, points: number, count: number): void;
  _bx_draw_path(path: number, paint: number): void;
  _bx_image_from_texture(texture: number): number;
  _bx_image_release(image: number): void;
  _bx_draw_image_rect(
    image: number,
    x: number,
    y: number,
    width: number,
    height: number
  ): void;

  // Variant C, command buffer: bench/cpp/cmdbuf.cpp.
  _cb_play(words: number, count: number): void;
}

/** The opcodes of bench/cpp/cmdbuf.cpp. */
export const Command = {
  Save: 1,
  Restore: 2,
  Concat: 3,
  DrawRRect: 4,
  DrawRectEffect: 5,
  DrawPolyline: 6,
  DrawImage: 7,
} as const;
