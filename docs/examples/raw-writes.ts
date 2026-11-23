import { Skia, paintColor, writeColor, writeRotate } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const canvas = document.querySelector("canvas")!;
const sk = await Skia.init({ device, canvas });

const b = sk.builder();
const transform = b.matrix();
const paint = b.paint({ color: "#3b82f6" });
b.save();
b.concat(transform);
b.drawRect({ x: 176, y: 176, width: 160, height: 160 }, paint);
b.restore();
const program = b.build();

// A slot is an offset into the data block. This one is the color of the paint.
const color = paintColor(paint);

const scene = program.instantiate();
sk.surface.setClearColor(1, 1, 1);

const frame = (time: number) => {
  const t = time / 1000;
  // Read `f32` again every frame: the view is detached when wasm memory grows.
  const { f32 } = scene;
  writeRotate(f32, transform, t, 256, 256);
  writeColor(f32, color, 0.5 + 0.5 * Math.sin(t * 2), 0.4, 1);
  sk.surface.draw(scene);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
