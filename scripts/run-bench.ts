/**
 * Runs bench/index.html (canvaskit-wasm against skia-wasm) and saves what it
 * measured.
 *
 *   yarn bench [--target=desktop|android] [--serial=<adb serial>]
 *              [--orders=KI,IK] [--output=<file>]
 *              [--scenes=rrects,shaders] [--frames=600] [--warmup=120]
 *              [--load=paced|spin] [--profile=0]
 *              [--isolate] [--cool=cool|none] [--cool-to=36] [--preheat=45]
 *
 * --load=spin keeps the core busy between frames, so that a CPU governor
 * does not lower the clock under the lighter variants: see bench/main.ts.
 * --profile=0 skips the allocation measurement, which halves a run.
 *
 * The page is loaded once per order: the variants run in the order given, so
 * that a difference between two of them can be told from a drift of the
 * machine during the run (a phone gets warm).
 *
 * desktop: the installed Google Chrome, in a window that must stay visible.
 *
 * android: Chrome on a phone plugged in over USB, with USB debugging on, the
 * screen on and unlocked. The page is served from this machine (adb reverse)
 * and driven over the DevTools protocol (adb forward). Only the tab this
 * script opens is attached to; the other tabs of the phone are left alone.
 *
 * A phone lowers the top speed of its cores after some twenty seconds of
 * load, by more than half on a Galaxy S25 Edge, and takes minutes to give it
 * back. A figure only compares with another taken under the same limit, so
 * the script records the limit while each variant is measured, and there are
 * two ways to run it:
 *
 *   --isolate            one page per scene and variant, each started on a
 *                        phone that has cooled down (to --cool-to degrees)
 *                        and has no limit on its cores: the first seconds of
 *                        an animation.
 *   --preheat=45 --cool=none
 *                        45 seconds of the heaviest scene first, then every
 *                        variant on a phone that stays hot: an animation
 *                        that never stops.
 */
import { execFileSync, spawn } from "child_process";
import fs from "fs";
import path from "path";

import { chromium } from "playwright";

import { serve } from "./serve";
import { PackageRoot } from "./skia";

const option = (name: string, fallback: string) =>
  process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;

// Ports of their own for each target: a run on the phone, which spends most
// of its time cooling down, does not keep the desktop waiting.
const onPhone = option("target", "desktop") === "android";
const Port = onPhone ? 8794 : 8795;
const DevToolsPort = onPhone ? 9333 : 9334;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---- The DevTools protocol, over the socket of the whole browser. ---- */

type Params = Record<string, unknown>;

interface Event {
  method: string;
  params: Params;
  sessionId?: string;
}

class DevTools {
  private next = 0;
  private readonly pending = new Map<
    number,
    { resolve(result: unknown): void; reject(error: Error): void }
  >();
  private readonly listeners: ((event: Event) => void)[] = [];
  private closed: string | null = null;

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      } & Event;
      if (message.id === undefined) {
        this.listeners.forEach((listener) => listener(message));
        return;
      }
      const call = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        call?.reject(new Error(message.error.message));
      } else {
        call?.resolve(message.result);
      }
    });
    // Without this a call made on a dead socket would wait forever.
    const fail = (reason: string) => {
      this.closed = reason;
      this.pending.forEach(({ reject }) => reject(new Error(reason)));
      this.pending.clear();
    };
    socket.addEventListener("error", (event) =>
      fail(
        `The DevTools socket failed: ${(event as ErrorEvent).message ?? "unknown error"}.`
      )
    );
    socket.addEventListener("close", () =>
      fail(this.closed ?? "The DevTools socket closed.")
    );
  }

  /** `endpoint` is the HTTP address of the browser's debugging port. */
  static async connect(endpoint: string) {
    const version = (await (
      await fetch(`${endpoint}/json/version`)
    ).json()) as {
      Browser: string;
      webSocketDebuggerUrl: string;
    };
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve());
      socket.addEventListener("error", () =>
        reject(new Error(`No DevTools socket at ${endpoint}.`))
      );
    });
    return { devtools: new DevTools(socket), browser: version.Browser };
  }

  send<T = Params>(method: string, params: Params = {}, sessionId?: string) {
    return new Promise<T>((resolve, reject) => {
      if (this.closed !== null) {
        reject(new Error(this.closed));
        return;
      }
      const id = ++this.next;
      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
      });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(listener: (event: Event) => void) {
    this.listeners.push(listener);
  }

  close() {
    this.socket.close();
  }
}

/* ---- What the page calls back for: bench/main.ts looks for these. ---- */

