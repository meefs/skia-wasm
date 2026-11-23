import { Skia } from "skia-wasm";

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter!.requestDevice();
const canvas = document.querySelector("canvas")!;
const sk = await Skia.init({ device, canvas });

// The type argument names the kind of each uniform for the type checker.
const effect = sk.effect<{ iTime: "f32"; iResolution: "vec2" }>(`
  uniform float iTime;
  uniform float2 iResolution;

  half4 main(float2 xy) {
    float2 uv = xy / iResolution;
    float3 color = 0.5 + 0.5 * cos(iTime + uv.xyx + float3(0, 2, 4));
    return half4(color, 1);
  }
`);

const b = sk.builder();
// The uniforms live in the data block: each one is a slot.
const shader = b.shader(effect, { iResolution: [512, 512] });
b.drawRect({ width: 512, height: 512 }, { shader });
const program = b.build({ time: shader.uniforms.iTime });

const scene = program.instantiate();

const frame = (time: number) => {
  scene.values.time = time / 1000;
  sk.surface.draw(scene);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
