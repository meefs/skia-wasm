/*
 * Typefaces, fonts, text blobs and paragraphs. There are no system fonts in
 * this build: every typeface comes from bytes.
 */
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include <emscripten/emscripten.h>

#include "include/core/SkCanvas.h"
#include "include/core/SkData.h"
#include "include/core/SkFont.h"
#include "include/core/SkFontMetrics.h"
#include "include/core/SkFontMgr.h"
#include "include/core/SkPaint.h"
#include "include/core/SkRSXform.h"
#include "include/core/SkString.h"
#include "include/core/SkTextBlob.h"
#include "include/core/SkTypeface.h"
#include "include/ports/SkFontMgr_empty.h"
#include "modules/skparagraph/include/FontCollection.h"
#include "modules/skparagraph/include/Paragraph.h"
#include "modules/skparagraph/include/ParagraphBuilder.h"
#include "modules/skparagraph/include/ParagraphStyle.h"
#include "modules/skparagraph/include/TextStyle.h"
#include "modules/skparagraph/include/TypefaceFontProvider.h"
#include "modules/skunicode/include/SkUnicode_libgrapheme.h"

#include "immediate.h"

namespace skwasm {

// What paragraphs look families up in: the typefaces that were registered.
struct ParagraphFonts {
  sk_sp<skia::textlayout::TypefaceFontProvider> provider =
      sk_make_sp<skia::textlayout::TypefaceFontProvider>();
  sk_sp<skia::textlayout::FontCollection> collection =
      sk_make_sp<skia::textlayout::FontCollection>();
  bool hasDefault = false;

  static ParagraphFonts& Get() {
    static ParagraphFonts* fonts = new ParagraphFonts();
    return *fonts;
  }
};

// Where functions that return a list of numbers leave it: the count, then
// the numbers.
inline std::vector<float> gList;

/*
 * A text style as floats, in this order: color (4), font size, weight,
 * width, slant, letter spacing, word spacing, height multiplier (0 for
 * none), decoration flags, decoration style, decoration thickness,
 * decoration color (4, alpha below 0 for the text color), background color
 * (4, alpha below 0 for none), half leading, shadow color (4, alpha below 0
 * for none), shadow dx, dy and blur.
 */
inline skia::textlayout::TextStyle textStyleOf(const float* s,
                                               const char* families,
                                               const SkPaint* foreground) {
  using namespace skia::textlayout;
  TextStyle style;
  if (foreground) {
    style.setForegroundPaint(*foreground);
  } else {
    style.setColor(SkColor4f{s[0], s[1], s[2], s[3]}.toSkColor());
  }
  style.setFontSize(s[4]);
  style.setFontStyle(SkFontStyle(static_cast<int>(s[5]),
                                 static_cast<int>(s[6]),
                                 static_cast<SkFontStyle::Slant>(s[7])));
  style.setLetterSpacing(s[8]);
  style.setWordSpacing(s[9]);
  if (s[10] > 0) {
    style.setHeight(s[10]);
    style.setHeightOverride(true);
  }
  style.setDecoration(static_cast<TextDecoration>(static_cast<int>(s[11])));
  style.setDecorationStyle(
      static_cast<TextDecorationStyle>(static_cast<int>(s[12])));
  style.setDecorationThicknessMultiplier(s[13]);
  style.setDecorationColor(s[17] < 0
                               ? SkColor4f{s[0], s[1], s[2], s[3]}.toSkColor()
                               : SkColor4f{s[14], s[15], s[16], s[17]}
                                     .toSkColor());
  if (s[21] >= 0) {
    SkPaint background;
    background.setColor(SkColor4f{s[18], s[19], s[20], s[21]});
    style.setBackgroundPaint(background);
  }
  style.setHalfLeading(s[22] != 0);
  if (s[26] >= 0) {
    style.addShadow(TextShadow(SkColor4f{s[23], s[24], s[25], s[26]}.toSkColor(),
                               {s[27], s[28]}, s[29]));
  }
  // Family names, separated by commas.
  std::vector<SkString> names;
  std::string list(families ? families : "");
  size_t start = 0;
  while (start <= list.size() && !list.empty()) {
    const size_t end = list.find(',', start);
    const std::string name = list.substr(
        start, end == std::string::npos ? std::string::npos : end - start);
    if (!name.empty()) {
      names.emplace_back(name.c_str());
    }
    if (end == std::string::npos) {
      break;
    }
    start = end + 1;
  }
  if (!names.empty()) {
    style.setFontFamilies(std::move(names));
  }
  return style;
}

}  // namespace skwasm

