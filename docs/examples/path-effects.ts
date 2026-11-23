import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({ device });
const surface = sk.surface(document.querySelector("canvas")!);

// One star, drawn four times through different path effects.
const star = sk.path();
for (let i = 0; i < 10; i++) {
  const radius = i % 2 === 0 ? 96 : 40;
  const angle = (i / 10) * 2 * Math.PI - Math.PI / 2;
  const x = radius * Math.cos(angle);
  const y = radius * Math.sin(angle);
  if (i === 0) {
    star.moveTo(x, y);
  } else {
    star.lineTo(x, y);
  }
}
star.close();

const stroke = sk.paint({
  color: "#3b82f6",
  style: "stroke",
  strokeWidth: 6,
  strokeJoin: "round",
  strokeCap: "round",
});
const rounded = sk.pathEffect.corner(24);
const rough = sk.pathEffect.discrete(8, 4);

const frame = (time: number) => {
  const t = time / 1000;
  const canvas = surface.getCanvas();
  canvas.clear("white");

  // Effects are immutable: one that animates is made again every frame.
  const marching = sk.pathEffect.dash([16, 12], t * 40);
  const growing = sk.pathEffect.trim(0, 0.5 - 0.5 * Math.cos(t), false);
  const effects = [marching, rounded, rough, growing];
  effects.forEach((effect, i) => {
    stroke.pathEffect = effect;
    canvas.save();
    canvas.translate(136 + (i % 2) * 240, 136 + Math.floor(i / 2) * 240);
    canvas.drawPath(star, stroke);
    canvas.restore();
  });
  marching.dispose();
  growing.dispose();

  surface.flush();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
