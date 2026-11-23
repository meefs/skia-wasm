/// <reference types="@webgpu/types" />
/**
 * The hero of the home page: Skia and a WebGPU pass of the page, on one
 * device.
 *
 * Skia draws the elements of the page into two textures: what the page marks
 * to stay in front (the word "skia", the subtitle and the buttons) in one,
 * everything else in the other. A fragment shader then draws a ribbon between
 * the two. It can, because what Skia draws is a texture like any other.
 */
import { Skia, parseColor } from "skia-wasm";
import type { Surface } from "skia-wasm";

import type { Hero, HeroLayout, MountHero } from "./types";

// The samples of the spine of the ribbon sent to the shader, which reads the
// path as straight between two of them: close enough to stay within half a
// pixel of the tightest bend on a wide screen.
const SAMPLES = 256;

interface Look {
  // The pigment along the ribbon: one cycle of the palette from end to end.
  colors: string[];
  shadow: [number, number, number];
  highlight: [number, number, number];
  depth: number;
  sheen: number;
}

const looks: Record<"light" | "dark", Look> = {
  light: {
    colors: [
      "#F6B8D8",
      "#FBEF7C",
      "#C6F5B4",
      "#A8F0F2",
      "#7FB4F9",
      "#A9EEF4",
      "#8CBDF9",
      "#B7F3D0",
      "#FBEE78",
      "#F9C3CF",
    ],
    shadow: [0.48, 0.5, 0.98],
    highlight: [1, 1, 1],
    depth: 0.62,
    sheen: 0.55,
  },
  dark: {
    colors: [
      "#B4307E",
      "#C98A1E",
      "#2F9E6B",
      "#1B8FA6",
      "#2F5FE0",
      "#1E93B0",
      "#3A63E6",
      "#2A9C7C",
      "#C78F22",
      "#B8386F",
    ],
    shadow: [0.05, 0.04, 0.2],
    highlight: [0.75, 0.9, 1],
    depth: 0.8,
    sheen: 0.35,
  },
};
const STOPS = looks.light.colors.length;

// From the top left, leaning toward the viewer.
const LIGHT = [-0.42, -0.62, 0.66];

