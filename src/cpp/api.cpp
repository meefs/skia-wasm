/*
 * The functions the TypeScript side calls. Plain C exports: numbers and
 * pointers in, numbers and pointers out, no wrapper objects.
 */
#include <cstdint>
#include <string>

#include <emscripten/emscripten.h>
#include <webgpu/webgpu_cpp.h>

#include "include/core/SkColorSpace.h"
#include "include/core/SkData.h"
#include "include/gpu/graphite/BackendTexture.h"
#include "include/gpu/graphite/Image.h"
#include "include/gpu/graphite/dawn/DawnGraphiteTypes.h"

#include "context.h"
#include "program.h"

using skwasm::Context;
using skwasm::Instance;
using skwasm::Program;

namespace {

std::string gDescription;

const char* uniformType(SkRuntimeEffect::Uniform::Type type) {
  using Type = SkRuntimeEffect::Uniform::Type;
  switch (type) {
    case Type::kFloat:
      return "float";
    case Type::kFloat2:
      return "float2";
    case Type::kFloat3:
      return "float3";
    case Type::kFloat4:
      return "float4";
    case Type::kFloat2x2:
      return "float2x2";
    case Type::kFloat3x3:
      return "float3x3";
    case Type::kFloat4x4:
      return "float4x4";
    case Type::kInt:
      return "int";
    case Type::kInt2:
      return "int2";
    case Type::kInt3:
      return "int3";
    case Type::kInt4:
      return "int4";
  }
  return "unknown";
}

uint32_t addImage(sk_sp<SkImage> image, wgpu::Texture texture = nullptr) {
  if (!image) {
    skwasm::setError("Graphite did not create the image.");
    return 0;
  }
  return Context::Get()->store().add(
      sk_make_sp<skwasm::ImageResource>(std::move(image), std::move(texture)));
}

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE int sk_init(WGPUDevice device) {
  return Context::Init(device) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE const char* sk_last_error() {
  return skwasm::lastError();
}

// ---- Context resources. A handle is one reference, given up by
// sk_resource_release(). Zero is a failure: see sk_last_error().

EMSCRIPTEN_KEEPALIVE uint32_t sk_effect_create(const char* sksl) {
  sk_sp<skwasm::EffectResource> effect = Context::Get()->effect(sksl);
  return effect ? Context::Get()->store().add(std::move(effect)) : 0;
}

// The uniforms and the children of an effect as JSON, valid until the next
// call.
EMSCRIPTEN_KEEPALIVE const char* sk_effect_describe(uint32_t handle) {
  skwasm::Resource* resource = Context::Get()->store().get(handle);
  if (!resource || resource->type() != skwasm::Resource::Type::kEffect) {
    return nullptr;
  }
  const SkRuntimeEffect* effect =
      static_cast<skwasm::EffectResource*>(resource)->effect();
  gDescription = "{\"size\":" + std::to_string(effect->uniformSize()) +
                 ",\"uniforms\":[";
  bool first = true;
  for (const SkRuntimeEffect::Uniform& uniform : effect->uniforms()) {
    gDescription += first ? "" : ",";
    first = false;
    gDescription += "{\"name\":\"" + std::string(uniform.name) +
                    "\",\"type\":\"" + uniformType(uniform.type) +
                    "\",\"offset\":" + std::to_string(uniform.offset) +
                    ",\"count\":" + std::to_string(uniform.count) +
                    ",\"size\":" + std::to_string(uniform.sizeInBytes()) + "}";
  }
  gDescription += "],\"children\":[";
  first = true;
  for (const SkRuntimeEffect::Child& child : effect->children()) {
    gDescription += first ? "" : ",";
    first = false;
    gDescription += "\"" + std::string(child.name) + "\"";
  }
  gDescription += "]}";
  return gDescription.c_str();
}

// Decodes an encoded image and uploads it: Graphite only draws GPU images.
EMSCRIPTEN_KEEPALIVE uint32_t sk_image_decode(const uint8_t* bytes,
                                              size_t length) {
  sk_sp<SkImage> decoded =
      SkImages::DeferredFromEncodedData(SkData::MakeWithCopy(bytes, length));
  if (!decoded) {
    skwasm::setError("The image could not be decoded.");
    return 0;
  }
  return addImage(
      SkImages::TextureFromImage(Context::Get()->recorder(), decoded.get()));
}

// `texture` comes from WebGPU.importJsTexture(); its reference is taken over.
EMSCRIPTEN_KEEPALIVE uint32_t sk_image_from_texture(WGPUTexture cTexture,
                                                    int opaque) {
  wgpu::Texture texture = wgpu::Texture::Acquire(cTexture);
  return addImage(
      SkImages::WrapTexture(
          Context::Get()->recorder(),
          skgpu::graphite::BackendTextures::MakeDawn(texture.Get()),
          opaque ? kOpaque_SkAlphaType : kPremul_SkAlphaType,
          SkColorSpace::MakeSRGB()),
      texture);
}

EMSCRIPTEN_KEEPALIVE void sk_resource_release(uint32_t handle) {
  Context::Get()->store().release(handle);
}

// ---- Programs and instances.

EMSCRIPTEN_KEEPALIVE Program* sk_program_create(const uint32_t* words,
                                                uint32_t count,
                                                const uint32_t* imports,
                                                uint32_t importCount) {
  return Program::Make(words, count, imports, importCount,
                       Context::Get()->store())
      .release();
}

// Gives up the reference of sk_program_create(). Instances keep the program.
EMSCRIPTEN_KEEPALIVE void sk_program_release(Program* program) {
  SkSafeUnref(program);
}

EMSCRIPTEN_KEEPALIVE Instance* sk_instance_create(Program* program) {
  return new Instance(sk_ref_sp(program));
}

EMSCRIPTEN_KEEPALIVE uint32_t* sk_instance_data(Instance* instance) {
  return instance->data();
}

EMSCRIPTEN_KEEPALIVE void sk_instance_release(Instance* instance) {
  delete instance;
}

// ---- Drawing.

// Clears the texture (from WebGPU.importJsTexture(), reference taken over),
// plays the instances in order, and submits.
EMSCRIPTEN_KEEPALIVE int sk_draw(WGPUTexture texture,
                                 float r,
                                 float g,
                                 float b,
                                 float a,
                                 Instance* const* instances,
                                 uint32_t count) {
  Context* context = Context::Get();
  SkCanvas* canvas = context->beginFrame(texture, SkColor4f{r, g, b, a});
  if (!canvas) {
    return 0;
  }
  for (uint32_t i = 0; i < count; i++) {
    instances[i]->play(canvas, context->store());
  }
  return context->endFrame() ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int sk_draw_one(WGPUTexture texture,
                                     float r,
                                     float g,
                                     float b,
                                     float a,
                                     Instance* instance) {
  return sk_draw(texture, r, g, b, a, &instance, 1);
}

EMSCRIPTEN_KEEPALIVE int sk_tick() { return Context::Get()->tick() ? 1 : 0; }

// ---- Measurements, for the benchmark.

EMSCRIPTEN_KEEPALIVE void sk_stats_enable(int enabled) {
  Context::Get()->statsEnabled = enabled != 0;
}

// Frames go to a canvas that draws nothing: see Context::nullCanvas.
EMSCRIPTEN_KEEPALIVE void sk_stats_null_canvas(int enabled) {
  Context::Get()->nullCanvas = enabled != 0;
}

// Three doubles: milliseconds of the last frame spent before, in and after
// the instances.
EMSCRIPTEN_KEEPALIVE const double* sk_stats() {
  return &Context::Get()->stats.begin;
}

}  // extern "C"
