/**
 * Builds the library into dist/lib, which is what the npm package ships:
 * src/cpp as skia-wasm.js and skia-wasm.wasm, src/ts as index.js with its
 * declarations. Also builds the page of the test.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

import { Dist, bundle, link, run, sourcesIn } from "./emcc";
import { generateExports } from "./generate-exports";
import { PackageRoot } from "./skia";

const Lib = path.join(Dist, "lib");

/**
 * The type declarations, one file per source file. The package is an ES
 * module, where a relative import names a file with its extension: the
 * source says "./canvas", so the declarations are made to say "./canvas.js".
 */
const declarations = () => {
  for (const file of fs.readdirSync(Lib)) {
    if (file.endsWith(".d.ts")) {
      fs.rmSync(path.join(Lib, file));
    }
  }
  execFileSync(
    path.join(PackageRoot, "node_modules", ".bin", "tsc"),
    ["--project", path.join(PackageRoot, "tsconfig.build.json")],
    { stdio: "inherit" }
  );
  const emitted = fs.readdirSync(Lib).filter((file) => file.endsWith(".d.ts"));
  for (const file of emitted) {
    const declaration = path.join(Lib, file);
    fs.writeFileSync(
      declaration,
      fs
        .readFileSync(declaration, "utf8")
        .replace(
          /(\bfrom\s+|\bimport\()(["'])(\.{1,2}\/[^"']+?)\2/g,
          (statement, keyword: string, quote: string, specifier: string) =>
            /\.[cm]?js$/.test(specifier)
              ? statement
              : `${keyword}${quote}${specifier}.js${quote}`
        )
    );
  }
  console.log(
    `✅ ${path.relative(PackageRoot, Lib)}/*.d.ts (${emitted.length} files)`
  );
};

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
    path.join(Lib, "index.js"),
    { published: true }
  );
  declarations();
  // The files of dist/lib are ES modules, whatever the package around them
  // says: Node and bundlers read the nearest package.json.
  fs.writeFileSync(
    path.join(Lib, "package.json"),
    `${JSON.stringify({ type: "module" }, null, 2)}\n`
  );
  await bundle(
    path.join(PackageRoot, "tests", "immediate.ts"),
    path.join(Dist, "tests", "immediate.js")
  );
});
