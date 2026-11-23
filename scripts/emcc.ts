/**
 * Links C++ sources with the Skia archives into an ES module and its .wasm,
 * with the Emscripten release, flags and defines the archives were built with,
 * and bundles the TypeScript that goes with it.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

import { build } from "esbuild";

import { findEmscripten } from "./emscripten";
import { PackageRoot, prepareSkia } from "./skia";

export const Dist = path.join(PackageRoot, "dist");

export interface LinkOptions {
  /** Output directory, under dist. */
  directory: string;
  /** Base name of the .js and .wasm files. */
  name: string;
  sources: string[];
  /** Assertions and a lower optimization level, to chase a bad pointer. */
  debug?: boolean;
}

export const link = async (options: LinkOptions) => {
  const { root, source, metadata } = await prepareSkia();
  const emscripten = findEmscripten(metadata.emscripten);
  console.log(
    `Skia wasm archives (${source}): ${root}\nEmscripten ${metadata.emscripten}: ${emscripten}`
  );
  const directory = path.join(Dist, options.directory);
  fs.mkdirSync(directory, { recursive: true });

  // One translation unit: the Skia headers are parsed once.
  const unity = path.join(directory, `${options.name}.unity.cpp`);
  fs.writeFileSync(
    unity,
    options.sources.map((file) => `#include "${file}"\n`).join("")
  );

  const output = path.join(directory, `${options.name}.js`);
  const args = [
    unity,
    // What the archives were compiled with: see metadata.json.
    ...metadata.cflags,
    ...metadata.defines.map((define) => `-D${define}`),
    ...(options.debug ? ["-O1", "-g2"] : ["-O3"]),
    `-I${path.join(root, "skia")}`,
    `-I${path.join(PackageRoot, "src", "cpp")}`,
    // The WebGPU headers when compiling and the JS half of WebGPU when linking.
    `--use-port=${path.join(root, "emdawnwebgpu", "emdawnwebgpu.port.py")}`,
    ...metadata.libraries.map((library) => path.join(root, "lib", library)),
    "-sMODULARIZE",
    "-sEXPORT_ES6",
    // Pages and workers: a worker draws to an OffscreenCanvas.
    "-sENVIRONMENT=web,worker",
    "-sALLOW_MEMORY_GROWTH",
    `-sASSERTIONS=${options.debug ? 1 : 0}`,
    // WebGPU.importJsDevice and importJsTexture hand over the page's objects;
    // the views are how the page writes into wasm memory.
    "-sEXPORTED_RUNTIME_METHODS=WebGPU,HEAPU8,HEAPU32,HEAPF32,HEAPF64",
    "-sEXPORTED_FUNCTIONS=_malloc,_free",
    "-o",
    output,
  ];
  execFileSync(path.join(emscripten, "em++"), args, { stdio: "inherit" });
  fs.rmSync(unity);
  for (const file of [`${options.name}.js`, `${options.name}.wasm`]) {
    report(path.join(directory, file));
  }
  return output;
};

/** Bundles a TypeScript entry point into one ES module for the browser. */
export const bundle = async (entry: string, output: string) => {
  await build({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    format: "esm",
    target: "es2022",
    sourcemap: "inline",
    logLevel: "warning",
  });
  report(output);
};

const report = (file: string) => {
  const { size } = fs.statSync(file);
  console.log(
    `✅ ${path.relative(PackageRoot, file)} ${(size / (1 << 20)).toFixed(2)} MB`
  );
};

export const sourcesIn = (directory: string) =>
  fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".cpp"))
    .sort()
    .map((file) => path.join(directory, file));

export const run = (main: () => Promise<void>) => {
  main().catch((error: Error) => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  });
};
