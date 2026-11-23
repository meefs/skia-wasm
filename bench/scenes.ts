/// <reference types="@webgpu/types" />
/**
 * The scenes of the benchmark. Each is animated on every frame and drawn two
 * ways, with the same arithmetic:
 *
 *   K  canvaskit-wasm from npm: Ganesh on WebGL, through embind
 *   I  skia-wasm: a canvas, paints and paths, one call per operation, on
 *      Graphite and WebGPU
 *
 * Each is written the way its own documentation advises for speed, and no
 * further: K keeps its arrays in wasm memory (Malloc), I reuses its arrays
 * instead of allocating one per call.
 *
 * `frame()` returns the milliseconds the frame spent in its last step, the
 * one that sends what was recorded to the GPU: flush().
 */
import type { Skia, Surface } from "../src/ts";

import type { CanvasKitEnv } from "./canvaskit";

export const WIDTH = 1024;
export const HEIGHT = 1024;

export interface Env {
  sk: Skia;
  surface: Surface;
  /** Four textures for the image scene. */
  textures: GPUTexture[];
  /** Their pixels: 32 by 32, RGBA. */
  texturePixels: Uint8Array[];
  /** canvaskit-wasm on its own canvas. */
  canvaskit: CanvasKitEnv | null;
}

export interface Variant {
  /** Which canvas it draws to. */
  target: "webgpu" | "webgl";
  /**
   * Draws one frame. `time` is in milliseconds, `frame` counts frames.
   * Returns the milliseconds spent sending the frame to the GPU.
   */
  frame(time: number, frame: number): number;
  /** The frame just drawn, as RGBA, when it is not on the WebGPU canvas. */
  readPixels?(): Uint8Array | null;
  dispose(): void;
}

export type VariantFactory = (env: Env) => Variant;

export interface Scene {
  id: string;
  title: string;
  variants: Record<string, VariantFactory>;
}

export const variantNames: Record<string, string> = {
  K: "canvaskit-wasm (WebGL)",
  I: "skia-wasm (WebGPU)",
};

const canvaskitOf = (env: Env) => {
  if (env.canvaskit === null) {
    throw new Error("CanvasKit is not loaded.");
  }
  return env.canvaskit;
};

const readCanvasKit = ({ ck, canvas }: CanvasKitEnv) =>
  canvas.readPixels(0, 0, {
    width: WIDTH,
    height: HEIGHT,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  }) as Uint8Array | null;

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
    K: (env) => {
      const canvaskit = canvaskitOf(env);
      const { ck, surface, canvas } = canvaskit;
      const paint = new ck.Paint();
      paint.setAntiAlias(true);
      // A 4x4, row-major: the one size of matrix that concat() takes from
      // wasm memory without copying. A 3x3 would be read element by element.
      const matrix = ck.Malloc(Float32Array, 16);
      const rrect = ck.Malloc(Float32Array, 12);
      (matrix.toTypedArray() as Float32Array).set([
        1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
      ]);
      // Left, top, right, bottom, then four pairs of radii.
      (rrect.toTypedArray() as Float32Array).set([
        -4, -4, 4, 4, 2, 2, 2, 2, 2, 2, 2, 2,
      ]);
      return {
        target: "webgl",
        frame(time, frame) {
          canvas.clear(ck.WHITE);
          let m = matrix.toTypedArray() as Float32Array;
          for (let i = 0; i < N1; i++) {
            const angle = time * 0.002 + i * 0.01;
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            const red = ((i + frame) & 255) / 255;
            canvas.save();
            // A view on memory that grew has no length.
            if (m.length === 0) {
              m = matrix.toTypedArray() as Float32Array;
            }
            m[0] = c;
            m[1] = -s;
            m[3] = xs1[i];
            m[4] = s;
            m[5] = c;
            m[7] = ys1[i];
            canvas.concat(matrix);
            paint.setColorComponents(red, 0.5, 1 - red, 1);
            canvas.drawRRect(rrect, paint);
            canvas.restore();
          }
          const drawn = performance.now();
          surface.flush();
          return performance.now() - drawn;
        },
        readPixels: () => readCanvasKit(canvaskit),
        dispose() {
          paint.delete();
          ck.Free(matrix);
          ck.Free(rrect);
        },
      };
    },

    I: ({ sk, surface }) => {
      const paint = sk.paint();
      // One array for the color, written in place: a new one per call would
      // be 10,000 short-lived arrays per frame.
      const color: [number, number, number, number] = [0, 0.5, 1, 1];
      return {
        target: "webgpu",
        frame(time, frame) {
          const canvas = surface.getCanvas();
          for (let i = 0; i < N1; i++) {
            const angle = time * 0.002 + i * 0.01;
            const c = Math.cos(angle);
            const s = Math.sin(angle);
            const red = ((i + frame) & 255) / 255;
            canvas.save();
            canvas.concat(c, -s, xs1[i], s, c, ys1[i]);
            color[0] = red;
            color[2] = 1 - red;
            paint.color = color;
            canvas.drawRoundedRect(-4, -4, 8, 8, 2, paint);
            canvas.restore();
          }
          const drawn = performance.now();
          surface.flush();
          return performance.now() - drawn;
        },
        dispose() {
          paint.dispose();
        },
      };
    },
  },
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

