/// <reference types="@webgpu/types" />
/**
 * The benchmark scenes. Each is animated on every frame and drawn five ways,
 * with the same arithmetic and the same Skia calls behind each: only the way
 * the values and the calls cross from JavaScript into wasm differs.
 *
 *   A  embind objects, one call per operation (the CanvasKit style)
 *   B  C exports, one call per operation
 *   C  a command buffer re-encoded every frame, one call
 *   D  the display list: raw writes into the data block, one call
 *   E  the display list through `scene.values`
 *
 * Extra variants, where they apply:
 *   F  the display list as one instance per item, drawn as an array
 *   S  the display list with nothing written: what its caches save
 */
import { paintColor, writePolylineVerbs } from "../src/ts";
import type { Instance, Skia, Slot, Surface } from "../src/ts";
import { allocateString } from "../src/ts/module";

import { Command } from "./module";
import type { BenchModule } from "./module";

export const WIDTH = 1024;
export const HEIGHT = 1024;

export interface Env {
  sk: Skia;
  module: BenchModule;
  surface: Surface;
  /** Four textures for the image scene. */
  textures: GPUTexture[];
}

export interface Variant {
  /** Draws one frame. `time` is in milliseconds, `frame` counts frames. */
  frame(time: number, frame: number): void;
  dispose(): void;
}

export type VariantFactory = (env: Env) => Variant;

export interface Scene {
  id: string;
  title: string;
  variants: Record<string, VariantFactory>;
}

// The frame of the baselines: the two halves of what Surface.draw() does in
// one call for the display list.
const begin = ({ module, surface }: Env) => {
  if (module._bench_begin(surface.acquire(), 1, 1, 1, 1) === 0) {
    throw new Error("bench_begin() failed.");
  }
};

const end = ({ module }: Env) => {
  if (module._bench_end() === 0) {
    throw new Error("bench_end() failed.");
  }
};

const grid = (count: number, columns: number, rows: number) => {
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    xs[i] = (i % columns) * (WIDTH / columns);
    ys[i] = Math.floor(i / columns) * (HEIGHT / rows);
  }
  return { xs, ys };
};

/* ------------------------------------------------------------------------ *
 * Scene 1: 10,000 rounded rects, each with its own matrix and color.
 * ------------------------------------------------------------------------ */

const N1 = 10_000;
const cells1 = grid(N1, 100, 100);
// The centers: each rect rotates around its own.
const xs1 = cells1.xs.map((x) => x + 5);
const ys1 = cells1.ys.map((y) => y + 5);

