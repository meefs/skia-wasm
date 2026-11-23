#include "context.h"

#include <utility>

#include <emscripten/emscripten.h>

#include "include/core/SkColorSpace.h"
#include "include/core/SkString.h"
#include "include/gpu/graphite/BackendTexture.h"
#include "include/gpu/graphite/ContextOptions.h"
#include "include/gpu/graphite/GraphiteTypes.h"
#include "include/gpu/graphite/Recording.h"
#include "include/gpu/graphite/Surface.h"
#include "include/gpu/graphite/dawn/DawnBackendContext.h"
#include "include/gpu/graphite/dawn/DawnGraphiteTypes.h"

// WebGPU.importJsDevice and importJsTexture, which the page calls, create
// their C++ counterparts through these.
EM_JS_DEPS(skwasm,
           "$WebGPU,emwgpuCreateDevice,emwgpuCreateQueue,emwgpuCreateTexture");

namespace skwasm {

namespace {

std::string gError;
Context* gContext = nullptr;

}  // namespace

void setError(std::string message) { gError = std::move(message); }
const char* lastError() { return gError.c_str(); }

EffectResource::~EffectResource() {
  if (Context* context = Context::Get()) {
    context->forgetEffect(this);
  }
}

Context* Context::Get() { return gContext; }

bool Context::Init(WGPUDevice cDevice) {
  wgpu::Device device = wgpu::Device::Acquire(cDevice);
  if (gContext) {
    setError("The module already has a context.");
    return false;
  }
  skgpu::graphite::DawnBackendContext backendContext;
  backendContext.fInstance = wgpu::CreateInstance();
  backendContext.fDevice = device;
  backendContext.fQueue = device.GetQueue();
  // fTick stays null: without Asyncify or JSPI nothing can wait on the GPU, so
  // Graphite never blocks and work completes from the browser's event loop.
  std::unique_ptr<Context> context(new Context());
  context->fContext = skgpu::graphite::ContextFactory::MakeDawn(
      backendContext, skgpu::graphite::ContextOptions());
  if (!context->fContext) {
    setError("Graphite did not create a context on the device.");
    return false;
  }
  context->fRecorder = context->fContext->makeRecorder();
  if (!context->fRecorder) {
    setError("Graphite did not create a recorder.");
    return false;
  }
  gContext = context.release();
  return true;
}

sk_sp<EffectResource> Context::effect(const char* sksl) {
  std::string source(sksl);
  auto found = fEffects.find(source);
  if (found != fEffects.end()) {
    return sk_ref_sp(const_cast<EffectResource*>(found->second));
  }
  auto result = SkRuntimeEffect::MakeForShader(SkString(sksl));
  if (!result.effect) {
    setError(std::string(result.errorText.c_str()));
    return nullptr;
  }
  auto resource =
      sk_make_sp<EffectResource>(std::move(result.effect), source);
  fEffects.emplace(std::move(source), resource.get());
  return resource;
}

void Context::forgetEffect(const EffectResource* effect) {
  auto found = fEffects.find(effect->source());
  if (found != fEffects.end() && found->second == effect) {
    fEffects.erase(found);
  }
}

bool Context::submit() {
  std::unique_ptr<skgpu::graphite::Recording> recording = fRecorder->snap();
  if (!recording) {
    setError("Graphite did not snap a recording.");
    return false;
  }
  skgpu::graphite::InsertRecordingInfo info;
  info.fRecording = recording.get();
  if (fContext->insertRecording(info) !=
      skgpu::graphite::InsertStatus::kSuccess) {
    setError("Graphite did not insert the recording.");
    return false;
  }
  if (!fContext->submit()) {
    setError("Graphite did not submit the recording.");
    return false;
  }
  return true;
}

bool Context::tick() {
  fContext->checkAsyncWorkCompletion();
  return fContext->hasUnfinishedGpuWork();
}

}  // namespace skwasm
