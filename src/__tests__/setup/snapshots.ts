/**
 * Compares what was drawn with the PNGs of src/__tests__/snapshots.
 *
 * UPDATE_SNAPSHOTS=1 writes them. A comparison that fails leaves what was
 * drawn and the difference in test-results/pixels.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 8 bits each. */
  data: Uint8Array;
}

export interface SnapshotOptions {
  /** How different the color of a pixel may be, in [0, 1]. */
  threshold?: number;
  /** The share of pixels, in [0, 1], that may be more different than that. */
  maxDifferent?: number;
  /** Whether a failure leaves its images in test-results. */
  record?: boolean;
}

const Here = path.dirname(fileURLToPath(import.meta.url));
const Snapshots = path.join(Here, "..", "snapshots");
const Results = path.join(Here, "..", "..", "..", "test-results", "pixels");

const encode = ({ width, height, data }: Pixels) => {
  const png = new PNG({ width, height });
  png.data.set(data);
  return PNG.sync.write(png);
};

const write = (file: string, content: Uint8Array) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

export const checkSnapshot = (
  actual: Pixels,
  name: string,
  {
    threshold = 0.05,
    maxDifferent = 0.001,
    record = true,
  }: SnapshotOptions = {}
) => {
  const file = path.join(Snapshots, `${name}.png`);
  const result = path.join(Results, `${name}.png`);
  const difference = path.join(Results, `${name}.diff.png`);
  if (record) {
    fs.rmSync(result, { force: true });
    fs.rmSync(difference, { force: true });
  }

  if (process.env.UPDATE_SNAPSHOTS) {
    write(file, encode(actual));
    return;
  }
  // Never written silently: a test with no snapshot would always pass.
  if (!fs.existsSync(file)) {
    write(result, encode(actual));
    throw new Error(
      `There is no snapshot ${name}.png: see ${result}, and run with UPDATE_SNAPSHOTS=1 to accept it.`
    );
  }
  const expected = PNG.sync.read(fs.readFileSync(file));
  const { width, height } = actual;
  if (expected.width !== width || expected.height !== height) {
    write(result, encode(actual));
    throw new Error(
      `${name} is ${width}x${height}, its snapshot ${expected.width}x${expected.height}.`
    );
  }
  const diff = new PNG({ width, height });
  const different = pixelmatch(
    expected.data,
    actual.data,
    diff.data,
    width,
    height,
    // Antialiased pixels count: they are part of what Skia draws.
    { threshold, includeAA: true }
  );
  if (different > maxDifferent * width * height) {
    if (record) {
      write(result, encode(actual));
      write(difference, PNG.sync.write(diff));
    }
    throw new Error(
      `${name}: ${different} of ${
        width * height
      } pixels differ from its snapshot. See ${result} and ${difference}.`
    );
  }
};
