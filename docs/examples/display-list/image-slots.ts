import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const canvas = document.querySelector("canvas")!;
const sk = await Skia.init({ device });
const surface = sk.surface(canvas);

// A texture of the page, wrapped as an image without a copy.
const solid = (r: number, g: number, b: number) => {
  const texture = device.createTexture({
    size: [1, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture },
    new Uint8Array([r, g, b, 255]),
    { bytesPerRow: 4 },
    [1, 1]
  );
  return sk.texture(texture, { opaque: true });
};
const images = [solid(239, 68, 68), solid(34, 197, 94), solid(59, 130, 246)];

const b = sk.builder();
// A slot is one word of the data block that names an image.
const picture = b.slot(images[0]);
b.drawImage(picture, { x: 156, y: 156, width: 200, height: 200 });
const program = b.build({ picture });

const scene = program.instantiate();
surface.setClearColor(1, 1, 1);

const frame = (time: number) => {
  // Rebinding a slot is one integer write.
  scene.values.picture = images[Math.floor(time / 500) % images.length];
  surface.draw(scene);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
