import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'skia-wasm';
export const appDescription = 'Skia Graphite on WebGPU, compiled to WebAssembly.';
// Where the site is served: see next.config.mjs. Next.js adds it to its own
// links; a URL built by hand, such as one given to fetch(), needs it spelled out.
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
// The live previews that scripts/examples.mjs builds into public/examples.
export const examplesRoute = `${basePath}/examples`;

export const gitConfig = {
  user: 'wcandillon',
  repo: 'skia-wasm',
  branch: 'main',
  // Where this site lives in the repository.
  directory: 'docs',
};

export const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png'];

  return { segments, url: getImageUrl(segments, page.locale) };
}
