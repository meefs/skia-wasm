import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

// The path the site is served under: "/skia-wasm" on GitHub Pages, set by the
// deployment workflow, and nothing in development.
const basePath = process.env.DOCS_BASE_PATH ?? '';

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  basePath,
  // Every page is a folder with an index.html. GitHub Pages does not serve
  // docs.html for /docs when a docs/ folder sits next to it.
  trailingSlash: true,
  reactStrictMode: true,
  env: {
    // For the URLs that Next.js does not prefix itself: see lib/shared.ts.
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  turbopack: {
    // This folder is its own project, with its own lockfile: without this,
    // Next.js takes the lockfile of the repository root for the workspace.
    root: import.meta.dirname,
  },
};

export default withMDX(config);
