/**
 * What a paint refers to: shaders, color filters, image filters, mask filters
 * and path effects. They are immutable, and a paint keeps what it is given:
 * disposing one after assigning it is safe.
 */
import { cachedColor } from "./color";
import type { ColorInput } from "./color";
import {
  blendModes,
  blurStyles,
  colorChannels,
  samplings,
  stampStyles,
  tileModes,
} from "./enums";
import type {
  BlendModeName,
  BlurStyle,
  ColorChannel,
  Sampling,
  StampStyle,
  TileMode,
} from "./enums";
import { NativeObject, ref, refOrNull } from "./native";
import type { Matrix, Runtime } from "./native";
import type { Path } from "./path";

type Point = readonly [number, number];

/** What a paint draws with instead of a color. */
export class Shader extends NativeObject {
  declare private readonly brand: "Shader";

  constructor(
    private readonly runtime: Runtime,
    pointer: number
  ) {
    super(pointer, runtime.module._sk_unref, "shader");
  }

  /** The same shader in a space transformed by the matrix. */
  withLocalMatrix(matrix: Matrix) {
    const { module, scratch } = this.runtime;
    scratch.reset();
    return new Shader(
      this.runtime,
      module._sk_shader_with_local_matrix(ref(this), scratch.matrix(matrix))
    );
  }

  /** The same shader with its output going through a color filter. */
  withColorFilter(filter: ColorFilter) {
    return new Shader(
      this.runtime,
      this.runtime.module._sk_shader_with_color_filter(ref(this), ref(filter))
    );
  }
}

/** Changes the color of what is drawn, pixel by pixel. */
export class ColorFilter extends NativeObject {
  declare private readonly brand: "ColorFilter";

  constructor(runtime: Runtime, pointer: number) {
    super(pointer, runtime.module._sk_unref, "color filter");
  }
}

/** Changes what is drawn as an image: blurs, shadows, offsets. */
export class ImageFilter extends NativeObject {
  declare private readonly brand: "ImageFilter";

  constructor(runtime: Runtime, pointer: number) {
    super(pointer, runtime.module._sk_unref, "image filter");
  }
}

/** Changes the coverage of what is drawn, before it is colored. */
export class MaskFilter extends NativeObject {
  declare private readonly brand: "MaskFilter";

  constructor(runtime: Runtime, pointer: number) {
    super(pointer, runtime.module._sk_unref, "mask filter");
  }
}

/** Changes the geometry of what is stroked or filled. */
export class PathEffect extends NativeObject {
  declare private readonly brand: "PathEffect";

  constructor(runtime: Runtime, pointer: number) {
    super(pointer, runtime.module._sk_unref, "path effect");
  }
}

// ---- Shaders.

export interface GradientOptions {
  /** Two or more. */
  colors: readonly ColorInput[];
  /** Where each color is, in [0, 1] and increasing. Evenly spaced if left out. */
  positions?: readonly number[];
  /** What is drawn outside of the gradient. "clamp" if left out. */
  tileMode?: TileMode;
  matrix?: Matrix;
}

export interface LinearGradientOptions extends GradientOptions {
  start: Point;
  end: Point;
}

export interface RadialGradientOptions extends GradientOptions {
  center: Point;
  radius: number;
}

/** From one circle to another. */
export interface ConicalGradientOptions extends GradientOptions {
  start: Point;
  startRadius: number;
  end: Point;
  endRadius: number;
}

export interface SweepGradientOptions extends GradientOptions {
  center: Point;
  /** Radians. A full turn from zero if left out. */
  startAngle?: number;
  endAngle?: number;
}

export interface NoiseOptions {
  frequencyX: number;
  frequencyY?: number;
  octaves?: number;
  seed?: number;
  /** Makes the noise repeat seamlessly over a tile of this size. */
  tileWidth?: number;
  tileHeight?: number;
}

export interface ImageShaderOptions {
  tileX?: TileMode;
  tileY?: TileMode;
  sampling?: Sampling;
  matrix?: Matrix;
}