// The folds of the ribbon, as waypoints relative to the center of the canvas
// at scale 1, where the ribbon is 90 wide.
const FOLDS: [number, number][] = [
  [-470, 160],
  [-360, 175],
  [-295, 115],
  [-320, 5],
  [-360, -95],
  [-365, -150],
  [-325, -175],
  [-230, -135],
  [-50, -25],
  [150, 105],
  [265, 175],
  [330, 170],
  [350, 95],
  [330, -25],
  [325, -115],
  [360, -180],
  [440, -190],
  [550, -145],
];
const RIBBON_WIDTH = 90;
// The size the folds are designed for at scale 1.
const DESIGN_WIDTH = 1040;
const DESIGN_HEIGHT = 620;
// The ribbon draws itself across the page in two steps. Its first fifth,
// which mostly comes in from beyond the edge, takes a fraction of a second.
// The rest follows an easing that would take this long from start to end,
// joined where that easing reaches a fifth, and at the speed it has there.
const INTRO = 0.2;
const INTRO_MS = 400;
const DRAW_MS = 6000;
// One slow revolution of the palette, once drawn.
const DRIFT_MS = 48000;
const shader = /* wgsl */ `
const SAMPLES = ${SAMPLES};
const STOPS = ${STOPS};

struct Uniforms {
  // The width of the ribbon, how many samples of it are drawn so far, where
  // the palette starts, and the size of a pixel of the page.
  ribbon: vec4f,
  // xyz, then how much the shaded side takes of the shadow tint.
  light: vec4f,
  // xyz, then how much the lit side takes of the highlight.
  shadow: vec4f,
  highlight: vec4f,
  // The palette, in Oklab.
  stops: array<vec4f, STOPS>,
  // xy: a point of the spine, at evenly spaced distances. The rest is the
  // stride of an array in a uniform buffer.
  spine: array<vec4f, SAMPLES>,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
// What Skia drew, premultiplied: what the ribbon passes over, then what
// stays in front of the ribbon.
@group(0) @binding(1) var under: texture_2d<f32>;
@group(0) @binding(2) var over: texture_2d<f32>;

const LAB_TO_LMS = mat3x3f(
  1.0, 1.0, 1.0,
  0.3963377774, -0.1055613458, -0.0894841775,
  0.2158037573, -0.0638541728, -1.2914855480
);
const LMS_TO_RGB = mat3x3f(
  4.0767416621, -1.2684380046, -0.0041960863,
  -3.3077115913, 2.6097574011, -0.7034186147,
  0.2309699292, -0.3413193965, 1.7076147010
);

fn oklabToSrgb(lab: vec3f) -> vec3f {
  let lms = LAB_TO_LMS * lab;
  let rgb = saturate(LMS_TO_RGB * (lms * lms * lms));
  return mix(
    12.92 * rgb,
    1.055 * pow(rgb, vec3f(1.0 / 2.4)) - 0.055,
    step(vec3f(0.0031308), rgb)
  );
}

// The stops are evenly spaced on a cycle: the last one blends back into the
// first, and each one weighs by how close it is to t.
fn pigment(t: f32) -> vec3f {
  let x = fract(t) * f32(STOPS);
  var lab = vec3f(0.0);
  for (var i = 0; i < STOPS; i++) {
    let gap = abs(x - f32(i));
    lab += u.stops[i].xyz * max(1.0 - min(gap, f32(STOPS) - gap), 0.0);
  }
  return oklabToSrgb(lab);
}

// One triangle that covers the canvas.
@vertex
fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let corners = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[index], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let p = position.xy;
  let below = textureLoad(under, vec2i(p), 0);
  let above = textureLoad(over, vec2i(p), 0);
  let radius = 0.5 * u.ribbon.x;
  let end = u.ribbon.y;

  // The ribbon is the union of the capsules around the stretches of its
  // spine: p is in it if one of them has a point within its radius of p.
  // That holds whatever the bend, even one tighter than the ribbon is wide.
  //
  // Where two stretches meet, as inside a fold, each says something else of
  // p: where it is across the ribbon, and how far along. Every stretch
  // weighs in by how deep p is under its surface, so that one takes over
  // from the other within a few pixels instead of at a line.
  let blend = 0.08 * radius;
  // How far p is from the surface of the ribbon: negative inside.
  var nearest = 1e9;
  var weight = 0.0;
  // Where p is across the ribbon: zero on the spine, one at the edge.
  var across = vec2f(0.0);
  // How far p is along the path, in samples.
  var t = 0.0;
  let last = i32(ceil(end));
  for (var i = 1; i < SAMPLES; i++) {
    if (i > last) {
      break;
    }
    let a = u.spine[i - 1].xy;
    let ab = u.spine[i].xy - a;
    // How much of this stretch is drawn: all of it, except the last one,
    // whose end is the round tip of the ribbon.
    let reach = min(end - f32(i - 1), 1.0);
    let h = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, reach);
    let c = a + h * ab;
    let d = distance(p, c) - radius;
    // Too far to cover p, or to weigh on what covers it.
    if (d > 2.0 * u.ribbon.w) {
      continue;
    }
    nearest = min(nearest, d);
    let w = exp(-d / blend);
    weight += w;
    across += w * (p - c) / radius;
    t += w * (f32(i - 1) + h);
  }

  let coverage = saturate(0.5 - nearest / u.ribbon.w);
  if (coverage <= 0.0) {
    return above + below * (1.0 - above.a);
  }
  across /= weight;
  t /= weight;

  // The ribbon read as a round tube: the normal faces the viewer on the
  // spine and leans away from it toward the edges.
  across /= max(length(across), 1.0);
  let normal = vec3f(across, sqrt(max(1.0 - dot(across, across), 0.0)));
  let facing = dot(normal, normalize(u.light.xyz));
  // The side turned away from the light slides toward the shadow tint, the
  // side facing it lifts toward the highlight.
  var color = pigment(t / f32(SAMPLES - 1) + u.ribbon.z);
  color = mix(mix(color, u.shadow.xyz, u.light.w), color, smoothstep(-0.8, 0.7, facing));
  color = mix(color, u.highlight.xyz, pow(max(facing, 0.0), 2.5) * u.shadow.w);
  let ribbon = vec4f(color, 1.0) * coverage;

  // The ribbon over one layer, the other layer over the ribbon: everything
  // is premultiplied.
  return above + (ribbon + below * (1.0 - coverage)) * (1.0 - above.a);
}
`;

