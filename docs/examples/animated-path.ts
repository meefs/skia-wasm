import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const canvas = document.querySelector("canvas")!;
const sk = await Skia.init({ device, canvas });

const COUNT = 64;

const b = sk.builder();
// A path whose verbs and points live in the data block, with a fixed capacity.
const wave = b.pathBuffer({ maxVerbs: COUNT, maxPoints: COUNT });
b.drawPath(wave, { color: "#3b82f6", style: "stroke", strokeWidth: 6 });
const program = b.build({ wave });

const scene = program.instantiate();
sk.surface.setClearColor(1, 1, 1);

const points = new Float32Array(COUNT * 2);
const frame = (time: number) => {
  for (let i = 0; i < COUNT; i++) {
    const x = (i / (COUNT - 1)) * 512;
    points[i * 2] = x;
    points[i * 2 + 1] = 256 + 96 * Math.sin(x / 48 + time / 300);
  }
  // One contour through the points: a move, then lines.
  scene.values.wave.setPolyline(points);
  sk.surface.draw(scene);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
