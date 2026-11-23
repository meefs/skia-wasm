import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const canvas = document.querySelector("canvas")!;
const sk = await Skia.init({ device });
const surface = sk.surface(canvas);

const b = sk.builder();
// A value is allocated in the data block. What comes back is its slot.
const transform = b.matrix();
b.save();
b.concat(transform);
b.drawRRect(
  { x: 156, y: 196, width: 200, height: 120, r: 16 },
  { color: "#3b82f6" }
);
b.restore();
// The schema names the slots to animate: they become `scene.values`.
const program = b.build({ transform });

const scene = program.instantiate();
surface.setClearColor(1, 1, 1);

const frame = (time: number) => {
  scene.values.transform.setRotate(time / 1000, 256, 256);
  surface.draw(scene);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
