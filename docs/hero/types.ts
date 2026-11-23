/**
 * What the home page and its hero exchange. The page measures its own
 * elements; the hero, which is built apart from the site and loaded at run
 * time, draws them.
 */

/** RGBA in [0, 1], not premultiplied. */
export type HeroColor = [number, number, number, number];

/** An element of the page, as the hero has to draw it. Sizes in CSS pixels. */
export interface HeroItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontWeight: number;
  color: HeroColor;
  background: HeroColor;
  border: HeroColor;
  borderWidth: number;
  radius: number;
  /** The whole element is in front of the ribbon: its box and its text. */
  onTop: boolean;
  /**
   * The part of the text that stays in front of the ribbon when the rest of
   * the element is under it. Empty for most elements.
   */
  front: string;
}

export interface HeroLayout {
  /** The size of the canvas, in CSS pixels. */
  width: number;
  height: number;
  pixelRatio: number;
  dark: boolean;
  /** No animation: the visitor prefers reduced motion. */
  still: boolean;
  items: HeroItem[];
}

export interface Hero {
  /** Draws again for a new layout: a resize, another theme. */
  update(layout: HeroLayout): void;
  destroy(): void;
}

export type MountHero = (
  canvas: HTMLCanvasElement,
  /** Where the fonts are: the folder of the example previews. */
  assets: string,
  layout: HeroLayout
) => Promise<Hero>;
