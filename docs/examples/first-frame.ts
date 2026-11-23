import { Skia } from "skia-wasm";

// Skia draws with the GPUDevice of the page.
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();

// Loads the wasm module and creates Skia's context on the device.
const sk = await Skia.init({ device });

// A surface is where drawing ends up: this one configures the canvas.
const surface = sk.surface(document.querySelector("canvas")!);

// A paint says how something is drawn.
const paint = sk.paint({ color: "#3b82f6" });

// A frame: ask for the canvas, draw, flush.
const canvas = surface.getCanvas();
canvas.clear("white");
canvas.drawRoundedRect(96, 156, 320, 200, 32, paint);
surface.flush();