const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const srgbToOklab = (color: string) => {
  const [r, g, b] = parseColor(color).map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// Where the easing reaches the end of the intro, and how fast it goes there
// compared to the intro at a constant speed.
const JOIN = Math.cbrt(INTRO / 4);
const JOIN_SPEED = (12 * JOIN * JOIN * INTRO_MS) / (DRAW_MS * INTRO);

/** How much of the ribbon is drawn after some milliseconds, from 0 to 1. */
const reveal = (elapsed: number) => {
  if (elapsed < INTRO_MS) {
    // Fast at first, slowing down to the speed of what follows.
    const s = elapsed / INTRO_MS;
    return (
      INTRO * (JOIN_SPEED * s + (1 - JOIN_SPEED) * (1 - Math.pow(1 - s, 3)))
    );
  }
  return easeInOutCubic(Math.min(JOIN + (elapsed - INTRO_MS) / DRAW_MS, 1));
};

/**
 * The waypoints of the ribbon for a canvas: the folds around its center,
 * joined to a lead-in from beyond the left edge and a lead-out past the right
 * one, so that the ribbon always bleeds off both sides.
 */
const waypoints = (width: number, height: number, scale: number) => {
  const cx = width / 2;
  const cy = height / 2;
  const reach = RIBBON_WIDTH * scale;
  const gap = 260 * scale;
  const first = cx + FOLDS[0][0] * scale;
  const lastFold = cx + FOLDS[FOLDS.length - 1][0] * scale;
  const left = Math.min(-reach, first - gap);
  const right = Math.max(width + reach, lastFold + gap);
  return [
    [left - 420 * scale, cy - 150 * scale],
    [left, cy - 40 * scale],
    [(left + first) / 2, cy + 85 * scale],
    ...FOLDS.map(([x, y]) => [cx + x * scale, cy + y * scale]),
    [(right + lastFold) / 2, cy - 55 * scale],
    [right, cy + 60 * scale],
    [right + 420 * scale, cy + 190 * scale],
  ];
};

interface Shared {
  device: GPUDevice;
  format: GPUTextureFormat;
  sk: Skia;
  pipeline: GPURenderPipeline;
}

// What every mount of the hero shares: the device, Skia on that device, and
// the pipeline of the ribbon.
const prepare = async (assets: string): Promise<Shared> => {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) {
    throw new Error("WebGPU is not available.");
  }
  const device = await adapter.requestDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();
  // One device for both: Skia is not given the canvas, only textures.
  const sk = await Skia.init({ device });
  const load = async (file: string) => {
    const response = await fetch(`${assets}/${file}`);
    return sk.typeface(await response.arrayBuffer());
  };
  sk.registerFont(await load("Roboto-Regular.ttf"), "Roboto");
  sk.registerFont(await load("Roboto-Medium.ttf"), "Roboto");
  const module = device.createShaderModule({ code: shader });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module },
    fragment: { module, targets: [{ format }] },
  });
  return { device, format, sk, pipeline };
};

