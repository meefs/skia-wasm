import fs from "fs";
import path from "path";

import { afterAll, beforeAll, expect, test } from "@jest/globals";
import { PNG } from "pngjs";

import type { Canvas, Skia } from "../ts";

import { Root, setup } from "./setup";
import type { Setup } from "./setup";
import { checkSnapshot } from "./setup/snapshots";
import type { SnapshotOptions } from "./setup/snapshots";

const SIZE = 256;
let dawn: Setup;

beforeAll(async () => {
  dawn = await setup();
  const bytes = fs.readFileSync(
    path.join(Root, "tests", "assets", "Roboto-Regular.ttf")
  );
  dawn.sk.registerFont(dawn.sk.typeface(bytes), "Roboto");
});

afterAll(() => dawn?.dispose());

const scene = (
  name: string,
  draw: (canvas: Canvas, sk: Skia) => void,
  options?: SnapshotOptions
) =>
  test(name, async () => {
    const pixels = await dawn.draw(SIZE, SIZE, (c) => draw(c, dawn.sk));
    checkSnapshot(pixels, name, options);
  });

scene("shapes", (c, sk) => {
  c.drawRect(16, 16, 96, 64, sk.paint({ color: "#0080ff" }));
  c.drawRoundedRect(
    144,
    16,
    96,
    64,
    { topLeft: 32, bottomRight: 16 },
    sk.paint({ color: "tomato" })
  );
  c.drawCircle(64, 144, 40, sk.paint({ color: "rgba(0, 160, 80, 0.5)" }));
  c.drawOval(
    144,
    112,
    96,
    64,
    sk.paint({ color: "purple", style: "stroke", strokeWidth: 6 })
  );
  c.drawArc(16, 192, 56, 56, 0, 4, true, sk.paint({ color: "orange" }));
  c.drawLine(
    112,
    232,
    240,
    200,
    sk.paint({ style: "stroke", strokeWidth: 10, strokeCap: "round" })
  );
});

scene("paths", (c, sk) => {
  const star = sk.path("M128 20 L190 220 L24 92 L232 92 L66 220 Z");
  star.fillType = "evenOdd";
  c.drawPath(star, sk.paint({ color: "gold" }));
  c.drawPath(
    star,
    sk.paint({ style: "stroke", strokeWidth: 4, strokeJoin: "round" })
  );
  c.drawPath(
    sk.path("M16 240 C 80 180, 176 290, 240 230"),
    sk.paint({
      color: "crimson",
      style: "stroke",
      strokeWidth: 6,
      pathEffect: sk.pathEffect.dash([16, 8]),
    })
  );
});

scene("gradients", (c, sk) => {
  const colors = ["#ff0080", "#ffcc00", "#00c2ff"];
  const shaders = [
    sk.linearGradient({ start: [0, 0], end: [128, 128], colors }),
    sk.radialGradient({ center: [192, 64], radius: 64, colors }),
    sk.sweepGradient({ center: [64, 192], colors }),
    sk.conicalGradient({
      start: [176, 176],
      startRadius: 8,
      end: [192, 192],
      endRadius: 64,
      colors,
    }),
  ];
  shaders.forEach((shader, i) =>
    c.drawRect((i % 2) * 128, (i >> 1) * 128, 128, 128, sk.paint({ shader }))
  );
});

scene("clips-and-transforms", (c, sk) => {
  c.save();
  c.clipRoundedRect(16, 16, 224, 224, 48);
  c.drawColor("#102040");
  for (let i = 0; i < 8; i++) {
    c.save();
    c.rotate((i * Math.PI) / 4, 128, 128);
    c.drawRect(128, 118, 128, 20, sk.paint({ color: "cyan", alpha: 0.6 }));
    c.restore();
  }
  c.restore();
});

scene("blend-modes", (c, sk) => {
  const modes = ["multiply", "screen", "difference", "overlay"] as const;
  modes.forEach((blendMode, i) => {
    c.save();
    c.translate((i % 2) * 128, (i >> 1) * 128);
    c.drawRect(16, 16, 72, 72, sk.paint({ color: "#e04060" }));
    c.drawRect(40, 40, 72, 72, sk.paint({ color: "#40a0e0", blendMode }));
    c.restore();
  });
});

scene("filters", (c, sk) => {
  c.drawRect(
    32,
    32,
    64,
    64,
    sk.paint({ color: "red", imageFilter: sk.imageFilter.blur(8) })
  );
  c.drawRect(
    152,
    32,
    64,
    64,
    sk.paint({
      color: "#0080ff",
      imageFilter: sk.imageFilter.dropShadow({
        dx: 8,
        dy: 8,
        sigma: 6,
        color: "black",
      }),
    })
  );
  c.drawCircle(
    64,
    192,
    36,
    sk.paint({ color: "green", maskFilter: sk.maskFilter.blur(6) })
  );
  c.drawCircle(
    184,
    192,
    36,
    sk.paint({
      color: "lime",
      colorFilter: sk.colorFilter.blend("blue", "srcIn"),
    })
  );
});

scene("runtime-effect", (c, sk) => {
  const effect = sk.effect<{ size: "f32" }>(`
    uniform float size;
    half4 main(float2 p) {
      float2 uv = p / size;
      float ring = smoothstep(0.02, 0.0, abs(length(uv - 0.5) - 0.3));
      return half4(mix(half3(uv.x, uv.y, 0.5), half3(1), ring), 1);
    }
  `);
  c.drawPaint(sk.paint({ shader: effect.shader({ size: SIZE }) }));
});

scene("text", (c, sk) => {
  const paragraph = sk
    .paragraph(
      [
        { text: "Skia Graphite " },
        { text: "on Dawn", color: "#0080ff", decoration: "underline" },
        { text: ", in Node, with nothing but a texture to draw to." },
      ],
      { fontSize: 28, fontFamilies: ["Roboto"] }
    )
    .layout(224);
  c.drawParagraph(paragraph, 16, 16);
});

test("image", async () => {
  const png = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < 16; i++) {
    png.data.set([(i % 4) * 85, (i >> 2) * 85, 128, 255], i * 4);
  }
  const image = await dawn.sk.image(PNG.sync.write(png));
  const pixels = await dawn.draw(SIZE, SIZE, (c) => {
    c.drawImage(image, 0, 0, SIZE, 128, { sampling: "nearest" });
    c.drawImage(image, 0, 128, SIZE, 128, { sampling: "linear" });
  });
  image.dispose();
  checkSnapshot(pixels, "image");
});

test("a difference is noticed", async () => {
  if (!process.env.UPDATE_SNAPSHOTS) {
    const blank = await dawn.draw(SIZE, SIZE, () => {});
    const different = () => checkSnapshot(blank, "shapes", { record: false });
    expect(different).toThrow("pixels differ");
  }
});
