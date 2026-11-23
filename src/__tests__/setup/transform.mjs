/** TypeScript for jest, through the esbuild that builds the package. */
import { transformSync } from "esbuild";

const process = (source, file) =>
  transformSync(source, {
    loader: "ts",
    format: "esm",
    target: "es2022",
    sourcemap: "inline",
    sourcefile: file,
  });

export default { process, processAsync: async (...args) => process(...args) };
