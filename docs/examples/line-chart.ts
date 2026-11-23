import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const canvas = document.querySelector("canvas")!;
const sk = await Skia.init({ device, canvas });

const COUNT = 48;
const LEFT = 32;
const RIGHT = 480;
const BOTTOM = 448;

const b = sk.builder();
const fade = b.linearGradient({
  start: [0, 96],
  end: [0, BOTTOM],
  colors: ["#3b82f6aa", "#3b82f600"],
});
// The area under the curve is the curve plus two corners, closed.
const area = b.pathBuffer({ maxVerbs: COUNT + 3, maxPoints: COUNT + 2 });
const line = b.pathBuffer({ maxVerbs: COUNT, maxPoints: COUNT });
b.drawPath(area, { shader: fade });
b.drawPath(line, { color: "#3b82f6", style: "stroke", strokeWidth: 4 });
const program = b.build({ area, line });

const scene = program.instantiate();
sk.surface.setClearColor(1, 1, 1);

const curve = new Float32Array(COUNT * 2);
const outline = new Float32Array((COUNT + 2) * 2);
outline.set([RIGHT, BOTTOM, LEFT, BOTTOM], COUNT * 2);

const frame = (time: number) => {
  const t = time / 1000;
  for (let i = 0; i < COUNT; i++) {
    curve[i * 2] = LEFT + (i / (COUNT - 1)) * (RIGHT - LEFT);
    curve[i * 2 + 1] =
      256 + 80 * Math.sin(i / 6 + t) + 40 * Math.sin(i / 2.5 - t * 1.7);
  }
  outline.set(curve);
  scene.values.line.setPolyline(curve);
  scene.values.area.setPolyline(outline, true);
  sk.surface.draw(scene);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
