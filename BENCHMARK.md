# Benchmark: a display list against per-call bindings

Measured on November 23, 2026. The raw figures are in [bench/results.json](./bench/results.json); `yarn bench-report` prints the tables below from it.

## What it found

1. **In a real frame, the binding layer does not matter.** With Graphite drawing, plain C exports, a command buffer and the display list are within the noise of each other in three scenes out of four. In the fourth, the shader scene, the display list is slower in most measurements, typically by 0.1 to 0.2 ms (5 to 15%).
2. **Plain C exports are as fast as the display list.** The hypothesis was that one JavaScript-to-wasm call per operation is expensive. It is not: about 2 nanoseconds per call here. With nothing drawn, the display list is 6% faster than C exports on 10,000 rounded rects and slower on the other three scenes.
3. **embind is the outlier, and only where it creates objects.** With one new shader per item per frame, it takes 4 to 6 times longer than the other variants at the binding layer and allocates 417 KB of JavaScript garbage per frame. In a full frame that is 0.3 to 0.6 ms more than the others on that scene.
4. **The time and the garbage are below the binding layer.** For 10,000 rounded rects, a frame costs about 15 ms of CPU whichever way the calls arrive. Two thirds of it is Graphite snapping, inserting and submitting the recording. The same frame allocates 5.3 MB of JavaScript heap in every variant, none of it from the Skia bindings.
5. **The typed helper is close to free.** `scene.values` costs 3 to 9% more than raw writes at the binding layer on rects and shaders, 7 microseconds more on 2,000 slot rebinds, and nothing measurable in a full frame.

## What is compared

Five ways of drawing the same frames, linked into one module against the same Skia archives, with the same flags (`-O3`, assertions off).

| Variant | Description |
| --- | --- |
| A. embind objects | CanvasKit style: `Paint`, `Path`, `Shader`, `RuntimeEffect` and `Image` wrapper classes through embind, one call per operation. Arrays are passed as pointers to wasm memory the page filled, as CanvasKit does. |
| B. C exports | Plain `extern "C"` functions, one call per operation. Objects are raw pointers: no wrapper objects, no lookups. |
| C. Command buffer | The frame is encoded, values included, into wasm memory every frame, then decoded by one call. Nothing is kept between frames. |
| D. Display list, raw writes | The program is built once. Per frame: raw `f32` and `u32` writes into the data block, then one call. |
| E. Display list, helper | The same, written through `scene.values`. |

Two more, where they apply:

| Variant | Description |
| --- | --- |
| F. One instance per item | The rounded rect scene as one program of a single rect and 10,000 instances, drawn as an array in one call. |
| S. Nothing written | The display list with no write at all: what its caches save when the content is static. |

A and B are written the way a careful user would: paints are reused, nothing is allocated needlessly, exported functions are held in local variables. This is a reimplementation of the CanvasKit style on this build, not CanvasKit itself.

## Scenes

Each is animated on every frame, on a 1024 by 1024 canvas.

1. **10,000 rounded rects**, each with its own matrix and color: `save`, `concat`, `drawRRect`, `restore` per item.
2. **1,000 rects with a runtime shader**, each with its own `iTime` and `color` uniforms.
3. **200 stroked paths of 64 points**, every point moving.
4. **2,000 images drawn from 4 textures**, each changing texture every frame.

Every variant draws the same picture: on a reference frame, the pixels of each variant were compared with those of D over a 16 by 16 grid of averages, and the largest difference was 0. No run reported a WebGPU validation error.

## Machine

| | |
| --- | --- |
| Computer | MacBook Pro (Mac17,7), Apple M5 Max, 18 cores, 64 GB |
| System | macOS 26.6.2 |
| Browser | Google Chrome 157.0.8103.79, in a regular window started by Playwright with `--js-flags=--expose-gc` |
| GPU | Apple M5 Max; WebGPU adapter `apple`, `metal-3`; canvas format `bgra8unorm` |
| Displays | Built-in at 120 Hz and an external one at 60 Hz. Frames were presented at 120 Hz in the first run and at 60 Hz in the second, except the rounded rects, which take more than 8 ms and always ran at 60 Hz. |
| Skia | Graphite on Dawn's WebGPU bindings for Emscripten 4.0.7. No SIMD (`SKVX_DISABLE_SIMD`), no threads. |

## How it is measured

