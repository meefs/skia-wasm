import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({
  device,
  canvas: document.querySelector("canvas")!,
});

// From an SVG path string.
const heart = sk.path(
  "M 128 208 C 48 152 48 72 128 104 C 208 72 208 152 128 208 Z"
);

// Built segment by segment. The methods chain.
const star = sk.path();
for (let i = 0; i < 10; i++) {
  const radius = i % 2 === 0 ? 88 : 36;
  const angle = (i / 10) * 2 * Math.PI - Math.PI / 2;
  const x = 384 + radius * Math.cos(angle);
  const y = 136 + radius * Math.sin(angle);
  if (i === 0) {
    star.moveTo(x, y);
  } else {
    star.lineTo(x, y);
  }
}
star.close();

// Combined: a rounded square with a disc taken out of it.
const square = sk.path().addRoundedRect(48, 288, 160, 160, 24);
const hole = sk.path().addCircle(208, 288, 72);
const bitten = square.op(hole, "difference")!;

// Two contours, filled where an odd number of them overlap.
const rings = sk.path().addCircle(384, 368, 88).addCircle(384, 368, 48);
rings.fillType = "evenOdd";

const fill = sk.paint({ color: "#ef4444" });
const outline = sk.paint({ color: "#7f1d1d", style: "stroke", strokeWidth: 6 });

const canvas = sk.surface.getCanvas();
canvas.clear("white");
for (const path of [heart, star, bitten, rings]) {
  canvas.drawPath(path, fill);
  canvas.drawPath(path, outline);
}
sk.surface.flush();