const rrects: Scene = {
  id: "rrects",
  title: "10,000 rounded rects, each with its own matrix and color",
  variants: {
    A: (env) => {
      const { module } = env;
      const canvas = new module.Canvas();
      const paint = new module.Paint();
      paint.setAntiAlias(true);
      // A matrix, then the rounded rect: filled by hand, passed by pointer.
      const scratch = module._malloc(15 * 4);
      const m = scratch >> 2;
      module.HEAPF32.set([0, 0, 0, 0, 0, 0, 0, 0, 1, -4, -4, 8, 8, 2, 2], m);
      return {
        frame(time, frame) {
          begin(env);
          let f32 = module.HEAPF32;
          for (let i = 0; i < N1; i++) {
            const angle = time * 0.002 + i * 0.01;
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            const red = ((i + frame) & 255) / 255;
            canvas.save();
            // The calls allocate: a view on memory that grew has no length.
            if (f32.length === 0) {
              f32 = module.HEAPF32;
            }
            f32[m] = c;
            f32[m + 1] = -s;
            f32[m + 2] = xs1[i];
            f32[m + 3] = s;
            f32[m + 4] = c;
            f32[m + 5] = ys1[i];
            canvas._concat(scratch);
            paint.setColorComponents(red, 0.5, 1 - red, 1);
            canvas._drawRRect(scratch + 36, paint);
            canvas.restore();
          }
          end(env);
        },
        dispose() {
          canvas.delete();
          paint.delete();
          module._free(scratch);
        },
      };
    },

    B: (env) => {
      const { module } = env;
      const save = module._bx_save;
      const restore = module._bx_restore;
      const concat = module._bx_concat;
      const setColor = module._bx_paint_set_color;
      const drawRRect = module._bx_draw_rrect;
      const paint = module._bx_paint_new();
      return {
        frame(time, frame) {
          begin(env);
          for (let i = 0; i < N1; i++) {
            const angle = time * 0.002 + i * 0.01;
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            const red = ((i + frame) & 255) / 255;
            save();
            concat(c, -s, xs1[i], s, c, ys1[i], 0, 0, 1);
            setColor(paint, red, 0.5, 1 - red, 1);
            drawRRect(-4, -4, 8, 8, 2, 2, paint);
            restore();
          }
          end(env);
        },
        dispose() {
          module._bx_paint_delete(paint);
        },
      };
    },

    C: (env) => {
      const { module } = env;
      const buffer = module._malloc(N1 * 23 * 4);
      return {
        frame(time, frame) {
          const f32 = module.HEAPF32;
          const u32 = module.HEAPU32;
          let p = buffer >> 2;
          for (let i = 0; i < N1; i++) {
            const angle = time * 0.002 + i * 0.01;
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            const red = ((i + frame) & 255) / 255;
            u32[p] = Command.Save;
            u32[p + 1] = Command.Concat;
            f32[p + 2] = c;
            f32[p + 3] = -s;
            f32[p + 4] = xs1[i];
            f32[p + 5] = s;
            f32[p + 6] = c;
            f32[p + 7] = ys1[i];
            f32[p + 8] = 0;
            f32[p + 9] = 0;
            f32[p + 10] = 1;
            u32[p + 11] = Command.DrawRRect;
            f32[p + 12] = -4;
            f32[p + 13] = -4;
            f32[p + 14] = 8;
            f32[p + 15] = 8;
            f32[p + 16] = 2;
            f32[p + 17] = 2;
            f32[p + 18] = red;
            f32[p + 19] = 0.5;
            f32[p + 20] = 1 - red;
            f32[p + 21] = 1;
            u32[p + 22] = Command.Restore;
            p += 23;
          }
          begin(env);
          module._cb_play(buffer, p - (buffer >> 2));
          end(env);
        },
        dispose() {
          module._free(buffer);
        },
      };
    },

    D: (env) => {
      const { scene, mats, colors, dispose } = recordRRects(env);
      const matrixOf = Int32Array.from(mats);
      const colorOf = Int32Array.from(colors);
      return {
        frame(time, frame) {
          const { f32 } = scene;
          for (let i = 0; i < N1; i++) {
            const angle = time * 0.002 + i * 0.01;
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            const red = ((i + frame) & 255) / 255;
            const m = matrixOf[i];
            f32[m] = c;
            f32[m + 1] = -s;
            f32[m + 2] = xs1[i];
            f32[m + 3] = s;
            f32[m + 4] = c;
            f32[m + 5] = ys1[i];
            const k = colorOf[i];
            f32[k] = red;
            f32[k + 1] = 0.5;
            f32[k + 2] = 1 - red;
            f32[k + 3] = 1;
          }
          env.surface.draw(scene);
        },
        dispose,
      };
    },

    E: (env) => {
      const { scene, dispose } = recordRRects(env);
      const { transforms, colors } = scene.values;
      return {
        frame(time, frame) {
          for (let i = 0; i < N1; i++) {
            const angle = time * 0.002 + i * 0.01;
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            const red = ((i + frame) & 255) / 255;
            transforms[i].set(c, -s, xs1[i], s, c, ys1[i]);
            colors[i].set(red, 0.5, 1 - red, 1);
          }
          env.surface.draw(scene);
        },
        dispose,
      };
    },

    // One program of a single rect, 10,000 instances, one call.
    F: (env) => {
      const b = env.sk.builder();
      const m = b.matrix();
      const paint = b.paint({ color: [0, 0.5, 1, 1] });
      const k = paintColor(paint);
      b.save();
      b.concat(m);
      b.drawRRect({ x: -4, y: -4, width: 8, height: 8, r: 2 }, paint);
      b.restore();
      const program = b.build();
      const cards: Instance[] = [];
      for (let i = 0; i < N1; i++) {
        cards.push(program.instantiate());
      }
      return {
        frame(time, frame) {
          for (let i = 0; i < N1; i++) {
            const angle = time * 0.002 + i * 0.01;
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            const red = ((i + frame) & 255) / 255;
            const { f32 } = cards[i];
            f32[m] = c;
            f32[m + 1] = -s;
            f32[m + 2] = xs1[i];
            f32[m + 3] = s;
            f32[m + 4] = c;
            f32[m + 5] = ys1[i];
            f32[k] = red;
            f32[k + 1] = 0.5;
            f32[k + 2] = 1 - red;
            f32[k + 3] = 1;
          }
          env.surface.draw(cards);
        },
        dispose() {
          cards.forEach((card) => card.dispose());
          program.dispose();
        },
      };
    },
  },
};

