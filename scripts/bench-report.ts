/**
 * Prints bench/results.json as the Markdown tables of BENCHMARK.md.
 *
 * A figure is the median over the runs of what each run measured (itself a
 * median or a 95th percentile over its frames), followed by how far the runs
 * were from it.
 */
import fs from "fs";
import path from "path";

import { PackageRoot } from "./skia";

interface Distribution {
  median: number;
  p95: number;
}

interface VariantResult {
  id: string;
  total: Distribution;
  begin: Distribution;
  play: Distribution;
  end: Distribution;
  outside: Distribution;
  raf: Distribution;
  allocation: number | null;
  minorCollections: number | null;
  majorCollections: number | null;
}

interface Run {
  run: number;
  mode: string;
  machine: Record<string, unknown>;
  gpuErrors: string[];
  scenes: {
    id: string;
    title: string;
    variants: VariantResult[];
    differences: Record<string, number>;
  }[];
}

const names: Record<string, string> = {
  A: "A. embind objects",
  B: "B. C exports",
  C: "C. Command buffer",
  D: "D. Display list, raw writes",
  E: "E. Display list, helper",
  F: "F. Display list, one instance per item",
  S: "S. Display list, nothing written",
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const spread = (values: number[]) =>
  (Math.max(...values) - Math.min(...values)) / 2;

const { chrome, runs } = JSON.parse(
  fs.readFileSync(path.join(PackageRoot, "bench", "results.json"), "utf8")
) as { chrome: string; runs: Run[] };

/** Every run's result for one variant of one scene in one mode. */
const collect = (mode: string, scene: string, variant: string) =>
  runs
    .filter((run) => run.mode === mode)
    .flatMap((run) => run.scenes.filter(({ id }) => id === scene))
    .flatMap(({ variants }) => variants.filter(({ id }) => id === variant));

const figure = (
  results: VariantResult[],
  pick: (result: VariantResult) => number,
  scale = 1,
  digits = 2
) => {
  const values = results.map((result) => pick(result) * scale);
  return `${median(values).toFixed(digits)} ±${spread(values).toFixed(digits)}`;
};

const table = (header: string[], rows: string[][]) =>
  [
    `| ${header.join(" | ")} |`,
    `| ${header.map((_, i) => (i === 0 ? "---" : "---:")).join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");

const allocation = (results: VariantResult[]) =>
  results[0].allocation === null
    ? "n/a"
    : `${(median(results.map((result) => result.allocation!)) / 1024).toFixed(1)} KB`;

// Per 600 frames: the profiled run of the mode that draws nothing has
// `repeat` frames per callback, so that many times more frames.
const collections = (results: VariantResult[], repeat: number) =>
  results[0].minorCollections === null
    ? "n/a"
    : `${(median(results.map((result) => result.minorCollections!)) / repeat).toFixed(0)} / ${(
        median(results.map((result) => result.majorCollections!)) / repeat
      ).toFixed(0)}`;

const [first] = runs;
const repeatOfNull = Number(
  runs.find((run) => run.mode === "null")?.machine.repeat ?? 1
);
console.log(`Chrome ${chrome}, ${runs.length / 2} runs per mode.\n`);
console.log("```json");
console.log(JSON.stringify(first.machine, null, 2));
console.log("```\n");
console.log(
  `WebGPU errors: ${runs.reduce((sum, run) => sum + run.gpuErrors.length, 0)}. ` +
    `Largest difference between the pixels of a variant and those of D on the reference frame, variant S excluded: ${Math.max(
      ...runs.flatMap((run) =>
        run.scenes.flatMap((scene) =>
          Object.entries(scene.differences)
            .filter(([id]) => id !== "S")
            .map(([, difference]) => difference)
        )
      )
    )}.\n`
);

for (const scene of first.scenes) {
  console.log(`### ${scene.title}\n`);

  // With Graphite. For A and B the time inside wasm is not measurable call by
  // call: it is taken to be what C spends replaying the same calls.
  const playOfC = median(
    collect("graphite", scene.id, "C").map((result) => result.play.median)
  );
  const wasmOf = (result: VariantResult) =>
    result.begin.median +
    result.end.median +
    (result.id === "A" || result.id === "B" ? playOfC : result.play.median);
  console.log("Drawing with Graphite, milliseconds per frame:\n");
  console.log(
    table(
      [
        "Variant",
        "Total, median",
        "Total, p95",
        "JavaScript",
        "Wasm",
        "of which snap, insert, submit",
        "Allocated per frame",
        "GCs, minor / major",
        "rAF interval",
      ],
      scene.variants.map(({ id }) => {
        const results = collect("graphite", scene.id, id);
        const derived = id === "A" || id === "B" ? " †" : "";
        return [
          names[id],
          figure(results, (result) => result.total.median),
          figure(results, (result) => result.total.p95),
          figure(results, (result) => result.total.median - wasmOf(result)) +
            derived,
          figure(results, wasmOf) + derived,
          figure(results, (result) => result.end.median),
          allocation(results),
          collections(results, 1),
          figure(results, (result) => result.raf.median, 1, 1),
        ];
      })
    )
  );

  console.log("\nDrawing nothing, microseconds per frame:\n");
  console.log(
    table(
      [
        "Variant",
        "Total, median",
        "Total, p95",
        "Before the calls",
        "The calls",
        "Allocated per frame",
        "GCs, minor / major",
      ],
      scene.variants.map(({ id }) => {
        const results = collect("null", scene.id, id);
        return [
          names[id],
          figure(results, (result) => result.total.median, 1000, 0),
          figure(results, (result) => result.total.p95, 1000, 0),
          figure(results, (result) => result.outside.median, 1000, 0),
          figure(
            results,
            (result) => result.begin.median + result.play.median,
            1000,
            0
          ),
          allocation(results),
          collections(results, repeatOfNull),
        ];
      })
    )
  );
  console.log("");
}
