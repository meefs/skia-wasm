import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({
  device,
  canvas: document.querySelector("canvas")!,
});

// A paint says how something is drawn. Colors are CSS strings.
const fill = sk.paint({ color: "#3b82f6" });
const stroke = sk.paint({
  color: "midnightblue",
  style: "stroke",
  strokeWidth: 8,
  strokeCap: "round",
});

// Positions and sizes are plain numbers; angles are in radians.
const canvas = sk.surface.getCanvas();
canvas.clear("white");
canvas.drawRect(32, 32, 192, 112, fill);
canvas.drawRoundedRect(288, 32, 192, 112, 24, fill);
canvas.drawRoundedRect(
  32,
  200,
  192,
  112,
  { topLeft: 56, bottomRight: 56 },
  fill
);
canvas.drawOval(288, 200, 192, 112, stroke);
canvas.drawCircle(96, 424, 56, fill);
canvas.drawLine(192, 380, 320, 468, stroke);
canvas.drawArc(352, 368, 112, 112, 0, 1.5 * Math.PI, true, fill);
// Nothing reaches the GPU before the frame is flushed.
sk.surface.flush();
