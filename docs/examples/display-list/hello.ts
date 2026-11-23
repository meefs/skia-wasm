import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const canvas = document.querySelector("canvas")!;
const sk = await Skia.init({ device });
const surface = sk.surface(canvas);

// Record the scene once.
const b = sk.builder();
b.drawRRect(
  { x: 56, y: 96, width: 400, height: 320, r: 32 },
  { color: "#3b82f6" }
);
const program = b.build();

// An instance pairs the program with its data: it is what gets drawn.
const scene = program.instantiate();
surface.setClearColor(1, 1, 1);
surface.draw(scene);