const recordRRects = ({ sk }: Env) => {
  const b = sk.builder();
  const rrect = b.rrect({ x: -4, y: -4, width: 8, height: 8, r: 2 });
  const mats: Slot<"mat3">[] = [];
  const colors: Slot<"color">[] = [];
  for (let i = 0; i < N1; i++) {
    const m = b.matrix([1, 0, xs1[i], 0, 1, ys1[i]]);
    const paint = b.paint({ color: [0, 0.5, 1, 1] });
    mats.push(m);
    colors.push(paintColor(paint));
    b.save();
    b.concat(m);
    b.drawRRect(rrect, paint);
    b.restore();
  }
  const program = b.build({ transforms: mats, colors });
  const scene = program.instantiate();
  return {
    scene,
    mats,
    colors,
    dispose() {
      scene.dispose();
      program.dispose();
    },
  };
};

/* ------------------------------------------------------------------------ *
 * Scene 2: 1,000 rects with a runtime shader, each with its own uniforms.
 * ------------------------------------------------------------------------ */

const N2 = 1000;
const cells2 = grid(N2, 40, 25);
const W2 = WIDTH / 40 - 4;
const H2 = HEIGHT / 25 - 4;
const xs2 = cells2.xs.map((x) => x + 2);
const ys2 = cells2.ys.map((y) => y + 2);

const SKSL = `
uniform float iTime;
uniform float4 color;
half4 main(float2 p) {
  float v = 0.5 + 0.5 * sin(p.x * 0.2 + iTime * 4.0);
  return half4(color.rgb * v, 1);
}`;

// A type alias: an interface has no index signature to satisfy UniformKinds.

type Uniforms = {
  iTime: "f32";
  color: "vec4";
};

// The layout of the uniform block, which every variant fills by hand.
const layoutOf = ({ sk }: Env) => {
  const effect = sk.effect<Uniforms>(SKSL);
  const layout = {
    words: effect.size,
    time: effect.uniforms.iTime.offset,
    color: effect.uniforms.color.offset,
  };
  effect.release();
  return layout;
};

