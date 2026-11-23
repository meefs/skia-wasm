/**
 * Runs the benchmark page in a Chrome window and saves what it measured to
 * bench/results.json.
 *
 * It uses the installed Google Chrome, not the Chromium that Playwright
 * ships. The window must stay visible: a hidden page gets no animation
 * frames.
 *
 *   yarn bench [--runs=2] [--modes=graphite,null] [--output=<file>]
 *              [--scenes=rrects,shaders] [--variants=A,D] [--frames=600]
 *
 * Each run measures both modes: "graphite" draws for real, "null" sends the
 * same calls to a canvas that draws nothing.
 */
import fs from "fs";
import path from "path";

import { chromium } from "playwright";
import type { Browser } from "playwright";

import { serve } from "./serve";
import { PackageRoot } from "./skia";

const Port = 8791;
const DefaultOutput = path.join(PackageRoot, "bench", "results.json");

interface HeapNode {
  selfSize: number;
  children: HeapNode[];
}

const sizeOf = (node: HeapNode): number =>
  node.selfSize + node.children.reduce((sum, child) => sum + sizeOf(child), 0);

const option = (name: string, fallback: string) =>
  process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;

const measure = async (browser: Browser, mode: string, query: string) => {
  const page = await browser.newPage({ viewport: null });
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.error(`page: ${message.text()}`);
    }
  });

  // What the page allocates and collects between "start" and "stop": the
  // sampling heap profiler counts every allocation, collected or not, and the
  // trace has one event per collection.
  const session = await page.context().newCDPSession(page);
  await session.send("HeapProfiler.enable");
  await page.exposeFunction("benchProfile", async (action: string) => {
    if (action === "start") {
      await browser.startTracing(page, {
        categories: ["devtools.timeline", "v8"],
      });
      await session.send("HeapProfiler.startSampling", {
        samplingInterval: 1024,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      });
      return null;
    }
    const { profile } = (await session.send("HeapProfiler.stopSampling")) as {
      profile: { head: HeapNode };
    };
    const trace = JSON.parse((await browser.stopTracing()).toString()) as {
      traceEvents: { name: string; ph: string }[];
    };
    const count = (name: string) =>
      trace.traceEvents.filter(
        (event) => event.name === name && event.ph !== "E"
      ).length;
    return {
      bytes: sizeOf(profile.head),
      minorCollections: count("MinorGC"),
      majorCollections: count("MajorGC"),
    };
  });

  await page.goto(
    `http://localhost:${Port}/bench/index.html?canvas=${mode}&${query}`
  );
  await page.bringToFront();
  let last = "";
  for (;;) {
    const state = await page.evaluate(() => ({
      status: document.querySelector("#status")?.textContent ?? "",
      done:
        (window as unknown as { benchResults?: unknown }).benchResults !==
        undefined,
    }));
    if (state.status !== last) {
      last = state.status;
      console.log(`[${mode}] ${last}`);
    }
    if (state.done) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const results = (await page.evaluate(
    () => (window as unknown as { benchResults: unknown }).benchResults
  )) as {
    error?: string;
    scenes?: { variants: { signature?: number[] }[] }[];
  };
  await page.close();
  if (results.error) {
    throw new Error(results.error);
  }
  // The pixels each variant drew were compared on the page: only the
  // differences are kept.
  for (const scene of results.scenes ?? []) {
    for (const variant of scene.variants) {
      delete variant.signature;
    }
  }
  return results;
};

(async () => {
  const runs = Number(option("runs", "1"));
  const modes = option("modes", "graphite,null").split(",");
  const output = path.resolve(option("output", DefaultOutput));
  const query = process.argv
    .slice(2)
    .filter((argument) =>
      /^--(scenes|variants|frames|warmup|repeat)=/.test(argument)
    )
    .map((argument) => argument.slice(2))
    .join("&");

  const server = await serve(Port);
  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--js-flags=--expose-gc", "--window-size=1200,1400"],
  });
  try {
    const measured = [];
    for (let run = 1; run <= runs; run++) {
      for (const mode of modes) {
        console.log(`--- run ${run} of ${runs}, ${mode}`);
        measured.push({ run, mode, ...(await measure(browser, mode, query)) });
      }
    }
    fs.writeFileSync(
      output,
      `${JSON.stringify({ chrome: browser.version(), runs: measured }, null, 2)}\n`
    );
    console.log(
      `✅ ${path.relative(PackageRoot, output)} (Chrome ${browser.version()})`
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error: Error) => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
