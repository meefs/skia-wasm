/// <reference types="@webgpu/types" />
/**
 * Runs the benchmark: every scene, every variant, measured inside
 * requestAnimationFrame. Results are shown on the page and left in
 * window.benchResults for scripts/run-bench.ts.
 */
import { Skia } from "../src/ts";

import type { BenchModule } from "./module";
import { HEIGHT, WIDTH, scenes } from "./scenes";
import type { Env, Variant } from "./scenes";

const params = new URLSearchParams(location.search);
const FRAMES = Number(params.get("frames") ?? 600);
const WARMUP = Number(params.get("warmup") ?? 240);
// "null" sends every frame to a canvas that draws nothing: what is left is
// the cost of getting the calls and their values into wasm.
const NULL_CANVAS = params.get("canvas") === "null";
// Without drawing, a frame takes a few dozen microseconds, close to the
// resolution of the clock: several are run per callback and averaged.
const REPEAT = Number(params.get("repeat") ?? (NULL_CANVAS ? 10 : 1));
const onlyScenes = params.get("scenes")?.split(",");
const onlyVariants = params.get("variants")?.split(",");
// One animation step per frame, whatever the refresh rate: every variant
// draws the same sequence of frames.
const STEP = 1000 / 60;
// The frame every variant draws again at the end, to compare their pixels.
const REFERENCE_FRAME = 1000;

const collect = (globalThis as unknown as { gc?: () => void }).gc;

/** What the page allocated and collected between "start" and "stop". */
interface Profile {
  bytes: number;
  minorCollections: number;
  majorCollections: number;
}
// Provided by scripts/run-bench.ts, which drives the sampling heap profiler
// and a trace of the collector over the DevTools protocol. The page cannot
// measure this itself: performance.memory does not move within a task.
const profile = (
  window as unknown as {
    benchProfile?: (action: "start" | "stop") => Promise<Profile | null>;
  }
).benchProfile;

interface Distribution {
  median: number;
  p95: number;
}

export interface VariantResult {
  id: string;
  frames: number;
  /** The frame callback, start to last return from wasm, in milliseconds. */
  total: Distribution;
  /** Inside wasm before the drawing calls: wrapping and clearing. */
  begin: Distribution;
  /**
   * Between the two: the play of a display list or of a command buffer; for
   * the per-call variants, the calls and the JavaScript between them.
   */
  play: Distribution;
  /** Inside wasm after them: snap, insert, submit. */
  end: Distribution;
  /** total - begin - play - end: JavaScript outside of the frame's calls. */
  outside: Distribution;
  /** Between two requestAnimationFrame callbacks. */
  raf: Distribution;
  /** Bytes of JavaScript heap allocated per frame; null without a profiler. */
  allocation: number | null;
  /** Scavenges and full collections over a run of as many frames. */
  minorCollections: number | null;
  majorCollections: number | null;
  /** Mean color of a 16x16 grid over the reference frame. */
  signature: number[];
}

const distribution = (samples: Float64Array): Distribution => {
  const sorted = Float64Array.from(samples).sort();
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { median: at(0.5), p95: at(0.95) };
};

const status = (text: string) => {
  document.querySelector("#status")!.textContent = text;
};