// Writes the stops of a gradient and returns [colors, positions, count,
// tile mode, matrix].
const stops = (runtime: Runtime, options: GradientOptions) => {
  const { module, scratch } = runtime;
  const { colors, positions } = options;
  if (colors.length < 2) {
    throw new RangeError("A gradient has at least two colors.");
  }
  if (positions && positions.length !== colors.length) {
    throw new RangeError("A gradient has one position per color.");
  }
  scratch.reset();
  const pointer = scratch.alloc(colors.length * 16);
  const heap = module.HEAPF32;
  colors.forEach((color, i) => {
    const [r, g, b, a = 1] =
      typeof color === "string" ? cachedColor(color) : color;
    const at = (pointer >> 2) + i * 4;
    heap[at] = r;
    heap[at + 1] = g;
    heap[at + 2] = b;
    heap[at + 3] = a;
  });
  return [
    pointer,
    scratch.floatsOrNull(positions),
    colors.length,
    tileModes(options.tileMode ?? "clamp"),
    scratch.matrix(options.matrix),
  ] as const;
};

export const shaders = (runtime: Runtime) => {
  const { module } = runtime;
  const make = (pointer: number) => new Shader(runtime, pointer);
  return {
    linearGradient: (options: LinearGradientOptions) => {
      const { start, end } = options;
      return make(
        module._sk_shader_linear_gradient(
          start[0],
          start[1],
          end[0],
          end[1],
          ...stops(runtime, options)
        )
      );
    },
    radialGradient: (options: RadialGradientOptions) => {
      const { center, radius } = options;
      return make(
        module._sk_shader_radial_gradient(
          center[0],
          center[1],
          radius,
          ...stops(runtime, options)
        )
      );
    },
    conicalGradient: (options: ConicalGradientOptions) => {
      const { start, startRadius, end, endRadius } = options;
      return make(
        module._sk_shader_conical_gradient(
          start[0],
          start[1],
          startRadius,
          end[0],
          end[1],
          endRadius,
          ...stops(runtime, options)
        )
      );
    },
    sweepGradient: (options: SweepGradientOptions) => {
      const { center, startAngle = 0, endAngle = 2 * Math.PI } = options;
      return make(
        module._sk_shader_sweep_gradient(
          center[0],
          center[1],
          startAngle,
          endAngle,
          ...stops(runtime, options)
        )
      );
    },
    /** One color everywhere. */
    color: (color: ColorInput) => {
      const rgba = typeof color === "string" ? cachedColor(color) : color;
      return make(
        module._sk_shader_color(rgba[0], rgba[1], rgba[2], rgba[3] ?? 1)
      );
    },
    /** The source shader blended over the destination shader. */
    blend: (mode: BlendModeName, destination: Shader, source: Shader) =>
      make(
        module._sk_shader_blend(blendModes(mode), ref(destination), ref(source))
      ),
    fractalNoise: (options: NoiseOptions) => make(noise(runtime, 0, options)),
    turbulence: (options: NoiseOptions) => make(noise(runtime, 1, options)),
  };
};

const noise = (runtime: Runtime, turbulence: number, options: NoiseOptions) =>
  runtime.module._sk_shader_noise(
    turbulence,
    options.frequencyX,
    options.frequencyY ?? options.frequencyX,
    options.octaves ?? 1,
    options.seed ?? 0,
    options.tileWidth ?? 0,
    options.tileHeight ?? 0
  );

/** The shader of an image, given its store handle. */
export const imageShader = (
  runtime: Runtime,
  handle: number,
  options: ImageShaderOptions = {}
) => {
  const { module, scratch } = runtime;
  scratch.reset();
  return new Shader(
    runtime,
    module._sk_shader_image(
      handle,
      tileModes(options.tileX ?? "clamp"),
      tileModes(options.tileY ?? "clamp"),
      samplings(options.sampling ?? "linear"),
      scratch.matrix(options.matrix)
    )
  );
};

