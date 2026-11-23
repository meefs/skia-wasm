import { Skia } from "skia-wasm";
import type { Color } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({
  device,
  canvas: document.querySelector("canvas")!,
});

const COUNT = 800;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// A color is a CSS string or RGBA in [0, 1]: numbers are cheaper in a loop.
const colors: Color[] = Array.from({ length: COUNT }, (_, i) => {
  const hue = (i / COUNT) * 2 * Math.PI;
  return [
    0.5 + 0.5 * Math.cos(hue),
    0.5 + 0.5 * Math.cos(hue + (2 * Math.PI) / 3),
    0.5 + 0.5 * Math.cos(hue + (4 * Math.PI) / 3),
  ];
});
const paint = sk.paint();

const frame = (time: number) => {
  const t = time / 1000;
  const spread = 7 + 1.5 * Math.sin(t);

  const canvas = sk.surface.getCanvas();
  canvas.clear("#0f172a");
  // 800 dots a frame: one call to set the color, one to draw.
  for (let i = 0; i < COUNT; i++) {
    const angle = i * GOLDEN_ANGLE + t * 0.2;
    const radius = spread * Math.sqrt(i);
    paint.color = colors[i];
    canvas.drawCircle(
      256 + radius * Math.cos(angle),
      256 + radius * Math.sin(angle),
      3 + 2 * Math.sin(t * 2 - i / 40),
      paint
    );
  }
  sk.surface.flush();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