- **Frames.** Each variant runs 180 warm-up frames, then 600 measured frames, inside `requestAnimationFrame`. The animation advances by one fixed step per frame, so every variant draws the same sequence.
- **Two modes.** "Drawing with Graphite" is the real thing. "Drawing nothing" sends the same calls to an `SkNoDrawCanvas`: Skia still tracks the matrix and clip and still creates shaders and paths, but nothing is recorded or submitted. What is left is the cost of getting calls and values into wasm. In that mode a frame takes tens of microseconds, so ten frames run per callback and are averaged.
- **Two runs** of each mode. A figure is the median of the two runs, followed by half the distance between them. Each run's own figure is the median or the 95th percentile over its 600 frames.
- **Clock.** `performance.now()` on a cross-origin isolated page: 5 microsecond resolution.
- **Total** is the frame callback, from its start until the last call into wasm returns.
- **Inside wasm** is measured in C++ at three points of every frame: after the target is wrapped and cleared, after the drawing calls, and after the recording is snapped, inserted and submitted.
- **JavaScript and Wasm columns.** For C, D, E, F and S the frame is a few calls, so the split is measured: Wasm is the time inside them, JavaScript the rest. For A and B the two are interleaved thousands of times per frame and cannot be timed call by call without distorting them. Their Wasm figure assumes the drawing calls take what C takes to replay the same calls, and their JavaScript figure is the total minus that. These derived figures are marked †. They are only as good as that assumption, and one of them comes out negative.
- **Allocation and collections** come from the DevTools protocol, in a separate run of 600 frames so that profiling does not slow the timed one: the sampling heap profiler with collected objects included, and the `MinorGC` and `MajorGC` events of a trace. What the harness itself allocates is subtracted. Collections are per 600 frames.

## Results

### 10,000 rounded rects, each with its own matrix and color

Drawing with Graphite, milliseconds per frame:

| Variant | Total, median | Total, p95 | JavaScript | Wasm | of which snap, insert, submit | Allocated per frame | GCs, minor / major | rAF interval |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A. embind objects | 15.50 ±0.41 | 17.87 ±0.74 | 0.34 ±0.22 † | 15.16 ±0.19 † | 9.77 ±0.18 | 5382.9 KB | 90 / 73 | 16.7 ±0.0 |
| B. C exports | 15.35 ±0.63 | 17.00 ±0.47 | 0.22 ±0.24 † | 15.14 ±0.39 † | 9.74 ±0.39 | 5264.3 KB | 59 / 60 | 16.7 ±0.0 |
| C. Command buffer | 15.45 ±0.80 | 17.22 ±0.66 | 0.21 ±0.04 | 15.24 ±0.76 | 9.85 ±0.47 | 5264.4 KB | 59 / 60 | 16.7 ±0.0 |
| D. Display list, raw writes | 14.98 ±0.48 | 17.45 ±1.09 | 0.15 ±0.04 | 14.83 ±0.45 | 9.53 ±0.25 | 5264.2 KB | 94 / 47 | 16.7 ±0.0 |
| E. Display list, helper | 15.09 ±0.31 | 17.62 ±0.89 | 0.20 ±0.01 | 14.89 ±0.30 | 9.56 ±0.15 | 5264.8 KB | 93 / 47 | 16.7 ±0.0 |
| F. Display list, one instance per item | 15.89 ±0.08 | 17.77 ±0.09 | 0.22 ±0.01 | 15.67 ±0.07 | 10.01 ±0.00 | 5264.9 KB | 51 / 50 | 16.7 ±0.0 |

Drawing nothing, microseconds per frame:

| Variant | Total, median | Total, p95 | Before the calls | The calls | Allocated per frame | GCs, minor / major |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A. embind objects | 1296 ±13 | 1321 ±14 | 2 ±0 | 1294 ±13 | 232.7 KB | 70 / 0 |
| B. C exports | 1067 ±14 | 1388 ±315 | 2 ±0 | 1065 ±13 | 0.1 KB | 0 / 0 |
| C. Command buffer | 989 ±6 | 1026 ±11 | 128 ±0 | 861 ±6 | 0.1 KB | 0 / 0 |
| D. Display list, raw writes | 1002 ±8 | 1040 ±13 | 105 ±0 | 897 ±9 | 0.1 KB | 0 / 0 |
| E. Display list, helper | 1037 ±5 | 1062 ±7 | 139 ±1 | 898 ±6 | 0.1 KB | 0 / 0 |
| F. Display list, one instance per item | 1159 ±8 | 1175 ±9 | 118 ±2 | 1041 ±10 | 0.1 KB | 0 / 0 |

### 1,000 rects with a runtime shader, each with its own uniforms

Drawing with Graphite, milliseconds per frame:

