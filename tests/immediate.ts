/// <reference types="@webgpu/types" />
/**
 * Correctness test of the immediate API. One tile per feature is drawn into a
 * texture, and pixels are read back with WebGPU. The result is left in
 * window.immediate for the spec.
 */
import { Skia, parseColor } from "../src/ts";
import type { Canvas, Paint } from "../src/ts";

const TILE = 64;
const COLUMNS = 6;
const ROWS = 9;
const WIDTH = TILE * COLUMNS;
const HEIGHT = TILE * ROWS;

type RGB = readonly [number, number, number];
const WHITE: RGB = [255, 255, 255];

interface Check {
  name: string;
  pass: boolean;
  expected?: unknown;
  got?: unknown;
}

const checks: Check[] = [];
const gpuErrors: string[] = [];

let currentStep = "starting";
const step = (name: string) => {
  currentStep = name;
  document.querySelector("pre")!.textContent = `running: ${name}`;
};

const expectTrue = (name: string, pass: boolean, got?: unknown) => {
  checks.push({ name, pass, got });
};

const expectClose = (
  name: string,
  got: readonly number[],
  expected: readonly number[],
  tolerance = 0.005
) => {
  checks.push({
    name,
    pass:
      got.length === expected.length &&
      expected.every((value, i) => Math.abs(value - got[i]) <= tolerance),
    expected,
    got,
  });
};

const expectThrows = (name: string, action: () => unknown) => {
  try {
    action();
    checks.push({ name, pass: false, got: "did not throw" });
  } catch (error) {
    checks.push({ name, pass: true, got: String((error as Error).message) });
  }
};

// What was drawn in each tile, for the checks that follow the readback.
const pixelChecks: {
  name: string;
  tile: number;
  x: number;
  y: number;
  expected: RGB | "not white";
  tolerance: number;
}[] = [];

