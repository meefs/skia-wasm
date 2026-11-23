import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const canvas = document.querySelector("canvas")!;
const sk = await Skia.init({ device, canvas });

// A PNG, JPEG or WebP file: decoded, then uploaded to the GPU.
const response = await fetch("image.png");
const image = await sk.image(await response.arrayBuffer());

const b = sk.builder();
b.drawImage(image, { x: 56, y: 56, width: 400, height: 400 });
const program = b.build();
// The program holds its own reference: the handle can be released.
image.release();

const scene = program.instantiate();
sk.surface.setClearColor(1, 1, 1);
sk.surface.draw(scene);
