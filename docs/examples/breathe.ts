import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const canvas = document.querySelector("canvas")!;
const sk = await Skia.init({ device, canvas });

const COUNT = 6;
const RADIUS = 96;

const b = sk.builder();
b.drawRect({ width: 512, height: 512 }, { color: "#242b38" });
// One disc per ring, around the origin: its matrix puts it in place.
const rings = Array.from({ length: COUNT }, (_, i) => {
  const transform = b.matrix();
  b.save();
  b.concat(transform);
  b.drawRRect(
    {
      x: -RADIUS,
      y: -RADIUS,
      width: 2 * RADIUS,
      height: 2 * RADIUS,
      r: RADIUS,
    },
    { color: i % 2 === 0 ? "#61bea2" : "#529ca0", blendMode: "Screen" }
  );
  b.restore();
  return transform;
});
// An array of slots in the schema is an array in `scene.values`.
const program = b.build({ rings });

const scene = program.instantiate();

const frame = (time: number) => {
  // Breathes in and out: from 0 to 1 and back, every six seconds.
  const progress = 0.5 - 0.5 * Math.cos((time / 3000) * Math.PI);
  const scale = 0.3 + 0.7 * progress;
  scene.values.rings.forEach((ring, i) => {
    const angle = (i / COUNT) * 2 * Math.PI + progress * Math.PI;
    const distance = scale * RADIUS * progress;
    ring.set(
      scale,
      0,
      256 + distance * Math.cos(angle),
      0,
      scale,
      256 + distance * Math.sin(angle)
    );
  });
  sk.surface.draw(scene);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
