/**
 * Builds the live previews of the examples into public/examples: one bundle
 * and one page per example, next to the wasm module that `yarn build` makes in
 * the repository root. A docs page shows that page in an iframe.
 *
 *   node scripts/examples.mjs            build once
 *   node scripts/examples.mjs --watch    rebuild when an example changes
 *   node scripts/examples.mjs --strict   fail if the wasm module is not built
 */
import fs from "node:fs";
import path from "node:path";

import { context } from "esbuild";

const docs = path.join(import.meta.dirname, "..");
const repository = path.join(docs, "..");
const sources = path.join(docs, "examples");
const assets = path.join(sources, "assets");
const output = path.join(docs, "public", "examples");
const library = path.join(repository, "dist", "lib");
const moduleFiles = ["skia-wasm.js", "skia-wasm.wasm"];

const strict = process.argv.includes("--strict");
const watch = process.argv.includes("--watch");

// examples/name.ts is one example. examples/name/main.ts is an example made
// of several files: the others become name.file.js, next to the page. Any
// other folder is a group: examples/group/name.ts is the example group-name.
const entryPoints = {};
const pages = [];
for (const entry of fs.readdirSync(sources, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".ts")) {
    const name = entry.name.slice(0, -3);
    entryPoints[name] = path.join(sources, entry.name);
    pages.push(name);
  } else if (entry.isDirectory() && entry.name !== "assets") {
    const files = fs.readdirSync(path.join(sources, entry.name));
    const group = !files.includes("main.ts");
    for (const file of files.filter((name) => name.endsWith(".ts"))) {
      const base = file.slice(0, -3);
      const source = path.join(sources, entry.name, file);
      if (group) {
        entryPoints[`${entry.name}-${base}`] = source;
        pages.push(`${entry.name}-${base}`);
      } else if (file === "main.ts") {
        entryPoints[entry.name] = source;
        pages.push(entry.name);
      } else {
        entryPoints[`${entry.name}.${base}`] = source;
      }
    }
  }
}

// The hero of the home page is built here too: it is a module that the page
// loads at run time, with no page of its own.
entryPoints.hero = path.join(docs, "hero", "hero.ts");

// `new URL("./worker.ts", import.meta.url)` is what a bundler expects in the
// source. Here the worker is built as its own file, so the URL names it.
const fileUrls = {
  name: "file-urls",
  setup(build) {
    build.onLoad({ filter: /[\\/]main\.ts$/ }, async (args) => {
      const directory = path.basename(path.dirname(args.path));
      const source = await fs.promises.readFile(args.path, "utf8");
      return {
        loader: "ts",
        contents: source.replace(
          /new URL\("\.\/([\w-]+)\.ts", import\.meta\.url\)/g,
          (_, file) => `new URL("./${directory}.${file}.js", import.meta.url)`
        ),
      };
    });
  },
};

const hasModule = moduleFiles.every((file) =>
  fs.existsSync(path.join(library, file))
);
if (!hasModule) {
  const message = `${path.relative(docs, library)} has no wasm module: run \`yarn build\` in the repository root.`;
  if (strict) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
  console.warn(`⚠️  ${message} The previews will say so instead of running.`);
}

const page = (name) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=512" />
    <title>${name}</title>
    <link rel="icon" href="data:," />
    <style>
      html,
      body {
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: #fff;
      }
      body {
        display: grid;
        place-items: center;
      }
      canvas {
        display: block;
        touch-action: none;
      }
      #message {
        position: absolute;
        inset: 0;
        display: none;
        place-items: center;
        padding: 32px;
        background: #fff;
        color: #b91c1c;
        font: 15px/1.5 system-ui, sans-serif;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <canvas width="512" height="512"></canvas>
    <div id="message"></div>
    <script type="module">
      const show = (text) => {
        const message = document.getElementById("message");
        message.textContent = text;
        message.style.display = "grid";
      };
      addEventListener("error", (event) => show(event.message));
      addEventListener("unhandledrejection", (event) =>
        show(String(event.reason?.message ?? event.reason))
      );
      if (!${hasModule}) {
        show("The wasm module is not built: run yarn build in the repository root.");
      } else if (!navigator.gpu) {
        show("This browser does not support WebGPU.");
      } else {
        import("./${name}.js");
      }
    </script>
  </body>
</html>
`;

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const name of pages) {
  fs.writeFileSync(path.join(output, `${name}.html`), page(name));
}
if (hasModule) {
  for (const file of moduleFiles) {
    fs.copyFileSync(path.join(library, file), path.join(output, file));
  }
}
if (fs.existsSync(assets)) {
  fs.cpSync(assets, output, { recursive: true });
}

const bundler = await context({
  entryPoints,
  outdir: output,
  bundle: true,
  // The examples share the library as one chunk.
  splitting: true,
  format: "esm",
  target: "es2022",
  minify: true,
  alias: { "skia-wasm": path.join(repository, "src", "ts", "index.ts") },
  plugins: [fileUrls],
  logLevel: "warning",
});
await bundler.rebuild();
console.log(
  `✅ ${pages.length} example previews in ${path.relative(docs, output)}`
);
if (watch) {
  await bundler.watch();
  console.log("Watching the examples.");
} else {
  await bundler.dispose();
}
