import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({ device });
const surface = sk.surface(document.querySelector("canvas")!);

const COUNT = 6;
const RADIUS = 96;

// Two colors, blended with Screen and glowing through a mask blur.
const paints = ["#61bea2", "#529ca0"].map((color) =>
  sk.paint({
    color,
    blendMode: "screen",
    maskFilter: sk.maskFilter.blur(10, "solid"),
  })
);

const frame = (time: number) => {
  // Breathes in and out: from 0 to 1 and back, every six seconds.
  const progress = 0.5 - 0.5 * Math.cos((time / 3000) * Math.PI);
  const scale = 0.3 + 0.7 * progress;

  const canvas = surface.getCanvas();
  canvas.clear("#242b38");
  canvas.translate(256, 256);
  canvas.rotate(progress * Math.PI);
  canvas.scale(scale);
  for (let i = 0; i < COUNT; i++) {
    const angle = (i / COUNT) * 2 * Math.PI;
    canvas.drawCircle(
      progress * RADIUS * Math.cos(angle),
      progress * RADIUS * Math.sin(angle),
      RADIUS,
      paints[i % 2]
    );
  }
  surface.flush();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
