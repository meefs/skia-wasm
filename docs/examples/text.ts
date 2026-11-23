import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({
  device,
  canvas: document.querySelector("canvas")!,
});

// There are no system fonts: a typeface is the bytes of a font file.
const response = await fetch("Roboto-Regular.ttf");
const typeface = sk.typeface(await response.arrayBuffer());
const title = sk.font(typeface, 96);
const label = sk.font(typeface, 16);
const wave = sk.font(typeface, 30);

const ink = sk.paint({ color: "#0f172a" });
const accent = sk.paint({ color: "#f97316" });
const guide = sk.paint({ color: "#94a3b8", style: "stroke", strokeWidth: 1 });

// Measured once. Text is placed by its baseline, and the metrics say how
// far the font goes above and below it.
const { width } = title.measureText("Skia");
const { ascent, descent } = title.metrics;
const left = (512 - width) / 2;

// Glyph by glyph: each one gets a position of its own.
const glyphs = wave.glyphs("every glyph where you want it");
const advances = wave.glyphWidths(glyphs);
const positions = new Float32Array(glyphs.length * 2);

const frame = (time: number) => {
  const canvas = sk.surface.getCanvas();
  canvas.clear("white");

  canvas.drawText("Skia", left, 192, title, ink);
  for (const [name, y] of [
    ["ascent", 192 + ascent],
    ["baseline", 192],
    ["descent", 192 + descent],
  ] as const) {
    canvas.drawLine(left, y, left + width, y, guide);
    canvas.drawText(name, left + width + 8, y + 5, label, ink);
  }

  let x = 0;
  for (let i = 0; i < glyphs.length; i++) {
    positions[i * 2] = x;
    positions[i * 2 + 1] = 16 * Math.sin(time / 300 + i * 0.5);
    x += advances[i];
  }
  canvas.drawGlyphs(glyphs, positions, (512 - x) / 2, 384, wave, accent);

  sk.surface.flush();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
