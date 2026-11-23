import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const canvas = document.querySelector("canvas")!;
const sk = await Skia.init({ device, canvas });

const COUNT = 800;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// One program of 800 dots, each with its own matrix in the data block.
const b = sk.builder();
b.drawRect({ width: 512, height: 512 }, { color: "#0f172a" });
const dots = Array.from({ length: COUNT }, (_, i) => {
  const transform = b.matrix();
  const hue = i / COUNT;
  b.save();
  b.concat(transform);
  b.drawRRect(
    { x: -5, y: -5, width: 10, height: 10, r: 5 },
    {
      color: [
        0.5 + 0.5 * Math.cos(2 * Math.PI * hue),
        0.5 + 0.5 * Math.cos(2 * Math.PI * (hue + 1 / 3)),
        0.5 + 0.5 * Math.cos(2 * Math.PI * (hue + 2 / 3)),
      ],
    }
  );
  b.restore();
  return transform;
});
const program = b.build({ dots });

const scene = program.instantiate();

const frame = (time: number) => {
  const t = time / 1000;
  const spread = 7 + 1.5 * Math.sin(t);
  scene.values.dots.forEach((dot, i) => {
    const angle = i * GOLDEN_ANGLE + t * 0.2;
    const radius = spread * Math.sqrt(i);
    const scale = 0.6 + 0.4 * Math.sin(t * 2 - i / 40);
    dot.set(
      scale,
      0,
      256 + radius * Math.cos(angle),
      0,
      scale,
      256 + radius * Math.sin(angle)
    );
  });
  // 800 matrices were written, and this is the only call into wasm.
  sk.surface.draw(scene);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