using skia::textlayout::Paragraph;
using skia::textlayout::ParagraphBuilder;

extern "C" {

// ---- Typefaces.

// The bytes of a font file, which are copied. Null if Skia cannot read them.
EMSCRIPTEN_KEEPALIVE SkTypeface* sk_typeface_from_data(const uint8_t* bytes,
                                                       size_t length) {
  static sk_sp<SkFontMgr> manager = SkFontMgr_New_Custom_Empty();
  sk_sp<SkTypeface> typeface =
      manager->makeFromData(SkData::MakeWithCopy(bytes, length));
  if (!typeface) {
    skwasm::setError("Not a font that Skia can read.");
  }
  return typeface.release();
}

// Valid until the next call.
EMSCRIPTEN_KEEPALIVE const char* sk_typeface_family(SkTypeface* typeface) {
  SkString name;
  typeface->getFamilyName(&name);
  skwasm::gText = name.c_str();
  return skwasm::gText.c_str();
}

// Makes a typeface available to paragraphs, under a family name or, if
// `family` is null, under its own.
EMSCRIPTEN_KEEPALIVE void sk_fonts_register(SkTypeface* typeface,
                                            const char* family) {
  skwasm::ParagraphFonts& fonts = skwasm::ParagraphFonts::Get();
  SkString name;
  if (family) {
    name = family;
    fonts.provider->registerTypeface(sk_ref_sp(typeface), name);
  } else {
    typeface->getFamilyName(&name);
    fonts.provider->registerTypeface(sk_ref_sp(typeface));
  }
  if (!fonts.hasDefault) {
    // Text that names no family, or an unknown one, uses the first font.
    fonts.collection->setDefaultFontManager(fonts.provider, name.c_str());
    fonts.hasDefault = true;
  }
  fonts.collection->clearCaches();
}

// ---- Fonts.

// `typeface` may be null: such a font draws nothing.
EMSCRIPTEN_KEEPALIVE SkFont* sk_font_new(SkTypeface* typeface, float size) {
  SkFont* font = new SkFont(sk_ref_sp(typeface), size);
  font->setSubpixel(true);
  font->setEdging(SkFont::Edging::kAntiAlias);
  return font;
}

EMSCRIPTEN_KEEPALIVE void sk_font_delete(SkFont* font) { delete font; }

EMSCRIPTEN_KEEPALIVE void sk_font_set_typeface(SkFont* font,
                                               SkTypeface* typeface) {
  font->setTypeface(sk_ref_sp(typeface));
}

EMSCRIPTEN_KEEPALIVE void sk_font_set_size(SkFont* font, float size) {
  font->setSize(size);
}

EMSCRIPTEN_KEEPALIVE void sk_font_set_scale_x(SkFont* font, float scale) {
  font->setScaleX(scale);
}

EMSCRIPTEN_KEEPALIVE void sk_font_set_skew_x(SkFont* font, float skew) {
  font->setSkewX(skew);
}

EMSCRIPTEN_KEEPALIVE void sk_font_set_embolden(SkFont* font, int embolden) {
  font->setEmbolden(embolden != 0);
}

EMSCRIPTEN_KEEPALIVE void sk_font_set_subpixel(SkFont* font, int subpixel) {
  font->setSubpixel(subpixel != 0);
}

// 0 aliased, 1 antialiased, 2 subpixel antialiased.
EMSCRIPTEN_KEEPALIVE void sk_font_set_edging(SkFont* font, int edging) {
  font->setEdging(static_cast<SkFont::Edging>(edging));
}

// Ascent, descent, leading, top, bottom, x height, cap height, average and
// maximum character width, underline position and thickness, strikeout
// position and thickness, then the recommended line spacing. Valid until the
// next call.
EMSCRIPTEN_KEEPALIVE const float* sk_font_metrics(const SkFont* font) {
  SkFontMetrics metrics;
  const float spacing = font->getMetrics(&metrics);
  float* r = skwasm::gResult;
  r[0] = metrics.fAscent;
  r[1] = metrics.fDescent;
  r[2] = metrics.fLeading;
  r[3] = metrics.fTop;
  r[4] = metrics.fBottom;
  r[5] = metrics.fXHeight;
  r[6] = metrics.fCapHeight;
  r[7] = metrics.fAvgCharWidth;
  r[8] = metrics.fMaxCharWidth;
  r[9] = metrics.fUnderlinePosition;
  r[10] = metrics.fUnderlineThickness;
  r[11] = metrics.fStrikeoutPosition;
  r[12] = metrics.fStrikeoutThickness;
  r[13] = spacing;
  return r;
}

// The advance of the text, then its bounds relative to where it starts: x,
// y, width and height. `paint` may be null; a stroke widens the bounds.
EMSCRIPTEN_KEEPALIVE const float* sk_font_measure_text(const SkFont* font,
                                                       const char* text,
                                                       int byteLength,
                                                       const SkPaint* paint) {
  SkRect bounds;
  float* r = skwasm::gResult;
  r[0] = font->measureText(text, byteLength, SkTextEncoding::kUTF8, &bounds,
                           paint);
  r[1] = bounds.x();
  r[2] = bounds.y();
  r[3] = bounds.width();
  r[4] = bounds.height();
  return r;
}

// Writes at most `capacity` glyph identifiers and returns how many the text
// has.
EMSCRIPTEN_KEEPALIVE int sk_font_glyphs(const SkFont* font,
                                        const char* text,
                                        int byteLength,
                                        uint16_t* glyphs,
                                        int capacity) {
  return static_cast<int>(font->textToGlyphs(
      text, byteLength, SkTextEncoding::kUTF8, SkSpan(glyphs, capacity)));
}

EMSCRIPTEN_KEEPALIVE void sk_font_glyph_widths(const SkFont* font,
                                               const uint16_t* glyphs,
                                               int count,
                                               float* widths) {
  font->getWidths(SkSpan(glyphs, count), SkSpan(widths, count));
}

// ---- Text blobs. One reference, given up with sk_text_blob_unref().

EMSCRIPTEN_KEEPALIVE SkTextBlob* sk_text_blob_from_text(const char* text,
                                                        int byteLength,
                                                        const SkFont* font) {
  return SkTextBlob::MakeFromText(text, byteLength, *font,
                                  SkTextEncoding::kUTF8)
      .release();
}

// One x, y pair per glyph.
EMSCRIPTEN_KEEPALIVE SkTextBlob* sk_text_blob_from_glyphs(
    const uint16_t* glyphs,
    const SkPoint* positions,
    int count,
    const SkFont* font) {
  return SkTextBlob::MakeFromPosGlyphs(SkSpan(glyphs, count),
                                       SkSpan(positions, count), *font)
      .release();
}

// One rotation, scale and translation per glyph, as four floats: the cosine
// and the sine of the angle times the scale, then the position.
EMSCRIPTEN_KEEPALIVE SkTextBlob* sk_text_blob_from_transforms(
    const uint16_t* glyphs,
    const SkRSXform* transforms,
    int count,
    const SkFont* font) {
  return SkTextBlob::MakeFromRSXformGlyphs(SkSpan(glyphs, count),
                                           SkSpan(transforms, count), *font)
      .release();
}

EMSCRIPTEN_KEEPALIVE void sk_text_blob_unref(SkTextBlob* blob) {
  SkSafeUnref(blob);
}

// ---- Paragraphs. Styles are floats: see textStyleOf().

// `align`: 0 left, 1 right, 2 center, 3 justify, 4 start, 5 end. `rtl`: the
// base direction. `maxLines`: 0 for no limit. `ellipsis` may be null.
EMSCRIPTEN_KEEPALIVE ParagraphBuilder* sk_paragraph_builder_new(
    int align,
    int rtl,
    int maxLines,
    const char* ellipsis,
    const float* style,
    const char* families,
    const SkPaint* foreground) {
  using namespace skia::textlayout;
  ParagraphStyle paragraphStyle;
  paragraphStyle.setTextAlign(static_cast<TextAlign>(align));
  paragraphStyle.setTextDirection(rtl ? TextDirection::kRtl
                                      : TextDirection::kLtr);
  if (maxLines > 0) {
    paragraphStyle.setMaxLines(maxLines);
  }
  if (ellipsis) {
    paragraphStyle.setEllipsis(SkString(ellipsis));
  }
  paragraphStyle.setTextStyle(skwasm::textStyleOf(style, families, foreground));
  static sk_sp<SkUnicode> unicode = SkUnicodes::Libgrapheme::Make();
  return ParagraphBuilder::make(paragraphStyle,
                                skwasm::ParagraphFonts::Get().collection,
                                unicode)
      .release();
}

EMSCRIPTEN_KEEPALIVE void sk_paragraph_builder_delete(
    ParagraphBuilder* builder) {
  delete builder;
}

EMSCRIPTEN_KEEPALIVE void sk_paragraph_builder_push(ParagraphBuilder* builder,
                                                    const float* style,
                                                    const char* families,
                                                    const SkPaint* foreground) {
  builder->pushStyle(skwasm::textStyleOf(style, families, foreground));
}

EMSCRIPTEN_KEEPALIVE void sk_paragraph_builder_pop(ParagraphBuilder* builder) {
  builder->pop();
}

EMSCRIPTEN_KEEPALIVE void sk_paragraph_builder_add_text(
    ParagraphBuilder* builder,
    const char* text,
    int byteLength) {
  builder->addText(text, byteLength);
}

EMSCRIPTEN_KEEPALIVE Paragraph* sk_paragraph_builder_build(
    ParagraphBuilder* builder) {
  return builder->Build().release();
}

EMSCRIPTEN_KEEPALIVE void sk_paragraph_delete(Paragraph* paragraph) {
  delete paragraph;
}

EMSCRIPTEN_KEEPALIVE void sk_paragraph_layout(Paragraph* paragraph,
                                              float width) {
  paragraph->layout(width);
}

// Height, longest line, width given to layout, minimum and maximum intrinsic
// widths, alphabetic and ideographic baselines, whether lines were cut, then
// the number of lines. Valid until the next call.
EMSCRIPTEN_KEEPALIVE const float* sk_paragraph_metrics(Paragraph* paragraph) {
  float* r = skwasm::gResult;
  r[0] = paragraph->getHeight();
  r[1] = paragraph->getLongestLine();
  r[2] = paragraph->getMaxWidth();
  r[3] = paragraph->getMinIntrinsicWidth();
  r[4] = paragraph->getMaxIntrinsicWidth();
  r[5] = paragraph->getAlphabeticBaseline();
  r[6] = paragraph->getIdeographicBaseline();
  r[7] = paragraph->didExceedMaxLines() ? 1 : 0;
  r[8] = static_cast<float>(paragraph->lineNumber());
  return r;
}

EMSCRIPTEN_KEEPALIVE void sk_paragraph_paint(Paragraph* paragraph,
                                             SkCanvas* canvas,
                                             float x,
                                             float y) {
  paragraph->paint(canvas, x, y);
}

// The boxes around a range of the text, in UTF-16 code units: a count, then
// x, y, width and height for each. Valid until the next call.
EMSCRIPTEN_KEEPALIVE const float* sk_paragraph_rects(Paragraph* paragraph,
                                                     int start,
                                                     int end) {
  using namespace skia::textlayout;
  const std::vector<TextBox> boxes = paragraph->getRectsForRange(
      start, end, RectHeightStyle::kTight, RectWidthStyle::kTight);
  std::vector<float>& list = skwasm::gList;
  list.clear();
  list.push_back(static_cast<float>(boxes.size()));
  for (const TextBox& box : boxes) {
    list.push_back(box.rect.x());
    list.push_back(box.rect.y());
    list.push_back(box.rect.width());
    list.push_back(box.rect.height());
  }
  return list.data();
}

// The index, in UTF-16 code units, of the text closest to a point.
EMSCRIPTEN_KEEPALIVE int sk_paragraph_position_at(Paragraph* paragraph,
                                                  float x,
                                                  float y) {
  return paragraph->getGlyphPositionAtCoordinate(x, y).position;
}

// A count, then for each line: where it starts and ends in the text, its
// left edge, width, height, baseline, ascent and descent. Valid until the
// next call.
EMSCRIPTEN_KEEPALIVE const float* sk_paragraph_lines(Paragraph* paragraph) {
  std::vector<skia::textlayout::LineMetrics> lines;
  paragraph->getLineMetrics(lines);
  std::vector<float>& list = skwasm::gList;
  list.clear();
  list.push_back(static_cast<float>(lines.size()));
  for (const skia::textlayout::LineMetrics& line : lines) {
    list.push_back(static_cast<float>(line.fStartIndex));
    list.push_back(static_cast<float>(line.fEndIndex));
    list.push_back(static_cast<float>(line.fLeft));
    list.push_back(static_cast<float>(line.fWidth));
    list.push_back(static_cast<float>(line.fHeight));
    list.push_back(static_cast<float>(line.fBaseline));
    list.push_back(static_cast<float>(line.fAscent));
    list.push_back(static_cast<float>(line.fDescent));
  }
  return list.data();
}

}  // extern "C"
