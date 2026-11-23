import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({ device });
const surface = sk.surface(document.querySelector("canvas")!);

const response = await fetch("image.png");
const image = await sk.image(await response.arrayBuffer());

// A color matrix: each row gives R, G, B or A from the R, G, B and A of the
// pixel, plus a constant.
const identity = sk.colorFilter.matrix([
  1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
]);
const grayscale = sk.colorFilter.matrix([
  0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152,
  0.0722, 0, 0, 0, 0, 0, 1, 0,
]);
const sepia = sk.colorFilter.matrix([
  0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131, 0,
  0, 0, 0, 0, 1, 0,
]);
const invert = sk.colorFilter.matrix([
  -1, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, 1, 0,
]);

// An image goes through a filter by being drawn with a paint.
const paint = sk.paint();
const through = { paint };

const frame = (time: number) => {
  const canvas = surface.getCanvas();
  canvas.clear("white");

  paint.colorFilter = null;
  canvas.drawImage(image, 24, 24, 224, 224, through);
  paint.colorFilter = grayscale;
  canvas.drawImage(image, 264, 24, 224, 224, through);
  paint.colorFilter = sepia;
  canvas.drawImage(image, 24, 264, 224, 224, through);

  // Between two filters: from the picture to its negative and back.
  const pulse = sk.colorFilter.lerp(
    0.5 - 0.5 * Math.cos(time / 1000),
    identity,
    invert
  );
  paint.colorFilter = pulse;
  pulse.dispose();
  canvas.drawImage(image, 264, 264, 224, 224, through);

  surface.flush();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
