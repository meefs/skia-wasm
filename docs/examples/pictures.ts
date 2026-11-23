import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({
  device,
  canvas: document.querySelector("canvas")!,
});

// Recorded once: a petal made of a hundred strokes.
const recorder = sk.pictureRecorder();
const recording = recorder.begin(-48, -160, 96, 160);
const stroke = sk.paint({ style: "stroke", strokeWidth: 1.5 });
const petal = sk.path();
for (let i = 0; i < 100; i++) {
  const spread = (i / 99 - 0.5) * 2;
  stroke.color = [0.93, 0.28 + 0.4 * Math.abs(spread), 0.6, 0.6];
  petal
    .reset()
    .moveTo(0, 0)
    .quadTo(spread * 80, -80, 0, -150);
  recording.drawPath(petal, stroke);
}
// The recording canvas is gone; the picture can be drawn any number of times.
const picture = recorder.finish();

const frame = (time: number) => {
  const canvas = sk.surface.getCanvas();
  canvas.clear("#0f172a");
  canvas.translate(256, 256);
  canvas.rotate(time / 4000);
  // Twelve petals: twelve calls, not twelve hundred.
  for (let i = 0; i < 12; i++) {
    canvas.save();
    canvas.rotate((i / 12) * 2 * Math.PI);
    canvas.scale(1, 1 + 0.2 * Math.sin(time / 600 + i));
    canvas.drawPicture(picture);
    canvas.restore();
  }
  sk.surface.flush();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
