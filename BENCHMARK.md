# Benchmark: canvaskit-wasm against skia-wasm

Measured on November 23, 2026, at commit `3e841bf`, when this library still had two APIs: the one it has now, called "immediate" below, and a retained one, a display list. This is the measurement that led to removing the display list, so its column is kept here. The raw figures are in [bench/results/](./bench/results); `yarn bench-report <file>` prints tables from them.

Three ways to draw the same frames:

- **K, canvaskit-wasm 0.41.1** from npm, the "full" build: Ganesh on WebGL 2, through embind. It is what React Native Skia draws with on the web today.
- **I, skia-wasm immediate**: `surface.getCanvas()`, one call per operation through the wrappers of `src/ts`, `surface.flush()`. Graphite on WebGPU. This is the library as it is today.
- **R, skia-wasm retained**: the display list, since removed. A scene was recorded once as a program; every number of it lived in a block of wasm memory; a frame was raw writes into that block, then one call that played the program. Graphite on WebGPU.

Each is written the way its documentation advises for speed and no further: K keeps its arrays in wasm memory, I reuses its arrays instead of allocating one per call, R writes straight into the block. I and R were the library exactly as `yarn build` made it; nothing was linked for the benchmark.

## Result

Milliseconds of main thread per frame. Every row compares figures taken under the same CPU clock limit.

| | Scene | canvaskit-wasm | skia-wasm immediate | skia-wasm retained | |
| --- | --- | ---: | ---: | ---: | --- |
| **Laptop** (M5 Max, Chrome 157) | 10,000 rounded rects | 6.38 | 14.41 | 14.25 | CanvasKit 2.3x faster |
| | 1,000 shader rects | 2.13 | 1.71 | 1.52 | skia-wasm 1.2x to 1.4x faster |
| | 200 animated paths | 1.09 | 0.65 | 0.65 | skia-wasm 1.7x faster |
| | 2,000 images | 1.55 | 3.31 | 3.31 | CanvasKit 2.1x faster |
| **Phone, first seconds** (Galaxy S25 Edge, Chrome 158, cores at 4.47 GHz) | 10,000 rounded rects | 10.30 | 27.56 | 27.45 | CanvasKit 2.7x faster |
| | 1,000 shader rects | 3.30 | 2.76 | 2.46 | skia-wasm 1.2x to 1.3x faster |
| | 200 animated paths | 1.61 | 1.02 | 0.97 | skia-wasm 1.6x faster |
| | 2,000 images | 1.99 | 5.56 | 5.47 | CanvasKit 2.8x faster |
| **Phone, sustained** (same phone, hot, cores limited to 1.69 GHz) | 10,000 rounded rects | 21.4 | 51.2 | 50.7 | CanvasKit 2.4x faster |
| | 1,000 shader rects | 7.6 | 5.7 | 5.2 | skia-wasm 1.3x to 1.5x faster |
| | 200 animated paths | 3.5 | 2.0 | 2.0 | skia-wasm 1.7x faster |
| | 2,000 images (at 1.96 GHz) | 4.3 | 9.8 | 10.2 | CanvasKit 2.3x faster |

How many pages are behind each figure: three orders of the variants on the laptop, all within 5% of each other; one page per figure for the phone's first seconds (the rect row agrees within 3% with five earlier pages that drew that scene first); two pages for the sustained rows, one for the image row.

Every variant drew the same pixels: I and R identical, K within 0.1 to 3.1 levels out of 255 on a 16x16 grid of means. No WebGPU error on either machine.

## What it says

