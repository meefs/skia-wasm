import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
  turbopack: {
    // This folder is its own project, with its own lockfile: without this,
    // Next.js takes the lockfile of the repository root for the workspace.
    root: import.meta.dirname,
  },
};

export default withMDX(config);
