/*
 * The Graphite context of the module, on the GPUDevice of the page, and the
 * frame it is drawing. One module has one context.
 */
#pragma once

#include <memory>
#include <string>
#include <unordered_map>

#include <webgpu/webgpu_cpp.h>

#include "include/core/SkCanvas.h"
#include "include/core/SkColor.h"
#include "include/core/SkSurface.h"
#include "include/gpu/graphite/Context.h"
#include "include/gpu/graphite/Recorder.h"

#include "resources.h"

namespace skwasm {

void setError(std::string message);
const char* lastError();

// Milliseconds spent in each part of the last frame, when enabled.
struct Stats {
  double begin = 0;
  double play = 0;
  double end = 0;
};

class Context {
 public:
  // Null until Init() succeeded.
  static Context* Get();
  // Takes over the reference of a device made by WebGPU.importJsDevice().
  static bool Init(WGPUDevice device);

  skgpu::graphite::Recorder* recorder() const { return fRecorder.get(); }
  Store& store() { return fStore; }

  // Compiles an effect, or returns the live one compiled from the same source.
  sk_sp<EffectResource> effect(const char* sksl);
  void forgetEffect(const EffectResource* effect);

  // Wraps the texture (from WebGPU.importJsTexture(), reference taken over)
  // and clears it. The canvas is valid until endFrame().
  SkCanvas* beginFrame(WGPUTexture texture, const SkColor4f& clear);
  // Snaps what was drawn, inserts the recording and submits it.
  bool endFrame();
  // The same for everything recorded so far, whatever the surface: what the
  // surfaces of the immediate API call when they are flushed.
  bool submit();
  skgpu::graphite::Context* graphite() const { return fContext.get(); }
  // Lets Graphite notice finished GPU work. Returns whether some is pending.
  bool tick();

  bool statsEnabled = false;
  Stats stats;
  // For the benchmark: frames are drawn into a canvas that draws nothing, so
  // that what is measured is how the calls arrive, without Graphite.
  bool nullCanvas = false;

 private:
  Context() = default;

  std::unique_ptr<skgpu::graphite::Context> fContext;
  std::unique_ptr<skgpu::graphite::Recorder> fRecorder;
  Store fStore;
  std::unordered_map<std::string, const EffectResource*> fEffects;
  wgpu::Texture fFrameTexture;
  sk_sp<SkSurface> fFrameSurface;
  std::unique_ptr<SkCanvas> fNullCanvas;
  bool fNullFrame = false;
  double fFrameMark = 0;
};

}  // namespace skwasm
