/**
 * Builds the benchmark of bench/index.html: the library exactly as
 * `yarn build` makes it (dist/lib), the page that draws with it, and
 * canvaskit-wasm as published on npm.
 */
import fs from "fs";
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
  });
  await bundle(
    path.join(PackageRoot, "bench", "main.ts"),
    path.join(Dist, "bench", "main.js")
  );
  // The "full" build: the one React Native Skia ships on the web.
  const canvaskit = path.join(Dist, "bench", "canvaskit");
  fs.mkdirSync(canvaskit, { recursive: true });
  for (const file of ["canvaskit.js", "canvaskit.wasm"]) {
    fs.copyFileSync(
      path.join(PackageRoot, "node_modules/canvaskit-wasm/bin/full", file),
      path.join(canvaskit, file)
    );
  }
});