const shaders: Scene = {
  id: "shaders",
  title: "1,000 rects with a runtime shader, each with its own uniforms",
  variants: {
    A: (env) => {
      const { module } = env;
      const layout = layoutOf(env);
      const canvas = new module.Canvas();
      const paint = new module.Paint();
      paint.setAntiAlias(true);
      const effect = module.RuntimeEffect.Make(SKSL);
      const scratch = module._malloc(layout.words * 4);
      const t = (scratch >> 2) + layout.time;
      const k = (scratch >> 2) + layout.color;
      return {
        frame(time, frame) {
          begin(env);
          let f32 = module.HEAPF32;
          for (let i = 0; i < N2; i++) {
            const red = ((i + frame) & 255) / 255;
            if (f32.length === 0) {
              f32 = module.HEAPF32;
            }
            f32[t] = time * 0.001 + i * 0.1;
            f32[k] = red;
            f32[k + 1] = 0.3;
            f32[k + 2] = 1 - red;
            f32[k + 3] = 1;
            // A new uniform value is a new shader, and a new wrapper for it.
            const shader = effect._makeShader(scratch);
            paint.setShader(shader);
            canvas.drawRect4f(xs2[i], ys2[i], xs2[i] + W2, ys2[i] + H2, paint);
            shader.delete();
          }
          end(env);
        },
        dispose() {
          canvas.delete();
          paint.delete();
          effect.delete();
          module._free(scratch);
        },
      };
    },

    B: (env) => {
      const { module } = env;
      const layout = layoutOf(env);
      const makeShader = module._bx_effect_make_shader;
      const setShader = module._bx_paint_set_shader;
      const drawRect = module._bx_draw_rect;
      const release = module._bx_shader_release;
      const source = allocateString(module, SKSL);
      const effect = module._bx_effect_new(source);
      module._free(source);
      const paint = module._bx_paint_new();
      const scratch = module._malloc(layout.words * 4);
      const t = (scratch >> 2) + layout.time;
      const k = (scratch >> 2) + layout.color;
      return {
        frame(time, frame) {
          begin(env);
          let f32 = module.HEAPF32;
          for (let i = 0; i < N2; i++) {
            const red = ((i + frame) & 255) / 255;
            if (f32.length === 0) {
              f32 = module.HEAPF32;
            }
            f32[t] = time * 0.001 + i * 0.1;
            f32[k] = red;
            f32[k + 1] = 0.3;
            f32[k + 2] = 1 - red;
            f32[k + 3] = 1;
            const shader = makeShader(effect, scratch);
            setShader(paint, shader);
            drawRect(xs2[i], ys2[i], W2, H2, paint);
            release(shader);
          }
          end(env);
        },
        dispose() {
          module._bx_paint_delete(paint);
          module._bx_effect_release(effect);
          module._free(scratch);
        },
      };
    },

    C: (env) => {
      const { module } = env;
      const layout = layoutOf(env);
      const source = allocateString(module, SKSL);
      const effect = module._bx_effect_new(source);
      module._free(source);
      const size = 7 + layout.words;
      const buffer = module._malloc(N2 * size * 4);
      return {
        frame(time, frame) {
          const f32 = module.HEAPF32;
          const u32 = module.HEAPU32;
          let p = buffer >> 2;
          for (let i = 0; i < N2; i++) {
            const red = ((i + frame) & 255) / 255;
            u32[p] = Command.DrawRectEffect;
            f32[p + 1] = xs2[i];
            f32[p + 2] = ys2[i];
            f32[p + 3] = W2;
            f32[p + 4] = H2;
            u32[p + 5] = effect;
            u32[p + 6] = layout.words;
            const t = p + 7 + layout.time;
            const k = p + 7 + layout.color;
            f32[t] = time * 0.001 + i * 0.1;
            f32[k] = red;
            f32[k + 1] = 0.3;
            f32[k + 2] = 1 - red;
            f32[k + 3] = 1;
            p += size;
          }
          begin(env);
          module._cb_play(buffer, p - (buffer >> 2));
          end(env);
        },
        dispose() {
          module._bx_effect_release(effect);
          module._free(buffer);
        },
      };
    },

    D: (env) => {
      const { scene, times, colors, dispose } = recordShaders(env);
      const timeOf = Int32Array.from(times);
      const colorOf = Int32Array.from(colors);
      return {
        frame(time, frame) {
          const { f32 } = scene;
          for (let i = 0; i < N2; i++) {
            const red = ((i + frame) & 255) / 255;
            f32[timeOf[i]] = time * 0.001 + i * 0.1;
            const k = colorOf[i];
            f32[k] = red;
            f32[k + 1] = 0.3;
            f32[k + 2] = 1 - red;
            f32[k + 3] = 1;
          }
          env.surface.draw(scene);
        },
        dispose,
      };
    },

    E: (env) => {
      const { scene, dispose } = recordShaders(env);
      const { times, colors } = scene.values;
      return {
        frame(time, frame) {
          for (let i = 0; i < N2; i++) {
            const red = ((i + frame) & 255) / 255;
            times.set(i, time * 0.001 + i * 0.1);
            colors[i].set(red, 0.3, 1 - red, 1);
          }
          env.surface.draw(scene);
        },
        dispose,
      };
    },

    // Nothing is written: every shader comes out of the instance's cache.
    S: (env) => {
      const { scene, dispose } = recordShaders(env);
      return {
        frame() {
          env.surface.draw(scene);
        },
        dispose,
      };
    },
  },
};

