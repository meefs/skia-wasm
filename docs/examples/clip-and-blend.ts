import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const canvas = document.querySelector("canvas")!;
const sk = await Skia.init({ device, canvas });

const b = sk.builder();
// A rect given as a slot can be written later; a literal cannot.
const clip = b.rect({ x: 96, y: 96, width: 320, height: 320 });
b.save();
b.clipRect(clip);
b.drawRect({ width: 512, height: 512 }, { color: "#000000" });
// Three discs that add up to white where they overlap.
b.drawRRect(
  { x: 136, y: 96, width: 240, height: 240, r: 120 },
  { color: "#ff0000", blendMode: "Plus" }
);
b.drawRRect(
  { x: 76, y: 196, width: 240, height: 240, r: 120 },
  { color: "#00ff00", blendMode: "Plus" }
);
b.drawRRect(
  { x: 196, y: 196, width: 240, height: 240, r: 120 },
  { color: "#0000ff", blendMode: "Plus" }
);
b.restore();
const program = b.build({ clip });

const scene = program.instantiate();
sk.surface.setClearColor(1, 1, 1);

const frame = (time: number) => {
  const inset = 96 + 64 * Math.sin(time / 1000);
  scene.values.clip.set(inset, inset, 512 - 2 * inset, 512 - 2 * inset);
  sk.surface.draw(scene);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
