import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({
  device,
  canvas: document.querySelector("canvas")!,
});

const colors = ["#f97316", "#ec4899", "#6366f1"];

// The first two rows of a rotation around a pivot.
const rotation = (radians: number, px: number, py: number) => {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    cos,
    -sin,
    px - cos * px + sin * py,
    sin,
    cos,
    py - sin * px - cos * py,
  ];
};

// A shader replaces the color of a paint.
const linear = sk.paint({
  shader: sk.linearGradient({ start: [32, 32], end: [224, 224], colors }),
});
const radial = sk.paint({
  shader: sk.radialGradient({ center: [384, 128], radius: 96, colors }),
});
const conical = sk.paint({
  shader: sk.conicalGradient({
    start: [104, 360],
    startRadius: 16,
    end: [128, 384],
    endRadius: 96,
    colors,
  }),
});
const sweep = sk.paint();

const frame = (time: number) => {
  const canvas = sk.surface.getCanvas();
  canvas.clear("white");
  canvas.drawRoundedRect(32, 32, 192, 192, 24, linear);
  canvas.drawRoundedRect(288, 32, 192, 192, 24, radial);
  canvas.drawRoundedRect(32, 288, 192, 192, 24, conical);

  // A gradient is immutable: animating one is making another. The paint
  // keeps the shader it is given, so the object here can be disposed.
  const turning = sk.sweepGradient({
    center: [384, 384],
    colors: [...colors, colors[0]],
    matrix: rotation(time / 1000, 384, 384),
  });
  sweep.shader = turning;
  turning.dispose();
  canvas.drawRoundedRect(288, 288, 192, 192, 24, sweep);

  sk.surface.flush();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