const recordShaders = ({ sk }: Env) => {
  const effect = sk.effect<Uniforms>(SKSL);
  const b = sk.builder();
  const times: Slot<"f32">[] = [];
  const colors: Slot<"vec4">[] = [];
  for (let i = 0; i < N2; i++) {
    const shader = b.shader(effect, { iTime: i * 0.1, color: [0, 0.3, 1, 1] });
    times.push(shader.uniforms.iTime);
    colors.push(shader.uniforms.color);
    b.drawRect({ x: xs2[i], y: ys2[i], width: W2, height: H2 }, { shader });
  }
  const program = b.build({ times, colors });
  // The program retains the effect.
  effect.release();
  const scene = program.instantiate();
  return {
    scene,
    times,
    colors,
    dispose() {
      scene.dispose();
      program.dispose();
    },
  };
};

/* ------------------------------------------------------------------------ *
 * Scene 3: 200 stroked paths of 64 points, every point moving.
 * ------------------------------------------------------------------------ */

const N3 = 200;
const P3 = 64;
const STROKE = 1.5;
const xs3 = Float32Array.from({ length: P3 }, (_, j) => 8 + j * 16);
const ys3 = Float32Array.from({ length: N3 }, (_, i) => 6 + i * 5.1);
const colorOfPath = (i: number) => [i / N3, 0.4, 1 - i / N3, 1] as const;

