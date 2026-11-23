/**
 * Locates the Skia wasm archives this package links against.
 *
 * The archives are built in the React Native Skia repository (`yarn
 * build-skia wasm` in packages/skia), from the same Skia and Dawn revisions
 * as its native binaries. binaries.json pins one build: it is downloaded
 * once, checked against its SHA-256 and unpacked in the cache.
 *
 * Set SKIA_WASM_ARCHIVES to the directory of a local build to use that
 * instead (packages/skia/libs/wasm in a React Native Skia checkout). Both
 * have the same layout:
 *
 *   lib/*.a          Skia and its modules
 *   skia/            the Skia headers
 *   emdawnwebgpu/    WebGPU headers and JS library (an Emscripten port)
 *   metadata.json    Emscripten version, flags and defines to match
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import extract from "extract-zip";

export const PackageRoot = path.join(__dirname, "..");
const AssetName = "skia-graphite-wasm.zip";

export interface SkiaWasmMetadata {
  skia: { commit: string; patches: string[] };
  dawn: { commit: string };
  /** The Emscripten release the archives were compiled with. */
  emscripten: string;
  cflags: string[];
  defines: string[];
  libraries: string[];
}

export interface SkiaWasm {
  root: string;
  source: "local build" | "release";
  metadata: SkiaWasmMetadata;
}

const read = (root: string, source: SkiaWasm["source"]): SkiaWasm => {
  const file = path.join(root, "metadata.json");
  if (!fs.existsSync(file)) {
    throw new Error(`${root} has no metadata.json: not Skia wasm archives.`);
  }
  const metadata = JSON.parse(
    fs.readFileSync(file, "utf8")
  ) as SkiaWasmMetadata;
  for (const library of metadata.libraries) {
    if (!fs.existsSync(path.join(root, "lib", library))) {
      throw new Error(`${root} has no lib/${library}.`);
    }
  }
  return { root, source, metadata };
};

const cacheDirectory = () => {
  const override = process.env.SKIA_WASM_CACHE_DIR;
  if (override) {
    if (!path.isAbsolute(override)) {
      throw new Error("SKIA_WASM_CACHE_DIR must be an absolute path.");
    }
    return override;
  }
  let root = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
  if (process.platform === "darwin") {
    root = path.join(os.homedir(), "Library", "Caches");
  } else if (process.platform === "win32") {
    root =
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  }
  return path.join(root, "skia-wasm");
};

const sha256 = (file: string) => {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  try {
    const chunk = Buffer.alloc(1 << 20);
    let length: number;
    while ((length = fs.readSync(descriptor, chunk, 0, chunk.length, null))) {
      hash.update(chunk.subarray(0, length));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
};

/** The pin may be an HTTP(S) URL or, to try an archive before uploading it, file:///. */
const download = async (url: URL, destination: string) => {
  if (url.protocol === "file:") {
    fs.copyFileSync(fileURLToPath(url), destination);
    return;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!response.ok) {
    throw new Error(`Cannot download ${url}: HTTP ${response.status}.`);
  }
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
};

const fromRelease = async (): Promise<SkiaWasm> => {
  const pin = JSON.parse(
    fs.readFileSync(path.join(PackageRoot, "binaries.json"), "utf8")
  )[AssetName] as { url?: string; sha256?: string } | undefined;
  if (!pin?.url) {
    throw new Error(
      `No Skia wasm archives: binaries.json pins no ${AssetName} and SKIA_WASM_ARCHIVES is not set.`
    );
  }
  const expected = pin.sha256 ?? "";
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error(`binaries.json has no valid sha256 for ${AssetName}.`);
  }

  // The checksum names the directory: a new pin never reuses an old tree.
  const cache = path.join(cacheDirectory(), expected);
  const root = path.join(cache, "skia-graphite-wasm");
  const complete = path.join(cache, ".complete");
  if (fs.existsSync(complete)) {
    return read(root, "release");
  }

  fs.mkdirSync(cache, { recursive: true });
  // Unique temporary directories and a rename keep parallel runs from seeing
  // a partial download or a half-extracted tree.
  const temporary = fs.mkdtempSync(path.join(cache, ".download-"));
  try {
    const archive = path.join(temporary, AssetName);
    console.log(`Downloading ${pin.url}`);
    await download(new URL(pin.url), archive);
    if (sha256(archive) !== expected) {
      throw new Error(`SHA-256 mismatch for ${AssetName}; download discarded.`);
    }
    const extracted = path.join(temporary, "extracted");
    await extract(archive, { dir: extracted });
    if (!fs.existsSync(path.join(extracted, "metadata.json"))) {
      throw new Error(`${AssetName} has no metadata.json.`);
    }
    fs.rmSync(root, { recursive: true, force: true });
    fs.renameSync(extracted, root);
    fs.writeFileSync(complete, `${expected}\n`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  return read(root, "release");
};

export const prepareSkia = async (): Promise<SkiaWasm> => {
  const local = process.env.SKIA_WASM_ARCHIVES;
  if (local) {
    if (!path.isAbsolute(local)) {
      throw new Error("SKIA_WASM_ARCHIVES must be an absolute path.");
    }
    return read(local, "local build");
  }
  return fromRelease();
};

if (require.main === module) {
  prepareSkia()
    .then(({ root, source, metadata }) => {
      console.log(
        `Skia wasm archives (${source}): ${root}\n  Skia ${metadata.skia.commit}\n  Dawn ${metadata.dawn.commit}\n  Emscripten ${metadata.emscripten}`
      );
    })
    .catch((error: Error) => {
      console.error(`❌ ${error.message}`);
      process.exitCode = 1;
    });
}
