#include "program.h"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <optional>
#include <utility>

#include "include/core/SkColorSpace.h"
#include "include/core/SkMatrix.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPathTypes.h"
#include "include/core/SkPoint.h"
#include "include/core/SkRRect.h"
#include "include/core/SkRect.h"
#include "include/core/SkSamplingOptions.h"
#include "include/core/SkSpan.h"
#include "include/core/SkTileMode.h"
#include "include/effects/SkGradient.h"
#include "include/utils/SkParsePath.h"

#include "context.h"

namespace skwasm {

namespace {

using format::Op;

constexpr uint32_t kMaxGradientStops = 16;

sk_sp<Program> fail(const char* message) {
  setError(message);
  return nullptr;
}

uint32_t expectedWords(Op op) {
  switch (op) {
    case Op::kSave:
      return format::kOpWordsSave;
    case Op::kRestore:
      return format::kOpWordsRestore;
    case Op::kConcat:
      return format::kOpWordsConcat;
    case Op::kClipRect:
      return format::kOpWordsClipRect;
    case Op::kDrawRect:
      return format::kOpWordsDrawRect;
    case Op::kDrawRRect:
      return format::kOpWordsDrawRRect;
    case Op::kDrawPath:
      return format::kOpWordsDrawPath;
    case Op::kDrawPathBuffer:
      return format::kOpWordsDrawPathBuffer;
    case Op::kDrawImage:
      return format::kOpWordsDrawImage;
    case Op::kDrawImageSlot:
      return format::kOpWordsDrawImageSlot;
  }
  // An opcode this player does not know: skipped by its size.
  return 0;
}

inline SkRect toRect(const RectData& rect) {
  return SkRect::MakeXYWH(rect.x, rect.y, rect.width, rect.height);
}

}  // namespace

sk_sp<Program> Program::Make(const uint32_t* words,
                             size_t count,
                             const uint32_t* importHandles,
                             size_t importCount,
                             const Store& store) {
  if (count < format::kHeaderWords || words[format::kHeaderMagic] != format::kMagic) {
    return fail("Not a display list program.");
  }
  if (words[format::kHeaderVersion] != format::kVersion) {
    return fail("Unsupported display list version.");
  }
  if (words[format::kHeaderImportCount] != importCount) {
    return fail("The program does not match its imports.");
  }
  sk_sp<Program> program(new Program());
  const uint32_t dataWords = words[format::kHeaderDataWords];
  program->dataWords = dataWords;
  // A block of `size` words at `offset` lies within the data block.
  const auto inData = [dataWords](uint32_t offset, uint32_t size) {
    return offset >= format::kReservedWords && offset <= dataWords &&
           size <= dataWords - offset;
  };

  size_t cursor = format::kHeaderWords;
  // Whether `size` more words can be read; 64 bits, so no sum overflows.
  const auto has = [&cursor, count](uint64_t size) {
    return static_cast<uint64_t>(cursor) + size <= count;
  };

  for (uint32_t i = 0; i < importCount; i++) {
    Resource* resource = store.get(importHandles[i]);
    if (!resource) {
      return fail("The program imports a released resource.");
    }
    program->imports.push_back(sk_ref_sp(resource));
  }

  for (uint32_t i = 0; i < words[format::kHeaderPathCount]; i++) {
    if (!has(1)) {
      return fail("Truncated program.");
    }
    const uint32_t bytes = words[cursor++];
    const uint64_t pathWords = (static_cast<uint64_t>(bytes) + 3) / 4;
    if (!has(pathWords)) {
      return fail("Truncated program.");
    }
    const std::string svg(reinterpret_cast<const char*>(words + cursor), bytes);
    cursor += pathWords;
    std::optional<SkPath> path = SkParsePath::FromSVGString(svg.c_str());
    if (!path) {
      return fail("A path of the program is not a valid SVG path.");
    }
    program->paths.push_back(std::move(*path));
  }

  const uint32_t shaderCount = words[format::kHeaderShaderCount];
  if (!has(static_cast<uint64_t>(shaderCount) * format::kShaderDeclWords)) {
    return fail("Truncated program.");
  }
  for (uint32_t i = 0; i < shaderCount; i++) {
    ShaderDeclData decl;
    memcpy(&decl, words + cursor, sizeof(decl));
    cursor += format::kShaderDeclWords;
    if (!inData(decl.dataOffset, decl.dataWords)) {
      return fail("A shader reads outside of the data block.");
    }
    if (decl.kind == format::kShaderKindRuntimeEffect) {
      if (decl.arg >= importCount ||
          program->imports[decl.arg]->type() != Resource::Type::kEffect) {
        return fail("A shader does not refer to an effect.");
      }
      const SkRuntimeEffect* effect =
          static_cast<EffectResource*>(program->imports[decl.arg].get())
              ->effect();
      if (effect->uniformSize() != decl.dataWords * sizeof(uint32_t)) {
        return fail("A shader does not match the uniforms of its effect.");
      }
      if (!effect->children().empty()) {
        return fail("Effects with children are not supported.");
      }
    } else if (decl.kind == format::kShaderKindLinearGradient) {
      if (decl.arg < 2 || decl.arg > kMaxGradientStops ||
          decl.dataWords != format::kLinearGradientColors + 4 * decl.arg) {
        return fail("Invalid linear gradient.");
      }
    } else {
      return fail("Unknown kind of shader.");
    }
    program->shaders.push_back(decl);
  }

  const uint32_t pathBufferCount = words[format::kHeaderPathBufferCount];
  if (!has(static_cast<uint64_t>(pathBufferCount) *
           format::kPathBufferDeclWords)) {
    return fail("Truncated program.");
  }
  for (uint32_t i = 0; i < pathBufferCount; i++) {
    PathBufferDeclData decl;
    memcpy(&decl, words + cursor, sizeof(decl));
    cursor += format::kPathBufferDeclWords;
    const uint64_t size = static_cast<uint64_t>(format::kPathBufferVerbs) +
                          decl.maxVerbs + 2 * static_cast<uint64_t>(decl.maxPoints);
    if (size > dataWords || !inData(decl.dataOffset, static_cast<uint32_t>(size))) {
      return fail("A path buffer lies outside of the data block.");
    }
    program->pathBuffers.push_back(decl);
  }

  const uint32_t slotCount = words[format::kHeaderSlotCount];
  if (!has(static_cast<uint64_t>(slotCount) * format::kSlotDeclWords)) {
    return fail("Truncated program.");
  }
  for (uint32_t i = 0; i < slotCount; i++) {
    SlotDeclData decl;
    memcpy(&decl, words + cursor, sizeof(decl));
    cursor += format::kSlotDeclWords;
    if (!inData(decl.dataOffset, 1)) {
      return fail("A slot lies outside of the data block.");
    }
    program->slots.push_back(decl);
  }

  const uint32_t commandWords = words[format::kHeaderCommandWords];
  if (!has(commandWords)) {
    return fail("Truncated program.");
  }
  const uint32_t* pc = words + cursor;
  const uint32_t* const end = pc + commandWords;
  int depth = 0;
  while (pc < end) {
    const uint32_t size = pc[0] >> 16;
    if (size == 0 || size > static_cast<size_t>(end - pc)) {
      return fail("A command has an invalid size.");
    }
    const Op op = static_cast<Op>(pc[0] & 0xFFFF);
    const uint32_t expected = expectedWords(op);
    if (size < expected) {
      return fail("A command is too short for its opcode.");
    }
    bool valid = true;
    // `expected` is 0 for an unknown opcode, which is not checked further.
    if (expected != 0) {
      switch (op) {
        case Op::kSave:
          depth++;
          break;
        case Op::kRestore:
          valid = depth-- > 0;
          break;
        case Op::kConcat:
          valid = inData(pc[1], format::kMatrixWords);
          break;
        case Op::kClipRect:
          valid = inData(pc[1], format::kRectWords);
          break;
        case Op::kDrawRect:
          valid = inData(pc[1], format::kRectWords) &&
                  inData(pc[2], format::kPaintWords);
          break;
        case Op::kDrawRRect:
          valid = inData(pc[1], format::kRRectWords) &&
                  inData(pc[2], format::kPaintWords);
          break;
        case Op::kDrawPath:
          valid = pc[1] < program->paths.size() &&
                  inData(pc[2], format::kPaintWords);
          break;
        case Op::kDrawPathBuffer:
          valid = pc[1] < program->pathBuffers.size() &&
                  inData(pc[2], format::kPaintWords);
          break;
        case Op::kDrawImage:
          valid = pc[1] < importCount &&
                  program->imports[pc[1]]->type() == Resource::Type::kImage &&
                  inData(pc[2], format::kRectWords);
          break;
        case Op::kDrawImageSlot:
          valid = pc[1] < program->slots.size() &&
                  inData(pc[2], format::kRectWords);
          break;
      }
    }
    if (!valid) {
      return fail("A command refers outside of the program or its data.");
    }
    pc += size;
  }
  program->commands.assign(words + cursor, words + cursor + commandWords);
  cursor += commandWords;

  if (!has(dataWords) || dataWords < format::kReservedWords) {
    return fail("The program has no initial data.");
  }
  program->initialData.assign(words + cursor, words + cursor + dataWords);
  return program;
}

Instance::Instance(sk_sp<Program> program)
    : fProgram(std::move(program)),
      fData(static_cast<uint32_t*>(
          malloc(fProgram->dataWords * sizeof(uint32_t)))),
      fShaders(fProgram->shaders.size()),
      fPaths(fProgram->pathBuffers.size()),
      fSlots(fProgram->slots.size()) {
  memcpy(fData, fProgram->initialData.data(),
         fProgram->dataWords * sizeof(uint32_t));
}

Instance::~Instance() { free(fData); }

sk_sp<SkShader> Instance::shader(uint32_t index) {
  if (index >= fShaders.size()) {
    return nullptr;
  }
  const ShaderDeclData& decl = fProgram->shaders[index];
  ShaderCache& cache = fShaders[index];
  const void* source = fData + decl.dataOffset;
  const size_t bytes = decl.dataWords * sizeof(uint32_t);
  if (cache.key && memcmp(cache.key->data(), source, bytes) == 0) {
    return cache.shader;
  }
  cache.key = SkData::MakeWithCopy(source, bytes);
  if (decl.kind == format::kShaderKindRuntimeEffect) {
    const SkRuntimeEffect* effect =
        static_cast<EffectResource*>(fProgram->imports[decl.arg].get())
            ->effect();
    // The copy that is the cache key is also what the shader reads.
    cache.shader = effect->makeShader(cache.key, {});
  } else {
    const float* values = static_cast<const float*>(cache.key->data());
    const SkPoint points[2] = {
        {values[format::kLinearGradientStart],
         values[format::kLinearGradientStart + 1]},
        {values[format::kLinearGradientEnd],
         values[format::kLinearGradientEnd + 1]}};
    SkColor4f colors[kMaxGradientStops];
    memcpy(colors, values + format::kLinearGradientColors,
           decl.arg * sizeof(SkColor4f));
    cache.shader = SkShaders::LinearGradient(
        points,
        SkGradient(SkGradient::Colors(SkSpan(colors, decl.arg),
                                      SkTileMode::kClamp),
                   SkGradient::Interpolation()));
  }
  return cache.shader;
}

const SkPath& Instance::pathBuffer(uint32_t index) {
  const PathBufferDeclData& decl = fProgram->pathBuffers[index];
  PathCache& cache = fPaths[index];
  const uint32_t* buffer = fData + decl.dataOffset;
  // The counts are data: whatever was written, the capacity bounds them.
  const uint32_t verbCount =
      std::min(buffer[format::kPathBufferVerbCount], decl.maxVerbs);
  const uint32_t pointCount =
      std::min(buffer[format::kPathBufferPointCount], decl.maxPoints);
  const uint32_t* verbs = buffer + format::kPathBufferVerbs;
  const uint32_t* points = verbs + decl.maxVerbs;
  const size_t verbBytes = verbCount * sizeof(uint32_t);
  const size_t pointBytes = pointCount * 2 * sizeof(float);
  const size_t keyWords = 2 + verbCount + 2 * pointCount;
  if (cache.valid && cache.key.size() == keyWords &&
      cache.key[0] == verbCount &&
      memcmp(cache.key.data() + 2, verbs, verbBytes) == 0 &&
      memcmp(cache.key.data() + 2 + verbCount, points, pointBytes) == 0) {
    return cache.path;
  }
  cache.key.resize(keyWords);
  cache.key[0] = verbCount;
  cache.key[1] = pointCount;
  memcpy(cache.key.data() + 2, verbs, verbBytes);
  memcpy(cache.key.data() + 2 + verbCount, points, pointBytes);
  cache.valid = true;

  fVerbs.resize(verbCount);
  bool known = true;
  for (uint32_t i = 0; i < verbCount; i++) {
    const uint32_t verb = verbs[i];
    known = known && (verb == format::kVerbMove || verb == format::kVerbLine ||
                      verb == format::kVerbQuad || verb == format::kVerbCubic ||
                      verb == format::kVerbClose);
    fVerbs[i] = static_cast<SkPathVerb>(verb);
  }
  // Raw() returns an empty path for a sequence of verbs that is not legal or
  // that needs more points than there are.
  cache.path =
      known ? SkPath::Raw(SkSpan(reinterpret_cast<const SkPoint*>(points),
                                 pointCount),
                          SkSpan(fVerbs.data(), verbCount), {},
                          SkPathFillType::kWinding, /*isVolatile=*/true)
            : SkPath();
  return cache.path;
}

SkImage* Instance::slotImage(uint32_t index, const Store& store) {
  SlotCache& cache = fSlots[index];
  const uint32_t handle = fData[fProgram->slots[index].dataOffset];
  if (handle != cache.handle) {
    // Rebound since the last frame: retain what it points to now. A handle
    // released before it was ever drawn resolves to nothing.
    cache.handle = handle;
    cache.resource = sk_ref_sp(store.get(handle));
  }
  if (!cache.resource || cache.resource->type() != Resource::Type::kImage) {
    return nullptr;
  }
  return static_cast<ImageResource*>(cache.resource.get())->image();
}

void Instance::makePaint(uint32_t offset, SkPaint* paint) {
  PaintData data;
  memcpy(&data, fData + offset, sizeof(data));
  paint->setAntiAlias(true);
  paint->setColor(
      SkColor4f{data.color[0], data.color[1], data.color[2], data.color[3]});
  if (data.style == format::kPaintStyleStroke) {
    paint->setStyle(SkPaint::kStroke_Style);
    paint->setStrokeWidth(data.strokeWidth);
  }
  if (data.blendMode != format::kBlendModeSrcOver &&
      data.blendMode <= format::kBlendModeLast) {
    paint->setBlendMode(static_cast<SkBlendMode>(data.blendMode));
  }
  if (data.shader != 0) {
    paint->setShader(this->shader(data.shader - 1));
  }
}

void Instance::play(SkCanvas* canvas, const Store& store) {
  const Program& program = *fProgram;
  const uint32_t* pc = program.commands.data();
  const uint32_t* const end = pc + program.commands.size();
  const SkSamplingOptions sampling(SkFilterMode::kLinear);
  // Program::Make() checked the commands; only the data is read here.
  const auto rectAt = [this](uint32_t offset) {
    RectData rect;
    memcpy(&rect, fData + offset, sizeof(rect));
    return toRect(rect);
  };

  const int saveCount = canvas->save();
  while (pc < end) {
    const uint32_t header = pc[0];
    switch (static_cast<Op>(header & 0xFFFF)) {
      case Op::kSave:
        canvas->save();
        break;
      case Op::kRestore:
        canvas->restore();
        break;
      case Op::kConcat: {
        const float* m = reinterpret_cast<const float*>(fData + pc[1]);
        canvas->concat(SkMatrix::MakeAll(m[0], m[1], m[2], m[3], m[4], m[5],
                                         m[6], m[7], m[8]));
        break;
      }
      case Op::kClipRect:
        canvas->clipRect(rectAt(pc[1]), /*doAntiAlias=*/true);
        break;
      case Op::kDrawRect: {
        SkPaint paint;
        this->makePaint(pc[2], &paint);
        canvas->drawRect(rectAt(pc[1]), paint);
        break;
      }
      case Op::kDrawRRect: {
        RRectData rrect;
        memcpy(&rrect, fData + pc[1], sizeof(rrect));
        SkPaint paint;
        this->makePaint(pc[2], &paint);
        canvas->drawRRect(
            SkRRect::MakeRectXY(SkRect::MakeXYWH(rrect.x, rrect.y, rrect.width,
                                                 rrect.height),
                                rrect.rx, rrect.ry),
            paint);
        break;
      }
      case Op::kDrawPath: {
        SkPaint paint;
        this->makePaint(pc[2], &paint);
        canvas->drawPath(program.paths[pc[1]], paint);
        break;
      }
      case Op::kDrawPathBuffer: {
        SkPaint paint;
        this->makePaint(pc[2], &paint);
        canvas->drawPath(this->pathBuffer(pc[1]), paint);
        break;
      }
      case Op::kDrawImage:
        canvas->drawImageRect(
            static_cast<ImageResource*>(program.imports[pc[1]].get())->image(),
            rectAt(pc[2]), sampling);
        break;
      case Op::kDrawImageSlot:
        if (SkImage* image = this->slotImage(pc[1], store)) {
          canvas->drawImageRect(image, rectAt(pc[2]), sampling);
        }
        break;
    }
    pc += header >> 16;
  }
  canvas->restoreToCount(saveCount);
}

}  // namespace skwasm
