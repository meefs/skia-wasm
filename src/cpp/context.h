/*
 * The Graphite context of the module, on the GPUDevice of the page. One
 * module has one context.
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

  // Snaps everything recorded so far, whatever the surface, inserts the
  // recording and submits it: what a surface does when it is flushed.
  bool submit();
  skgpu::graphite::Context* graphite() const { return fContext.get(); }
  // Lets Graphite notice finished GPU work. Returns whether some is pending.
  bool tick();

 private:
  Context() = default;

  std::unique_ptr<skgpu::graphite::Context> fContext;
  std::unique_ptr<skgpu::graphite::Recorder> fRecorder;
  Store fStore;
  std::unordered_map<std::string, const EffectResource*> fEffects;
};

}  // namespace skwasm
