import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const sk = await Skia.init({
  device,
  canvas: document.querySelector("canvas")!,
});

// SkSL, compiled once. The type argument names the kind of each uniform.
const effect = sk.effect<{ iTime: "f32"; iResolution: "vec2" }>(`
  uniform float iTime;
  uniform float2 iResolution;

  half4 main(float2 xy) {
    float2 uv = xy / iResolution;
    float3 color = 0.5 + 0.5 * cos(iTime + uv.xyx + float3(0, 2, 4));
    return half4(color, 1);
  }
`);

const paint = sk.paint();

const frame = (time: number) => {
  // A shader holds the values of its uniforms: new values, new shader.
  const shader = effect.shader({
    iTime: time / 1000,
    iResolution: [512, 512],
  });
  paint.shader = shader;
  shader.dispose();

  const canvas = sk.surface.getCanvas();
  canvas.drawPaint(paint);
  sk.surface.flush();
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
