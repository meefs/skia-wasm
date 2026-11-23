import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({ device });
const surface = sk.surface(document.querySelector("canvas")!);

const response = await fetch("Roboto-Medium.ttf");
const font = sk.font(sk.typeface(await response.arrayBuffer()), 32);

const face = sk.paint({ color: "#0f172a" });
const mark = sk.paint({ color: "#94a3b8" });
const light = sk.paint({ color: "#f8fafc" });
const orange = sk.paint({ color: "#f97316" });

// Each numeral, measured once to be centered on its place around the dial.
const numerals = Array.from({ length: 12 }, (_, i) => {
  const text = String(i + 1);
  const angle = ((i + 1) / 12) * 2 * Math.PI - Math.PI / 2;
  const { bounds } = font.measureText(text);
  return {
    text,
    x: 256 + 150 * Math.cos(angle) - bounds.x - bounds.width / 2,
    y: 256 + 150 * Math.sin(angle) - bounds.y - bounds.height / 2,
  };
});

const frame = () => {
  const now = new Date();
  const seconds = now.getSeconds() + now.getMilliseconds() / 1000;
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;
  const turn = 2 * Math.PI;

  const canvas = surface.getCanvas();
  canvas.clear("white");
  canvas.drawCircle(256, 256, 216, face);
  for (const { text, x, y } of numerals) {
    canvas.drawText(text, x, y, font, light);
  }
  // Sixty marks: the same rect, drawn in a space that turns.
  for (let i = 0; i < 60; i++) {
    canvas.save();
    canvas.rotate((i / 60) * turn, 256, 256);
    canvas.drawRect(255, 48, 2, i % 5 === 0 ? 16 : 8, mark);
    canvas.restore();
  }
  // A hand points up, in a space rotated around the center.
  const hand = (
    angle: number,
    width: number,
    length: number,
    paint = light
  ) => {
    canvas.save();
    canvas.rotate(angle, 256, 256);
    canvas.drawRoundedRect(
      256 - width / 2,
      256 - length,
      width,
      length + 24,
      width / 2,
      paint
    );
    canvas.restore();
  };
  hand((hours / 12) * turn, 12, 96);
  hand((minutes / 60) * turn, 8, 136);
  hand((seconds / 60) * turn, 4, 168, orange);
  canvas.drawCircle(256, 256, 8, orange);

  surface.flush();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
