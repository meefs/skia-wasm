import { Skia, paintColor } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const canvas = document.querySelector("canvas")!;
const sk = await Skia.init({ device, canvas });

// One program: a rounded rect around the origin.
const b = sk.builder();
const transform = b.matrix();
const paint = b.paint();
b.save();
b.concat(transform);
b.drawRRect({ x: -20, y: -20, width: 40, height: 40, r: 8 }, paint);
b.restore();
const program = b.build({ transform, color: paintColor(paint) });

// Many instances: each has its own copy of the data block.
const COLUMNS = 8;
const cards = Array.from({ length: COLUMNS * COLUMNS }, (_, i) => {
  const card = program.instantiate();
  const column = i % COLUMNS;
  const row = Math.floor(i / COLUMNS);
  card.values.color.set(column / COLUMNS, row / COLUMNS, 1, 1);
  return { card, x: 32 + column * 64, y: 32 + row * 64 };
});
const instances = cards.map(({ card }) => card);
sk.surface.setClearColor(1, 1, 1);

const frame = (time: number) => {
  cards.forEach(({ card, x, y }, i) => {
    const angle = time / 1000 + i * 0.1;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // A rotation, then a translation to the place of the card.
    card.values.transform.set(cos, -sin, x, sin, cos, y);
  });
  // Every instance is drawn by one call into wasm.
  sk.surface.draw(instances);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
