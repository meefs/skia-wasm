/**
 * Prints the tables of BENCHMARK.md from the files that scripts/run-bench.ts
 * wrote.
 *
 *   yarn bench-report bench/results/phone-sustained.json [more files]
 *
 * A file holds several loads of the page, each with some or all of the
 * variants. A figure is the median, over the pages that measured it, of the
 * median of each, with the range of those pages.
 */
import fs from "fs";

interface Distribution {
  median: number;
  p95: number;
}

interface Variant {
  id: string;
  name: string;
  total: Distribution;
  record: Distribution;
  submit: Distribution;
  raf: Distribution;
  fps: number;
  allocation: number | null;
  /** Per group of cores, in kHz: what they were allowed while measured. */
  clock?: { cores: number; top: number; lowest: number; highest: number }[];
}

interface Scene {
  id: string;
  title: string;
  variants: Variant[];
  differences: Record<string, number>;
}

interface Results {
  target: string;
  browser: string;
  device: { model: string; soc: string; android: string } | null;
  runs: {
    order: string;
    load: string;
    machine: {
      webgpu: { vendor: string; architecture: string };
      webgl: string | null;
      displayIntervalMs: number;
      frames: number;
    };
    gpuErrors: string[];
    scenes: Scene[];
  }[];
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const ms = (value: number) => value.toFixed(2);
const ghz = (khz: number) => (khz / 1e6).toFixed(2);

const report = (file: string) => {
  const results = JSON.parse(fs.readFileSync(file, "utf8")) as Results;
  const { runs } = results;
  const [first] = runs;
  const where = results.device
    ? `${results.device.model} (${results.device.soc}, Android ${results.device.android})`
    : "desktop";
  console.log(`## ${file}\n`);
  console.log(
    `${where}, ${results.browser}, load "${first.load}". ${
      runs.length
    } pages, ${first.machine.frames} frames per variant, a frame every ${first.machine.displayIntervalMs.toFixed(
      1
    )} ms. WebGPU: ${first.machine.webgpu.vendor} ${
      first.machine.webgpu.architecture
    }. WebGL: ${first.machine.webgl ?? "unknown"}. WebGPU errors: ${runs.reduce(
      (sum, run) => sum + run.gpuErrors.length,
      0
    )}.\n`
  );

  // Every scene and every variant that some page measured.
  const scenes = new Map<string, string>();
  const names = new Map<string, string>();
  for (const run of runs) {
    for (const scene of run.scenes) {
      scenes.set(scene.id, scene.title);
      scene.variants.forEach(({ id, name }) => names.set(id, name));
    }
  }
  // R is the retained API that the results of 2026-11-23 also measured.
  const order = ["K", "I", "R"].filter((id) => names.has(id));
  const measured = (scene: string, id: string) =>
    runs.flatMap(
      (run) =>
        run.scenes
          .find((candidate) => candidate.id === scene)
          ?.variants.filter((candidate) => candidate.id === id) ?? []
    );
  // The limit on the fastest cores while a variant was measured, over its
  // pages: "4.47" if it never moved, "1.96 to 2.65" if it did.
  const clockOf = (variants: Variant[]) => {
    const limits = variants.flatMap(({ clock }) => {
      const fastest = clock?.reduce((a, b) => (b.top > a.top ? b : a));
      return fastest && !Number.isNaN(fastest.lowest)
        ? [fastest.lowest, fastest.highest]
        : [];
    });
    if (limits.length === 0) {
      return "n/a";
    }
    const lowest = Math.min(...limits);
    const highest = Math.max(...limits);
    return lowest === highest
      ? ghz(lowest)
      : `${ghz(lowest)} to ${ghz(highest)}`;
  };

  console.log(
    "Milliseconds of main thread per frame: median (range), then the speed limit of the fastest cores in GHz while it was measured.\n"
  );
  console.log(`| Scene | ${order.map((id) => names.get(id)).join(" | ")} |`);
  console.log(`| --- | ${order.map(() => "---:").join(" | ")} |`);
  for (const [scene, title] of scenes) {
    const cells = order.map((id) => {
      const variants = measured(scene, id);
      const totals = variants.map((variant) => variant.total.median);
      if (totals.length === 0) {
        return "n/a";
      }
      return `${ms(median(totals))} (${ms(Math.min(...totals))} to ${ms(
        Math.max(...totals)
      )}) @ ${clockOf(variants)}`;
    });
    console.log(`| ${title} | ${cells.join(" | ")} |`);
  }
  console.log("");

  for (const [scene, title] of scenes) {
    console.log(`### ${title}\n`);
    console.log(
      "| | Frame | p95 | Record | Submit | Frames per second | Slowest 5% of frames | Allocated per frame | Pixels vs reference | Pages |"
    );
    console.log(
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
    );
    for (const id of order) {
      const variants = measured(scene, id);
      if (variants.length === 0) {
        continue;
      }
      const of = (pick: (v: Variant) => number) => median(variants.map(pick));
      const allocations = variants.flatMap(({ allocation }) =>
        allocation === null ? [] : [allocation]
      );
      const difference = Math.max(
        ...runs.map(
          (run) =>
            run.scenes.find((candidate) => candidate.id === scene)?.differences[
              id
            ] ?? 0
        )
      );
      console.log(
        `| ${names.get(id)} | ${ms(of((v) => v.total.median))} | ${ms(
          of((v) => v.total.p95)
        )} | ${ms(of((v) => v.record.median))} | ${ms(
          of((v) => v.submit.median)
        )} | ${of((v) => v.fps).toFixed(1)} | ${ms(of((v) => v.raf.p95))} ms | ${
          allocations.length === 0
            ? "n/a"
            : `${(median(allocations) / (1 << 20)).toFixed(2)} MB`
        } | ${difference.toFixed(1)} | ${variants.length} |`
      );
    }
    console.log("");
  }
};

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: yarn bench-report <results.json> [more files]");
  process.exitCode = 1;
}
files.forEach(report);
