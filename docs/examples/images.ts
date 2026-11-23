import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({ device });
const surface = sk.surface(document.querySelector("canvas")!);

// A PNG, JPEG or WebP file: decoded, then uploaded to the GPU.
const response = await fetch("image.png");
const image = await sk.image(await response.arrayBuffer());

// An image is also a shader: here it repeats, mirrored, at a quarter of its
// size.
const pattern = sk.paint({
  shader: image.shader({
    tileX: "mirror",
    tileY: "mirror",
    matrix: [0.25, 0, 0, 0, 0.25, 0],
  }),
});
const faded = sk.paint({ alpha: 0.4 });

const canvas = surface.getCanvas();
canvas.clear("white");
// At a size.
canvas.drawImage(image, 32, 32, 208, 208);
// A part of it, the sun, into a rect.
canvas.drawImageRect(image, 176, 248, 160, 160, 272, 32, 208, 208);
// As the shader of a shape.
canvas.drawCircle(136, 376, 104, pattern);
// Through a paint, for its alpha, blend mode or filters.
canvas.drawImage(image, 272, 272, 208, 208, { paint: faded });
surface.flush();
