/*
 * The structs the player reads out of a program and of a data block. Their
 * layout is defined in src/ts/format.ts; the static asserts below fail the
 * build when the two disagree.
 */
#pragma once

#include <cstddef>
#include <cstdint>

#include "generated/format.h"

namespace skwasm {

struct RectData {
  float x, y, width, height;
};

struct RRectData {
  float x, y, width, height, rx, ry;
};

struct PaintData {
  uint32_t style;
  float strokeWidth;
  uint32_t blendMode;
  uint32_t shader;
  float color[4];
};

struct ShaderDeclData {
  uint32_t kind, arg, dataOffset, dataWords;
};

struct PathBufferDeclData {
  uint32_t dataOffset, maxVerbs, maxPoints;
};

struct SlotDeclData {
  uint32_t dataOffset;
};

#define SKWASM_SIZE(Type, constant) \
  static_assert(sizeof(Type) == format::constant * sizeof(uint32_t))
#define SKWASM_FIELD(Type, field, constant) \
  static_assert(offsetof(Type, field) == format::constant * sizeof(uint32_t))

SKWASM_SIZE(RectData, kRectWords);
SKWASM_FIELD(RectData, x, kRectX);
SKWASM_FIELD(RectData, y, kRectY);
SKWASM_FIELD(RectData, width, kRectWidth);
SKWASM_FIELD(RectData, height, kRectHeight);

SKWASM_SIZE(RRectData, kRRectWords);
SKWASM_FIELD(RRectData, x, kRRectX);
SKWASM_FIELD(RRectData, y, kRRectY);
SKWASM_FIELD(RRectData, width, kRRectWidth);
SKWASM_FIELD(RRectData, height, kRRectHeight);
SKWASM_FIELD(RRectData, rx, kRRectRx);
SKWASM_FIELD(RRectData, ry, kRRectRy);

SKWASM_SIZE(PaintData, kPaintWords);
SKWASM_FIELD(PaintData, style, kPaintStyle);
SKWASM_FIELD(PaintData, strokeWidth, kPaintStrokeWidth);
SKWASM_FIELD(PaintData, blendMode, kPaintBlendMode);
SKWASM_FIELD(PaintData, shader, kPaintShader);
SKWASM_FIELD(PaintData, color, kPaintColor);

SKWASM_SIZE(ShaderDeclData, kShaderDeclWords);
SKWASM_FIELD(ShaderDeclData, kind, kShaderDeclKind);
SKWASM_FIELD(ShaderDeclData, arg, kShaderDeclArg);
SKWASM_FIELD(ShaderDeclData, dataOffset, kShaderDeclDataOffset);
SKWASM_FIELD(ShaderDeclData, dataWords, kShaderDeclDataWords);

SKWASM_SIZE(PathBufferDeclData, kPathBufferDeclWords);
SKWASM_FIELD(PathBufferDeclData, dataOffset, kPathBufferDeclDataOffset);
SKWASM_FIELD(PathBufferDeclData, maxVerbs, kPathBufferDeclMaxVerbs);
SKWASM_FIELD(PathBufferDeclData, maxPoints, kPathBufferDeclMaxPoints);

SKWASM_SIZE(SlotDeclData, kSlotDeclWords);
SKWASM_FIELD(SlotDeclData, dataOffset, kSlotDeclDataOffset);

#undef SKWASM_SIZE
#undef SKWASM_FIELD

}  // namespace skwasm