/** Runs `each` once per animation frame, `count` times. */
const frames = (count: number, each: (index: number, now: number) => void) =>
  new Promise<void>((resolve, reject) => {
    let index = 0;
    const tick = (now: number) => {
      try {
        each(index, now);
      } catch (error) {
        reject(error);
        return;
      }
      if (++index < count) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });

/** The smallest step of performance.now(), in milliseconds. */
const timerResolution = () => {
  let smallest = Infinity;
  for (let i = 0; i < 200; i++) {
    const start = performance.now();
    let now = start;
    while (now === start) {
      now = performance.now();
    }
    smallest = Math.min(smallest, now - start);
  }
  return smallest;
};

const run = async () => {
  if (!navigator.gpu) {
    throw new Error("This browser does not expose WebGPU.");
  }
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) {
    throw new Error("No WebGPU adapter.");
  }
  const device = await adapter.requestDevice();
  const gpuErrors: string[] = [];
  device.addEventListener("uncapturederror", (event) => {
    gpuErrors.push(event.error.message);
  });

  const canvas = document.querySelector("canvas")!;
  const sk = await Skia.init({
    device,
    canvas,
    module: new URL("../dist/bench/bench-module.js", location.href).href,
  });
  const module = sk.module as BenchModule;
  const { surface } = sk;
  surface.setClearColor(1, 1, 1, 1);
  module._sk_stats_enable(1);
  module._sk_stats_null_canvas(NULL_CANVAS ? 1 : 0);
  const stats = module._sk_stats() >> 3;

  // Four 32x32 textures for the image scene.
  const textures = [
    [230, 60, 60],
    [60, 180, 90],
    [60, 110, 230],
    [240, 190, 40],
  ].map(([r, g, b]) => {
    const texture = device.createTexture({
      size: [32, 32],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const data = new Uint8Array(32 * 32 * 4);
    for (let i = 0; i < 32 * 32; i++) {
      const edge = i % 32 < 2 || i < 64 ? 0.6 : 1;
      data.set([r * edge, g * edge, b * edge, 255], i * 4);
    }
    device.queue.writeTexture(
      { texture },
      data,
      { bytesPerRow: 128 },
      [32, 32]
    );
    return texture;
  });
  const env: Env = { sk, module, surface, textures };

  const machine = {
    userAgent: navigator.userAgent,
    gpu: {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      device: adapter.info.device,
      description: adapter.info.description,
    },
    canvas: `${WIDTH}x${HEIGHT} ${navigator.gpu.getPreferredCanvasFormat()}`,
    devicePixelRatio,
    crossOriginIsolated,
    timerResolutionMs: timerResolution(),
    canvasMode: NULL_CANVAS ? "null" : "graphite",
    exposeGc: collect !== undefined,
    profiler: profile !== undefined,
    frames: FRAMES,
    warmup: WARMUP,
    repeat: REPEAT,
  };
  document.querySelector("#machine")!.textContent = JSON.stringify(
    machine,
    null,
    2
  );

  // The canvas of this frame, averaged over a 16x16 grid: what a variant
  // drew, to compare with what the others drew.
  const context = canvas.getContext("webgpu") as GPUCanvasContext;
  const readback = device.createBuffer({
    size: WIDTH * HEIGHT * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const signatureOfCanvas = async () => {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: context.getCurrentTexture() },
      { buffer: readback, bytesPerRow: WIDTH * 4 },
      [WIDTH, HEIGHT]
    );
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const pixels = new Uint8Array(readback.getMappedRange());
    const cells = 16;
    const sums = new Float64Array(cells * cells * 3);
    for (let y = 0; y < HEIGHT; y++) {
      const row = Math.floor((y * cells) / HEIGHT) * cells;
      for (let x = 0; x < WIDTH; x++) {
        const cell = (row + Math.floor((x * cells) / WIDTH)) * 3;
        const at = (y * WIDTH + x) * 4;
        sums[cell] += pixels[at];
        sums[cell + 1] += pixels[at + 1];
        sums[cell + 2] += pixels[at + 2];
      }
    }
    readback.unmap();
    const perCell = (WIDTH / cells) * (HEIGHT / cells);
    return Array.from(sums, (sum) => Math.round((sum / perCell) * 10) / 10);
  };

  // A run of as many frames as the timed one, under the profiler. It is a
  // separate run: profiling would slow the timed one down.
  const profileRun = async (variant: Variant | null, start: number) => {
    if (!profile) {
      return null;
    }
    collect?.();
    await profile("start");
    await frames(FRAMES, (index) => {
      for (let r = 0; r < REPEAT; r++) {
        const frame = start + index * REPEAT + r;
        variant?.frame(frame * STEP, frame);
      }
    });
    return profile("stop");
  };
  // What the harness itself allocates and collects, to subtract.
  const baseline = await profileRun(null, 0);

  const measure = async (
    id: string,
    label: string,
    variant: Variant
  ): Promise<VariantResult> => {
    status(`${label}: warming up`);
    await frames(WARMUP, (index) => variant.frame(index * STEP, index));
    collect?.();

    status(`${label}: measuring ${FRAMES} frames`);
    const total = new Float64Array(FRAMES);
    const begin = new Float64Array(FRAMES);
    const play = new Float64Array(FRAMES);
    const end = new Float64Array(FRAMES);
    const outside = new Float64Array(FRAMES);
    const raf = new Float64Array(FRAMES);
    let lastNow = 0;
    await frames(FRAMES + 1, (index, now) => {
      // The first frame only gives the next one a previous timestamp.
      if (index > 0) {
        raf[index - 1] = now - lastNow;
      }
      lastNow = now;
      if (index === FRAMES) {
        return;
      }
      let inBegin = 0;
      let inPlay = 0;
      let inEnd = 0;
      const start = performance.now();
      for (let r = 0; r < REPEAT; r++) {
        // A new frame each time: repeating one would only measure caches.
        const frame = WARMUP + index * REPEAT + r;
        variant.frame(frame * STEP, frame);
        const f64 = module.HEAPF64;
        inBegin += f64[stats];
        inPlay += f64[stats + 1];
        inEnd += f64[stats + 2];
      }
      const elapsed = (performance.now() - start) / REPEAT;
      total[index] = elapsed;
      begin[index] = inBegin / REPEAT;
      play[index] = inPlay / REPEAT;
      end[index] = inEnd / REPEAT;
      outside[index] = elapsed - (inBegin + inPlay + inEnd) / REPEAT;
    });

    status(`${label}: measuring allocation`);
    const profiled = await profileRun(variant, (WARMUP + FRAMES) * REPEAT);

    // The same frame for every variant, read back in the task that drew it.
    let signature: number[] | null = NULL_CANVAS ? [] : null;
    await frames(1, () => {
      variant.frame(REFERENCE_FRAME * STEP, REFERENCE_FRAME);
      if (!NULL_CANVAS) {
        void signatureOfCanvas().then((result) => {
          signature = result;
        });
      }
    });
    while (signature === null) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    return {
      id,
      frames: FRAMES,
      total: distribution(total),
      begin: distribution(begin),
      play: distribution(play),
      end: distribution(end),
      outside: distribution(outside),
      raf: distribution(raf),
      allocation:
        profiled && baseline
          ? Math.max(0, profiled.bytes - baseline.bytes) / (FRAMES * REPEAT)
          : null,
      minorCollections:
        profiled && baseline
          ? Math.max(0, profiled.minorCollections - baseline.minorCollections)
          : null,
      majorCollections:
        profiled && baseline
          ? Math.max(0, profiled.majorCollections - baseline.majorCollections)
          : null,
      signature,
    };
  };

  const results = [];
  for (const scene of scenes) {
    if (onlyScenes && !onlyScenes.includes(scene.id)) {
      continue;
    }
    const variants: VariantResult[] = [];
    // In the order of the URL when it names variants: running them in another
    // order tells a difference between variants from a drift during the run.
    for (const id of onlyVariants ?? Object.keys(scene.variants)) {
      const make = scene.variants[id];
      if (!make) {
        continue;
      }
      const variant = make(env);
      variants.push(await measure(id, `${scene.id} ${id}`, variant));
      variant.dispose();
      collect?.();
    }
    // Every variant must have drawn the reference frame alike.
    const reference = variants.find(({ id }) => id === "D") ?? variants[0];
    const differences = Object.fromEntries(
      variants.map(({ id, signature }) => [
        id,
        signature.reduce(
          (max, value, i) =>
            Math.max(max, Math.abs(value - reference.signature[i])),
          0
        ),
      ])
    );
    results.push({ id: scene.id, title: scene.title, variants, differences });
    render(results);
  }
  status(
    gpuErrors.length === 0
      ? "done"
      : `done, with ${gpuErrors.length} WebGPU errors`
  );
  return { machine, baseline, gpuErrors, scenes: results };
};

const ms = (value: number) => value.toFixed(value < 1 ? 3 : 2);

const render = (
  results: {
    title: string;
    variants: VariantResult[];
    differences: Record<string, number>;
  }[]
) => {
  const root = document.querySelector("#results")!;
  root.innerHTML = "";
  for (const { title, variants, differences } of results) {
    const heading = document.createElement("h3");
    heading.textContent = title;
    const table = document.createElement("table");
    const header = [
      "variant",
      "total (median)",
      "total (p95)",
      "JS outside",
      "begin",
      "play",
      "end",
      "alloc / frame",
      "GCs (minor + major)",
      "rAF (median)",
      "pixels vs D",
    ];
    table.createTHead().insertRow().innerHTML = header
      .map((cell) => `<th>${cell}</th>`)
      .join("");
    const body = table.createTBody();
    for (const variant of variants) {
      const cells = [
        variant.id,
        ms(variant.total.median),
        ms(variant.total.p95),
        ms(variant.outside.median),
        ms(variant.begin.median),
        ms(variant.play.median),
        ms(variant.end.median),
        variant.allocation === null
          ? "n/a"
          : `${(variant.allocation / 1024).toFixed(1)} KB`,
        variant.minorCollections === null
          ? "n/a"
          : `${variant.minorCollections} + ${variant.majorCollections}`,
        ms(variant.raf.median),
        NULL_CANVAS ? "n/a" : differences[variant.id].toFixed(1),
      ];
      body.insertRow().innerHTML = cells
        .map((cell) => `<td>${cell}</td>`)
        .join("");
    }
    root.append(heading, table);
  }
};

run()
  .then((results) => {
    (window as unknown as { benchResults: unknown }).benchResults = results;
  })
  .catch((error: Error) => {
    status(`failed: ${error.message}`);
    (window as unknown as { benchResults: unknown }).benchResults = {
      error: error.message,
    };
  });