const run = async () => {
  if (!navigator.gpu) {
    throw new Error("This browser does not expose WebGPU.");
  }
  step("requesting a WebGPU device");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("No WebGPU adapter.");
  }
  const device = await adapter.requestDevice();
  device.addEventListener("uncapturederror", (event) => {
    gpuErrors.push(event.error.message);
  });

  step("loading the module");
  const sk = await Skia.init({
    device,
    canvas: document.querySelector<HTMLCanvasElement>("#gpu")!,
    module: new URL("../dist/lib/skia-wasm.js", location.href).href,
  });

  const target = device.createTexture({
    size: [WIDTH, HEIGHT],
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC,
  });
  const surface = sk.makeSurface(target);
  surface.setClearColor(1, 1, 1, 1);

  const readback = device.createBuffer({
    size: WIDTH * 4 * HEIGHT,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const read = async (texture: GPUTexture) => {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: readback, bytesPerRow: WIDTH * 4 },
      [WIDTH, HEIGHT]
    );
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const pixels = new Uint8Array(readback.getMappedRange()).slice();
    readback.unmap();
    return pixels;
  };

  // A texture of two colors, left and right, wrapped as an image.
  const twoColors = (left: RGB, right: RGB) => {
    const texture = device.createTexture({
      size: [4, 4],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const data = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      data.set([...(i % 4 < 2 ? left : right), 255], i * 4);
    }
    device.queue.writeTexture({ texture }, data, { bytesPerRow: 16 }, [4, 4]);
    return sk.texture(texture, { opaque: true });
  };

  // ---- Colors: plain TypeScript.
  step("parsing colors");
  expectClose("hex color", parseColor("#3b82f6"), [
    59 / 255,
    130 / 255,
    246 / 255,
    1,
  ]);
  expectClose("short hex with alpha", parseColor("#f008"), [1, 0, 0, 8 / 15]);
  expectClose("named color", parseColor("rebeccapurple"), [0.4, 0.2, 0.6, 1]);
  expectClose("rgb()", parseColor("rgb(255, 128, 0)"), [1, 128 / 255, 0, 1]);
  expectClose(
    "rgb() with alpha",
    parseColor("rgb(0 0 255 / 50%)"),
    [0, 0, 1, 0.5]
  );
  expectClose("rgba()", parseColor("rgba(0, 255, 0, 0.25)"), [0, 1, 0, 0.25]);
  expectClose("hsl()", parseColor("hsl(120, 100%, 50%)"), [0, 1, 0, 1]);
  expectClose(
    "hsl() in turns",
    parseColor("hsl(0.5turn 100% 50% / 0.5)"),
    [0, 1, 1, 0.5]
  );
  expectClose("transparent", parseColor("transparent"), [0, 0, 0, 0]);
  expectThrows("a string that is not a color throws", () => parseColor("nope"));
  {
    // Every named color, against the browser's own parser.
    const context = new OffscreenCanvas(1, 1).getContext("2d")!;
    const wrong: string[] = [];
    const names = [
      "aliceblue",
      "antiquewhite",
      "aqua",
      "aquamarine",
      "azure",
      "beige",
      "bisque",
      "black",
      "blanchedalmond",
      "blue",
      "blueviolet",
      "brown",
      "burlywood",
      "cadetblue",
      "chartreuse",
      "chocolate",
      "coral",
      "cornflowerblue",
      "cornsilk",
      "crimson",
      "cyan",
      "darkblue",
      "darkcyan",
      "darkgoldenrod",
      "darkgray",
      "darkgreen",
      "darkgrey",
      "darkkhaki",
      "darkmagenta",
      "darkolivegreen",
      "darkorange",
      "darkorchid",
      "darkred",
      "darksalmon",
      "darkseagreen",
      "darkslateblue",
      "darkslategray",
      "darkslategrey",
      "darkturquoise",
      "darkviolet",
      "deeppink",
      "deepskyblue",
      "dimgray",
      "dimgrey",
      "dodgerblue",
      "firebrick",
      "floralwhite",
      "forestgreen",
      "fuchsia",
      "gainsboro",
      "ghostwhite",
      "gold",
      "goldenrod",
      "gray",
      "green",
      "greenyellow",
      "grey",
      "honeydew",
      "hotpink",
      "indianred",
      "indigo",
      "ivory",
      "khaki",
      "lavender",
      "lavenderblush",
      "lawngreen",
      "lemonchiffon",
      "lightblue",
      "lightcoral",
      "lightcyan",
      "lightgoldenrodyellow",
      "lightgray",
      "lightgreen",
      "lightgrey",
      "lightpink",
      "lightsalmon",
      "lightseagreen",
      "lightskyblue",
      "lightslategray",
      "lightslategrey",
      "lightsteelblue",
      "lightyellow",
      "lime",
      "limegreen",
      "linen",
      "magenta",
      "maroon",
      "mediumaquamarine",
      "mediumblue",
      "mediumorchid",
      "mediumpurple",
      "mediumseagreen",
      "mediumslateblue",
      "mediumspringgreen",
      "mediumturquoise",
      "mediumvioletred",
      "midnightblue",
      "mintcream",
      "mistyrose",
      "moccasin",
      "navajowhite",
      "navy",
      "oldlace",
      "olive",
      "olivedrab",
      "orange",
      "orangered",
      "orchid",
      "palegoldenrod",
      "palegreen",
      "paleturquoise",
      "palevioletred",
      "papayawhip",
      "peachpuff",
      "peru",
      "pink",
      "plum",
      "powderblue",
      "purple",
      "rebeccapurple",
      "red",
      "rosybrown",
      "royalblue",
      "saddlebrown",
      "salmon",
      "sandybrown",
      "seagreen",
      "seashell",
      "sienna",
      "silver",
      "skyblue",
      "slateblue",
      "slategray",
      "slategrey",
      "snow",
      "springgreen",
      "steelblue",
      "tan",
      "teal",
      "thistle",
      "tomato",
      "turquoise",
      "violet",
      "wheat",
      "white",
      "whitesmoke",
      "yellow",
      "yellowgreen",
    ];
    for (const name of names) {
      context.fillStyle = "#000";
      context.fillStyle = name;
      const expected = parseColor(context.fillStyle);
      const got = parseColor(name);
      if (expected.some((value, i) => Math.abs(value - got[i]) > 0.001)) {
        wrong.push(name);
      }
    }
    expectTrue(
      "the 148 named colors match the browser",
      wrong.length === 0,
      wrong
    );
  }

  // ---- Paths: values, without drawing.
  step("measuring paths");
  {
    const path = sk
      .path()
      .moveTo(10, 20)
      .lineTo(110, 20)
      .lineTo(110, 70)
      .close();
    const bounds = path.bounds();
    expectClose(
      "path bounds",
      [bounds.x, bounds.y, bounds.width, bounds.height],
      [10, 20, 100, 50]
    );
    expectTrue("path contains a point inside", path.contains(100, 30));
    expectTrue("path does not contain a point outside", !path.contains(20, 60));
    expectTrue(
      "path to SVG",
      path.toSVG() === "M10 20L110 20L110 70L10 20Z",
      path.toSVG()
    );
    const line = sk.path("M 0 0 L 30 40");
    expectClose("path length", [line.length], [50]);
    const middle = line.pointAt(25)!;
    expectClose(
      "point and tangent along a path",
      [middle.x, middle.y, middle.tangentX, middle.tangentY],
      [15, 20, 0.6, 0.8]
    );
    expectTrue("no point past the end of a path", line.pointAt(60) === null);
    const half = line.trim(0, 0.5);
    expectClose("trimmed path", [half.length], [25]);
    const outline = line.stroke({ width: 10 });
    expectTrue(
      "stroked path is an outline",
      outline.contains(15, 20) && !outline.contains(0, 30)
    );
    const square = sk.path().addRect(0, 0, 10, 10);
    const moved = sk.path().addRect(20, 20, 10, 10);
    const between = square.interpolate(moved, 0.5)!;
    const betweenBounds = between.bounds();
    expectClose(
      "interpolated path",
      [betweenBounds.x, betweenBounds.y],
      [10, 10]
    );
    expectTrue(
      "paths of different shapes do not interpolate",
      square.interpolate(line, 0.5) === null
    );
    const copy = square.copy().offset(5, 5);
    expectClose(
      "a copy is edited on its own",
      [square.bounds().x, copy.bounds().x],
      [0, 5]
    );
    expectTrue("an empty path is empty", sk.path().isEmpty && !square.isEmpty);
    expectThrows("a string that is not an SVG path throws", () =>
      sk.path("M 0 0 L nope")
    );
    path.dispose();
    expectThrows("a disposed path throws", () => path.lineTo(0, 0));
  }

  // ---- Offscreen surfaces, their pixels and their files: before the frame,
  // since the GPU answers a read later.
  step("drawing offscreen");
  const offscreen = sk.makeOffscreenSurface(32, 32);
  const hidden = offscreen.getCanvas();
  hidden.clear("orange");
  hidden.drawCircle(16, 16, 8, sk.paint({ color: "black" }));
  offscreen.flush();
  const snapshot = offscreen.snapshot();
  expectTrue(
    "a snapshot has the size of its surface",
    snapshot.width === 32 && snapshot.height === 32
  );
  const read32 = await snapshot.readPixels();
  const pixelAt = (x: number, y: number) =>
    Array.from(read32.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));
  expectTrue(
    "read pixels are RGBA",
    read32.length === 32 * 32 * 4,
    read32.length
  );
  expectClose(
    "read pixels: the background",
    pixelAt(4, 4),
    [255, 165, 0, 255],
    1
  );
  expectClose(
    "read pixels: what was drawn",
    pixelAt(16, 16),
    [0, 0, 0, 255],
    1
  );
  const png = await snapshot.encode("png");
  expectTrue(
    "an image encodes to PNG",
    png[0] === 137 && png[1] === 80 && png[2] === 78 && png[3] === 71,
    Array.from(png.subarray(0, 4))
  );
  const jpeg = await snapshot.encode("jpeg", 80);
  expectTrue(
    "an image encodes to JPEG",
    jpeg[0] === 0xff && jpeg[1] === 0xd8,
    Array.from(jpeg.subarray(0, 4))
  );
  const webp = await snapshot.encode("webp");
  expectTrue(
    "an image encodes to WebP",
    String.fromCharCode(...webp.subarray(0, 4)) === "RIFF",
    Array.from(webp.subarray(0, 4))
  );
  const decoded = await sk.image(png);
  expectTrue(
    "an encoded image decodes to the same size",
    decoded.width === 32 && decoded.height === 32
  );

  // ---- Text: values first.
  step("loading fonts");
  const loadTypeface = async (file: string) =>
    sk.typeface(await (await fetch(`assets/${file}`)).arrayBuffer());
  const regular = await loadTypeface("Roboto-Regular.ttf");
  const medium = await loadTypeface("Roboto-Medium.ttf");
  expectTrue(
    "a typeface knows its family",
    regular.familyName === "Roboto",
    regular.familyName
  );
  expectThrows("bytes that are not a font throw", () =>
    sk.typeface(new Uint8Array([1, 2, 3, 4]))
  );
  const font = sk.font(regular, 48);
  const { metrics } = font;
  expectTrue(
    "font metrics",
    metrics.ascent < 0 &&
      metrics.descent > 0 &&
      Math.abs(
        metrics.lineSpacing -
          (metrics.descent - metrics.ascent + metrics.leading)
      ) < 0.01,
    metrics
  );
  const hello = font.measureText("Hello");
  const helloGlyphs = font.glyphs("Hello");
  expectTrue(
    "the glyphs of a text",
    helloGlyphs.length === 5 &&
      helloGlyphs.every((glyph) => glyph !== 0) &&
      helloGlyphs[2] === helloGlyphs[3],
    Array.from(helloGlyphs)
  );
  expectClose(
    "glyph widths add up to the width of the text",
    [font.glyphWidths(helloGlyphs).reduce((sum, width) => sum + width, 0)],
    [hello.width],
    0.5
  );
  expectTrue(
    "the bounds of a text are above its baseline",
    hello.bounds.y < 0 && hello.bounds.height > 20,
    hello
  );
  font.size = 24;
  expectClose(
    "a font half the size measures half",
    [font.measureText("Hello").width * 2],
    [hello.width],
    0.5
  );
  font.size = 48;
  // The stem of an I fills its bounds: their center is ink.
  const stem = font.measureText("I").bounds;
  const inkX = stem.x + stem.width / 2;
  const inkY = stem.y + stem.height / 2;

  step("laying out paragraphs");
  sk.registerFont(regular);
  sk.registerFont(medium, "Medium");
  const sentence = "Hello world, this is text that wraps over lines.";
  const wrapped = sk.paragraph(sentence, { fontSize: 10 }).layout(TILE);
  expectTrue(
    "a paragraph wraps",
    wrapped.lineCount >= 3 &&
      wrapped.longestLine <= TILE &&
      wrapped.height > 30 &&
      wrapped.maxWidth === TILE,
    [wrapped.lineCount, wrapped.longestLine, wrapped.height]
  );
  expectTrue(
    "a paragraph knows its intrinsic widths",
    wrapped.maxIntrinsicWidth > TILE && wrapped.minIntrinsicWidth < TILE,
    [wrapped.minIntrinsicWidth, wrapped.maxIntrinsicWidth]
  );
  const wrappedLines = wrapped.lines();
  expectTrue(
    "a paragraph describes its lines",
    wrappedLines.length === wrapped.lineCount &&
      wrappedLines[0].start === 0 &&
      wrappedLines[1].start > 0 &&
      wrappedLines[1].baseline > wrappedLines[0].baseline,
    wrappedLines
  );
  expectTrue(
    "the boxes of a range of text",
    wrapped.rectsForRange(0, 5).length === 1 &&
      wrapped.rectsForRange(0, sentence.length).length >= 3
  );
  expectTrue(
    "the text at a point",
    wrapped.positionAt(0, 2) === 0 &&
      wrapped.positionAt(TILE, wrapped.height - 2) > 20,
    [wrapped.positionAt(0, 2), wrapped.positionAt(TILE, wrapped.height - 2)]
  );
  const oneLine = sk
    .paragraph(sentence, { fontSize: 10, maxLines: 1, ellipsis: "\u2026" })
    .layout(TILE);
  expectTrue(
    "a paragraph is cut at its maximum of lines",
    oneLine.lineCount === 1 && oneLine.didExceedMaxLines,
    oneLine.lineCount
  );
  const centered = sk
    .paragraph("I", { fontSize: 20, align: "center", fontFamilies: ["Medium"] })
    .layout(TILE);
  const [centeredLine] = centered.lines();
  expectClose(
    "a centered line",
    [centeredLine.left + centeredLine.width / 2],
    [TILE / 2],
    1
  );
  const styled = sk
    .paragraph(
      [
        { text: "I", color: "red" },
        { text: "I", color: "blue", backgroundColor: "yellow" },
      ],
      { fontSize: 48 }
    )
    .layout(TILE);
  const [firstBox] = styled.rectsForRange(0, 1);
  const [secondBox] = styled.rectsForRange(1, 2);
  expectTrue(
    "spans follow each other",
    secondBox.x > firstBox.x &&
      Math.abs(secondBox.x - (firstBox.x + firstBox.width)) < 1,
    [firstBox, secondBox]
  );

  // ---- Drawing: one tile per feature.
  step("drawing");
  const canvas = surface.getCanvas();
  expectTrue(
    "getCanvas() returns the same canvas during a frame",
    surface.getCanvas() === canvas
  );
  let tiles = 0;
  // Draws in a tile, and returns a function that records what to expect at
  // a pixel of it.
  const tile = (draw: (canvas: Canvas) => void) => {
    const index = tiles++;
    canvas.save();
    canvas.translate(
      (index % COLUMNS) * TILE,
      Math.floor(index / COLUMNS) * TILE
    );
    canvas.clipRect(0, 0, TILE, TILE);
    draw(canvas);
    canvas.restore();
    return (
      name: string,
      x: number,
      y: number,
      expected: RGB | "not white",
      tolerance = 3
    ) => {
      pixelChecks.push({ name, tile: index, x, y, expected, tolerance });
    };
  };
  const fill = (color: string) => sk.paint({ color });
  let expect: ReturnType<typeof tile>;

  expect = tile((c) => c.drawRect(0, 0, TILE, TILE, fill("#0080ff")));
  expect("rect", 32, 32, [0, 128, 255]);

  expect = tile((c) =>
    c.drawRoundedRect(
      8,
      8,
      48,
      48,
      12,
      sk.paint({ color: "red", style: "stroke", strokeWidth: 6 })
    )
  );
  expect("rounded rect stroke", 8, 32, [255, 0, 0]);
  expect("rounded rect is not filled", 32, 32, WHITE);

  expect = tile((c) =>
    c.drawRoundedRect(
      8,
      8,
      48,
      48,
      { topLeft: 24, bottomRight: [24, 12] },
      fill("#00a050")
    )
  );
  expect("corner with a radius is cut", 10, 10, WHITE);
  expect("corner without a radius is square", 54, 10, [0, 160, 80]);

  expect = tile((c) => {
    c.clipRect(16, 16, 32, 32);
    c.drawColor("lime");
  });
  expect("inside the clip", 32, 32, [0, 255, 0]);
  expect("outside the clip", 6, 6, WHITE);

  expect = tile((c) => {
    c.clipRect(16, 16, 32, 32, "difference");
    c.drawColor("lime");
  });
  expect("inside a difference clip", 32, 32, WHITE);
  expect("outside a difference clip", 6, 6, [0, 255, 0]);

  expect = tile((c) => {
    c.clipRoundedRect(8, 8, 48, 48, 24);
    c.drawPaint(fill("#ff8000"));
  });
  expect("inside a rounded clip", 32, 32, [255, 128, 0]);
  expect("corner of a rounded clip", 10, 10, WHITE);

  expect = tile((c) => {
    c.translate(32, 32);
    c.rotate(Math.PI / 2);
    c.scale(2);
    // A 12 by 4 rect along x becomes 8 by 24 along y.
    c.drawRect(0, -2, 12, 4, fill("magenta"));
  });
  expect("translate, rotate and scale", 32, 50, [255, 0, 255]);
  expect("the transform leaves the x axis", 50, 32, WHITE);

  expect = tile((c) => {
    c.concat(1, 0, 32, 0, 1, 32);
    c.drawRect(0, 0, 24, 24, fill("magenta"));
    expectClose(
      "getMatrix() reads the transform",
      c.getMatrix().slice(0, 2),
      [1, 0]
    );
    c.setMatrix();
    c.drawRect(0, 0, 8, 8, fill("black"));
  });
  expect("concat", 44, 44, [255, 0, 255]);

  expect = tile((c) => {
    const triangle = sk
      .path()
      .moveTo(8, 56)
      .lineTo(32, 8)
      .lineTo(56, 56)
      .close();
    c.drawPath(triangle, fill("#00a050"));
  });
  expect("path", 32, 40, [0, 160, 80]);
  expect("outside the path", 8, 12, WHITE);

  expect = tile((c) => {
    const frame = sk
      .path("M 8 8 H 56 V 56 H 8 Z")
      .op(sk.path().addCircle(32, 32, 12), "difference")!;
    c.drawPath(frame, fill("navy"));
  });
  expect("path op keeps the first path", 12, 12, [0, 0, 128]);
  expect("path op removes the second", 32, 32, WHITE);

  expect = tile((c) => {
    const rings = sk.path().addCircle(32, 32, 24).addCircle(32, 32, 12);
    rings.fillType = "evenOdd";
    c.drawPath(rings, fill("navy"));
  });
  expect("even-odd fill", 32, 12, [0, 0, 128]);
  expect("even-odd hole", 32, 32, WHITE);

  expect = tile((c) => {
    const shapes = sk
      .path()
      .addRoundedRect(4, 4, 24, 24, 8)
      .addOval(36, 4, 24, 16)
      .addArc(4, 36, 24, 24, 0, Math.PI)
      .addPolygon([36, 36, 60, 36, 48, 60], true);
    c.drawPath(shapes, fill("teal"));
  });
  expect("rounded rect in a path", 16, 16, [0, 128, 128]);
  expect("oval in a path", 48, 12, [0, 128, 128]);
  expect("arc in a path", 16, 54, [0, 128, 128]);
  expect("polygon in a path", 48, 44, [0, 128, 128]);

  expect = tile((c) => {
    c.drawCircle(16, 16, 12, fill("red"));
    c.drawOval(32, 4, 28, 20, fill("green"));
    c.drawLine(
      4,
      44,
      60,
      44,
      sk.paint({ color: "blue", style: "stroke", strokeWidth: 8 })
    );
    c.drawArc(4, 36, 24, 24, 0, Math.PI / 2, true, fill("black"));
  });
  expect("circle", 16, 16, [255, 0, 0]);
  expect("oval", 46, 14, [0, 128, 0]);
  expect("line", 40, 44, [0, 0, 255]);
  expect("arc wedge", 22, 54, [0, 0, 0]);

  expect = tile((c) => {
    const dots = sk.paint({
      color: "black",
      style: "stroke",
      strokeWidth: 8,
      strokeCap: "round",
    });
    c.drawPoints("points", [16, 16, 48, 16], dots);
    c.drawPoints(
      "polygon",
      [8, 48, 32, 40, 56, 48],
      sk.paint({ color: "red", style: "stroke", strokeWidth: 4 })
    );
  });
  expect("point", 16, 16, [0, 0, 0]);
  expect("between two points", 32, 16, WHITE);
  expect("polygon through points", 32, 40, [255, 0, 0]);

  expect = tile((c) => {
    const gradient = sk.linearGradient({
      start: [0, 0],
      end: [TILE, 0],
      colors: ["red", "blue"],
    });
    c.drawPaint(sk.paint({ shader: gradient }));
  });
  expect("linear gradient start", 2, 32, [247, 0, 8], 10);
  expect("linear gradient end", 61, 32, [8, 0, 247], 10);

  expect = tile((c) => {
    const gradient = sk.linearGradient({
      start: [0, 0],
      end: [TILE, 0],
      colors: ["red", "lime", "blue"],
      positions: [0, 0.25, 1],
    });
    c.drawPaint(sk.paint({ shader: gradient }));
  });
  expect("gradient stop at its position", 16, 32, [0, 255, 0], 12);

  expect = tile((c) => {
    const gradient = sk.radialGradient({
      center: [32, 32],
      radius: 32,
      colors: ["yellow", "black"],
    });
    c.drawPaint(sk.paint({ shader: gradient }));
  });
  expect("radial gradient center", 32, 32, [255, 255, 0], 12);
  expect("radial gradient edge", 32, 62, [16, 16, 0], 24);

  expect = tile((c) => {
    const gradient = sk.sweepGradient({
      center: [32, 32],
      colors: ["red", "lime", "blue", "red"],
    });
    c.drawPaint(sk.paint({ shader: gradient }));
  });
  // A third of a turn clockwise from the x axis: down and to the left.
  expect("sweep gradient", 32 - 14, 32 + 24, [0, 255, 0], 30);

  expect = tile((c) => {
    const gradient = sk.conicalGradient({
      start: [32, 32],
      startRadius: 8,
      end: [32, 32],
      endRadius: 32,
      colors: ["white", "blue"],
    });
    c.drawPaint(sk.paint({ shader: gradient }));
  });
  expect("conical gradient inside the first circle", 32, 32, WHITE);
  expect("conical gradient at the second circle", 32, 62, [20, 20, 255], 30);

  const effect = sk.effect<{ color: "vec4"; scale: "f32" }>(`
    uniform float4 color;
    uniform float scale;
    half4 main(float2 p) { return half4(color.rgb * scale, 1); }
  `);
  expect = tile((c) => {
    c.drawPaint(
      sk.paint({ shader: effect.shader({ color: [1, 0, 0.5, 1], scale: 0.5 }) })
    );
  });
  expect("runtime shader with uniforms", 32, 32, [128, 0, 64]);

  const tint = sk.effect(`
    uniform shader image;
    uniform shader mask;
    half4 main(float2 p) { return image.eval(p).bgra * mask.eval(p).a; }
  `);
  expectTrue(
    "an effect lists its children",
    tint.children.join() === "image,mask",
    tint.children
  );
  expect = tile((c) => {
    const shader = tint.shader(
      {},
      { image: sk.colorShader("#ff0000"), mask: sk.colorShader("#000000") }
    );
    c.drawPaint(sk.paint({ shader }));
  });
  expect("runtime shader with children", 32, 32, [0, 0, 255]);
  expectThrows("a runtime shader without its children throws", () =>
    tint.shader()
  );

  const halves = twoColors([255, 0, 0], [0, 255, 0]);
  expectTrue(
    "an image knows its size",
    halves.width === 4 && halves.height === 4,
    [halves.width, halves.height]
  );
  expect = tile((c) =>
    c.drawImage(halves, 0, 0, TILE, TILE, { sampling: "nearest" })
  );
  expect("image, left", 16, 32, [255, 0, 0]);
  expect("image, right", 48, 32, [0, 255, 0]);

  expect = tile((c) => c.drawImage(halves, 30, 30));
  expect("image at its own size", 31, 31, [255, 0, 0]);
  expect("around an image at its own size", 40, 40, WHITE);

  expect = tile((c) =>
    c.drawImageRect(halves, 2, 0, 2, 4, 0, 0, TILE, TILE, {
      sampling: "nearest",
    })
  );
  expect("part of an image", 16, 32, [0, 255, 0]);

  expect = tile((c) => {
    const shader = halves.shader({
      tileX: "repeat",
      tileY: "repeat",
      sampling: "nearest",
      matrix: [4, 0, 0, 0, 4, 0],
    });
    c.drawPaint(sk.paint({ shader }));
  });
  expect("image shader, first tile", 4, 4, [255, 0, 0]);
  expect("image shader, repeated", 16 + 12, 4, [0, 255, 0]);

  expect = tile((c) => {
    c.drawPaint(fill("#ff0000"));
    c.drawPaint(sk.paint({ color: "#00ff00", blendMode: "plus" }));
  });
  expect("blend mode", 32, 32, [255, 255, 0]);

  expect = tile((c) => {
    const noise = sk.fractalNoise({ frequencyX: 0.05, octaves: 2, seed: 3 });
    c.drawPaint(
      sk.paint({
        shader: sk.blendShader("srcOver", sk.colorShader("black"), noise),
      })
    );
  });
  expect("noise over a color", 32, 32, "not white");

  expect = tile((c) => {
    // Red in, green out.
    const swap = sk.colorFilter.matrix([
      0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
    ]);
    c.drawPaint(sk.paint({ color: "red", colorFilter: swap }));
  });
  expect("color matrix", 32, 32, [0, 255, 0]);

  expect = tile((c) => {
    const filter = sk.colorFilter.compose(
      sk.colorFilter.blend("blue", "plus"),
      sk.colorFilter.blend("red", "srcIn")
    );
    c.drawPaint(sk.paint({ color: "lime", colorFilter: filter }));
  });
  expect("composed color filters", 32, 32, [255, 0, 255]);

  expect = tile((c) => {
    c.drawRect(
      0,
      0,
      16,
      16,
      sk.paint({ color: "red", imageFilter: sk.imageFilter.offset(32, 32) })
    );
  });
  expect("offset image filter", 40, 40, [255, 0, 0]);
  expect("an offset moves what is drawn", 8, 8, WHITE);

  expect = tile((c) => {
    c.drawRect(
      24,
      24,
      16,
      16,
      sk.paint({ color: "red", imageFilter: sk.imageFilter.blur(4) })
    );
  });
  expect("blur spreads past the rect", 20, 32, "not white");
  expect("blur does not reach far", 4, 32, WHITE);

  expect = tile((c) => {
    const shadow = sk.imageFilter.dropShadow({
      dx: 16,
      dy: 16,
      sigma: 0.1,
      color: "blue",
    });
    c.drawRect(8, 8, 24, 24, sk.paint({ color: "red", imageFilter: shadow }));
  });
  expect("what casts a shadow", 16, 16, [255, 0, 0]);
  expect("drop shadow", 44, 44, [0, 0, 255]);

  expect = tile((c) => {
    const filter = sk.imageFilter.compose(
      sk.imageFilter.colorFilter(sk.colorFilter.blend("blue", "srcIn")),
      sk.imageFilter.dilate(8)
    );
    c.drawRect(24, 24, 16, 16, sk.paint({ color: "red", imageFilter: filter }));
  });
  expect("dilate, then a color filter", 18, 32, [0, 0, 255]);

  expect = tile((c) => {
    c.drawRect(
      16,
      16,
      32,
      32,
      sk.paint({ color: "red", maskFilter: sk.maskFilter.blur(4) })
    );
  });
  expect("mask blur keeps the center", 32, 32, [255, 0, 0]);
  expect("mask blur spreads past the rect", 13, 32, "not white");

  expect = tile((c) => {
    const dashed = sk.paint({
      color: "black",
      style: "stroke",
      strokeWidth: 8,
      pathEffect: sk.pathEffect.dash([16, 16]),
    });
    c.drawLine(0, 32, TILE, 32, dashed);
  });
  expect("dash", 8, 32, [0, 0, 0]);
  expect("gap", 24, 32, WHITE);

  expect = tile((c) => {
    const half = sk.paint({
      color: "black",
      style: "stroke",
      strokeWidth: 8,
      pathEffect: sk.pathEffect.trim(0, 0.5),
    });
    c.drawLine(0, 32, TILE, 32, half);
  });
  expect("trim keeps the start", 16, 32, [0, 0, 0]);
  expect("trim drops the end", 48, 32, WHITE);

  const recorder = sk.pictureRecorder();
  const recording = recorder.begin(0, 0, TILE, TILE);
  recording.drawRect(16, 16, 32, 32, fill("purple"));
  const picture = recorder.finish();
  expectThrows("the canvas of a finished recording throws", () =>
    recording.save()
  );
  expectThrows("finishing without a recording throws", () => recorder.finish());
  expect = tile((c) => c.drawPicture(picture));
  expect("picture", 32, 32, [128, 0, 128]);

  expect = tile((c) => {
    c.drawPaint(
      sk.paint({
        shader: picture.shader({
          tileX: "repeat",
          tileY: "repeat",
          matrix: [0.5, 0, 0, 0, 0.5, 0],
        }),
      })
    );
  });
  expect("picture shader, first tile", 16, 16, [128, 0, 128]);
  expect("picture shader, repeated", 48, 48, [128, 0, 128]);
  expect("picture shader, between tiles", 32, 32, WHITE);

  expect = tile((c) => {
    const count = c.saveLayer({ paint: sk.paint({ alpha: 0.5 }) });
    c.drawRect(0, 0, TILE, TILE, fill("black"));
    // Opaque in the layer: the layer is what is half transparent.
    c.drawRect(16, 16, 32, 32, fill("red"));
    c.restoreToCount(count);
  });
  expect("layer drawn back at half alpha", 4, 4, [128, 128, 128], 4);
  expect("what is drawn in a layer covers", 32, 32, [255, 128, 128], 4);

  expect = tile((c) => c.drawImage(snapshot, 0, 0, TILE, TILE));
  expect("snapshot of an offscreen surface", 4, 4, [255, 165, 0]);
  expect("what was drawn offscreen", 32, 32, [0, 0, 0]);

  expect = tile((c) => c.drawImage(decoded, 0, 0, TILE, TILE));
  expect("an image encoded then decoded", 4, 4, [255, 165, 0]);
  expect("what it showed", 32, 32, [0, 0, 0]);

  expect = tile((c) => c.drawText("I", 8, 56, font, fill("black")));
  expect("text", Math.round(8 + inkX), Math.round(56 + inkY), [0, 0, 0], 40);
  expect("beside the text", 50, 30, WHITE);

  expect = tile((c) => {
    c.drawTextBlob(font.textBlob("I"), 8, 56, fill("red"));
    c.drawTextBlob(
      font.glyphBlob(font.glyphs("I"), [0, 0]),
      40,
      56,
      fill("blue")
    );
  });
  expect(
    "text blob",
    Math.round(8 + inkX),
    Math.round(56 + inkY),
    [255, 0, 0],
    40
  );
  expect(
    "glyph blob",
    Math.round(40 + inkX),
    Math.round(56 + inkY),
    [0, 0, 255],
    40
  );

  expect = tile((c) => {
    c.drawGlyphs(font.glyphs("II"), [0, 0, 32, 0], 8, 56, font, fill("green"));
  });
  expect(
    "first glyph",
    Math.round(8 + inkX),
    Math.round(56 + inkY),
    [0, 128, 0],
    40
  );
  expect(
    "second glyph",
    Math.round(40 + inkX),
    Math.round(56 + inkY),
    [0, 128, 0],
    40
  );

  expect = tile((c) => {
    // A quarter of a turn: the stem lies down, from x = 16 to the right.
    const lying = font.transformedGlyphBlob(font.glyphs("I"), [0, 1, 16, 32]);
    c.drawTextBlob(lying, 0, 0, fill("black"));
  });
  expect(
    "glyph with a transform",
    Math.round(16 - inkY),
    Math.round(32 + inkX),
    [0, 0, 0],
    40
  );
  expect(
    "where the glyph would stand",
    Math.round(16 + inkX),
    Math.round(32 + inkY),
    WHITE
  );

  expect = tile((c) => c.drawParagraph(styled, 4, 0));
  expect(
    "first span of a paragraph",
    Math.round(4 + firstBox.x + firstBox.width / 2),
    Math.round(firstBox.y + firstBox.height / 2),
    [255, 0, 0],
    40
  );
  expect(
    "second span of a paragraph",
    Math.round(4 + secondBox.x + secondBox.width / 2),
    Math.round(secondBox.y + secondBox.height / 2),
    [0, 0, 255],
    40
  );
  expect(
    "background of a span",
    Math.floor(4 + secondBox.x) + 2,
    Math.round(secondBox.y) + 3,
    [255, 255, 0],
    10
  );

  expect = tile((c) => wrapped.draw(c, 0, 0));
  // The left stem of the H that starts the first line.
  expect(
    "a wrapped paragraph draws its text",
    1,
    Math.round(wrappedLines[0].baseline) - 3,
    "not white"
  );
  expect(
    "between the lines of a paragraph",
    1,
    Math.round(wrappedLines[0].baseline) + 2,
    WHITE
  );

  // A paint is read back as it was set, copied, and refuses use once disposed.
  {
    const paint: Paint = sk.paint({
      alpha: 0.5,
      color: "#ff0000",
      strokeWidth: 3,
    });
    expectClose(
      "a paint reads back its color and alpha",
      [...paint.color] as number[],
      [1, 0, 0, 0.5]
    );
    paint.color = [0, 1, 0];
    paint.blendMode = "multiply";
    const copy = paint.copy();
    paint.color = "blue";
    expectClose(
      "a copy keeps its own color",
      [...copy.color] as number[],
      [0, 1, 0, 1]
    );
    expectTrue(
      "a copy keeps the other properties",
      copy.blendMode === "multiply" && copy.strokeWidth === 3
    );
    expect = tile((c) => {
      copy.blendMode = "srcOver";
      c.drawPaint(copy);
    });
    expect("a copied paint draws", 32, 32, [0, 255, 0]);
    expectThrows("an unknown enumeration name throws", () => {
      copy.blendMode = "nope" as never;
    });
    expectThrows("an unknown style in the options of a paint throws", () =>
      sk.paint({ style: "outline" as never })
    );
    const spare = twoColors([0, 0, 0], [0, 0, 0]);
    spare.dispose();
    spare.dispose();
    expectTrue(
      "an image is disposed like any other object",
      typeof spare[Symbol.dispose] === "function"
    );
    paint.dispose();
    paint.dispose();
    expectThrows("a disposed paint throws", () => canvas.drawPaint(paint));
    expectTrue(
      "objects can be disposed by a using declaration",
      typeof copy[Symbol.dispose] === "function"
    );
  }

  expectTrue("the tiles fit in the texture", tiles <= COLUMNS * ROWS, tiles);
  surface.flush();
  expectThrows("the canvas of a flushed frame throws", () => canvas.save());

  step("reading back");
  const pixels = await read(target);
  for (const check of pixelChecks) {
    const px = (check.tile % COLUMNS) * TILE + check.x;
    const py = Math.floor(check.tile / COLUMNS) * TILE + check.y;
    const at = (py * WIDTH + px) * 4;
    const got = [pixels[at], pixels[at + 1], pixels[at + 2]];
    const { expected } = check;
    checks.push({
      name: check.name,
      pass:
        pixels[at + 3] === 255 &&
        (expected === "not white"
          ? got.some((value) => value < 250)
          : expected.every(
              (value, i) => Math.abs(value - got[i]) <= check.tolerance
            )),
      expected,
      got: [...got, pixels[at + 3]],
    });
  }

  // The read-back pixels, for a person.
  document
    .querySelector<HTMLCanvasElement>("#readback")!
    .getContext("2d")!
    .putImageData(
      new ImageData(new Uint8ClampedArray(pixels), WIDTH, HEIGHT),
      0,
      0
    );

  // ---- The canvas surface: two frames, straight to the canvas.
  step("drawing to the canvas");
  sk.surface.setClearColor(1, 1, 1, 1);
  for (let frame = 0; frame < 2; frame++) {
    const onscreen = sk.surface.getCanvas();
    onscreen.drawRect(0, 0, 64, 64, fill(frame === 0 ? "red" : "#0080ff"));
    sk.surface.flush();
  }
  const context = document
    .querySelector<HTMLCanvasElement>("#gpu")!
    .getContext("webgpu") as GPUCanvasContext;
  const canvasPixels = await read(context.getCurrentTexture());
  const blueFirst = navigator.gpu.getPreferredCanvasFormat() === "bgra8unorm";
  const at = (32 * WIDTH + 32) * 4;
  const drawn = [
    canvasPixels[at + (blueFirst ? 2 : 0)],
    canvasPixels[at + 1],
    canvasPixels[at + (blueFirst ? 0 : 2)],
  ];
  checks.push({
    name: "canvas: the second frame",
    pass:
      Math.abs(drawn[0]) <= 3 &&
      Math.abs(drawn[1] - 128) <= 3 &&
      Math.abs(drawn[2] - 255) <= 3,
    expected: [0, 128, 255],
    got: drawn,
  });
  expectTrue(
    "a surface knows its size",
    sk.surface.width === WIDTH && sk.surface.height === HEIGHT
  );

  step("waiting for pending GPU work");
  let pending = sk.tick();
  for (let i = 0; pending && i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    pending = sk.tick();
  }
  return { pendingGpuWork: pending };
};

const timeout = new Promise<never>((_, reject) => {
  setTimeout(
    () => reject(new Error(`Timed out while ${currentStep}.`)),
    30_000
  );
});

Promise.race([run(), timeout])
  .then(({ pendingGpuWork }) => ({
    pass:
      checks.every((check) => check.pass) &&
      gpuErrors.length === 0 &&
      !pendingGpuWork,
    pendingGpuWork,
  }))
  .catch((error: Error) => ({
    pass: false,
    error: `${error.message} (while ${currentStep})`,
  }))
  .then((outcome) => {
    const result = { ...outcome, checks, gpuErrors };
    (window as unknown as { immediate: unknown }).immediate = result;
    document.querySelector("pre")!.textContent = JSON.stringify(
      {
        ...result,
        checks: checks.filter((check) => !check.pass),
        passed: checks.filter((check) => check.pass).length,
      },
      null,
      2
    );
    document.title = result.pass ? "immediate: pass" : "immediate: FAIL";
  });
