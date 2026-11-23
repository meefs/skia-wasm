/// <reference types="@webgpu/types" />
/**
 * Runs the benchmark: every scene drawn by canvaskit-wasm and by skia-wasm,
 * measured inside requestAnimationFrame. Results are shown on the page and
 * left in window.benchResults for scripts/run-bench.ts.
 */
import { Skia } from "../src/ts";

import { loadCanvasKit } from "./canvaskit";
import { HEIGHT, WIDTH, scenes, variantNames } from "./scenes";
import type { Env, Variant } from "./scenes";

const params = new URLSearchParams(location.search);
const FRAMES = Number(params.get("frames") ?? 600);
const WARMUP = Number(params.get("warmup") ?? 120);
const onlyScenes = params.get("scenes")?.split(",");
// The order of the URL is the order of the run.
const order = params.get("variants")?.split(",") ?? ["K", "I"];
// "paced": one frame per animation frame, and the core is idle until the
// next one. That is what a page does, and it says which frame rate holds, but
// it is a poor measure of cost on a phone: the CPU governor lowers the clock
// when a frame leaves slack, so a light frame takes as long as a heavy one.
// "spin": the same, then the core is kept busy until the next frame is due,
// so that every variant is measured at the full clock speed.
const LOAD = params.get("load") === "spin" ? "spin" : "paced";
const PROFILE = params.get("profile") !== "0";
// Seconds of the heaviest scene before anything is measured. A phone lowers
// the top speed of its processor after some twenty seconds of load, by more
// than half on the one this was written with: either every figure is taken
// before that happens (one variant per page, on a cool phone), or the phone
// is brought there first and every figure is taken after.
const PREHEAT = Number(params.get("preheat") ?? 0);
// One animation step per frame, whatever the refresh rate: every variant
// draws the same sequence of frames.
const STEP = 1000 / 60;
// The frame every variant draws again at the end, to compare their pixels.
const REFERENCE_FRAME = 1000;

/** What the page allocated between "start" and "stop". */
interface Profile {
  bytes: number;
}
// Provided by scripts/run-bench.ts over the DevTools protocol: the page
// cannot measure its own allocation, nor ask for a collection.
const hooks = window as unknown as {
  benchProfile?: (action: "start" | "stop") => Promise<Profile | null>;
  benchCollect?: () => Promise<void>;
};
const collect = async () => {
  (globalThis as unknown as { gc?: () => void }).gc?.();
  await hooks.benchCollect?.();
};

interface Distribution {
  median: number;
  p95: number;
}

export interface VariantResult {
  id: string;
  name: string;
  frames: number;
  /** The frame callback, start to end, in milliseconds of the main thread. */
  total: Distribution;
  /** Until the frame is sent: the drawing calls. */
  record: Distribution;
  /** Sending it: flush(). For skia-wasm, snap, insert and submit. */
  submit: Distribution;
  /** Between two requestAnimationFrame callbacks. */
  raf: Distribution;
  /** Frames per second over the measured run: what the screen showed. */
  fps: number;
  /** When the measured frames were drawn: milliseconds since the epoch. */
  window: [number, number];
  /** Bytes of JavaScript heap allocated per frame; null without a profiler. */
  allocation: number | null;
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

/** The median time between two animation frames, in milliseconds. */
const displayInterval = async () => {
  const stamps: number[] = [];
  await frames(61, (_index, now) => {
    stamps.push(now);
  });
  const intervals = stamps.slice(1).map((stamp, i) => stamp - stamps[i]);
  return intervals.sort((a, b) => a - b)[30];
};

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

  const gpuCanvas = document.querySelector<HTMLCanvasElement>("#gpu")!;
  const glCanvas = document.querySelector<HTMLCanvasElement>("#webgl")!;
  const sk = await Skia.init({
    device,
    module: new URL("../dist/lib/skia-wasm.js", location.href).href,
  });
  // The scenes are measured on the pixels the canvas was given, as
  // CanvasKit draws them on its own.
  const surface = sk.surface(gpuCanvas, { pixelRatio: 1 });
  surface.setClearColor(1, 1, 1, 1);

