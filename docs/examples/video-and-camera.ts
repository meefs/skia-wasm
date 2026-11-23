import { Skia } from "skia-wasm";
import type { ColorFilter } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({
  device,
  canvas: document.querySelector("canvas")!,
});

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

// Color matrices: each row gives R, G, B or A from those of the pixel.
const filters: Record<string, ColorFilter | null> = {
  None: null,
  Grayscale: sk.colorFilter.matrix([
    0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152, 0.0722, 0, 0, 0.2126, 0.7152,
    0.0722, 0, 0, 0, 0, 0, 1, 0,
  ]),
  Sepia: sk.colorFilter.matrix([
    0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131,
    0, 0, 0, 0, 0, 1, 0,
  ]),
  Invert: sk.colorFilter.matrix([
    -1, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, 1, 0,
  ]),
  Warm: sk.colorFilter.matrix([
    1.1, 0, 0, 0, 0.05, 0, 1, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 1, 0,
  ]),
  Cool: sk.colorFilter.matrix([
    0.8, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1.1, 0, 0.05, 0, 0, 0, 1, 0,
  ]),
};

// The pictures are drawn through one paint: its filter applies to both.
const picture = sk.paint();
const through = { paint: picture };
const border = sk.paint({ color: "white", style: "stroke", strokeWidth: 4 });

// A menu over the canvas picks the filter.
const menu = document.createElement("select");
menu.style.cssText = "position: absolute; top: 12px; left: 12px";
for (const name of Object.keys(filters)) {
  menu.add(new Option(name));
}
menu.addEventListener("change", () => {
  picture.colorFilter = filters[menu.value];
});
document.body.append(menu);

const filmHeight = 512 * film.aspect;
const insetHeight = 160 * camera.aspect;

const frame = (time: number) => {
  film.update();
  camera.update();

  const canvas = sk.surface.getCanvas();
  canvas.clear("black");
  // The film fills the width; the camera is a tilting picture in its corner.
  canvas.drawImage(
    film.image,
    0,
    (512 - filmHeight) / 2,
    512,
    filmHeight,
    through
  );
  canvas.rotate(0.1 * Math.sin(time / 1000), 400, 400);
  canvas.drawImage(
    camera.image,
    320,
    480 - insetHeight,
    160,
    insetHeight,
    through
  );
  canvas.drawRect(320, 480 - insetHeight, 160, insetHeight, border);
  sk.surface.flush();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
