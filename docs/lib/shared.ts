import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'skia-wasm';
export const appDescription = 'Skia Graphite on WebGPU, compiled to WebAssembly.';
export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
// The live previews that scripts/examples.mjs builds into public/examples.
export const examplesRoute = '/examples';

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