// Made once for the page, whatever the number of times the hero is mounted.
// A canvas can only be drawn to by the device it was last configured with:
// two mounts with a device each, as React does in development, would fight
// over it. It also spares a wasm module per visit of the home page.
let shared: Promise<Shared> | null = null;

export const mountHero: MountHero = async (canvas, assets, initial) => {
  shared ??= prepare(assets);
  const { device, format, sk, pipeline } = await shared;
  const context = canvas.getContext("webgpu")!;
  context.configure({ device, format, alphaMode: "premultiplied" });

  // Four vectors, the palette and the spine.
  const uniforms = new Float32Array((4 + STOPS + SAMPLES) * 4);
  const buffer = device.createBuffer({
    size: uniforms.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const fill = sk.paint();
  const stroke = sk.paint({ style: "stroke" });

  let layout = initial;
  // The two layers that Skia draws: behind the ribbon and in front of it.
  let layers: { texture: GPUTexture; surface: Surface }[] = [];
  let bindings: GPUBindGroup | null = null;
  let started = performance.now();
  let request = 0;
  let timer = 0;
  let alive = true;

  // What Skia draws: every element of the page, where the page has it. An
  // element goes under the ribbon, unless it is marked to stay in front of
  // it: as a whole, or for a part of its text.
  const drawPage = () => {
    const [under, over] = layers.map(({ surface }) => surface.getCanvas());
    for (const item of layout.items) {
      const layer = item.onTop ? over : under;
      const radius = Math.min(item.radius, item.height / 2);
      if (item.background[3] > 0) {
        fill.color = item.background;
        layer.drawRoundedRect(
          item.x,
          item.y,
          item.width,
          item.height,
          radius,
          fill
        );
      }
      if (item.borderWidth > 0 && item.border[3] > 0) {
        const inset = item.borderWidth / 2;
        stroke.color = item.border;
        stroke.strokeWidth = item.borderWidth;
        layer.drawRoundedRect(
          item.x + inset,
          item.y + inset,
          item.width - item.borderWidth,
          item.height - item.borderWidth,
          Math.max(radius - inset, 0),
          stroke
        );
      }
      if (item.text === "") {
        continue;
      }
      const paragraph = sk.paragraph(item.text, {
        color: item.color,
        fontFamilies: ["Roboto"],
        fontSize: item.fontSize,
        fontWeight: item.fontWeight,
        align: "center",
      });
      // One line on the page stays one line here, even if this font runs
      // wider than the one of the page.
      const oneLine = item.height < item.fontSize * 2.5;
      paragraph.layout(1e5);
      const width = oneLine
        ? Math.max(item.width, Math.ceil(paragraph.maxIntrinsicWidth) + 2)
        : item.width;
      paragraph.layout(width);
      const x = item.x + (item.width - width) / 2;
      const y = item.y + (item.height - paragraph.height) / 2;
      const start = item.front === "" ? -1 : item.text.indexOf(item.front);
      if (start < 0) {
        layer.drawParagraph(paragraph, x, y);
      } else {
        // The paragraph says where the word is. Both layers draw the whole
        // paragraph, one clipped to that box and the other to what is
        // outside of it: the word keeps the spacing it has in its line.
        const word = sk.path();
        for (const box of paragraph.rectsForRange(
          start,
          start + item.front.length
        )) {
          // Wide and tall enough for what glyphs draw outside of their
          // boxes, on the sides where nothing else is.
          const before = start === 0 ? item.fontSize : 0;
          word.addRect(
            x + box.x - before,
            y + box.y - item.fontSize,
            box.width + before,
            box.height + 2 * item.fontSize
          );
        }
        over.save();
        over.clipPath(word);
        over.drawParagraph(paragraph, x, y);
        over.restore();
        under.save();
        under.clipPath(word, "difference");
        under.drawParagraph(paragraph, x, y);
        under.restore();
        word.dispose();
      }
      paragraph.dispose();
    }
    layers.forEach(({ surface }) => surface.flush());
  };

  // The spine of the ribbon, the palette and the light, for this layout.
  const writeScene = (width: number, height: number) => {
    const scale = Math.min(height / DESIGN_HEIGHT, width / DESIGN_WIDTH);
    const look = layout.dark ? looks.dark : looks.light;
    uniforms.set([RIBBON_WIDTH * scale, 0, 0, layout.pixelRatio], 0);
    uniforms.set([...LIGHT, look.depth], 4);
    uniforms.set([...look.shadow, look.sheen], 8);
    uniforms.set([...look.highlight, 0], 12);
    look.colors.forEach((color, i) => {
      uniforms.set(srgbToOklab(color), 16 + i * 4);
    });
    // A Catmull-Rom spline through the waypoints, as cubics. The first and
    // the last one only steer the end tangents.
    const points = waypoints(width, height, scale);
    const spine = sk.path().moveTo(points[1][0], points[1][1]);
    for (let i = 1; i < points.length - 2; i++) {
      const [p0, p1, p2, p3] = points.slice(i - 1, i + 3);
      spine.cubicTo(
        p1[0] + (p2[0] - p0[0]) / 6,
        p1[1] + (p2[1] - p0[1]) / 6,
        p2[0] - (p3[0] - p1[0]) / 6,
        p2[1] - (p3[1] - p1[1]) / 6,
        p2[0],
        p2[1]
      );
    }
    // Skia measures the path: points at even distances along it.
    const { length } = spine;
    for (let i = 0; i < SAMPLES; i++) {
      const at = spine.pointAt(
        Math.min((i / (SAMPLES - 1)) * length, length - 0.01)
      )!;
      uniforms.set([at.x, at.y], (4 + STOPS + i) * 4);
    }
    spine.dispose();
  };

  const render = () => {
    const elapsed = performance.now() - started;
    const drawn = layout.still ? 1 : reveal(elapsed);
    uniforms[1] = drawn * (SAMPLES - 1);
    uniforms[2] = layout.still ? 0 : elapsed / DRIFT_MS;
    device.queue.writeBuffer(buffer, 0, uniforms);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: [0, 0, 0, 0],
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindings);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    return drawn < 1;
  };

  // Every frame while the ribbon draws itself; then now and then, for the
  // slow drift of its colors.
  const loop = () => {
    if (!alive) {
      return;
    }
    if (render()) {
      request = requestAnimationFrame(loop);
    } else if (!layout.still) {
      timer = window.setTimeout(() => {
        request = requestAnimationFrame(loop);
      }, 100);
    }
  };

  const update = (next: HeroLayout) => {
    layout = next;
    const width = Math.max(1, Math.round(next.width * next.pixelRatio));
    const height = Math.max(1, Math.round(next.height * next.pixelRatio));
    if (canvas.width !== width || canvas.height !== height || !bindings) {
      canvas.width = width;
      canvas.height = height;
      layers.forEach(({ texture }) => texture.destroy());
      layers = [0, 1].map(() => {
        const texture = device.createTexture({
          size: [width, height],
          format: "rgba8unorm",
          usage:
            GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        // Skia draws to a texture of the page as it does to a canvas, in
        // the units of the page: CSS pixels.
        return {
          texture,
          surface: sk.makeSurface(texture, { pixelRatio: next.pixelRatio }),
        };
      });
      bindings = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer } },
          { binding: 1, resource: layers[0].texture.createView() },
          { binding: 2, resource: layers[1].texture.createView() },
        ],
      });
    }
    drawPage();
    writeScene(width, height);
    cancelAnimationFrame(request);
    clearTimeout(timer);
    loop();
  };

  started = performance.now();
  update(initial);

  const hero: Hero = {
    update,
    destroy: () => {
      alive = false;
      cancelAnimationFrame(request);
      clearTimeout(timer);
      layers.forEach(({ texture }) => texture.destroy());
      buffer.destroy();
      fill.dispose();
      stroke.dispose();
    },
  };
  return hero;
};
