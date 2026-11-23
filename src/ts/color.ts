/**
 * Colors. A color is RGBA, unpremultiplied, each channel in [0, 1]. Wherever
 * the API takes one, it also takes a CSS color string.
 */

export type Color = readonly [number, number, number, number?];

/** What the API accepts as a color. */
export type ColorInput = Color | string;

// The named colors of CSS, as "name:rrggbb".
const names =
  "aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32";

type RGBA = [number, number, number, number];

const named = new Map<string, string>(
  names.split(",").map((entry) => entry.split(":") as [string, string])
);

const clamp = (value: number) => Math.min(1, Math.max(0, value));

const parseHex = (hex: string): RGBA | null => {
  const wide = hex.length === 6 || hex.length === 8;
  if (
    !/^[0-9a-f]+$/i.test(hex) ||
    !(wide || hex.length === 3 || hex.length === 4)
  ) {
    return null;
  }
  const channel = (index: number) =>
    wide
      ? parseInt(hex.slice(index * 2, index * 2 + 2), 16) / 255
      : parseInt(hex[index], 16) / 15;
  const hasAlpha = hex.length === 4 || hex.length === 8;
  return [channel(0), channel(1), channel(2), hasAlpha ? channel(3) : 1];
};

// A number, or a percentage of `whole`.
const amount = (text: string, whole: number) =>
  text.endsWith("%") ? (parseFloat(text) / 100) * whole : parseFloat(text);

// A percentage, with or without its sign.
const percent = (text: string) => clamp(parseFloat(text) / 100);

// An angle as a fraction of a turn.
const turns = (text: string) => {
  const value = parseFloat(text);
  if (text.endsWith("turn")) {
    return value;
  }
  if (text.endsWith("grad")) {
    return value / 400;
  }
  if (text.endsWith("rad")) {
    return value / (2 * Math.PI);
  }
  return value / 360;
};

const hslToRgb = (h: number, s: number, l: number) => {
  const hue = ((h % 1) + 1) % 1;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const channel = (offset: number) => {
    const k = (offset + hue * 12) % 12;
    return l - (chroma / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
};

const parseFunction = (css: string): RGBA | null => {
  const match = /^(rgb|hsl)a?\(([^()]*)\)$/.exec(css);
  if (!match) {
    return null;
  }
  const parts = match[2].trim().split(/[\s,/]+/);
  if (parts.length !== 3 && parts.length !== 4) {
    return null;
  }
  const rgb =
    match[1] === "rgb"
      ? parts.slice(0, 3).map((part) => amount(part, 255) / 255)
      : hslToRgb(turns(parts[0]), percent(parts[1]), percent(parts[2]));
  const alpha = parts.length === 4 ? amount(parts[3], 1) : 1;
  const color: RGBA = [
    clamp(rgb[0]),
    clamp(rgb[1]),
    clamp(rgb[2]),
    clamp(alpha),
  ];
  return color.some(Number.isNaN) ? null : color;
};

const cache = new Map<string, RGBA>();

const lookup = (css: string): RGBA => {
  const text = css.trim().toLowerCase();
  let color: RGBA | null = null;
  if (text.startsWith("#")) {
    color = parseHex(text.slice(1));
  } else if (text === "transparent") {
    color = [0, 0, 0, 0];
  } else if (named.has(text)) {
    color = parseHex(named.get(text)!);
  } else {
    color = parseFunction(text);
  }
  if (color === null) {
    throw new Error(`Not a color: ${css}`);
  }
  return color;
};

/**
 * The parsed color of a CSS string, shared between calls: for code that reads
 * it at once and does not keep it.
 */
export const cachedColor = (css: string): Readonly<RGBA> => {
  let color = cache.get(css);
  if (color === undefined) {
    color = lookup(css);
    // Strings made in a loop, such as `hsl(${hue} 80% 50%)`, would fill it.
    if (cache.size >= 1024) {
      cache.clear();
    }
    cache.set(css, color);
  }
  return color;
};

/**
 * Parses a CSS color: a hex color ("#rgb", "#rgba", "#rrggbb", "#rrggbbaa"),
 * a named color, "transparent", rgb() or hsl(), with commas or spaces and an
 * optional alpha.
 */
export const parseColor = (css: string): RGBA => {
  const color = cachedColor(css);
  return [color[0], color[1], color[2], color[3]];
};

export const toColor = (color: ColorInput): RGBA =>
  typeof color === "string"
    ? parseColor(color)
    : [color[0], color[1], color[2], color[3] ?? 1];