const paths: Scene = {
  id: "paths",
  title: "200 stroked paths of 64 points, every point moving",
  variants: {
    A: (env) => {
      const { module } = env;
      const canvas = new module.Canvas();
      const path = new module.Path();
      const paints = Array.from({ length: N3 }, (_, i) => {
        const paint = new module.Paint();
        paint.setAntiAlias(true);
        paint.setStroke(STROKE);
        paint.setColorComponents(...colorOfPath(i));
        return paint;
      });
      const scratch = module._malloc(P3 * 2 * 4);
      return {
        frame(time) {
          begin(env);
          let f32 = module.HEAPF32;
          for (let i = 0; i < N3; i++) {
            if (f32.length === 0) {
              f32 = module.HEAPF32;
            }
            let p = scratch >> 2;
            for (let j = 0; j < P3; j++) {
              const phase = time * 0.004 + j * 0.3 + i * 0.2;
              f32[p++] = xs3[j] + 2 * Math.cos(phase);
              f32[p++] = ys3[i] + 4 * Math.sin(phase);
            }
            path._setPolyline(scratch, P3);
            canvas.drawPath(path, paints[i]);
          }
          end(env);
        },
        dispose() {
          canvas.delete();
          path.delete();
          paints.forEach((paint) => paint.delete());
          module._free(scratch);
        },
      };
    },

    B: (env) => {
      const { module } = env;
      const setPolyline = module._bx_path_set_polyline;
      const drawPath = module._bx_draw_path;
      const path = module._bx_path_new();
      const paints = Int32Array.from({ length: N3 }, (_, i) => {
        const paint = module._bx_paint_new();
        module._bx_paint_set_stroke(paint, STROKE);
        module._bx_paint_set_color(paint, ...colorOfPath(i));
        return paint;
      });
      const scratch = module._malloc(P3 * 2 * 4);
      return {
        frame(time) {
          begin(env);
          let f32 = module.HEAPF32;
          for (let i = 0; i < N3; i++) {
            if (f32.length === 0) {
              f32 = module.HEAPF32;
            }
            let p = scratch >> 2;
            for (let j = 0; j < P3; j++) {
              const phase = time * 0.004 + j * 0.3 + i * 0.2;
              f32[p++] = xs3[j] + 2 * Math.cos(phase);
              f32[p++] = ys3[i] + 4 * Math.sin(phase);
            }
            setPolyline(path, scratch, P3);
            drawPath(path, paints[i]);
          }
          end(env);
        },
        dispose() {
          module._bx_path_delete(path);
          paints.forEach((paint) => module._bx_paint_delete(paint));
          module._free(scratch);
        },
      };
    },

    C: (env) => {
      const { module } = env;
      const size = 7 + P3 * 2;
      const buffer = module._malloc(N3 * size * 4);
      return {
        frame(time) {
          const f32 = module.HEAPF32;
          const u32 = module.HEAPU32;
          let p = buffer >> 2;
          for (let i = 0; i < N3; i++) {
            u32[p] = Command.DrawPolyline;
            u32[p + 1] = P3;
            f32[p + 2] = STROKE;
            f32[p + 3] = i / N3;
            f32[p + 4] = 0.4;
            f32[p + 5] = 1 - i / N3;
            f32[p + 6] = 1;
            p += 7;
            for (let j = 0; j < P3; j++) {
              const phase = time * 0.004 + j * 0.3 + i * 0.2;
              f32[p++] = xs3[j] + 2 * Math.cos(phase);
              f32[p++] = ys3[i] + 4 * Math.sin(phase);
            }
          }
          begin(env);
          module._cb_play(buffer, p - (buffer >> 2));
          end(env);
        },
        dispose() {
          module._free(buffer);
        },
      };
    },

    D: (env) => {
      const { scene, lines, dispose } = recordPaths(env);
      const pointsOf = Int32Array.from(lines, (line) => line.points);
      return {
        frame(time) {
          const { f32 } = scene;
          for (let i = 0; i < N3; i++) {
            let p = pointsOf[i];
            for (let j = 0; j < P3; j++) {
              const phase = time * 0.004 + j * 0.3 + i * 0.2;
              f32[p++] = xs3[j] + 2 * Math.cos(phase);
              f32[p++] = ys3[i] + 4 * Math.sin(phase);
            }
          }
          env.surface.draw(scene);
        },
        dispose,
      };
    },

    E: (env) => {
      const { scene, dispose } = recordPaths(env);
      const { lines } = scene.values;
      // The helper copies from an array: the points are computed into one.
      const points = new Float32Array(P3 * 2);
      return {
        frame(time) {
          for (let i = 0; i < N3; i++) {
            let p = 0;
            for (let j = 0; j < P3; j++) {
              const phase = time * 0.004 + j * 0.3 + i * 0.2;
              points[p++] = xs3[j] + 2 * Math.cos(phase);
              points[p++] = ys3[i] + 4 * Math.sin(phase);
            }
            lines[i].setPoints(points);
          }
          env.surface.draw(scene);
        },
        dispose,
      };
    },

    // Nothing is written: no path is rebuilt.
    S: (env) => {
      const { scene, dispose } = recordPaths(env);
      return {
        frame() {
          env.surface.draw(scene);
        },
        dispose,
      };
    },
  },
};

const recordPaths = ({ sk }: Env) => {
  const b = sk.builder();
  const lines = Array.from({ length: N3 }, (_, i) => {
    const line = b.pathBuffer({ maxVerbs: P3, maxPoints: P3 });
    b.drawPath(line, {
      color: colorOfPath(i),
      style: "stroke",
      strokeWidth: STROKE,
    });
    return line;
  });
  const program = b.build({ lines });
  const scene = program.instantiate();
  // The verbs never change: written once. The points start as straight lines.
  const { f32, u32 } = scene;
  lines.forEach((line, i) => {
    writePolylineVerbs(u32, line, P3);
    for (let j = 0; j < P3; j++) {
      f32[line.points + 2 * j] = xs3[j];
      f32[line.points + 2 * j + 1] = ys3[i];
    }
  });
  return {
    scene,
    lines,
    dispose() {
      scene.dispose();
      program.dispose();
    },
  };
};

/* ------------------------------------------------------------------------ *
 * Scene 4: 2,000 images from 4 textures, each changing texture every frame.
 * ------------------------------------------------------------------------ */

const N4 = 2000;
const cells4 = grid(N4, 50, 40);
const SIZE4 = 16;
const xs4 = cells4.xs.map((x) => x + 2);
const ys4 = cells4.ys.map((y) => y + 4);

