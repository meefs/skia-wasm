/// <reference types="@webgpu/types" />
/**
 * Correctness test of the display list prototype. It records one program with
 * a tile per feature, draws it over four frames while changing its data, its
 * bindings and the lifetime of its resources, and checks pixels read back
 * with WebGPU. The result is left in window.displayList for the spec.
 */
import {
  BlendMode,
  Skia,
  paintColor,
  writeColor,
  writePolyline,
} from "../src/ts";
import type { Instance } from "../src/ts";

const TILE = 64;
const COLUMNS = 4;
const WIDTH = TILE * COLUMNS;
const HEIGHT = TILE * 3;

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

const expectThrows = (name: string, action: () => unknown) => {
  try {
    action();
    checks.push({ name, pass: false, got: "did not throw" });
  } catch (error) {
    checks.push({ name, pass: true, got: String((error as Error).message) });
  }
};

/** Checks a pixel given in the coordinates of a tile. */
const expectPixel = (
  name: string,
  pixels: Uint8Array,
  tile: number,
  x: number,
  y: number,
  expected: RGB,
  tolerance = 3
) => {
  const px = (tile % COLUMNS) * TILE + x;
  const py = Math.floor(tile / COLUMNS) * TILE + y;
  const at = (py * WIDTH + px) * 4;
  const got = [pixels[at], pixels[at + 1], pixels[at + 2]];
  checks.push({
    name,
    pass:
      expected.every((value, i) => Math.abs(value - got[i]) <= tolerance) &&
      pixels[at + 3] === 255,
    expected,
    got: [...got, pixels[at + 3]],
  });
};

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
    module: new URL("../dist/lib/skia-wasm.js", location.href).href,
  });

  // The target that is read back: a texture, not the canvas.
  const target = device.createTexture({
    size: [WIDTH, HEIGHT],
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC,
  });
  const surface = sk.surface(target);
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

  // ---- Context resources.
  step("creating resources");
  const solidTexture = (r: number, g: number, b: number) => {
    const texture = device.createTexture({
      size: [4, 4],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const data = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      data.set([r, g, b, 255], i * 4);
    }
    device.queue.writeTexture({ texture }, data, { bytesPerRow: 16 }, [4, 4]);
    return texture;
  };
  const solidPng = async (css: string) => {
    const canvas = new OffscreenCanvas(8, 8);
    const context = canvas.getContext("2d")!;
    context.fillStyle = css;
    context.fillRect(0, 0, 8, 8);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return blob.arrayBuffer();
  };

  const glow = sk.effect<{ color: "vec4"; scale: "f32" }>(`
    uniform float4 color;
    uniform float scale;
    half4 main(float2 p) { return half4(color.rgb * scale, 1); }
  `);
  const sameGlow = sk.effect(`
    uniform float4 color;
    uniform float scale;
    half4 main(float2 p) { return half4(color.rgb * scale, 1); }
  `);
  expectTrue(
    "an effect reports the layout of its uniforms",
    glow.size === 5 &&
      glow.uniforms.color.offset === 0 &&
      glow.uniforms.color.size === 4 &&
      glow.uniforms.scale.offset === 4 &&
      glow.uniforms.scale.kind === "f32",
    glow.uniforms
  );
  sameGlow.release();
  expectThrows("an effect that does not compile throws", () =>
    sk.effect("half4 main(float2 p) { return nothing; }")
  );

  const red = sk.texture(solidTexture(255, 0, 0), { opaque: true });
  const green = sk.texture(solidTexture(0, 255, 0), { opaque: true });
  const yellow = sk.texture(solidTexture(255, 255, 0), { opaque: true });
  const blue = await sk.image(await solidPng("#0000ff"));

  // ---- The program: one tile per feature.
  step("recording the program");
  const b = sk.builder();
  let tiles = 0;
  const tile = (draw: () => void) => {
    const index = tiles++;
    b.save();
    b.concat(
      b.matrix([
        1,
        0,
        (index % COLUMNS) * TILE,
        0,
        1,
        Math.floor(index / COLUMNS) * TILE,
      ])
    );
    b.clipRect({ width: TILE, height: TILE });
    draw();
    b.restore();
  };
  const full = b.rect({ width: TILE, height: TILE });

  // 0: a filled rect.
  tile(() => b.drawRect(full, { color: "#0080ff" }));
  // 1: a stroked rounded rect.
  tile(() =>
    b.drawRRect(
      { x: 8, y: 8, width: 48, height: 48, r: 12 },
      { color: "#ff0000", style: "stroke", strokeWidth: 6 }
    )
  );
  // 2: a clip.
  tile(() => {
    b.clipRect({ x: 16, y: 16, width: 32, height: 32 });
    b.drawRect(full, { color: "#00ff00" });
  });
  // 3: a matrix, animated later through the helper.
  const transform = b.matrix([1, 0, 32, 0, 1, 32]);
  tile(() => {
    b.save();
    b.concat(transform);
    b.drawRect({ width: 24, height: 24 }, { color: "#ff00ff" });
    b.restore();
  });
  // 4: a static path, owned by the program.
  tile(() =>
    b.drawPath(b.path("M 8 56 L 32 8 L 56 56 Z"), { color: "#00a050" })
  );
  // 5: a path buffer, animated by writing its points.
  const line = b.pathBuffer({ maxVerbs: 8, maxPoints: 8 });
  tile(() => b.drawPath(line, { color: "#ff8000" }));
  // 6: a runtime shader whose uniforms are in the data block.
  const shader = b.shader(glow, { color: [1, 0, 0.5, 1], scale: 1 });
  tile(() => b.drawRect(full, { shader }));
  // 7: the built-in gradient.
  const gradient = b.linearGradient({
    start: [0, 0],
    end: [TILE, 0],
    colors: ["#ff0000", "#0000ff"],
  });
  tile(() => b.drawRect(full, { shader: gradient }));
  // 8: an image through an instance slot.
  const picture = b.slot(red);
  tile(() => b.drawImage(picture, full));
  // 9: an image the program imports.
  tile(() => b.drawImage(blue, full));
  // 10: a blend mode.
  const blended = b.paint({ color: "#00ff00", blendMode: "Plus" });
  tile(() => {
    b.drawRect(full, { color: "#ff0000" });
    b.drawRect(full, blended);
  });
  expectThrows("restore() without save() throws", () => b.restore());

  const program = b.build({
    transform,
    line,
    picture,
    scale: shader.uniforms.scale,
    color: shader.uniforms.color,
    gradientEnd: gradient.colors[1],
    blended,
  });
  expectThrows("a builder builds once", () => b.build());
  expectThrows("an invalid SVG path fails the build", () => {
    const bad = sk.builder();
    bad.drawPath(bad.path("M 0 0 L nope"), {});
    bad.build();
  });

  // A second program, instantiated three times: tile 11.
  const cb = sk.builder();
  const cardTransform = cb.matrix();
  const cardPaint = cb.paint({ color: "#000000" });
  cb.save();
  cb.concat(cardTransform);
  cb.drawRect({ width: 16, height: 16 }, cardPaint);
  cb.restore();
  const cardProgram = cb.build({
    transform: cardTransform,
    color: paintColor(cardPaint),
  });
  const cardColors: RGB[] = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
  ];
  const cards = cardColors.map(([r, g, b8], i) => {
    const card = cardProgram.instantiate();
    card.values.transform.setTranslate(3 * TILE + 4 + i * 20, 2 * TILE + 24);
    card.values.color.set(r / 255, g / 255, b8 / 255, 1);
    return card;
  });

  const scene = program.instantiate();
  const scenes: Instance[] = [scene, ...cards];
  // The path of tile 5 starts as a triangle on the left.
  writePolyline(scene.f32, scene.u32, line, [4, 4, 28, 4, 4, 60], true);

  // ---- Frame 1: the scene as recorded.
  step("drawing frame 1");
  surface.draw(scenes);
  let pixels = await read(target);
  expectPixel("1: rect", pixels, 0, 32, 32, [0, 128, 255]);
  expectPixel("1: rrect stroke", pixels, 1, 8, 32, [255, 0, 0]);
  expectPixel("1: rrect is not filled", pixels, 1, 32, 32, WHITE);
  expectPixel("1: inside the clip", pixels, 2, 32, 32, [0, 255, 0]);
  expectPixel("1: outside the clip", pixels, 2, 6, 6, WHITE);
  expectPixel("1: matrix moves the rect", pixels, 3, 44, 44, [255, 0, 255]);
  expectPixel("1: matrix leaves the origin", pixels, 3, 10, 10, WHITE);
  expectPixel("1: static path", pixels, 4, 32, 40, [0, 160, 80]);
  expectPixel("1: outside the static path", pixels, 4, 8, 12, WHITE);
  expectPixel("1: path buffer", pixels, 5, 10, 20, [255, 128, 0]);
  expectPixel("1: outside the path buffer", pixels, 5, 54, 40, WHITE);
  expectPixel("1: runtime shader", pixels, 6, 32, 32, [255, 0, 128]);
  expectPixel("1: gradient start", pixels, 7, 2, 32, [247, 0, 8], 10);
  expectPixel("1: gradient end", pixels, 7, 61, 32, [8, 0, 247], 10);
  expectPixel("1: image slot", pixels, 8, 32, 32, [255, 0, 0]);
  expectPixel("1: imported image", pixels, 9, 32, 32, [0, 0, 255]);
  expectPixel("1: blend mode", pixels, 10, 32, 32, [255, 255, 0]);
  cardColors.forEach((color, i) =>
    expectPixel(`1: instance ${i}`, pixels, 11, 12 + i * 20, 32, color)
  );
  expectPixel("1: around the instances", pixels, 11, 32, 8, WHITE);

  // ---- Frame 2: raw writes, and resources released while in use.
  step("drawing frame 2");
  glow.release();
  red.release();
  blue.release();
  program.dispose();
  cardProgram.dispose();
  expectThrows("a disposed program does not instantiate", () =>
    program.instantiate()
  );
  {
    const { f32 } = scene;
    f32.set([60, 4, 36, 4, 60, 60], line.points);
    writeColor(f32, shader.uniforms.color, 0, 1, 0, 1);
  }
  surface.draw(scenes);
  pixels = await read(target);
  expectPixel("2: path points moved", pixels, 5, 54, 20, [255, 128, 0]);
  expectPixel("2: path left its old place", pixels, 5, 10, 20, WHITE);
  expectPixel("2: uniform written", pixels, 6, 32, 32, [0, 255, 0]);
  expectPixel(
    "2: released slot image is retained",
    pixels,
    8,
    32,
    32,
    [255, 0, 0]
  );
  expectPixel("2: released import is retained", pixels, 9, 32, 32, [0, 0, 255]);
  expectPixel("2: unchanged tile", pixels, 0, 32, 32, [0, 128, 255]);

  // ---- Frame 3: wasm memory grows, then writes through the typed helper.
  step("drawing frame 3");
  const stale = scene.f32;
  const { module } = sk;
  const before = module.HEAPU8.buffer.byteLength;
  module._free(module._malloc(before + (64 << 20)));
  expectTrue(
    "wasm memory grew and detached the old view",
    module.HEAPU8.buffer.byteLength > before && stale.length === 0,
    { before, after: module.HEAPU8.buffer.byteLength, stale: stale.length }
  );
  expectTrue(
    "the instance hands out a live view after growth",
    scene.f32.length === program.dataWords && scene.f32 !== stale
  );
  const v = scene.values;
  v.scale = 0.5;
  v.color.set(0, 0, 1, 1);
  v.transform.setTranslate(4, 4);
  v.line.setPolyline([4, 60, 60, 60, 32, 4], true);
  v.picture = green;
  v.gradientEnd.set(0, 1, 0, 1);
  v.blended.color.set(0, 0, 1, 1);
  v.blended.blendMode = BlendMode.Plus;
  cards[0].values.color.set(1, 1, 0, 1);
  cards[2].values.transform.setTranslate(3 * TILE + 44, 2 * TILE + 4);
  surface.draw(scenes);
  pixels = await read(target);
  expectTrue("values read back what was written", v.scale === 0.5, v.scale);
  expectPixel("3: scalar and vector uniforms", pixels, 6, 32, 32, [0, 0, 128]);
  expectPixel("3: matrix helper", pixels, 3, 12, 12, [255, 0, 255]);
  expectPixel("3: matrix left its old place", pixels, 3, 50, 50, WHITE);
  expectPixel("3: polyline helper", pixels, 5, 32, 44, [255, 128, 0]);
  expectPixel("3: polyline left its old place", pixels, 5, 54, 12, WHITE);
  expectPixel("3: slot rebound", pixels, 8, 32, 32, [0, 255, 0]);
  expectPixel("3: gradient color", pixels, 7, 61, 32, [8, 247, 0], 10);
  expectPixel("3: paint color", pixels, 10, 32, 32, [255, 0, 255]);
  expectPixel("3: instance color", pixels, 11, 12, 32, [255, 255, 0]);
  expectPixel("3: instance moved", pixels, 11, 52, 12, [0, 0, 255]);
  expectPixel("3: instance left its old place", pixels, 11, 52, 32, WHITE);

  // ---- Frame 4: a slot bound to a resource released before it was drawn,
  // and an instance disposed.
  step("drawing frame 4");
  scene.bind(picture, yellow);
  yellow.release();
  green.release();
  cards[1].dispose();
  expectThrows("drawing a disposed instance throws", () =>
    surface.draw(scenes)
  );
  expectThrows("a disposed instance has no data", () => cards[1].f32);
  surface.draw([scene, cards[0], cards[2]]);
  pixels = await read(target);
  expectPixel(
    "4: a slot of a released resource is empty",
    pixels,
    8,
    32,
    32,
    WHITE
  );
  expectPixel("4: disposed instance is gone", pixels, 11, 32, 32, WHITE);
  expectPixel("4: other instances remain", pixels, 11, 12, 32, [255, 255, 0]);
  expectPixel("4: scene remains", pixels, 0, 32, 32, [0, 128, 255]);

  // The read-back pixels, for a person.
  document
    .querySelector<HTMLCanvasElement>("#readback")!
    .getContext("2d")!
    .putImageData(
      new ImageData(new Uint8ClampedArray(pixels), WIDTH, HEIGHT),
      0,
      0
    );

  // ---- The canvas surface: the same scene, one instance, straight to the
  // canvas, whose texture can be read until the frame is presented.
  step("drawing to the canvas");
  const element = document.querySelector<HTMLCanvasElement>("#gpu")!;
  // The checks read pixels back: one per unit, whatever the screen.
  const canvasSurface = sk.surface(element, { pixelRatio: 1 });
  canvasSurface.setClearColor(1, 1, 1, 1);
  canvasSurface.draw(scene);
  const context = element.getContext("webgpu") as GPUCanvasContext;
  const canvasPixels = await read(context.getCurrentTexture());
  if (navigator.gpu.getPreferredCanvasFormat() === "bgra8unorm") {
    for (let i = 0; i < canvasPixels.length; i += 4) {
      const blueChannel = canvasPixels[i];
      canvasPixels[i] = canvasPixels[i + 2];
      canvasPixels[i + 2] = blueChannel;
    }
  }
  expectPixel("canvas: rect", canvasPixels, 0, 32, 32, [0, 128, 255]);
  expectPixel("canvas: runtime shader", canvasPixels, 6, 32, 32, [0, 0, 128]);

  // ---- Teardown.
  step("waiting for pending GPU work");
  scene.dispose();
  cards[0].dispose();
  cards[2].dispose();
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
    (window as unknown as { displayList: unknown }).displayList = result;
    document.querySelector("pre")!.textContent = JSON.stringify(
      {
        ...result,
        checks: checks.filter((check) => !check.pass),
        passed: checks.filter((check) => check.pass).length,
      },
      null,
      2
    );
    document.title = result.pass ? "display list: pass" : "display list: FAIL";
  });