// ---- Color filters.

export const colorFilters = (runtime: Runtime) => {
  const { module, scratch } = runtime;
  const make = (pointer: number) => new ColorFilter(runtime, pointer);
  return {
    /**
     * Twenty numbers, row-major: each of R, G, B and A out is a sum of R, G,
     * B and A in and a constant, all in [0, 1].
     */
    matrix: (matrix: readonly number[]) => {
      if (matrix.length !== 20) {
        throw new RangeError("A color matrix is twenty numbers.");
      }
      scratch.reset();
      return make(module._sk_color_filter_matrix(scratch.floats(matrix)));
    },
    /** Blends a color over what is drawn. */
    blend: (color: ColorInput, mode: BlendModeName) => {
      const rgba = typeof color === "string" ? cachedColor(color) : color;
      return make(
        module._sk_color_filter_blend(
          rgba[0],
          rgba[1],
          rgba[2],
          rgba[3] ?? 1,
          blendModes(mode)
        )
      );
    },
    /** The inner filter, then the outer one. */
    compose: (outer: ColorFilter, inner: ColorFilter) =>
      make(module._sk_color_filter_compose(ref(outer), ref(inner))),
    /** Between two filters: `t` of zero is the first. */
    lerp: (t: number, from: ColorFilter, to: ColorFilter) =>
      make(module._sk_color_filter_lerp(t, ref(from), ref(to))),
    /** The luminance of the color as alpha, over black. */
    luma: () => make(module._sk_color_filter_builtin(0)),
    linearToSRGB: () => make(module._sk_color_filter_builtin(1)),
    sRGBToLinear: () => make(module._sk_color_filter_builtin(2)),
  };
};

// ---- Image filters.

export interface BlurOptions {
  /** What is sampled past the edges. "decal", transparent, if left out. */
  tileMode?: TileMode;
  input?: ImageFilter | null;
}

export interface DropShadowOptions {
  dx: number;
  dy: number;
  sigma: number;
  color: ColorInput;
  /** Leaves out what casts the shadow. */
  shadowOnly?: boolean;
  input?: ImageFilter | null;
}

export const imageFilters = (runtime: Runtime) => {
  const { module, scratch } = runtime;
  const make = (pointer: number) => new ImageFilter(runtime, pointer);
  return {
    /** A Gaussian blur. One sigma, or one per axis. */
    blur: (
      sigma: number | readonly [number, number],
      options: BlurOptions = {}
    ) =>
      make(
        module._sk_image_filter_blur(
          typeof sigma === "number" ? sigma : sigma[0],
          typeof sigma === "number" ? sigma : sigma[1],
          tileModes(options.tileMode ?? "decal"),
          refOrNull(options.input)
        )
      ),
    colorFilter: (filter: ColorFilter, input?: ImageFilter | null) =>
      make(module._sk_image_filter_color_filter(ref(filter), refOrNull(input))),
    offset: (dx: number, dy: number, input?: ImageFilter | null) =>
      make(module._sk_image_filter_offset(dx, dy, refOrNull(input))),
    dropShadow: (options: DropShadowOptions) => {
      const { color } = options;
      const rgba = typeof color === "string" ? cachedColor(color) : color;
      return make(
        module._sk_image_filter_drop_shadow(
          options.dx,
          options.dy,
          options.sigma,
          options.sigma,
          rgba[0],
          rgba[1],
          rgba[2],
          rgba[3] ?? 1,
          options.shadowOnly ? 1 : 0,
          refOrNull(options.input)
        )
      );
    },
    /** Grows what is drawn by a radius. */
    dilate: (radius: number, input?: ImageFilter | null) =>
      make(
        module._sk_image_filter_morphology(0, radius, radius, refOrNull(input))
      ),
    /** Shrinks what is drawn by a radius. */
    erode: (radius: number, input?: ImageFilter | null) =>
      make(
        module._sk_image_filter_morphology(1, radius, radius, refOrNull(input))
      ),
    /** The inner filter, then the outer one. */
    compose: (outer: ImageFilter, inner: ImageFilter) =>
      make(module._sk_image_filter_compose(ref(outer), ref(inner))),
    /** The foreground blended over the background. Null is the source. */
    blend: (
      mode: BlendModeName,
      background: ImageFilter | null,
      foreground: ImageFilter | null
    ) =>
      make(
        module._sk_image_filter_blend(
          blendModes(mode),
          refOrNull(background),
          refOrNull(foreground)
        )
      ),
    /** A shader as an image, whatever is drawn. */
    shader: (shader: Shader) =>
      make(module._sk_image_filter_shader(ref(shader))),
    /** Moves pixels by the channels of another image. */
    displacementMap: (
      channelX: ColorChannel,
      channelY: ColorChannel,
      scale: number,
      displacement: ImageFilter,
      input?: ImageFilter | null
    ) =>
      make(
        module._sk_image_filter_displacement_map(
          colorChannels(channelX),
          colorChannels(channelY),
          scale,
          ref(displacement),
          refOrNull(input)
        )
      ),
    matrixTransform: (
      matrix: Matrix,
      sampling: Sampling = "linear",
      input?: ImageFilter | null
    ) => {
      scratch.reset();
      return make(
        module._sk_image_filter_matrix_transform(
          scratch.matrix(matrix),
          samplings(sampling),
          refOrNull(input)
        )
      );
    },
  };
};