| Variant | Total, median | Total, p95 | JavaScript | Wasm | of which snap, insert, submit | Allocated per frame | GCs, minor / major | rAF interval |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A. embind objects | 2.18 ±0.07 | 2.58 ±0.26 | 0.44 ±0.02 † | 1.74 ±0.05 † | 1.23 ±0.03 | 988.4 KB | 14 / 21 | 12.5 ±4.2 |
| B. C exports | 1.61 ±0.05 | 1.69 ±0.05 | 0.04 ±0.01 † | 1.57 ±0.03 † | 1.05 ±0.02 | 530.3 KB | 0 / 22 | 12.5 ±4.2 |
| C. Command buffer | 1.58 ±0.04 | 1.68 ±0.04 | 0.03 ±0.00 | 1.56 ±0.04 | 1.04 ±0.02 | 530.6 KB | 0 / 21 | 12.5 ±4.2 |
| D. Display list, raw writes | 1.92 ±0.22 | 2.41 ±0.44 | 0.02 ±0.01 | 1.90 ±0.22 | 1.24 ±0.14 | 530.4 KB | 0 / 19 | 12.5 ±4.2 |
| E. Display list, helper | 1.76 ±0.01 | 2.26 ±0.27 | 0.03 ±0.01 | 1.72 ±0.02 | 1.14 ±0.02 | 530.7 KB | 0 / 19 | 12.5 ±4.2 |
| S. Display list, nothing written | 1.78 ±0.07 | 2.13 ±0.22 | 0.02 ±0.01 | 1.76 ±0.06 | 1.19 ±0.04 | 530.4 KB | 0 / 18 | 12.5 ±4.2 |

Drawing nothing, microseconds per frame:

| Variant | Total, median | Total, p95 | Before the calls | The calls | Allocated per frame | GCs, minor / major |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A. embind objects | 311 ±42 | 433 ±10 | 2 ±1 | 308 ±42 | 416.5 KB | 125 / 0 |
| B. C exports | 55 ±3 | 119 ±9 | 3 ±0 | 53 ±3 | 0.1 KB | 0 / 0 |
| C. Command buffer | 48 ±10 | 86 ±15 | 6 ±1 | 42 ±9 | 0.1 KB | 0 / 0 |
| D. Display list, raw writes | 64 ±1 | 127 ±2 | 4 ±0 | 60 ±1 | 0.1 KB | 0 / 0 |
| E. Display list, helper | 70 ±5 | 156 ±18 | 8 ±0 | 62 ±4 | 0.1 KB | 0 / 0 |
| S. Display list, nothing written | 41 ±5 | 67 ±28 | 3 ±0 | 38 ±6 | 0.1 KB | 0 / 0 |

### 200 stroked paths of 64 points, every point moving

Drawing with Graphite, milliseconds per frame:

| Variant | Total, median | Total, p95 | JavaScript | Wasm | of which snap, insert, submit | Allocated per frame | GCs, minor / major | rAF interval |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A. embind objects | 0.86 ±0.16 | 1.38 ±0.29 | 0.18 ±0.05 † | 0.69 ±0.11 † | 0.48 ±0.09 | 116.2 KB | 0 / 6 | 12.5 ±4.2 |
| B. C exports | 0.91 ±0.08 | 1.44 ±0.22 | 0.17 ±0.04 † | 0.74 ±0.05 † | 0.52 ±0.05 | 116.9 KB | 0 / 6 | 12.5 ±4.2 |
| C. Command buffer | 0.87 ±0.05 | 1.28 ±0.30 | 0.17 ±0.01 | 0.71 ±0.04 | 0.50 ±0.03 | 117.4 KB | 0 / 6 | 12.5 ±4.2 |
| D. Display list, raw writes | 0.84 ±0.07 | 1.57 ±0.15 | 0.15 ±0.01 | 0.69 ±0.06 | 0.45 ±0.04 | 116.4 KB | 0 / 6 | 12.5 ±4.2 |
| E. Display list, helper | 0.95 ±0.01 | 1.75 ±0.14 | 0.17 ±0.00 | 0.78 ±0.01 | 0.52 ±0.00 | 116.8 KB | 0 / 6 | 12.5 ±4.2 |
| S. Display list, nothing written | 0.79 ±0.07 | 1.69 ±0.28 | 0.03 ±0.00 | 0.76 ±0.07 | 0.51 ±0.05 | 116.5 KB | 0 / 6 | 12.5 ±4.2 |

Drawing nothing, microseconds per frame:

