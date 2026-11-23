# skia-wasm

Skia Graphite on WebGPU, compiled to WebAssembly.

Skia's Graphite renderer runs on the `GPUDevice` of the page, through Dawn's WebGPU bindings for Emscripten. It is built from the same Skia and Dawn revisions as the native binaries of [React Native Skia](https://github.com/wcandillon/react-native-skia).

**This is experimental.** There is no stable API yet, and the `skia-wasm` package on npm is a placeholder. The API is in the style of CanvasKit: a canvas, paints and paths. [BENCHMARK.md](./BENCHMARK.md) measures it against `canvaskit-wasm`, on a laptop and on a phone.

**Documentation:** [wcandillon.github.io/skia-wasm](https://wcandillon.github.io/skia-wasm/docs/). Two short guides ([getting started](https://wcandillon.github.io/skia-wasm/docs/getting-started/) and [conventions](https://wcandillon.github.io/skia-wasm/docs/conventions/)), then examples that run live above their code.

This is an independent open source project. It is not an official Skia package.

## The API

A canvas, paints and paths, as in CanvasKit, over plain C exports: no embind, and no wrapper object per call.

```ts
const sk = await Skia.init({ device });
const surface = sk.surface(canvas);

const card = sk.paint({ color: "#3b82f6" });
const glow = sk.paint({
  shader: sk.linearGradient({
    start: [0, 0],
    end: [512, 0],
    colors: ["#f97316", "#ec4899"],
  }),
  maskFilter: sk.maskFilter.blur(8),
});
const font = sk.font(sk.typeface(fontBytes), 32);

function tick(time: number) {
  const canvas = surface.getCanvas();
  canvas.clear("white");
  canvas.save();
  canvas.rotate(time / 1000, 256, 256);
  canvas.drawRoundedRect(156, 196, 200, 120, 16, card);
  canvas.restore();
  canvas.drawCircle(256, 400, 48, glow);
  canvas.drawText("Hello", 32, 64, font, card);
  surface.flush();
  requestAnimationFrame(tick);
}
```

Where it departs from CanvasKit:

- **Plain numbers.** `drawRect(x, y, width, height, paint)`: no rect, point or matrix objects, and no typed arrays to allocate and free. An array is only taken where the data is one: points, glyphs, the stops of a gradient.
- **Explicit names.** `drawRoundedRect`, `sk.linearGradient({ start, end, colors })`, `sk.path("M 0 0 L 10 10")`, `path.op(other, "difference")`, `sk.imageFilter.dropShadow({ dx, dy, sigma, color })`.
- **Options and properties.** `sk.paint({ color, style: "stroke" })`, then `paint.strokeWidth = 4`. Enumerations are strings, such as `"srcOver"` or `"round"`, and a name that does not exist throws.
- **Everything comes from `sk`.** `sk.paint()`, `sk.path()`, `sk.font()`: an object lives in the wasm module that `sk` loaded, so there are no constructors to call.
- **CSS colors.** Wherever a color is taken: hex, names, `rgb()` and `hsl()`, or `[r, g, b, a]` in [0, 1]. `parseColor()` is exported.
- **Radians**, for every angle.
- **Units, not pixels.** The size of a canvas is the size of the drawing. A canvas on the page gets the pixels its screen needs, and drawing is scaled to them under every transform: the same code is sharp at any device pixel ratio. `pixelRatio: 1` leaves a canvas alone.
- **Lifetimes.** `dispose()` frees an object now, a `using` declaration frees it at the end of a scope, and the garbage collector frees what was forgotten. A paint keeps the shader and the filters it is given, so they can be disposed right after. Images and runtime effects are only freed by `dispose()`.
- **Frames.** `surface.getCanvas()` starts a frame and `surface.flush()` sends it to the GPU.

What it covers:

- **Canvas:** state, transforms, clips, layers with backdrops, shapes, paths, images, text, paragraphs and pictures.
- **Paths:** segments and shapes, SVG in and out, boolean operations, bounds, hit testing, length and points along the path, trimming, stroking and interpolation.
- **Shaders:** linear, radial, conical and sweep gradients, images, pictures, noise, blends, and runtime effects with uniforms and children.
- **Filters and effects:** color filters, image filters, mask filters and path effects.
- **Text:** typefaces from bytes, fonts, metrics, glyphs, text blobs, and paragraphs with styled spans.
- **Surfaces and export:** canvases, textures of the page, offscreen surfaces, snapshots, reading pixels, and encoding PNG, JPEG and WebP.

Left out for now: vertices and atlases, placeholders and font fallback in paragraphs, SVG documents and Skottie (both are in the archives), and any React integration.

## Layout

- `src/cpp/`: the Graphite context (`context.cpp`), the table of images and runtime effects (`resources.h`, `api.cpp`), and one file of C exports per area: `canvas.cpp`, `paint.cpp`, `path.cpp`, `text.cpp` and `image.cpp`. No embind.
- `src/ts/`: one file per kind of object (`canvas.ts`, `paint.ts`, `path.ts`, `effects.ts`, `text.ts`, `picture.ts`), with `color.ts` for CSS colors and `native.ts` for lifetimes.
- `src/ts/exports.ts`: the typed list of the C exports, written by `yarn generate-exports` from `src/cpp`, so that a call with the wrong number of arguments does not compile.
- `tests/`: a page with a tile per feature, checked by reading pixels back with WebGPU.
- `bench/`: four scenes drawn by `canvaskit-wasm` and by this library, in Chrome on this machine or on a phone over adb. `bench/results/` holds the runs that [BENCHMARK.md](./BENCHMARK.md) reports.
- `docs/`: the documentation site: two guides, then examples. Its home page is drawn by the library: Skia draws the page into two textures and a WebGPU pass draws a ribbon between them, over the page and behind the word "skia", the subtitle and the buttons (`docs/hero/hero.ts`). `docs/examples/` holds one module per example, type checked and linted with the rest of the repository. The site itself is a standalone project (`cd docs && yarn install && yarn dev`).

An earlier version also had a retained API, a display list: a scene recorded once as a program, and animated by writing numbers into a block of wasm memory. It was removed because it cost the same as the calls it replaced, on every scene measured. BENCHMARK.md has the figures, and the last commit with the code is `e1c6a31`.

## Building

You need Node, Yarn and the Emscripten release the Skia archives were built with (4.0.7 today; `metadata.json` in the archives says which). Point `EMSDK` at an emsdk that has it:

```sh
emsdk install 4.0.7 && emsdk activate 4.0.7
export EMSDK=/path/to/emsdk
```

The emsdk inside a React Native Skia checkout works too: `externals/skia/third_party/externals/emsdk`.

```sh
yarn install
yarn test             # build the module and run its test in headless Chromium
yarn bench            # build and run the benchmark in a Chrome window
yarn bench-report bench/results/laptop-spin.json
                      # the tables of a run
yarn build && yarn build-bench && yarn serve
                      # http://localhost:8790/tests/immediate.html
                      # http://localhost:8790/bench/index.html
```

The test needs Playwright's Chromium (`yarn playwright install chromium`); the benchmark uses the installed Google Chrome, or Chrome on an Android phone (`yarn bench --target=android`, see `scripts/run-bench.ts`).

## The Skia archives

This repository does not build Skia. It links prebuilt static archives of Skia Graphite, built in the React Native Skia repository (`yarn build-skia wasm` in `packages/skia`):

```
lib/*.a          Skia and its modules, as wasm object archives
skia/            the Skia headers
emdawnwebgpu/    WebGPU headers and JS library, generated from the pinned Dawn
metadata.json    Emscripten version, flags and defines a consumer has to match
```

`binaries.json` pins one build by URL and SHA-256. `scripts/skia.ts` downloads it once, checks it and unpacks it in the user cache. To link a local build instead:

```sh
export SKIA_WASM_ARCHIVES=/path/to/react-native-skia/packages/skia/libs/wasm
```

Three things have to match what `metadata.json` records, because they change the layout of Skia's types and the features of the object files: the Emscripten release, the compiler flags (`-fno-exceptions`, `-fno-rtti`, no pthreads) and the preprocessor defines. The build scripts read them from the metadata.

Dawn itself is not in the archives. The browser implements WebGPU; `emdawnwebgpu/` provides `webgpu.h`, `webgpu_cpp.h` and the JavaScript glue, added at link time.

## Notes on this build of Skia

- The Graphite context is created without a tick function, so it never blocks: no Asyncify, no JSPI. Synchronous readbacks are not available; GPU work completes from the browser's event loop.
- Graphite only draws GPU images. A CPU image needs `SkImages::TextureFromImage()`.
- There are no system fonts. Typefaces come from bytes, through `SkFontMgr_New_Custom_Empty()`.
- No pthreads.

## License

MIT. Skia and Dawn have their own licenses, shipped with the archives.
