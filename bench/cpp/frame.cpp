#include "frame.h"

#include <emscripten/emscripten.h>
#include <webgpu/webgpu_cpp.h>

#include "context.h"

namespace bench {

SkCanvas* gCanvas = nullptr;

}  // namespace bench

extern "C" {

// The first half of sk_draw(): wraps and clears the texture.
EMSCRIPTEN_KEEPALIVE int bench_begin(WGPUTexture texture,
                                     float r,
                                     float g,
                                     float b,
                                     float a) {
  bench::gCanvas =
      skwasm::Context::Get()->beginFrame(texture, SkColor4f{r, g, b, a});
  return bench::gCanvas ? 1 : 0;
}

// The second half: snaps, inserts and submits.
EMSCRIPTEN_KEEPALIVE int bench_end() {
  bench::gCanvas = nullptr;
  return skwasm::Context::Get()->endFrame() ? 1 : 0;
}

}  // extern "C"