const hooks = `(() => {
  let next = 0;
  const pending = new Map();
  const call = (action) =>
    new Promise((resolve) => {
      const id = ++next;
      pending.set(id, resolve);
      window.benchHost(JSON.stringify({ id, action }));
    });
  window.benchHostResolve = (id, value) => {
    pending.get(id)?.(value);
    pending.delete(id);
  };
  window.benchProfile = (action) => call(action);
  window.benchCollect = () => call("collect");
})();`;

interface HeapNode {
  selfSize: number;
  children: HeapNode[];
}

const sizeOf = (node: HeapNode): number =>
  node.selfSize + node.children.reduce((sum, child) => sum + sizeOf(child), 0);

interface PageResults {
  error?: string;
  scenes?: { variants: { signature?: number[] }[] }[];
}

/** Closes the tabs of this benchmark that a run which was killed left open. */
const closeStaleTabs = async (devtools: DevTools) => {
  const { targetInfos } = await devtools.send<{
    targetInfos: { targetId: string; url: string }[];
  }>("Target.getTargets");
  for (const { targetId, url } of targetInfos) {
    if (url.startsWith(`http://localhost:${Port}/bench/index.html`)) {
      await devtools.send("Target.closeTarget", { targetId });
    }
  }
};

/** Opens a tab, runs the page in it, closes the tab. */
const measure = async (devtools: DevTools, url: string, label: string) => {
  const { targetId } = await devtools.send<{ targetId: string }>(
    "Target.createTarget",
    { url: "about:blank" }
  );
  const { sessionId } = await devtools.send<{ sessionId: string }>(
    "Target.attachToTarget",
    { targetId, flatten: true }
  );
  const tab = <T = Params>(method: string, params: Params = {}) =>
    devtools.send<T>(method, params, sessionId);
  try {
    await tab("Page.enable");
    await tab("Runtime.enable");
    await tab("HeapProfiler.enable");
    await tab("Runtime.addBinding", { name: "benchHost" });
    await tab("Page.addScriptToEvaluateOnNewDocument", { source: hooks });

    // What the page allocates between "start" and "stop": the sampling heap
    // profiler counts every allocation, collected or not.
    const host = async (action: string) => {
      switch (action) {
        case "start":
          await tab("HeapProfiler.startSampling", {
            // Bytes between samples, on average. The profile lists every
            // sample and comes back as one message, which Node refuses past a
            // few megabytes: a run that allocates 3 GB must stay under that.
            samplingInterval: 128 * 1024,
            includeObjectsCollectedByMajorGC: true,
            includeObjectsCollectedByMinorGC: true,
          });
          return null;
        case "stop": {
          const { profile } = await tab<{ profile: { head: HeapNode } }>(
            "HeapProfiler.stopSampling"
          );
          return { bytes: sizeOf(profile.head) };
        }
        case "collect":
          await tab("HeapProfiler.collectGarbage");
          return null;
        default:
          return null;
      }
    };
    devtools.on((event) => {
      if (
        event.sessionId !== sessionId ||
        event.method !== "Runtime.bindingCalled" ||
        event.params.name !== "benchHost"
      ) {
        return;
      }
      const { id, action } = JSON.parse(String(event.params.payload)) as {
        id: number;
        action: string;
      };
      host(action)
        .catch((error: Error) => {
          console.error(`host: ${action}: ${error.message}`);
          return null;
        })
        .then((result) =>
          tab("Runtime.evaluate", {
            expression: `benchHostResolve(${id}, ${JSON.stringify(result)})`,
          })
        )
        .catch(() => undefined);
    });

    await tab("Page.navigate", { url });
    await tab("Page.bringToFront");
    const evaluate = async <T>(expression: string) => {
      const { result } = await tab<{ result: { value: T } }>(
        "Runtime.evaluate",
        { expression, returnByValue: true }
      );
      return result.value;
    };
    let last = "";
    for (;;) {
      const state = await evaluate<{
        status: string;
        done: boolean;
        visible: boolean;
      }>(`({
        status: document.querySelector("#status")?.textContent ?? "",
        done: window.benchResults !== undefined,
        visible: document.visibilityState === "visible",
      })`);
      if (state.status !== last) {
        last = state.status;
        console.log(
          `${new Date().toISOString().slice(11, 19)} [${label}] ${last}`
        );
      }
      if (!state.visible) {
        console.log(`[${label}] the page is hidden: no frames are drawn`);
      }
      if (state.done) {
        break;
      }
      await sleep(1000);
    }
    const results = await evaluate<PageResults>("window.benchResults");
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
  } finally {
    await devtools.send("Target.closeTarget", { targetId }).catch(() => null);
  }
};

