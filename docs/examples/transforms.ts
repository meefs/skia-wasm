import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({ device });
const surface = sk.surface(document.querySelector("canvas")!);

const card = sk.paint({ color: "#3b82f6" });
const dot = sk.paint({ color: "#f97316" });

const frame = (time: number) => {
  const t = time / 1000;
  const canvas = surface.getCanvas();
  canvas.clear("white");

  // What is between save() and restore() is drawn in its own space.
  canvas.save();
  canvas.translate(256, 256);
  canvas.rotate(t);
  canvas.scale(1 + 0.25 * Math.sin(t * 2));
  canvas.drawRoundedRect(-100, -60, 200, 120, 16, card);
  // Nested: the dot orbits a corner of the card.
  canvas.save();
  canvas.translate(100, 60);
  canvas.rotate(-t * 4);
  canvas.drawCircle(40, 0, 12, dot);
  canvas.restore();
  canvas.restore();

  surface.flush();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
