import { Skia } from "skia-wasm";

// Skia draws with the GPUDevice of the page.
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();

// Loads the wasm module and configures the canvas.
const sk = await Skia.init({
  device,
  canvas: document.querySelector("canvas")!,
});

// A paint says how something is drawn.
const paint = sk.paint({ color: "#3b82f6" });

// A frame: ask for the canvas, draw, flush.
const canvas = sk.surface.getCanvas();
canvas.clear("white");
canvas.drawRoundedRect(96, 156, 320, 200, 32, paint);
sk.surface.flush();
