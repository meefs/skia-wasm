import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const canvas = document.querySelector("canvas")!;
const sk = await Skia.init({ device, canvas });

const b = sk.builder();
// An SVG path string, parsed once when the program is built.
const heart = b.path(
  "M 256 416 C 96 304 96 144 256 208 C 416 144 416 304 256 416 Z"
);
b.drawPath(heart, { color: "#ef4444" });
b.drawPath(heart, { color: "#7f1d1d", style: "stroke", strokeWidth: 8 });
const program = b.build();

const scene = program.instantiate();
sk.surface.setClearColor(1, 1, 1);
sk.surface.draw(scene);
