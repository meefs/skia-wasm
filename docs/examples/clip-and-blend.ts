import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({
  device,
  canvas: document.querySelector("canvas")!,
});

// Three lights that add up to white where they overlap.
const red = sk.paint({ color: "#ff0000", blendMode: "plus" });
const green = sk.paint({ color: "#00ff00", blendMode: "plus" });
const blue = sk.paint({ color: "#0000ff", blendMode: "plus" });
const black = sk.paint({ color: "black" });

const frame = (time: number) => {
  const inset = 96 + 64 * Math.sin(time / 1000);
  const canvas = sk.surface.getCanvas();
  canvas.clear("white");

  // The clip is part of the state that save() and restore() keep.
  canvas.save();
  canvas.clipRoundedRect(inset, inset, 512 - 2 * inset, 512 - 2 * inset, 32);
  canvas.drawPaint(black);
  canvas.drawCircle(256, 216, 120, red);
  canvas.drawCircle(196, 316, 120, green);
  canvas.drawCircle(316, 316, 120, blue);
  canvas.restore();

  sk.surface.flush();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
