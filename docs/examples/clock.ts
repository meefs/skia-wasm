import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const canvas = document.querySelector("canvas")!;
const sk = await Skia.init({ device, canvas });

// What never moves is a static path: the twelve marks of the dial.
const marks = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * 2 * Math.PI;
  const point = (radius: number) =>
    `${256 + radius * Math.cos(angle)} ${256 + radius * Math.sin(angle)}`;
  return `M ${point(168)} L ${point(192)}`;
}).join(" ");

const b = sk.builder();
b.drawRRect(
  { x: 40, y: 40, width: 432, height: 432, r: 216 },
  { color: "#0f172a" }
);
b.drawPath(b.path(marks), {
  color: "#94a3b8",
  style: "stroke",
  strokeWidth: 6,
});
// What moves is a matrix per hand. A hand is drawn pointing up.
const hand = (width: number, length: number, color: string) => {
  const transform = b.matrix();
  b.save();
  b.concat(transform);
  b.drawRRect(
    {
      x: 256 - width / 2,
      y: 256 - length,
      width,
      height: length + 24,
      r: width / 2,
    },
    { color }
  );
  b.restore();
  return transform;
};
const program = b.build({
  hours: hand(12, 104, "#f8fafc"),
  minutes: hand(8, 152, "#f8fafc"),
  seconds: hand(4, 168, "#f97316"),
});

const scene = program.instantiate();
sk.surface.setClearColor(1, 1, 1);

const frame = () => {
  const now = new Date();
  const seconds = now.getSeconds() + now.getMilliseconds() / 1000;
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;
  const turn = 2 * Math.PI;
  scene.values.seconds.setRotate((seconds / 60) * turn, 256, 256);
  scene.values.minutes.setRotate((minutes / 60) * turn, 256, 256);
  scene.values.hours.setRotate((hours / 12) * turn, 256, 256);
  sk.surface.draw(scene);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
