/**
 * Builds the benchmark: one module holding the display list of src/cpp and
 * the three baselines of bench/cpp, so that every variant is compiled with the
 * same flags and linked against the same Skia archives.
 */
import path from "path";

import { Dist, bundle, link, run, sourcesIn } from "./emcc";
import { generateFormat } from "./generate-format";
import { PackageRoot } from "./skia";

run(async () => {
  generateFormat();
  await link({
    directory: "bench",
    name: "bench-module",
    sources: [
      ...sourcesIn(path.join(PackageRoot, "src", "cpp")),
      ...sourcesIn(path.join(PackageRoot, "bench", "cpp")),
    ],
    embind: true,
  });
  await bundle(
    path.join(PackageRoot, "bench", "main.ts"),
    path.join(Dist, "bench", "main.js")
  );
});
