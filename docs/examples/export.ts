import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({
  device,
  canvas: document.querySelector("canvas")!,
});

// A surface that is not on screen: Skia owns its texture. It is given the
// density of the screen it will be shown on.
const offscreen = sk.makeOffscreenSurface(256, 256, {
  pixelRatio: devicePixelRatio,
});
const hidden = offscreen.getCanvas();
hidden.clear("#fde68a");
const petal = sk.paint({ color: "#f97316", blendMode: "multiply" });
for (let i = 0; i < 8; i++) {
  hidden.save();
  hidden.rotate((i / 8) * 2 * Math.PI, 128, 128);
  hidden.drawOval(104, 16, 48, 112, petal);
  hidden.restore();
}
offscreen.flush();

// What it holds, as an image like any other.
const image = offscreen.snapshot();

// Its pixels come back from the GPU later: encoding is asynchronous.
const png = await image.encode("png");
const link = document.createElement("a");
link.href = URL.createObjectURL(new Blob([png], { type: "image/png" }));
link.download = "flower.png";
link.textContent = `Download the PNG (${(png.length / 1024).toFixed(1)} KB)`;
link.style.cssText =
  "position: absolute; left: 0; right: 0; bottom: 20px; text-align: center; font: 14px system-ui";
document.body.append(link);

const frame = (time: number) => {
  const canvas = sk.surface.getCanvas();
  canvas.clear("white");
  canvas.rotate(time / 3000, 256, 232);
  // An image is measured in pixels: it is drawn at the size of the surface.
  canvas.drawImage(image, 128, 104, offscreen.width, offscreen.height);
  sk.surface.flush();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
