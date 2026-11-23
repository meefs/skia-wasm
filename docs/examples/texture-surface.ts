import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
// No canvas: this context only draws to textures.
const sk = await Skia.init({ device });

const SIZE = 256;
const texture = device.createTexture({
  size: [SIZE, SIZE],
  format: "rgba8unorm",
  usage:
    GPUTextureUsage.RENDER_ATTACHMENT |
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_SRC,
});
const surface = sk.makeSurface(texture);
surface.setClearColor(1, 1, 1);

const b = sk.builder();
b.drawRRect(
  { x: 48, y: 48, width: 160, height: 160, r: 24 },
  { color: "#3b82f6" }
);
const scene = b.build().instantiate();
surface.draw(scene);

// Read the pixels back with WebGPU.
const buffer = device.createBuffer({
  size: SIZE * SIZE * 4,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
});
const encoder = device.createCommandEncoder();
encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: SIZE * 4 }, [
  SIZE,
  SIZE,
]);
device.queue.submit([encoder.finish()]);
await buffer.mapAsync(GPUMapMode.READ);
const pixels = new Uint8ClampedArray(buffer.getMappedRange()).slice();
buffer.unmap();

// Show them in a 2D canvas.
const canvas = document.querySelector("canvas")!;
canvas.width = SIZE;
canvas.height = SIZE;
canvas.getContext("2d")!.putImageData(new ImageData(pixels, SIZE, SIZE), 0, 0);
