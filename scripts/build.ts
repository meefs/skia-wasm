/**
 * Builds the library: src/cpp into dist/lib/skia-wasm.js and .wasm, src/ts
 * into dist/lib/index.js, and the page of its test.
 */
import path from "path";

import { Dist, bundle, link, run, sourcesIn } from "./emcc";
import { generateExports } from "./generate-exports";
import { PackageRoot } from "./skia";

run(async () => {
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
  await bundle(
    path.join(PackageRoot, "tests", "immediate.ts"),
    path.join(Dist, "tests", "immediate.js")
  );
});
