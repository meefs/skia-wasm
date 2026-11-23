import { Skia } from "skia-wasm";

type Message = { canvas: OffscreenCanvas } | { x: number; y: number };

const pointer = { x: 256, y: 256 };

const start = async (canvas: OffscreenCanvas) => {
  // WebGPU is available in workers: the device is created here.
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter!.requestDevice();
  const sk = await Skia.init({ device, canvas });

  const effect = sk.effect<{ iTime: "f32"; iPointer: "vec2" }>(`
    uniform float iTime;
    uniform float2 iPointer;

    half4 main(float2 xy) {
      float d = distance(xy, iPointer);
      float ripple = 0.5 + 0.5 * cos(d / 12 - iTime * 4);
      float3 color = mix(
        float3(0.06, 0.09, 0.16),
        float3(0.23, 0.51, 0.96),
        ripple * exp(-d / 160)
      );
      return half4(color, 1);
    }
  `);

  const b = sk.builder();
  const shader = b.shader(effect);
  b.drawRect({ width: canvas.width, height: canvas.height }, { shader });
  const program = b.build({
    time: shader.uniforms.iTime,
    pointer: shader.uniforms.iPointer,
  });

  const scene = program.instantiate();
  // Workers that own a canvas have requestAnimationFrame too.
  const frame = (time: number) => {
    scene.values.time = time / 1000;
    scene.values.pointer.set(pointer.x, pointer.y);
    sk.surface.draw(scene);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

addEventListener("message", ({ data }: MessageEvent<Message>) => {
  if ("canvas" in data) {
    start(data.canvas);
  } else {
    pointer.x = data.x;
    pointer.y = data.y;
  }
});