const images: Scene = {
  id: "images",
  title: "2,000 images from 4 textures, rebound every frame",
  variants: {
    A: (env) => {
      const { module } = env;
      const canvas = new module.Canvas();
      const wrapped = env.textures.map((texture) =>
        module._MakeImageFromTexture(module.WebGPU.importJsTexture(texture))
      );
      return {
        frame(_time, frame) {
          begin(env);
          for (let i = 0; i < N4; i++) {
            canvas.drawImageRect4f(
              wrapped[(i + frame) & 3],
              xs4[i],
              ys4[i],
              SIZE4,
              SIZE4
            );
          }
          end(env);
        },
        dispose() {
          canvas.delete();
          wrapped.forEach((image) => image.delete());
        },
      };
    },

    B: (env) => {
      const { module } = env;
      const drawImageRect = module._bx_draw_image_rect;
      const wrapped = Int32Array.from(env.textures, (texture) =>
        module._bx_image_from_texture(module.WebGPU.importJsTexture(texture))
      );
      return {
        frame(_time, frame) {
          begin(env);
          for (let i = 0; i < N4; i++) {
            drawImageRect(
              wrapped[(i + frame) & 3],
              xs4[i],
              ys4[i],
              SIZE4,
              SIZE4
            );
          }
          end(env);
        },
        dispose() {
          wrapped.forEach((image) => module._bx_image_release(image));
        },
      };
    },

    C: (env) => {
      const { module } = env;
      const wrapped = Int32Array.from(env.textures, (texture) =>
        module._bx_image_from_texture(module.WebGPU.importJsTexture(texture))
      );
      const buffer = module._malloc(N4 * 6 * 4);
      return {
        frame(_time, frame) {
          const f32 = module.HEAPF32;
          const u32 = module.HEAPU32;
          let p = buffer >> 2;
          for (let i = 0; i < N4; i++) {
            u32[p] = Command.DrawImage;
            u32[p + 1] = wrapped[(i + frame) & 3];
            f32[p + 2] = xs4[i];
            f32[p + 3] = ys4[i];
            f32[p + 4] = SIZE4;
            f32[p + 5] = SIZE4;
            p += 6;
          }
          begin(env);
          module._cb_play(buffer, p - (buffer >> 2));
          end(env);
        },
        dispose() {
          wrapped.forEach((image) => module._bx_image_release(image));
          module._free(buffer);
        },
      };
    },

    D: (env) => {
      const { scene, slots, wrapped, dispose } = recordImages(env);
      const slotOf = Int32Array.from(slots);
      const handles = Uint32Array.from(wrapped, (image) => image.handle);
      return {
        frame(_time, frame) {
          const { u32 } = scene;
          for (let i = 0; i < N4; i++) {
            u32[slotOf[i]] = handles[(i + frame) & 3];
          }
          env.surface.draw(scene);
        },
        dispose,
      };
    },

    E: (env) => {
      const { scene, wrapped, dispose } = recordImages(env);
      const { pictures } = scene.values;
      return {
        frame(_time, frame) {
          for (let i = 0; i < N4; i++) {
            pictures.set(i, wrapped[(i + frame) & 3]);
          }
          env.surface.draw(scene);
        },
        dispose,
      };
    },
  },
};

const recordImages = ({ sk, textures }: Env) => {
  const wrapped = textures.map((texture) =>
    sk.texture(texture, { opaque: true })
  );
  const b = sk.builder();
  const slots: Slot<"image">[] = [];
  for (let i = 0; i < N4; i++) {
    const picture = b.slot(wrapped[i & 3]);
    slots.push(picture);
    b.drawImage(picture, {
      x: xs4[i],
      y: ys4[i],
      width: SIZE4,
      height: SIZE4,
    });
  }
  const program = b.build({ pictures: slots });
  const scene = program.instantiate();
  return {
    scene,
    slots,
    wrapped,
    dispose() {
      scene.dispose();
      program.dispose();
      wrapped.forEach((image) => image.release());
    },
  };
};

export const scenes: Scene[] = [rrects, shaders, paths, images];
