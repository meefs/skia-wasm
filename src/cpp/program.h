/*
 * A display list: an immutable program, and instances that pair it with a
 * data block. Drawing is a function of the program, the data and the
 * resources; nothing else is kept between frames but caches of derived
 * objects.
 */
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "include/core/SkCanvas.h"
#include "include/core/SkData.h"
#include "include/core/SkPath.h"
#include "include/core/SkRefCnt.h"
#include "include/core/SkShader.h"

#include "layout.h"
#include "resources.h"

namespace skwasm {

class Program final : public SkRefCnt {
 public:
  // Checks every command, offset and index once, so that the player does not
  // have to. `words` is the block src/ts/builder.ts encodes; `imports` are
  // handles of context resources, which the program retains.
  static sk_sp<Program> Make(const uint32_t* words,
                             size_t count,
                             const uint32_t* imports,
                             size_t importCount,
                             const Store& store);

  uint32_t dataWords = 0;
  std::vector<uint32_t> commands;
  std::vector<uint32_t> initialData;
  // Context resources, retained: releasing their handles is safe.
  std::vector<sk_sp<Resource>> imports;
  // Owned by the program.
  std::vector<SkPath> paths;
  std::vector<ShaderDeclData> shaders;
  std::vector<PathBufferDeclData> pathBuffers;
  std::vector<SlotDeclData> slots;

 private:
  Program() = default;
};

class Instance {
 public:
  explicit Instance(sk_sp<Program> program);
  ~Instance();
  Instance(const Instance&) = delete;
  Instance& operator=(const Instance&) = delete;

  // What JavaScript writes to: `program->dataWords` words.
  uint32_t* data() const { return fData; }

  // Slots are resolved through the store; everything else is in the instance.
  void play(SkCanvas* canvas, const Store& store);

 private:
  // A derived object and a copy of the data it was derived from. It is
  // rebuilt when the data no longer matches the copy, whoever wrote it.
  struct ShaderCache {
    sk_sp<SkData> key;
    sk_sp<SkShader> shader;
  };
  struct PathCache {
    std::vector<uint32_t> key;
    SkPath path;
    bool valid = false;
  };
  // What a slot pointed to the last time it was read, retained.
  struct SlotCache {
    uint32_t handle = 0;
    sk_sp<Resource> resource;
  };

  void makePaint(uint32_t offset, SkPaint* paint);
  sk_sp<SkShader> shader(uint32_t index);
  const SkPath& pathBuffer(uint32_t index);
  SkImage* slotImage(uint32_t index, const Store& store);

  sk_sp<Program> fProgram;
  uint32_t* fData;
  std::vector<ShaderCache> fShaders;
  std::vector<PathCache> fPaths;
  std::vector<SlotCache> fSlots;
  std::vector<SkPathVerb> fVerbs;
};

}  // namespace skwasm
