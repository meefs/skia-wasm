import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({
  device,
  canvas: document.querySelector("canvas")!,
});

const load = async (file: string) => {
  const response = await fetch(file);
  return sk.typeface(await response.arrayBuffer());
};
// Paragraphs find their fonts by family name. Both files are registered as
// "Roboto": the weight of a span picks one.
sk.registerFont(await load("Roboto-Regular.ttf"), "Roboto");
sk.registerFont(await load("Roboto-Medium.ttf"), "Roboto");

// Spans are texts, or texts with a style over the style of the paragraph.
const paragraph = sk.paragraph(
  [
    "Skia lays out ",
    { text: "paragraphs", fontWeight: "medium", color: "#2563eb" },
    ": text that wraps, with ",
    {
      text: "spans",
      decoration: "underline",
      decorationStyle: "wavy",
      decorationColor: "#ef4444",
    },
    " that have a ",
    { text: "style", backgroundColor: "#fde68a" },
    " of their own. The width changes here, and the lines follow.",
  ],
  {
    fontFamilies: ["Roboto"],
    fontSize: 28,
    lineHeight: 1.4,
    color: "#0f172a",
  }
);

const box = sk.paint({
  color: "#94a3b8",
  style: "stroke",
  strokeWidth: 2,
  pathEffect: sk.pathEffect.dash([6, 6]),
});

const frame = (time: number) => {
  const width = 300 + 140 * Math.sin(time / 1500);
  // Breaking lines is the costly part: it is only done when the width changes.
  paragraph.layout(width);

  const canvas = sk.surface.getCanvas();
  canvas.clear("white");
  canvas.drawParagraph(paragraph, 32, 32);
  canvas.drawRect(32, 32, width, paragraph.height, box);
  sk.surface.flush();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
