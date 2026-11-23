import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const canvas = document.querySelector("canvas")!;
const sk = await Skia.init({ device, canvas });

const b = sk.builder();
const gradient = b.linearGradient({
  start: [56, 56],
  end: [456, 456],
  colors: ["#f97316", "#ec4899", "#6366f1"],
});
b.drawRRect(
  { x: 56, y: 56, width: 400, height: 400, r: 48 },
  { shader: gradient }
);
// The points and the colors of the gradient are slots too.
const program = b.build({ end: gradient.end, middle: gradient.colors[1] });

const scene = program.instantiate();
sk.surface.setClearColor(1, 1, 1);

const frame = (time: number) => {
  const t = time / 1000;
  scene.values.end.set(256 + 200 * Math.cos(t), 256 + 200 * Math.sin(t));
  scene.values.middle.set(0.9, 0.3, 0.5 + 0.4 * Math.sin(t * 2), 1);
  sk.surface.draw(scene);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
