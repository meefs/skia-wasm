/**
 * canvaskit-wasm as published on npm: Skia's own JavaScript bindings (embind),
 * on Ganesh and WebGL. It is what React Native Skia draws with on the web
 * today, so it is the reference the Graphite and WebGPU build has to match.
 *
 * It draws on a canvas of its own: a canvas has one kind of context.
 */
import type { Canvas, CanvasKit, Surface } from "canvaskit-wasm";

export interface CanvasKitEnv {
  ck: CanvasKit;
  surface: Surface;
  canvas: Canvas;
}

export const loadCanvasKit = async (
  element: HTMLCanvasElement
): Promise<CanvasKitEnv> => {
  // scripts/build-bench.ts copies the "full" build there.
  const base = new URL("../dist/bench/canvaskit/", location.href).href;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${base}canvaskit.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("canvaskit.js did not load."));
    document.head.append(script);
  });
  const init = (
    window as unknown as {
      CanvasKitInit: (options: {
        locateFile(file: string): string;
      }) => Promise<CanvasKit>;
    }
  ).CanvasKitInit;
  const ck = await init({ locateFile: (file) => base + file });
  const surface = ck.MakeWebGLCanvasSurface(element);
  if (!surface) {
    throw new Error("CanvasKit did not create a WebGL surface.");
  }
  return { ck, surface, canvas: surface.getCanvas() };
};
