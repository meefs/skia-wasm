/**
 * Builds the display list prototype: src/cpp into dist/lib/skia-wasm.js and
 * .wasm, src/ts into dist/lib/index.js, and the page of its test.
 */
import path from "path";

import { Dist, bundle, link, run, sourcesIn } from "./emcc";
import { generateFormat } from "./generate-format";
import { PackageRoot } from "./skia";

run(async () => {
  generateFormat();
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
    path.join(PackageRoot, "tests", "display-list.ts"),
    path.join(Dist, "tests", "display-list.js")
  );
});
