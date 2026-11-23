import { defineConfig } from "playwright/test";

const port = 8790;

// The Linux runners of GitHub Actions have no GPU: WebGPU runs on SwiftShader,
// the software Vulkan driver that ships with Chromium. ANGLE has to run on it
// too, or the GPU process cannot share the texture of a canvas and crashes.
const softwareVulkan =
  process.env.CI && process.platform === "linux"
    ? [
        "--enable-features=Vulkan",
        "--use-vulkan=swiftshader",
        "--use-angle=swiftshader",
        "--use-webgpu-adapter=swiftshader",
        "--disable-vulkan-surface",
      ]
    : [];

// eslint-disable-next-line import/no-default-export
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${port}`,
    // The full Chromium build in its new headless mode: the default headless
    // shell has no GPU process to give WebGPU an adapter.
    channel: "chromium",
    launchOptions: {
      args: ["--enable-unsafe-webgpu", "--enable-gpu", ...softwareVulkan],
    },
  },
  webServer: {
    command: "yarn serve",
    cwd: __dirname,
    env: { PORT: String(port) },
    url: `http://localhost:${port}/tests/immediate.html`,
    reuseExistingServer: !process.env.CI,
  },
});
