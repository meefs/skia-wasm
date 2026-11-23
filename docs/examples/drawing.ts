import { Skia, Verb } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const canvas = document.querySelector("canvas")!;
const sk = await Skia.init({ device, canvas });

const CAPACITY = 8192;

const b = sk.builder();
const strokes = b.pathBuffer({ maxVerbs: CAPACITY, maxPoints: CAPACITY });
b.drawPath(strokes, { color: "#0f172a", style: "stroke", strokeWidth: 4 });
const program = b.build();

const scene = program.instantiate();
sk.surface.setClearColor(1, 1, 1);
sk.surface.draw(scene);

// Every point comes with one verb: a move starts a stroke, a line extends it.
let count = 0;
const add = (event: PointerEvent, verb: number) => {
  if (count === CAPACITY) {
    return;
  }
  const { f32, u32 } = scene;
  u32[strokes.verbs + count] = verb;
  f32[strokes.points + count * 2] = event.offsetX;
  f32[strokes.points + count * 2 + 1] = event.offsetY;
  count++;
  u32[strokes.verbCount] = count;
  u32[strokes.pointCount] = count;
  // Nothing animates: a frame is drawn when the path changes.
  sk.surface.draw(scene);
};

let drawing = false;
canvas.addEventListener("pointerdown", (event) => {
  drawing = true;
  canvas.setPointerCapture(event.pointerId);
  add(event, Verb.Move);
});
canvas.addEventListener("pointermove", (event) => {
  if (drawing) {
    add(event, Verb.Line);
  }
});
canvas.addEventListener("pointerup", () => {
  drawing = false;
});