**1. Immediate and retained cost the same.** Within 2% on the rects, the paths and the images, on both machines and in both states of the phone. The display list had no speed to offer over calls made one at a time, which an [earlier experiment](#earlier-the-display-list-against-per-call-bindings) had found with a C export baseline and which this confirmed with the real wrappers. It also covered less (no text, no filters, no layers) and was a third of the source. It was removed.

The one exception is the shader scene, where retained is ahead by 0.2 ms on the laptop and 0.3 to 0.5 ms on the phone (about 10%). The immediate API makes a `Shader` object per rect, 1,000 per frame, each registered for finalization and then disposed, where the display list rebuilds its shaders in C++. It also shows in allocation (below). That is a cost of those wrappers, not of the immediate style: an effect whose uniforms can be written in place would remove it. It is the one thing the display list did better, and it does not need a display list.

**2. The immediate bindings are cheaper than CanvasKit's.** Before anything is sent to the GPU, the calls themselves take less time than embind's on every scene:

| Recording, phone at 4.47 GHz | canvaskit-wasm | skia-wasm immediate |
| --- | ---: | ---: |
| 10,000 rounded rects | 10.00 ms | 9.74 ms |
| 1,000 shader rects | 1.62 ms | 1.02 ms |
| 200 animated paths | 1.32 ms | 0.38 ms |
| 2,000 images | 1.88 ms | 1.76 ms |

**3. The whole deficit is in Graphite's submit.** Sending the recorded frame takes:

| Submit, phone at 4.47 GHz | canvaskit-wasm (flush) | skia-wasm (snap, insert, submit) |
| --- | ---: | ---: |
| 10,000 rounded rects | 0.28 ms | 17.8 ms |
| 1,000 shader rects | 1.69 ms | 1.75 ms |
| 200 animated paths | 0.30 ms | 0.63 ms |
| 2,000 images | 0.12 ms | 3.8 ms |

The two scenes that skia-wasm loses are the two where Ganesh batches and this build of Graphite does not: one instanced draw against a bind group, a `setBindGroup` and a `drawIndexed` per item (counted on the laptop: 30,667 WebGPU calls per frame against 4 WebGL calls on the rects, 7,918 against 250 on the images). The cause is a setting of Graphite's Dawn backend under Emscripten (`DawnCaps.cpp` turns immediates and storage buffers off), not WebGPU. The phone reports what the fix needs: `maxImmediateSize` 64, 16 storage buffers per stage, `setImmediates` present.

**4. The phone makes the gap matter.** On the laptop both hold 60 frames per second on every scene. On the phone the rect scene does not:

| 10,000 rounded rects, frames per second | canvaskit-wasm | skia-wasm |
| --- | ---: | ---: |
| Phone, first seconds | 60 | 32 |
| Phone, sustained | 46 | 18 |

**5. Garbage.** JavaScript heap allocated per frame, the same on both machines:

| | canvaskit-wasm | skia-wasm immediate | skia-wasm retained |
| --- | ---: | ---: | ---: |
| 10,000 rounded rects | 3.65 MB | 5.42 MB | 5.13 MB |
| 1,000 shader rects | 1.19 MB | 0.80 MB | 0.51 MB |
| 200 animated paths | 0.19 MB | 0.11 MB | 0.11 MB |
| 2,000 images | 0.68 MB | 1.07 MB | 1.07 MB |

Most of skia-wasm's is made below the bindings, by the WebGPU calls of the submit: it is there in the retained variant too, which makes one call per frame. The immediate API adds 0.3 MB per frame on the rects and on the shaders.

## How it was measured

- **Scenes.** The four of BENCHMARK.md, 1024x1024, every item animated on every frame, the same arithmetic in each variant.
- **A frame.** One per `requestAnimationFrame`, timed with `performance.now()` on a cross-origin isolated page (5 µs steps on both machines). "Submit" is `flush()` for K and I, and for R the part of `draw()` after the play of the display list, which the module times itself. "Record" is the rest.
- **Runs.** 300 measured frames per variant after a warm-up, the page loaded once per order of the variants (KIR, RIK, IRK). A figure is the median over the pages of the median of each.
- **Load.** The tables above are from the "spin" load: after its frame, the page keeps the core busy until nine tenths of the frame interval, so that the CPU governor has no slack to lower the clock on. Without it, on the phone, CanvasKit took about 10 ms on all four scenes: the governor slows a light frame down until it fills the interval. The "paced" load (no spin) was run too, for the frame rates and for the allocation, which a sampling heap profiler measures over the DevTools protocol in a separate run of as many frames.
- **Canvases.** Only the canvas being drawn to is on the page, in the same box for both.

### The phone

A Galaxy S25 Edge (SM-S937B, Snapdragon 8 Elite, Adreno 830, Android 17), plugged into the laptop. Chrome 158 on the phone loads the page from the laptop through `adb reverse`, and is driven over the DevTools protocol through `adb forward`, in a tab the runner opens and closes itself. Chrome ran `requestAnimationFrame` at 60 Hz.

The phone limits the top speed of its cores under load, and quickly. Drawing the rect scene with skia-wasm five times in a row, from a phone at 37 °C:

| Seconds of load | Fastest cores limited to | Frame |
| ---: | ---: | ---: |
| 0 to 12 | 4.47 GHz (no limit) | 28 ms |
| 15 | 4.09 GHz | |
| 26 | 2.65 GHz | 33 ms |
| 33 and after | 1.96 GHz | 44 ms |

Later, with the skin of the phone above 39 °C, the limit went down to 1.69 GHz. Android's thermal status still said 0 for most of this. Within one page load, the variant that ran first was therefore measured on a faster phone than the ones that followed, by a factor of 1.6 to 1.8, which a first session of six pages showed before the cause was known (`bench/results/phone-unsorted-spin.json` and `phone-unsorted-paced.json`: kept, but only their frame rates and allocations are used here).

So the runner records the limit (`scaling_max_freq` of each group of cores, four times a second) while each variant is measured, and the phone was measured in two states:

- **First seconds** (`--isolate`): one page per scene and variant, each started once the phone had cooled down and had no limit on its cores. The limit stayed at 4.47 GHz through every measurement but one (the paths with the immediate API, at 3.51 GHz).
- **Sustained** (`--preheat=45 --cool=none`): 45 seconds of the rect scene first, then every variant on a phone that stays hot. Rows are only taken from pages where the three variants had the same limit.

## Caveats

- **CPU time of the main thread only**, plus the frame rate. What the GPU process does with 4 calls or 30,000 is not timed, though on the phone the frame rate follows the main thread closely.
- **Not a controlled test of Ganesh against Graphite**: canvaskit-wasm 0.41.1 is another Skia revision, built with other flags.
- **One phone, one laptop, Chrome only.** The laptop was not idle (other work was running); its three orders still agree within 5%.
- **The phone's first-seconds figures are one page each**, and its image row under sustained load is one page.
- **Four synthetic scenes**, chosen to stress the bindings, with thousands of small items. A scene of a few large draws would show none of this.

## Reproduce

The benchmark in `bench/` now draws with canvaskit-wasm and with the library as it is: columns K and I. The retained column cannot be measured again from this code.

```sh
# The laptop: a Chrome window that has to stay visible.
yarn bench --load=spin --profile=0 --frames=300
yarn bench --load=paced --frames=300

# A phone over adb: screen on, unlocked, USB debugging on.
yarn bench --target=android --serial=<serial> \
  --isolate --orders=KI --load=spin --profile=0 --frames=200 --warmup=60 --cool-to=38
yarn bench --target=android --serial=<serial> \
  --preheat=45 --cool=none --load=spin --profile=0 --frames=300 --warmup=60

yarn bench-report bench/results/desktop.json
```

The runs reported here:

| File in `bench/results/` | |
| --- | --- |
| `laptop-spin.json` | The laptop rows of the result table |
| `laptop-paced.json` | The laptop's allocation |
| `phone-first-seconds.json` | The phone on a cool start, one variant per page |
| `phone-sustained.json` | The phone kept hot |
| `phone-unsorted-spin.json`, `phone-unsorted-paced.json` | The first session on the phone, with variants measured under different clock limits: frame rates and allocation only |

## Earlier: the display list against per-call bindings

The display list was a prototype to decide what shape the bindings should take. The hypothesis was that one call from JavaScript into wasm per drawing operation is expensive, so that a scene described as data and played by one call would be faster. It was measured the same day, on the laptop, against three baselines linked into the same module: embind objects, plain C exports, and a command buffer encoded again every frame. The full write-up and its code are in the history of this repository (`git show 3e841bf:BENCHMARK.md`, `bench/` and `src/` at that commit). What it found:

- **A call is cheap.** About 2 nanoseconds through a plain C export, about 7 through embind.
- **In a real frame the binding layer does not matter.** On 10,000 rounded rects: 15.5 ms with embind, 15.4 with C exports, 15.5 with the command buffer, 15.0 with the display list. With nothing drawn, to isolate the bindings: 1.30, 1.07, 0.99 and 1.00 ms.
- **embind only hurts where it creates objects**: 4 to 6 times slower than the others at the binding layer on the shader scene, and 0.4 MB of garbage per frame.
- **The time and the garbage are below the bindings**: about 1.5 microseconds of CPU per rounded rect in Graphite, two thirds of it in snap, insert and submit, and 5.3 MB of JavaScript heap per frame whichever way the calls arrive.

So the bindings became plain C exports with thin wrappers, and the display list was left with structure as its only argument: a frame as plain data that anything could write, derived objects cached while their numbers do not change, many instances of one program. None of those had a user. If one appears, the display list can come back as a layer over the same canvas, without changing the API.
