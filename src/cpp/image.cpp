/*
 * The immediate API: images. An image is a store handle, shared with the
 * display list. Pixels are read back asynchronously: nothing here can wait
 * for the GPU.
 */
#include <cstdint>
#include <cstring>
#include <unordered_map>
#include <vector>

#include <emscripten/emscripten.h>

#include "include/core/SkColorSpace.h"
#include "include/core/SkData.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkPixmap.h"
#include "include/encode/SkJpegEncoder.h"
#include "include/encode/SkPngEncoder.h"
#include "include/encode/SkWebpEncoder.h"
#include "include/gpu/graphite/Context.h"

#include "immediate.h"

namespace skwasm {

// The pixels of an image being read back: RGBA, unpremultiplied, row by row.
struct Readback {
  // 0 while the GPU has not answered, 1 once the pixels are here, 2 if the
  // read failed.
  int status = 0;
  int width = 0;
  int height = 0;
  std::vector<uint8_t> pixels;
};

inline std::unordered_map<uint32_t, Readback> gReadbacks;
inline uint32_t gNextReadback = 1;

}  // namespace skwasm

extern "C" {

// Width and height, valid until the next call. Null for a released handle.
EMSCRIPTEN_KEEPALIVE const float* sk_image_size(uint32_t handle) {
  sk_sp<SkImage> image = skwasm::imageOf(handle);
  if (!image) {
    return nullptr;
  }
  skwasm::gResult[0] = image->width();
  skwasm::gResult[1] = image->height();
  return skwasm::gResult;
}

// Asks for the pixels of an image. Returns the identifier of the request, to
// poll with sk_readback_status() after sk_tick(), or zero.
EMSCRIPTEN_KEEPALIVE uint32_t sk_image_read_pixels(uint32_t handle) {
  sk_sp<SkImage> image = skwasm::imageOf(handle);
  if (!image) {
    skwasm::setError("The image was released.");
    return 0;
  }
  skwasm::Context* context = skwasm::Context::Get();
  // What the image shows may still be waiting in the recorder.
  if (!context->submit()) {
    return 0;
  }
  const uint32_t id = skwasm::gNextReadback++;
  skwasm::Readback& readback = skwasm::gReadbacks[id];
  readback.width = image->width();
  readback.height = image->height();
  const SkImageInfo info =
      SkImageInfo::Make(image->width(), image->height(),
                        kRGBA_8888_SkColorType, kUnpremul_SkAlphaType,
                        SkColorSpace::MakeSRGB());
  context->graphite()->asyncRescaleAndReadPixels(
      image.get(), info, SkIRect::MakeWH(image->width(), image->height()),
      SkImage::RescaleGamma::kSrc, SkImage::RescaleMode::kNearest,
      [](SkImage::ReadPixelsContext cookie,
         std::unique_ptr<const SkImage::AsyncReadResult> result) {
        const uint32_t request =
            static_cast<uint32_t>(reinterpret_cast<uintptr_t>(cookie));
        auto found = skwasm::gReadbacks.find(request);
        if (found == skwasm::gReadbacks.end()) {
          return;
        }
        skwasm::Readback& target = found->second;
        if (!result) {
          target.status = 2;
          return;
        }
        const size_t rowBytes = static_cast<size_t>(target.width) * 4;
        target.pixels.resize(rowBytes * target.height);
        const uint8_t* source = static_cast<const uint8_t*>(result->data(0));
        for (int y = 0; y < target.height; y++) {
          memcpy(target.pixels.data() + y * rowBytes,
                 source + y * result->rowBytes(0), rowBytes);
        }
        target.status = 1;
      },
      reinterpret_cast<SkImage::ReadPixelsContext>(
          static_cast<uintptr_t>(id)));
  context->graphite()->submit();
  return id;
}

EMSCRIPTEN_KEEPALIVE int sk_readback_status(uint32_t id) {
  auto found = skwasm::gReadbacks.find(id);
  return found == skwasm::gReadbacks.end() ? 2 : found->second.status;
}

// Width times height times four bytes, until sk_readback_free().
EMSCRIPTEN_KEEPALIVE const uint8_t* sk_readback_pixels(uint32_t id) {
  auto found = skwasm::gReadbacks.find(id);
  return found == skwasm::gReadbacks.end() ? nullptr
                                           : found->second.pixels.data();
}

EMSCRIPTEN_KEEPALIVE void sk_readback_free(uint32_t id) {
  skwasm::gReadbacks.erase(id);
}

// Encodes RGBA pixels, unpremultiplied. `format`: 0 PNG, 1 JPEG, 2 WebP;
// `quality` from 0 to 100, for the last two. One reference, or null.
EMSCRIPTEN_KEEPALIVE SkData* sk_encode(const uint8_t* pixels,
                                       int width,
                                       int height,
                                       int format,
                                       int quality) {
  const SkPixmap pixmap(
      SkImageInfo::Make(width, height, kRGBA_8888_SkColorType,
                        kUnpremul_SkAlphaType, SkColorSpace::MakeSRGB()),
      pixels, static_cast<size_t>(width) * 4);
  sk_sp<SkData> data;
  if (format == 1) {
    SkJpegEncoder::Options options;
    options.fQuality = quality;
    data = SkJpegEncoder::Encode(pixmap, options);
  } else if (format == 2) {
    SkWebpEncoder::Options options;
    options.fQuality = static_cast<float>(quality);
    data = SkWebpEncoder::Encode(pixmap, options);
  } else {
    data = SkPngEncoder::Encode(pixmap, SkPngEncoder::Options());
  }
  if (!data) {
    skwasm::setError("The pixels could not be encoded.");
  }
  return data.release();
}

EMSCRIPTEN_KEEPALIVE const uint8_t* sk_data_bytes(SkData* data) {
  return data->bytes();
}

EMSCRIPTEN_KEEPALIVE size_t sk_data_size(SkData* data) { return data->size(); }

EMSCRIPTEN_KEEPALIVE void sk_data_unref(SkData* data) { SkSafeUnref(data); }

}  // extern "C"
