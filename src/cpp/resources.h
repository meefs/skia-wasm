/*
 * Context resources: immutable Skia objects that JavaScript refers to by
 * number. It holds them through handles; what is made from a resource, a
 * shader for instance, holds a reference of its own, so releasing a handle
 * never invalidates it.
 */
#pragma once

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include <webgpu/webgpu_cpp.h>

#include "include/core/SkImage.h"
#include "include/core/SkRefCnt.h"
#include "include/effects/SkRuntimeEffect.h"

namespace skwasm {

class Resource : public SkRefCnt {
 public:
  enum class Type { kEffect, kImage };
  Type type() const { return fType; }

 protected:
  explicit Resource(Type type) : fType(type) {}

 private:
  const Type fType;
};

class EffectResource final : public Resource {
 public:
  EffectResource(sk_sp<SkRuntimeEffect> effect, std::string source)
      : Resource(Type::kEffect),
        fEffect(std::move(effect)),
        fSource(std::move(source)) {}
  // Leaves the table of interned effects.
  ~EffectResource() override;

  SkRuntimeEffect* effect() const { return fEffect.get(); }
  const std::string& source() const { return fSource; }

 private:
  sk_sp<SkRuntimeEffect> fEffect;
  std::string fSource;
};

class ImageResource final : public Resource {
 public:
  // `texture` is the one a wrapped image samples, kept alive with it.
  explicit ImageResource(sk_sp<SkImage> image, wgpu::Texture texture = nullptr)
      : Resource(Type::kImage),
        fImage(std::move(image)),
        fTexture(std::move(texture)) {}

  SkImage* image() const { return fImage.get(); }

 private:
  sk_sp<SkImage> fImage;
  wgpu::Texture fTexture;
};

/*
 * Maps handles to resources. A handle is an index and the generation of its
 * entry: a handle that outlived its release resolves to nothing instead of to
 * whatever reused the entry. Zero is never a handle.
 */
class Store {
 public:
  uint32_t add(sk_sp<Resource> resource) {
    uint32_t index;
    if (!fFree.empty()) {
      index = fFree.back();
      fFree.pop_back();
    } else {
      index = static_cast<uint32_t>(fEntries.size());
      if (index >= kIndexMask) {
        return 0;
      }
      fEntries.emplace_back();
    }
    fEntries[index].resource = std::move(resource);
    return makeHandle(index);
  }

  Resource* get(uint32_t handle) const {
    const uint32_t index = (handle & kIndexMask) - 1;
    if (handle == 0 || index >= fEntries.size() ||
        makeHandle(index) != handle) {
      return nullptr;
    }
    return fEntries[index].resource.get();
  }

  bool release(uint32_t handle) {
    if (!this->get(handle)) {
      return false;
    }
    const uint32_t index = (handle & kIndexMask) - 1;
    fEntries[index].resource.reset();
    fEntries[index].generation++;
    fFree.push_back(index);
    return true;
  }

 private:
  static constexpr uint32_t kIndexBits = 20;
  static constexpr uint32_t kIndexMask = (1u << kIndexBits) - 1;

  struct Entry {
    sk_sp<Resource> resource;
    uint32_t generation = 0;
  };

  uint32_t makeHandle(uint32_t index) const {
    return (fEntries[index].generation << kIndexBits) | (index + 1);
  }

  std::vector<Entry> fEntries;
  std::vector<uint32_t> fFree;
};

}  // namespace skwasm
