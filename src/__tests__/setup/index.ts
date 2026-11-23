/// <reference types="@webgpu/types" />
/**
 * Skia on Dawn's bindings for Node: the same module as in a browser, on a
 * GPUDevice that comes from the webgpu package instead of a page.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { create, globals } from "webgpu";

import type * as Library from "../../ts";

import type { Pixels } from "./snapshots";

export const Root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);
const Lib = path.join(Root, "dist", "lib");

export interface Setup {
  sk: Library.Skia;
  device: GPUDevice;
  /** Draws on a white texture, and reads it back. */
  draw: (
    width: number,
    height: number,
    scene: (canvas: Library.Canvas) => void
  ) => Promise<Pixels>;
  dispose: () => void;
}

/** What the JavaScript that Emscripten made takes; the types leave it out. */
type Factory = (options: {
  wasmBinary: Uint8Array;
}) => ReturnType<Library.ModuleFactory>;

export const setup = async (): Promise<Setup> => {
  // GPUBufferUsage and the classes, which the glue of Emscripten looks for.
  Object.assign(globalThis, globals);
  const backend = process.platform === "linux" ? ["backend=vulkan"] : [];
  const gpu = create(backend);
  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    throw new Error("Dawn found no GPU.");
  }
  const { vendor, architecture, description, isFallbackAdapter } = adapter.info;
  const name = [vendor, architecture, description].filter(Boolean).join(", ");
  // A software driver would not test what draws on people's screens.
  if (isFallbackAdapter) {
    throw new Error(`The pixel tests need a GPU, not ${name}.`);
  }
  process.stderr.write(`GPU: ${name}\n`);
  const device = await adapter.requestDevice();
  const errors: string[] = [];
  device.addEventListener("uncapturederror", (event) => {
    errors.push(event.error.message);
  });

  // The files that are published, not the sources.
  const library = (await import(path.join(Lib, "index.js"))) as typeof Library;
  const { default: factory } = (await import(
    path.join(Lib, "skia-wasm.js")
  )) as { default: Factory };
  // The module is built for the web, where it fetches its wasm.
  const wasmBinary = fs.readFileSync(path.join(Lib, "skia-wasm.wasm"));
  const sk = await library.Skia.init({
    device,
    module: () => factory({ wasmBinary }),
  });

  const draw: Setup["draw"] = async (width, height, scene) => {
    const texture = device.createTexture({
      size: [width, height],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    const surface = sk.surface(texture);
    surface.setClearColor(1, 1, 1, 1);
    scene(surface.getCanvas());
    surface.flush();

    // Rows of a copy are aligned to 256 bytes.
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const buffer = device.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [
      width,
      height,
    ]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const rows = new Uint8Array(buffer.getMappedRange());
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const row = y * bytesPerRow;
      data.set(rows.subarray(row, row + width * 4), y * width * 4);
    }
    buffer.unmap();
    buffer.destroy();
    texture.destroy();
    sk.tick();
    if (errors.length > 0) {
      throw new Error(`GPU errors:\n${errors.splice(0).join("\n")}`);
    }
    return { width, height, data };
  };

  return { sk, device, draw, dispose: () => device.destroy() };
};