/* ---- Android: the phone, over adb. ---- */

/** The highest speed each group of cores was allowed, in kHz, at a time. */
interface ClockSample {
  time: number;
  limits: number[];
}

const android = (serial: string) => {
  const target = serial ? ["-s", serial] : [];
  const adb = (...args: string[]) =>
    execFileSync("adb", [...target, ...args], { encoding: "utf8" }).trim();
  const property = (name: string) => adb("shell", "getprop", name);
  const policies = "/sys/devices/system/cpu/cpufreq/policy*";
  // One line per group of cores: its cores, and the speed it is built for.
  const clusters = adb(
    "shell",
    `for p in ${policies}; do echo "$(cat $p/related_cpus | wc -w) $(cat $p/cpuinfo_max_freq)"; done`
  )
    .split("\n")
    .map((line) => {
      const [cores, top] = line.trim().split(/\s+/).map(Number);
      return { cores, top };
    });
  const limits = () =>
    adb("shell", `cat ${policies}/scaling_max_freq`).split(/\s+/).map(Number);
  return {
    clusters,
    describe: () => ({
      model: property("ro.product.model"),
      soc: property("ro.soc.model"),
      android: property("ro.build.version.release"),
      chrome:
        /versionName=(\S+)/.exec(
          adb("shell", "dumpsys", "package", "com.android.chrome")
        )?.[1] ?? null,
      clusters,
    }),
    /** Android's throttling status (0 is none) and temperatures in °C. */
    thermal: () => {
      const service = adb("shell", "dumpsys", "thermalservice");
      const current = service.slice(
        service.indexOf("Current temperatures from HAL")
      );
      const reading = (name: string) => {
        const match = new RegExp(
          `mValue=([\\d.]+), mType=\\d+, mName=${name},`
        ).exec(current);
        return match ? Number(match[1]) : null;
      };
      const battery =
        /temperature: (\d+)/.exec(adb("shell", "dumpsys", "battery"))?.[1] ??
        null;
      return {
        status: Number(/Thermal Status: (\d+)/.exec(service)?.[1] ?? -1),
        ap: reading("AP"),
        skin: reading("SKIN"),
        battery: battery === null ? null : Number(battery) / 10,
      };
    },
    /** Whether every core may run at the speed it is built for. */
    unlimited: () =>
      limits().every((limit, index) => limit >= clusters[index].top),
    /**
     * Records the speed limit of each group of cores, four times a second,
     * until stop() is called. The times are those of the phone's clock, which
     * is also the clock of the page.
     */
    watchClock: () => {
      const samples: ClockSample[] = [];
      const watcher = spawn("adb", [
        ...target,
        "shell",
        `while true; do echo "$(date +%s%3N) $(cat ${policies}/scaling_max_freq | tr '\\n' ' ')"; sleep 0.25; done`,
      ]);
      let pending = "";
      watcher.stdout.on("data", (chunk: Buffer) => {
        pending += chunk.toString();
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const [time, ...values] = line.trim().split(/\s+/).map(Number);
          if (values.length === clusters.length) {
            samples.push({ time, limits: values });
          }
        }
      });
      return {
        stop: () => {
          watcher.kill();
          return samples;
        },
      };
    },
    connect: () => {
      adb("reverse", `tcp:${Port}`, `tcp:${Port}`);
      adb(
        "forward",
        `tcp:${DevToolsPort}`,
        "localabstract:chrome_devtools_remote"
      );
      // Screen on, Chrome in front. The phone has to be unlocked already.
      adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
      adb(
        "shell",
        "am",
        "start",
        "-n",
        "com.android.chrome/com.google.android.apps.chrome.Main"
      );
    },
    disconnect: () => {
      adb("reverse", "--remove", `tcp:${Port}`);
      adb("forward", "--remove", `tcp:${DevToolsPort}`);
    },
  };
};

type Phone = ReturnType<typeof android>;

/**
 * Waits for the phone to be as it was before any load: cool, and with no
 * limit on the speed of its cores. Ten minutes at most.
 */
const coolDown = async (phone: Phone, coolTo: number) => {
  const waitingSince = Date.now();
  for (;;) {
    const { ap, skin } = phone.thermal();
    const unlimited = phone.unlimited();
    // The skin of the phone is what Android throttles on: it has to cool
    // down too, and it does so more slowly.
    const cool =
      unlimited &&
      (ap === null || ap <= coolTo) &&
      (skin === null || skin <= coolTo - 1);
    if (cool) {
      return true;
    }
    if (Date.now() - waitingSince > 10 * 60_000) {
      return false;
    }
    console.log(
      `--- cooling down: processor ${ap} °C, skin ${skin} °C${
        unlimited ? "" : ", cores limited"
      }`
    );
    await sleep(15_000);
  }
};

