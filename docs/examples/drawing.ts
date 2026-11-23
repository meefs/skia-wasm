import { Skia } from "skia-wasm";
import type { Path } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const element = document.querySelector("canvas")!;
const sk = await Skia.init({ device, canvas: element });

const pen = sk.paint({
  color: "#0f172a",
  style: "stroke",
  strokeWidth: 4,
  strokeCap: "round",
  strokeJoin: "round",
});

// One path per stroke.
const strokes: Path[] = [];

// Nothing animates: a frame is drawn when a stroke changes.
const draw = () => {
  const canvas = sk.surface.getCanvas();
  canvas.clear("white");
  for (const stroke of strokes) {
    canvas.drawPath(stroke, pen);
  }
  sk.surface.flush();
};
draw();

let current: Path | null = null;
element.addEventListener("pointerdown", (event) => {
  element.setPointerCapture(event.pointerId);
  current = sk.path().moveTo(event.offsetX, event.offsetY);
  strokes.push(current);
});
element.addEventListener("pointermove", (event) => {
  if (current) {
    current.lineTo(event.offsetX, event.offsetY);
    draw();
  }
});
element.addEventListener("pointerup", () => {
  current = null;
});