| Variant | Total, median | Total, p95 | Before the calls | The calls | Allocated per frame | GCs, minor / major |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A. embind objects | 165 ±18 | 291 ±91 | 3 ±1 | 163 ±16 | 0.1 KB | 0 / 0 |
| B. C exports | 149 ±3 | 338 ±27 | 2 ±0 | 146 ±4 | 0.1 KB | 0 / 0 |
| C. Command buffer | 159 ±4 | 307 ±27 | 138 ±4 | 21 ±0 | 0.1 KB | 0 / 0 |
| D. Display list, raw writes | 209 ±18 | 322 ±11 | 152 ±13 | 56 ±5 | 0.1 KB | 0 / 0 |
| E. Display list, helper | 162 ±1 | 311 ±22 | 119 ±0 | 44 ±0 | 0.1 KB | 0 / 0 |
| S. Display list, nothing written | 23 ±2 | 59 ±14 | 3 ±0 | 21 ±1 | 0.1 KB | 0 / 0 |

### 2,000 images from 4 textures, rebound every frame

Drawing with Graphite, milliseconds per frame:

| Variant | Total, median | Total, p95 | JavaScript | Wasm | of which snap, insert, submit | Allocated per frame | GCs, minor / major | rAF interval |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A. embind objects | 3.99 ±0.26 | 4.55 ±0.24 | -0.20 ±0.08 † | 4.19 ±0.18 † | 2.53 ±0.17 | 1087.5 KB | 0 / 36 | 12.5 ±4.2 |
| B. C exports | 4.72 ±0.94 | 5.02 ±0.76 | 0.06 ±0.34 † | 4.66 ±0.60 † | 3.01 ±0.59 | 1055.1 KB | 1 / 34 | 12.5 ±4.2 |
| C. Command buffer | 4.69 ±1.00 | 5.02 ±0.75 | 0.04 ±0.00 | 4.65 ±0.99 | 3.00 ±0.64 | 1055.3 KB | 0 / 35 | 12.5 ±4.2 |
| D. Display list, raw writes | 4.65 ±1.06 | 5.00 ±0.83 | 0.04 ±0.00 | 4.60 ±1.06 | 2.96 ±0.67 | 1057.8 KB | 0 / 34 | 12.5 ±4.2 |
| E. Display list, helper | 4.69 ±1.06 | 5.06 ±0.78 | 0.05 ±0.00 | 4.64 ±1.06 | 2.98 ±0.66 | 1057.0 KB | 1 / 33 | 12.5 ±4.2 |

Drawing nothing, microseconds per frame:

| Variant | Total, median | Total, p95 | Before the calls | The calls | Allocated per frame | GCs, minor / major |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A. embind objects | 35 ±7 | 91 ±21 | 3 ±0 | 32 ±7 | 31.4 KB | 20 / 0 |
| B. C exports | 15 ±1 | 43 ±9 | 3 ±0 | 13 ±0 | 0.1 KB | 0 / 0 |
| C. Command buffer | 15 ±0 | 42 ±8 | 7 ±0 | 8 ±0 | 0.1 KB | 0 / 0 |
| D. Display list, raw writes | 22 ±2 | 68 ±1 | 4 ±1 | 18 ±1 | 0.1 KB | 0 / 0 |
| E. Display list, helper | 29 ±4 | 89 ±1 | 10 ±1 | 19 ±3 | 0.1 KB | 0 / 0 |

## Reading the results

### How much faster than per-call bindings?

**With Graphite drawing: not measurably.**

- **Rounded rects.** 15.0 to 15.9 ms for every variant, with runs 0.3 to 0.8 ms apart. The display list has the lowest median, by less than the distance between two runs of the same variant.
- **Paths.** 0.79 to 0.95 ms for every variant.
- **Images.** 4.0 to 4.7 ms, but the two runs are 2 ms apart (about 5.7 ms when presenting at 120 Hz, 3.7 ms at 60 Hz). No difference between variants survives that.
- **Shaders.** embind is the slowest at 2.18 ms. C exports and the command buffer are the fastest at 1.6 ms. The display list is in between, at 1.76 to 1.92 ms. To rule out a drift during the run, the scene was measured twice more with the variants in another order: with the display list first, it took 1.73 to 1.77 ms against 1.53 to 1.59 ms for B and C; with it last, D and E took 1.70 and 1.59 ms against 1.61 to 1.63 ms. Over the four measurements D is 5 to 29% slower than B, and E from 1% faster to 16% slower: typically 0.1 to 0.2 ms, and not a drift. The extra time is inside Graphite's recording and snap, not in decoding: with nothing drawn the same variants differ by 15 microseconds. The cause is not established.

