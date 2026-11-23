import { BlendMode, Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const canvas = document.querySelector("canvas")!;
const sk = await Skia.init({ device, canvas });

// A playing video element: from a file, or from a stream such as the camera.
const play = async (source: string | MediaStream) => {
  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  if (typeof source === "string") {
    video.src = source;
  } else {
    video.srcObject = source;
  }
  await video.play();
  return video;
};

// A texture that receives the frames of a video, wrapped once as an image.
const live = (video: HTMLVideoElement) => {
  const size = [video.videoWidth, video.videoHeight];
  const texture = device.createTexture({
    size,
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  return {
    image: sk.texture(texture, { opaque: true }),
    aspect: video.videoHeight / video.videoWidth,
    // Copies the current frame into the texture, on the GPU.
    update: () =>
      device.queue.copyExternalImageToTexture(
        { source: video },
        { texture },
        size
      ),
  };
};

const film = live(await play("video.mp4"));
const camera = live(
  await play(await navigator.mediaDevices.getUserMedia({ video: true }))
);

// There is no color filter in the prototype yet. A rect drawn over a picture
// with a blend mode does the basic ones, and a filter is then two values of
// a paint: its blend mode and its color.
interface Filter {
  blendMode: number;
  color: [number, number, number, number];
}
const filters: Record<string, Filter> = {
  None: { blendMode: BlendMode.SrcOver, color: [0, 0, 0, 0] },
  Grayscale: { blendMode: BlendMode.Saturation, color: [0.5, 0.5, 0.5, 1] },
  Sepia: { blendMode: BlendMode.Color, color: [0.6, 0.48, 0.36, 1] },
  Invert: { blendMode: BlendMode.Difference, color: [1, 1, 1, 1] },
  Warm: { blendMode: BlendMode.Multiply, color: [1, 0.85, 0.65, 1] },
  Cool: { blendMode: BlendMode.Multiply, color: [0.7, 0.85, 1, 1] },
};

// The film fills the width; the camera is a tilting picture in its corner.
const b = sk.builder();
const filter = b.paint({ color: filters.None.color });
const filmHeight = 512 * film.aspect;
const screen = b.rect({
  y: (512 - filmHeight) / 2,
  width: 512,
  height: filmHeight,
});
b.drawImage(film.image, screen);
b.drawRect(screen, filter);
const inset = b.rect({
  x: 320,
  y: 480 - 160 * camera.aspect,
  width: 160,
  height: 160 * camera.aspect,
});
const tilt = b.matrix();
b.save();
b.concat(tilt);
b.drawImage(camera.image, inset);
// The same paint: one write filters both pictures.
b.drawRect(inset, filter);
b.drawRect(inset, { color: "#ffffff", style: "stroke", strokeWidth: 4 });
b.restore();
const program = b.build({ tilt, filter });

const scene = program.instantiate();
sk.surface.setClearColor(0, 0, 0);

// A menu over the canvas picks the filter.
const menu = document.createElement("select");
menu.style.cssText = "position: absolute; top: 12px; left: 12px";
for (const name of Object.keys(filters)) {
  menu.add(new Option(name));
}
menu.addEventListener("change", () => {
  const { blendMode, color } = filters[menu.value];
  scene.values.filter.blendMode = blendMode;
  scene.values.filter.color.set(...color);
});
document.body.append(menu);

const frame = (time: number) => {
  film.update();
  camera.update();
  scene.values.tilt.setRotate(0.1 * Math.sin(time / 1000), 400, 400);
  sk.surface.draw(scene);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
