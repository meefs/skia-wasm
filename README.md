# skia-wasm

Skia Graphite on WebGPU, compiled to WebAssembly.

Skia's Graphite renderer runs on the `GPUDevice` of the page, through Dawn's WebGPU bindings for Emscripten. It is built from the same Skia and Dawn revisions as the native binaries of [React Native Skia](https://github.com/wcandillon/react-native-skia).

**This is experimental.** There is no stable API yet, and the `skia-wasm` package on npm is a placeholder. The repository currently holds a prototype of a display list API and a benchmark of it against conventional per-call bindings (results in [BENCHMARK.md](./BENCHMARK.md)). The prototype exists to decide what shape the real bindings should take.

This is an independent open source project. It is not an official Skia package.

## The display list prototype

A scene is recorded once as an immutable program. Every number of the scene lives in a flat block of wasm memory, and drawing is a function of three things: `draw(program, data, resources)`. Animating a frame is writing floats into the block and making one call.

| Part | Contents | Mutability |
| --- | --- | --- |
| Program | Ordered commands. Each names its type and the offsets of its operands in the data block. It contains no values. | Immutable once built |
| Data block | One region of wasm memory, in 32-bit words, holding every operand | Written by JavaScript every frame |
| Resources | Skia objects the commands refer to, by index | Immutable objects |

```ts
const sk = await Skia.init({ device, canvas });
const glow = sk.effect<{ iTime: "f32"; color: "vec4" }>(sksl);

// Recorded once. The builder returns slots: offsets into the data block.
const b = sk.builder();
const m = b.matrix();
const shader = b.shader(glow, { iTime: 0, color: [0.2, 0.4, 1, 1] });
const line = b.pathBuffer({ maxVerbs: 64, maxPoints: 64 });
const picture = b.slot(logo);
b.save();
b.concat(m);
b.drawRRect({ width: 200, height: 120, r: 16 }, { shader });
b.drawPath(line, { color: "#fff", style: "stroke", strokeWidth: 2 });
b.drawImage(picture, { x: 16, y: 16, width: 48, height: 48 });
b.restore();
const program = b.build({ transform: m, time: shader.uniforms.iTime, line });

// Per frame: write numbers, make one call.
const scene = program.instantiate();
function tick(time: number) {
  const f32 = scene.f32; // read again every frame: memory growth detaches it
  writeRotate(f32, m, time * 0.001, 100, 60);
  f32[shader.uniforms.iTime] = time / 1000;
  f32.set(points, line.points);
  // or, through the typed helper generated from the schema:
  // scene.values.transform.setRotate(time * 0.001, 100, 60);
  sk.surface.draw(scene);
  requestAnimationFrame(tick);
}
```

What the prototype covers:

- **State:** `save`, `restore`, `concat` (3x3 matrix), `clipRect`.
- **Drawing:** `drawRect`, `drawRRect`, `drawPath` (a static path or a path buffer), `drawImage`.
- **Paint:** a color, fill or stroke, a stroke width, a blend mode, an optional shader.
- **Shaders:** runtime effects with their uniforms in the data block, and a linear gradient.
- **Resources:** effects and images shared across programs, static paths owned by a program, image slots per instance.
- **Instances:** any number per program, drawn one at a time or as an array, in one call.

Left out on purpose: text and paragraphs, image filters, color filters, path effects, layers, conditional and repeated commands, threads, and any React integration.

## Layout

- `src/ts/format.ts`: the binary format, defined once. `yarn generate-format` writes `src/cpp/generated/format.h` from it, and `src/cpp/layout.h` checks the C++ structs against it with static asserts.
- `src/cpp/`: the player (`program.cpp`), the resource store (`resources.h`), the Graphite context and the frame (`context.cpp`), and the C exports (`api.cpp`). No embind.
- `src/ts/`: the builder, the program and its instances, the write helpers, and `values.ts`, which generates the typed `scene.values`.
- `tests/`: one scene with a tile per feature, drawn over four frames while its data, its bindings and the lifetime of its resources change, and checked by reading pixels back with WebGPU.
- `bench/`: four scenes, each drawn through embind objects, C exports, a command buffer and the display list.
- `docs/`: the documentation site, which for now contains examples only. `docs/examples/` holds one module per example, type checked and linted with the rest of the repository. The site itself is a standalone project (`cd docs && yarn install && yarn dev`).

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
yarn bench-report     # the tables of BENCHMARK.md, from bench/results.json
yarn build && yarn build-bench && yarn serve
                      # http://localhost:8790/tests/display-list.html
                      # http://localhost:8790/bench/index.html
```

The test needs Playwright's Chromium (`yarn playwright install chromium`); the benchmark uses the installed Google Chrome.

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