  // Four 32x32 textures for the image scene.
  const texturePixels: Uint8Array[] = [];
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
    texturePixels.push(data);
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
  const canvaskit = order.includes("K") ? await loadCanvasKit(glCanvas) : null;
  const env: Env = {
    sk,
    surface,
    textures,
    texturePixels,
    canvaskit,
  };

  const interval = await displayInterval();
  // Busy until nine tenths of the frame: the callback of the next one is not
  // delayed.
  const spinFor = interval * 0.9;
  const spin = (start: number) => {
    if (LOAD === "spin") {
      const until = start + spinFor;
      while (performance.now() < until) {
        // Nothing: the point is a core that never looks idle.
      }
    }
  };

  const gl = glCanvas.getContext("webgl2");
  const debugInfo = gl?.getExtension("WEBGL_debug_renderer_info");
  const machine = {
    userAgent: navigator.userAgent,
    webgpu: {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      device: adapter.info.device,
      description: adapter.info.description,
    },
    webgl:
      gl && debugInfo
        ? (gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string)
        : null,
    canvas: `${WIDTH}x${HEIGHT} ${navigator.gpu.getPreferredCanvasFormat()}`,
    devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    crossOriginIsolated,
    timerResolutionMs: timerResolution(),
    profiler: PROFILE && hooks.benchProfile !== undefined,
    displayIntervalMs: interval,
    load: LOAD,
    order: order.join(","),
    frames: FRAMES,
    warmup: WARMUP,
  };
  document.querySelector("#machine")!.textContent = JSON.stringify(
    machine,
    null,
    2
  );

  // The canvas of this frame, averaged over a 16x16 grid: what a variant
  // drew, to compare with what the others drew.
  const context = gpuCanvas.getContext("webgpu") as GPUCanvasContext;
  const readback = device.createBuffer({
    size: WIDTH * HEIGHT * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  // Mean red, green and blue of each cell. `bgra` says the pixels are in
  // that order.
  const signatureOf = (pixels: Uint8Array, bgra: boolean) => {
    const cells = 16;
    const sums = new Float64Array(cells * cells * 3);
    const red = bgra ? 2 : 0;
    const blue = bgra ? 0 : 2;
    for (let y = 0; y < HEIGHT; y++) {
      const row = Math.floor((y * cells) / HEIGHT) * cells;
      for (let x = 0; x < WIDTH; x++) {
        const cell = (row + Math.floor((x * cells) / WIDTH)) * 3;
        const at = (y * WIDTH + x) * 4;
        sums[cell] += pixels[at + red];
        sums[cell + 1] += pixels[at + 1];
        sums[cell + 2] += pixels[at + blue];
      }
    }
    const perCell = (WIDTH / cells) * (HEIGHT / cells);
    return Array.from(sums, (sum) => Math.round((sum / perCell) * 10) / 10);
  };
  const signatureOfCanvas = async () => {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: context.getCurrentTexture() },
      { buffer: readback, bytesPerRow: WIDTH * 4 },
      [WIDTH, HEIGHT]
    );
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const signature = signatureOf(
      new Uint8Array(readback.getMappedRange()),
      navigator.gpu.getPreferredCanvasFormat() === "bgra8unorm"
    );
    readback.unmap();
    return signature;
  };

  // A run of as many frames as the timed one, under the profiler. It is a
  // separate run: profiling would slow the timed one down.
  const profileRun = async (variant: Variant | null, start: number) => {
    if (!PROFILE || !hooks.benchProfile) {
      return null;
    }
    await collect();
    await hooks.benchProfile("start");
    await frames(FRAMES, (index) => {
      const frame = start + index;
      variant?.frame(frame * STEP, frame);
    });
    return hooks.benchProfile("stop");
  };
  // What the harness itself allocates, to subtract.
  const baseline = await profileRun(null, 0);