interface MeasuredVariant {
  window?: [number, number];
  /** Per group of cores: the lowest and highest limit while it was measured. */
  clock?: { cores: number; top: number; lowest: number; highest: number }[];
}

(async () => {
  const target = option("target", "desktop");
  const orders = option("orders", "KI,IK").split(",");
  const coolTo = Number(option("cool-to", "36"));
  // "cool": wait before each page for a phone with no limit on its cores.
  // "none": start at once, for runs that are meant to be hot (--preheat).
  const cool = option("cool", "cool") === "cool";
  // One page per scene and variant: nothing that ran before it has warmed
  // the phone up.
  const isolate = process.argv.includes("--isolate");
  const sceneIds = option("scenes", "rrects,shaders,paths,images").split(",");
  const output = path.resolve(
    option(
      "output",
      path.join(PackageRoot, "bench", "results", `${target}.json`)
    )
  );
  const query = process.argv
    .slice(2)
    .filter((argument) =>
      /^--(frames|warmup|load|profile|preheat)=/.test(argument)
    )
    .map((argument) => argument.slice(2))
    .join("&");

  // What each page draws: a whole order of variants over the scenes, or one
  // variant of one scene.
  const pages = orders.flatMap((order) =>
    isolate
      ? sceneIds.flatMap((scene) =>
          order.split("").map((variant) => ({
            order,
            label: `${order} ${scene} ${variant}`,
            scenes: scene,
            variants: variant,
          }))
        )
      : [
          {
            order,
            label: order,
            scenes: sceneIds.join(","),
            variants: order.split("").join(","),
          },
        ]
  );

  const server = await serve(Port);
  const phone = target === "android" ? android(option("serial", "")) : null;
  // The desktop browser is launched here; the phone's is already running.
  const launched = phone
    ? null
    : await chromium.launch({
        channel: "chrome",
        headless: false,
        args: [
          `--remote-debugging-port=${DevToolsPort}`,
          "--window-size=1200,1400",
        ],
      });
  try {
    phone?.connect();
    await sleep(1000);
    const { devtools, browser } = await DevTools.connect(
      `http://127.0.0.1:${DevToolsPort}`
    );
    await closeStaleTabs(devtools);
    const device = phone?.describe() ?? null;
    console.log(`${browser}${device ? ` on ${device.model}` : ""}`);
    const runs = [];
    for (const [index, page] of pages.entries()) {
      const cooled = phone && cool ? await coolDown(phone, coolTo) : null;
      const before = phone?.thermal() ?? null;
      console.log(
        `--- page ${index + 1} of ${pages.length}, ${page.label}${
          before ? `, ${JSON.stringify(before)}` : ""
        }${cooled === false ? ", NOT cooled down" : ""}`
      );
      const clock = phone?.watchClock() ?? null;
      const results = await measure(
        devtools,
        `http://localhost:${Port}/bench/index.html?variants=${page.variants}&scenes=${page.scenes}&${query}`,
        page.label
      );
      const samples = clock?.stop() ?? [];
      const after = phone?.thermal() ?? null;
      // What the cores were allowed while each variant was measured.
      if (phone) {
        for (const scene of results.scenes ?? []) {
          for (const variant of scene.variants as MeasuredVariant[]) {
            const { window } = variant;
            const during = window
              ? samples.filter(
                  ({ time }) => time >= window[0] && time <= window[1]
                )
              : [];
            variant.clock = phone.clusters.map(({ cores, top }, cluster) => {
              const limits = during.map((sample) => sample.limits[cluster]);
              return {
                cores,
                top,
                lowest: limits.length > 0 ? Math.min(...limits) : Number.NaN,
                highest: limits.length > 0 ? Math.max(...limits) : Number.NaN,
              };
            });
          }
        }
      }
      runs.push({
        order: page.order,
        label: page.label,
        load: option("load", "paced"),
        cooled,
        thermal: { before, after },
        ...results,
      });
      // Saved after every page: a long session can be read before it ends.
      fs.writeFileSync(
        output,
        `${JSON.stringify({ target, browser, device, runs }, null, 2)}\n`
      );
    }
    devtools.close();
    console.log(`✅ ${path.relative(PackageRoot, output)}`);
  } finally {
    phone?.disconnect();
    await launched?.close();
    server.close();
  }
})().catch((error: Error) => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