**With nothing drawn**, the binding layers separate:

| Scene | embind (A) | C exports (B) | Command buffer (C) | Display list (D) | D against A | D against B |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Rounded rects | 1296 µs | 1067 µs | 989 µs | 1002 µs | 1.3 times faster | 6% faster |
| Shaders | 311 µs | 55 µs | 48 µs | 64 µs | 4.9 times faster | 16% slower |
| Paths | 165 µs | 149 µs | 159 µs | 209 µs | 27% slower | 40% slower |
| Images | 35 µs | 15 µs | 15 µs | 22 µs | 1.6 times faster | 47% slower |

- **A call into wasm is cheap.** In the rounded rect scene, B makes 50,000 calls per frame and is 78 microseconds slower than the command buffer, which makes one. Most of the millisecond is Skia tracking 30,000 matrix and save operations, which every variant pays.
- **The display list is not the cheapest layer.** A command buffer does the least work per item. The display list adds an indirection through offsets, a comparison for every cached object and, for a slot, a lookup and a retain when it was rebound.
- **These amounts are small.** The largest gap between B and D is 60 microseconds per frame, in a scene whose full frame takes 0.9 ms.

### Does the design hold for real content?

Functionally, yes. Transforms, runtime shaders with animated uniforms, animated paths and images rebound every frame all draw correctly, pixel for pixel like the per-call variants, with no validation error.

- **Shaders with uniforms that change every frame.** The cache is pure overhead then: a comparison that fails, then the same `makeShader` every other variant pays. 64 microseconds per 1,000 shaders against 48 for the command buffer. When nothing changes it saves the creation: 41 microseconds.
- **Animated paths.** A path buffer costs more than building the path from inline points: 56 microseconds per 200 paths in the player against 21 for the command buffer. The buffer is compared, copied as the cache key, its verbs are narrowed from words to bytes, and the path is rebuilt. When nothing changes, the whole frame is 23 microseconds against 209.
- **Raw writes into wasm memory are not free.** In the path scene, writing 25,600 floats one by one into the data block (D) is slower than computing them into a JavaScript array and copying once (E): 152 against 119 microseconds before the calls.
- **Slots.** Rebinding 2,000 slots every frame costs 18 microseconds in the player against 13 for 2,000 calls that pass a pointer: each rebound slot is a lookup in the store and a retain.
- **One instance per item.** 10,000 instances of a one-rect program cost 16% more than one program of 10,000 rects with nothing drawn (1159 against 1002 microseconds), and 6% more in a full frame, which is within the noise.

### Where the time and the garbage are

- **Graphite.** A rounded rect with its own matrix costs about 1.5 microseconds of CPU: 0.5 to record it and 1.0 in snap, insert and submit. That is 15 ms for 10,000, in a build without SIMD or threads.
- **JavaScript garbage below the bindings.** With Graphite drawing, every variant allocates the same amount per frame: 5.3 MB for 10,000 rounded rects, 0.5 MB for 1,000 shader rects, 0.1 MB for 200 paths, 1.1 MB for 2,000 images. With nothing drawn, every variant but embind allocates nothing. So this garbage is made on the way from Graphite to WebGPU, in the JavaScript glue of the WebGPU bindings or in the browser's own WebGPU objects; which of the two was not profiled.
- **Collections follow.** The rounded rect scene has 50 to 94 scavenges and 47 to 73 major collection events per 600 frames in every variant.
- **What embind adds** is visible only against that background: 233 KB per frame for the rounded rects, 417 KB for the shaders, 31 KB for the images, nothing for the paths.

## Limits

- One machine, one browser, two runs. In a full frame, differences under about 5% cannot be told from noise.
- The display rate differed between the two runs, and the image scene shows that it changes the time spent submitting.
- The JavaScript and Wasm columns of A and B are derived, not measured.
- "Drawing nothing" still includes Skia's canvas state and the creation of shaders and paths. It is the binding layer plus the smallest amount of Skia that every variant needs.
- The scenes are synthetic: many small items of one kind each.
- The display list is a prototype. Nothing in its player was tuned.

## Running it

```sh
yarn bench                          # one run of both modes, in a Chrome window
yarn bench --runs=2                 # what the figures above come from
yarn bench --modes=graphite --scenes=shaders --variants=S,D,E,C,B
yarn bench-report                   # these tables, from bench/results.json
```

The window has to stay visible: a hidden page gets no animation frames. The page can also be opened by hand at `http://localhost:8790/bench/index.html` after `yarn build-bench && yarn serve`; the allocation columns are then empty, since they need the DevTools protocol.