// ---- Mask filters.

export const maskFilters = (runtime: Runtime) => {
  const { module } = runtime;
  return {
    /**
     * Blurs the edges of what is drawn. With `respectMatrix`, the sigma is
     * scaled by the transform of the canvas.
     */
    blur: (sigma: number, style: BlurStyle = "normal", respectMatrix = true) =>
      new MaskFilter(
        runtime,
        module._sk_mask_filter_blur(
          blurStyles(style),
          sigma,
          respectMatrix ? 1 : 0
        )
      ),
  };
};

// ---- Path effects.

export const pathEffects = (runtime: Runtime) => {
  const { module, scratch } = runtime;
  const make = (pointer: number) => new PathEffect(runtime, pointer);
  return {
    /** Lengths of dashes and gaps, alternating: an even number of them. */
    dash: (intervals: readonly number[], phase = 0) => {
      if (intervals.length < 2 || intervals.length % 2 !== 0) {
        throw new RangeError("Dashes come in pairs of a length and a gap.");
      }
      scratch.reset();
      return make(
        module._sk_path_effect_dash(
          scratch.floats(intervals),
          intervals.length,
          phase
        )
      );
    },
    /** Rounds sharp corners. */
    corner: (radius: number) => make(module._sk_path_effect_corner(radius)),
    /** Breaks the path into segments and moves their ends at random. */
    discrete: (segmentLength: number, deviation: number, seed = 0) =>
      make(module._sk_path_effect_discrete(segmentLength, deviation, seed)),
    /** Keeps the part between two fractions of the length of the path. */
    trim: (start: number, stop: number, inverted = false) =>
      make(module._sk_path_effect_trim(start, stop, inverted ? 1 : 0)),
    /** Stamps a path along the one being drawn, every `advance`. */
    stamp: (
      path: Path,
      advance: number,
      phase = 0,
      style: StampStyle = "rotate"
    ) =>
      make(
        module._sk_path_effect_stamp(
          ref(path),
          advance,
          phase,
          stampStyles(style)
        )
      ),
    /** The inner effect, then the outer one. */
    compose: (outer: PathEffect, inner: PathEffect) =>
      make(module._sk_path_effect_compose(ref(outer), ref(inner))),
    /** Both effects, drawn together. */
    sum: (first: PathEffect, second: PathEffect) =>
      make(module._sk_path_effect_sum(ref(first), ref(second))),
  };
};
