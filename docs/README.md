# skia-wasm docs

The documentation site of skia-wasm: [Fumadocs](https://fumadocs.dev) on Next.js, exported as a static site. It contains three short guides and examples. Each example page runs its example live, then shows its code.

This folder is a standalone project, with its own `package.json` and lockfile. It is not a workspace of the repository root.

```sh
yarn build         # in the repository root: the wasm module the previews run
cd docs
yarn install
yarn dev           # http://localhost:3000
yarn build         # the static site, in out/
yarn types:check
```

## Examples

- `examples/`: one module per example, or one folder with a `main.ts` when an example needs several files. Any other folder is a group: `examples/group/name.ts` is the example `group-name`. These files belong to the project of the repository root: `yarn tsc` and `yarn lint` there check them against the source of the library, with `skia-wasm` mapped to `src/ts`.
- `examples/assets/`: the files the examples fetch: an image, a video and two fonts. `CREDITS.md` says where they come from.
- `content/docs/getting-started.mdx` and `conventions.mdx`: the guides. Their snippets are written in the page, so nothing type checks them: keep them short, and prefer including an example.
- `content/docs/`: one page per example. A page is an `<Example name="..." />`, which is the live preview, and an `<include>` of the module, so the code on the site is the code that runs.
- `content/docs/meta.json`: the order of the sidebar.

To add an example, write `examples/name.ts`, add `content/docs/name.mdx`, then list it in `meta.json` and in `content/docs/index.mdx`.

## Live previews

`scripts/examples.mjs` bundles every example into `public/examples`, with a small page around each one and a copy of `dist/lib/skia-wasm.js` and `skia-wasm.wasm` from the repository root. The folder is generated and ignored by git. `<Example>` shows that page in an iframe.

- `yarn dev` and `yarn build` run the script first.
- `yarn examples --watch` rebuilds the previews when an example changes.
- Without the wasm module, `yarn dev` still works and the previews say what is missing. `yarn build` fails instead, so that a site is never published with previews that cannot run.
- An example that asks for a permission, such as the camera, takes `<Example name="..." manual />` and waits for a click.

## The home page

The hero of the home page is drawn by the library itself. Skia draws the elements of the page into two textures: what stays in front (the word "skia", the subtitle and the buttons) in one, everything else in the other. A WebGPU pass of the page draws a ribbon between the two: it draws itself across the page, curls into a loop where it passes over itself, then sways slowly. An element is put in front with `data-hero-front=""`, or a part of its text with `data-hero-front="word"`.

- `components/hero.tsx`: the page. Its elements are real ones: they are the layout, the links and what a screen reader finds. It measures them, hands their boxes, fonts and colors to the hero, and makes them transparent once the hero runs. Without WebGPU or without the wasm module, they simply stay.
- `hero/hero.ts`: the hero, with its WGSL shader. Like the examples, it belongs to the project of the repository root, and `scripts/examples.mjs` builds it into `public/examples/hero.js`, which the page loads at run time.
- `hero/types.ts`: what the two exchange.

## Deployment

`.github/workflows/docs.yml` publishes the site to GitHub Pages on every push to `main`. It installs Emscripten, builds the wasm module in the repository root, then builds this folder and uploads `out/`. It needs Pages enabled in the repository settings, with "GitHub Actions" as its source.

GitHub Pages serves a project site under the name of its repository, so the workflow passes two variables to the build:

- `DOCS_BASE_PATH`: the path the site is served under, such as `/skia-wasm`. Next.js adds it to its own links; `basePath` in `lib/shared.ts` is for the URLs built by hand.
- `DOCS_SITE_URL`: the origin of the site, for the absolute URLs of social cards.

Neither is needed in development.