  const measure = async (
    id: string,
    label: string,
    variant: Variant
  ): Promise<VariantResult> => {
    // Only the canvas being drawn to is on the page: the compositor has one
    // canvas to show, of the same size, whatever the variant.
    gpuCanvas.style.display = variant.target === "webgpu" ? "block" : "none";
    glCanvas.style.display = variant.target === "webgl" ? "block" : "none";

    status(`${label}: warming up`);
    await frames(WARMUP, (index) => {
      const start = performance.now();
      variant.frame(index * STEP, index);
      spin(start);
    });
    await collect();

    status(`${label}: measuring ${FRAMES} frames`);
    const total = new Float64Array(FRAMES);
    const record = new Float64Array(FRAMES);
    const submit = new Float64Array(FRAMES);
    const raf = new Float64Array(FRAMES);
    let lastNow = 0;
    let firstNow = 0;
    const began = Date.now();
    await frames(FRAMES + 1, (index, now) => {
      // The first frame only gives the next one a previous timestamp.
      if (index > 0) {
        raf[index - 1] = now - lastNow;
      } else {
        firstNow = now;
      }
      lastNow = now;
      if (index === FRAMES) {
        return;
      }
      const frame = WARMUP + index;
      const start = performance.now();
      const submitted = variant.frame(frame * STEP, frame);
      const elapsed = performance.now() - start;
      total[index] = elapsed;
      submit[index] = submitted;
      record[index] = elapsed - submitted;
      spin(start);
    });
    const fps = (FRAMES * 1000) / (lastNow - firstNow);
    const ended = Date.now();

    status(`${label}: measuring allocation`);
    const profiled = await profileRun(variant, WARMUP + FRAMES);

    // The same frame for every variant, read back in the task that drew it.
    let signature: number[] | null = null;
    await frames(1, () => {
      variant.frame(REFERENCE_FRAME * STEP, REFERENCE_FRAME);
      if (variant.readPixels) {
        // Not on the WebGPU canvas: the variant hands its pixels over.
        const pixels = variant.readPixels();
        signature = pixels ? signatureOf(pixels, false) : [];
      } else {
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
      name: variantNames[id] ?? id,
      frames: FRAMES,
      total: distribution(total),
      record: distribution(record),
      submit: distribution(submit),
      raf: distribution(raf),
      fps,
      window: [began, ended],
      allocation:
        profiled && baseline
          ? Math.max(0, profiled.bytes - baseline.bytes) / FRAMES
          : null,
      signature,
    };
  };

  if (PREHEAT > 0) {
    status(`heating up for ${PREHEAT} s`);
    const heater = scenes[0].variants.I(env);
    const until = performance.now() + PREHEAT * 1000;
    let frame = 0;
    while (performance.now() < until) {
      await frames(30, () => {
        const start = performance.now();
        heater.frame(frame * STEP, frame);
        frame++;
        spin(start);
      });
    }
    heater.dispose();
  }

  const results = [];
  for (const scene of scenes) {
    if (onlyScenes && !onlyScenes.includes(scene.id)) {
      continue;
    }
    const variants: VariantResult[] = [];
    for (const id of order) {
      const make = scene.variants[id];
      if (!make) {
        continue;
      }
      const variant = make(env);
      variants.push(await measure(id, `${scene.id} ${id}`, variant));
      variant.dispose();
      await collect();
    }
    // Every variant must have drawn the reference frame alike.
    const reference = variants.find(({ id }) => id === "I") ?? variants[0];
    const differences = Object.fromEntries(
      variants.map(({ id, signature }) => [
        id,
        signature.length === reference.signature.length
          ? signature.reduce(
              (max, value, i) =>
                Math.max(max, Math.abs(value - reference.signature[i])),
              0
            )
          : -1,
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
      "frame (median)",
      "frame (p95)",
      "record",
      "submit",
      "fps",
      "rAF (p95)",
      "alloc / frame",
      "pixels vs skia-wasm",
    ];
    table.createTHead().insertRow().innerHTML = header
      .map((cell) => `<th>${cell}</th>`)
      .join("");
    const body = table.createTBody();
    for (const variant of variants) {
      const cells = [
        variant.name,
        ms(variant.total.median),
        ms(variant.total.p95),
        ms(variant.record.median),
        ms(variant.submit.median),
        variant.fps.toFixed(1),
        ms(variant.raf.p95),
        variant.allocation === null
          ? "n/a"
          : `${(variant.allocation / 1024).toFixed(1)} KB`,
        differences[variant.id].toFixed(1),
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
