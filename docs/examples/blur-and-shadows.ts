import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({ device });
const surface = sk.surface(document.querySelector("canvas")!);

const blobs = ["#f97316", "#ec4899", "#6366f1"].map((color) =>
  sk.paint({ color })
);

// An image filter changes what a paint draws, as an image.
const card = sk.paint({
  color: "white",
  imageFilter: sk.imageFilter.dropShadow({
    dx: 0,
    dy: 12,
    sigma: 16,
    color: "rgb(15 23 42 / 35%)",
  }),
});
// A mask filter blurs the edges of a shape before it is colored.
const glow = sk.paint({ color: "#facc15", maskFilter: sk.maskFilter.blur(16) });

// Frosted glass: a layer that starts as a blur of what is behind it.
const frost = sk.imageFilter.blur(16, { tileMode: "clamp" });
const tint = sk.paint({ color: "rgb(255 255 255 / 40%)" });
const layer = { backdrop: frost };

const frame = (time: number) => {
  const t = time / 1000;
  const canvas = surface.getCanvas();
  canvas.clear("#e2e8f0");

  blobs.forEach((blob, i) => {
    const angle = t + (i * 2 * Math.PI) / 3;
    canvas.drawCircle(
      256 + 120 * Math.cos(angle),
      176 + 72 * Math.sin(angle * 2),
      72,
      blob
    );
  });

  canvas.save();
  canvas.clipRoundedRect(96, 96, 320, 160, 24);
  canvas.saveLayer(layer);
  canvas.drawPaint(tint);
  canvas.restore();
  canvas.restore();

  canvas.drawRoundedRect(96, 320, 200, 128, 16, card);
  canvas.drawCircle(376, 384, 40 + 8 * Math.sin(t * 3), glow);

  surface.flush();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
