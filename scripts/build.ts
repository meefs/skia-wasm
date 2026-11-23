/**
 * Builds the library: src/cpp into dist/lib/skia-wasm.js and .wasm, src/ts
 * into dist/lib/index.js, and the pages of its tests.
 */
import path from "path";

import { Dist, bundle, link, run, sourcesIn } from "./emcc";
import { generateExports } from "./generate-exports";
import { generateFormat } from "./generate-format";
import { PackageRoot } from "./skia";

run(async () => {
  generateFormat();
  generateExports();
  await link({
    directory: "lib",
    name: "skia-wasm",
    sources: sourcesIn(path.join(PackageRoot, "src", "cpp")),
    debug: process.argv.includes("--debug"),
  });
  await bundle(
    path.join(PackageRoot, "src", "ts", "index.ts"),
    path.join(Dist, "lib", "index.js")
  );
  for (const test of ["display-list", "immediate"]) {
    await bundle(
      path.join(PackageRoot, "tests", `${test}.ts`),
      path.join(Dist, "tests", `${test}.js`)
    );
  }
});