const shaders: Scene = {
  id: "shaders",
  title: "1,000 rects with a runtime shader, each with its own uniforms",
  variants: {
    K: (env) => {
      const canvaskit = canvaskitOf(env);
      const { ck, surface, canvas } = canvaskit;
      // The layout of the uniform block is the same in both builds of Skia.
      const described = env.sk.effect<Uniforms>(SKSL);
      const words = described.size;
      const t = described.uniforms.iTime.offset;
      const k = described.uniforms.color.offset;
      described.release();
      const paint = new ck.Paint();
      paint.setAntiAlias(true);
      const effect = ck.RuntimeEffect.Make(SKSL);
      if (!effect) {
        throw new Error("CanvasKit did not compile the effect.");
      }
      const uniforms = ck.Malloc(Float32Array, words);
      return {
        target: "webgl",
        frame(time, frame) {
          canvas.clear(ck.WHITE);
          let u = uniforms.toTypedArray() as Float32Array;
          for (let i = 0; i < N2; i++) {
            const red = ((i + frame) & 255) / 255;
            if (u.length === 0) {
              u = uniforms.toTypedArray() as Float32Array;
            }
            u[t] = time * 0.001 + i * 0.1;
            u[k] = red;
            u[k + 1] = 0.3;
            u[k + 2] = 1 - red;
            u[k + 3] = 1;
            // A new uniform value is a new shader, and a new wrapper for it.
            const shader = effect.makeShader(uniforms);
            paint.setShader(shader);
            canvas.drawRect4f(xs2[i], ys2[i], xs2[i] + W2, ys2[i] + H2, paint);
            shader.delete();
          }
          const drawn = performance.now();
          surface.flush();
          return performance.now() - drawn;
        },
        readPixels: () => readCanvasKit(canvaskit),
        dispose() {
          paint.delete();
          effect.delete();
          ck.Free(uniforms);
        },
      };
    },

    I: ({ sk, surface }) => {
      const effect = sk.effect<Uniforms>(SKSL);
      const paint = sk.paint();
      // Reused: the values are read during the call.
      const color = [0, 0.3, 1, 1];
      const uniforms = { iTime: 0, color };
      return {
        target: "webgpu",
        frame(time, frame) {
          const canvas = surface.getCanvas();
          for (let i = 0; i < N2; i++) {
            const red = ((i + frame) & 255) / 255;
            uniforms.iTime = time * 0.001 + i * 0.1;
            color[0] = red;
            color[2] = 1 - red;
            // A new uniform value is a new shader, and a new wrapper for it.
            const shader = effect.shader(uniforms);
            paint.shader = shader;
            canvas.drawRect(xs2[i], ys2[i], W2, H2, paint);
            shader.dispose();
          }
          const drawn = performance.now();
          surface.flush();
          return performance.now() - drawn;
        },
        dispose() {
          paint.dispose();
          effect.release();
        },
      };
    },
  },
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
    // A path is immutable in this CanvasKit: each frame builds new ones.
    K: (env) => {
      const canvaskit = canvaskitOf(env);
      const { ck, surface, canvas } = canvaskit;
      const builder = new ck.PathBuilder();
      const points = ck.Malloc(Float32Array, P3 * 2);
      const paints = Array.from({ length: N3 }, (_, i) => {
        const paint = new ck.Paint();
        paint.setAntiAlias(true);
        paint.setStyle(ck.PaintStyle.Stroke);
        paint.setStrokeWidth(STROKE);
        paint.setColorComponents(...colorOfPath(i));
        return paint;
      });
      return {
        target: "webgl",
        frame(time) {
          canvas.clear(ck.WHITE);
          let f32 = points.toTypedArray() as Float32Array;
          for (let i = 0; i < N3; i++) {
            if (f32.length === 0) {
              f32 = points.toTypedArray() as Float32Array;
            }
            let p = 0;
            for (let j = 0; j < P3; j++) {
              const phase = time * 0.004 + j * 0.3 + i * 0.2;
              f32[p++] = xs3[j] + 2 * Math.cos(phase);
              f32[p++] = ys3[i] + 4 * Math.sin(phase);
            }
            builder.addPolygon(points, false);
            const path = builder.detach();
            canvas.drawPath(path, paints[i]);
            path.delete();
          }
          const drawn = performance.now();
          surface.flush();
          return performance.now() - drawn;
        },
        readPixels: () => readCanvasKit(canvaskit),
        dispose() {
          builder.delete();
          paints.forEach((paint) => paint.delete());
          ck.Free(points);
        },
      };
    },

    // One path, emptied and filled again for every line.
    I: ({ sk, surface }) => {
      const path = sk.path();
      const points = new Float32Array(P3 * 2);
      const paints = Array.from({ length: N3 }, (_, i) =>
        sk.paint({
          color: colorOfPath(i),
          style: "stroke",
          strokeWidth: STROKE,
        })
      );
      return {
        target: "webgpu",
        frame(time) {
          const canvas = surface.getCanvas();
          for (let i = 0; i < N3; i++) {
            let p = 0;
            for (let j = 0; j < P3; j++) {
              const phase = time * 0.004 + j * 0.3 + i * 0.2;
              points[p++] = xs3[j] + 2 * Math.cos(phase);
              points[p++] = ys3[i] + 4 * Math.sin(phase);
            }
            path.reset();
            path.addPolygon(points);
            canvas.drawPath(path, paints[i]);
          }
          const drawn = performance.now();
          surface.flush();
          return performance.now() - drawn;
        },
        dispose() {
          path.dispose();
          paints.forEach((paint) => paint.dispose());
        },
      };
    },
  },
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
    K: (env) => {
      const canvaskit = canvaskitOf(env);
      const { ck, surface, canvas } = canvaskit;
      // Texture-backed images, uploaded once, from the same pixels.
      const wrapped = env.texturePixels.map((pixels) => {
        const image = surface.makeImageFromTextureSource(
          new ImageData(new Uint8ClampedArray(pixels), 32, 32)
        );
        if (!image) {
          throw new Error("CanvasKit did not create the image.");
        }
        return image;
      });
      // Plain arrays: drawImageRectOptions() always reads its rects from its
      // own scratch memory, which it does not fill from a Malloc'd array.
      const source = Float32Array.of(0, 0, 32, 32);
      const destination = new Float32Array(4);
      return {
        target: "webgl",
        frame(_time, frame) {
          canvas.clear(ck.WHITE);
          const d = destination;
          for (let i = 0; i < N4; i++) {
            d[0] = xs4[i];
            d[1] = ys4[i];
            d[2] = xs4[i] + SIZE4;
            d[3] = ys4[i] + SIZE4;
            canvas.drawImageRectOptions(
              wrapped[(i + frame) & 3],
              source,
              destination,
              ck.FilterMode.Linear,
              ck.MipmapMode.None,
              null
            );
          }
          const drawn = performance.now();
          surface.flush();
          return performance.now() - drawn;
        },
        readPixels: () => readCanvasKit(canvaskit),
        dispose() {
          wrapped.forEach((image) => image.delete());
        },
      };
    },

    I: ({ sk, surface, textures }) => {
      const wrapped = textures.map((texture) =>
        sk.texture(texture, { opaque: true })
      );
      return {
        target: "webgpu",
        frame(_time, frame) {
          const canvas = surface.getCanvas();
          for (let i = 0; i < N4; i++) {
            canvas.drawImage(
              wrapped[(i + frame) & 3],
              xs4[i],
              ys4[i],
              SIZE4,
              SIZE4
            );
          }
          const drawn = performance.now();
          surface.flush();
          return performance.now() - drawn;
        },
        dispose() {
          wrapped.forEach((image) => image.release());
        },
      };
    },
  },
};

export const scenes: Scene[] = [rrects, shaders, paths, images];
