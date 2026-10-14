/**
 * Gauge designs — a gauge is assembled from parts (frame, indicator, scale,
 * readout, unit, label) instead of being one fixed drawing. Everything is in
 * a 1000×1000 canvas. Designs are plain JSON so the Theme Maker can create
 * them and they can be shared as files.
 */

export const DESIGN_SCHEMA = 'opengauge-design/1';

export type FrameStyle = 'chrome' | 'black' | 'brushed' | 'color' | 'flat' | 'none';
export type FrameShape = 'round' | 'square';
export type FaceStyle = 'carbon' | 'matte' | 'gradient' | 'none';

export interface FramePart {
  style: FrameStyle;
  shape: FrameShape;
  /** Bezel tint for style 'color' and 'flat'. */
  color: string;
  face: FaceStyle;
  faceColor: string;
}

/** Arc made of separate segments (the original Performance Chrome look). */
export interface ArcSegmentsIndicator {
  type: 'arc-segments';
  startDeg: number;     // 0 = straight up, clockwise positive
  endDeg: number;
  radius: number;       // ring centre-line radius
  thickness: number;
  segments: number;
  /** 0..1 — how much of each slot a segment fills (rest is gap). */
  fill: number;
}

/** One continuous arc that fills up. */
export interface ArcSmoothIndicator {
  type: 'arc-smooth';
  startDeg: number;
  endDeg: number;
  radius: number;
  thickness: number;
  roundCaps: boolean;
}

/** Analog needle sweeping an arc. */
export interface NeedleIndicator {
  type: 'needle';
  startDeg: number;
  endDeg: number;
  radius: number;       // scale radius the needle points at
  length: number;       // tip distance from centre
  width: number;        // needle base width
  tail: number;         // length behind the hub
  hubRadius: number;
  color: string;
  /** Coloured band along the arc showing normal / warning zones. */
  zoneBand: boolean;
}

/** Straight bar (solid or segmented). */
export interface BarIndicator {
  type: 'bar';
  orientation: 'vertical' | 'horizontal';
  x: number; y: number; width: number; height: number;
  /** 0 = solid bar, otherwise number of blocks. */
  segments: number;
  /** 0..1 — fraction of each block that is filled (rest is gap). */
  fill: number;
  radius: number;       // corner rounding
}

export interface NoIndicator { type: 'none' }

export type Indicator =
  | ArcSegmentsIndicator
  | ArcSmoothIndicator
  | NeedleIndicator
  | BarIndicator
  | NoIndicator;

export type IndicatorType = Indicator['type'];

export interface ScalePart {
  show: boolean;
  /** Arc scales: distance inward from the indicator's inner edge. Bar scales: gap from the bar. */
  offset: number;
  majorLength: number;
  minorLength: number;
  /** Extra distance from the ticks to the numbers. */
  labelGap: number;
  labelSize: number;
  /** Bar scales only: which side of the bar the ticks go. */
  side: 'start' | 'end';
}

export interface ReadoutPart {
  show: boolean;
  style: 'segment' | 'text';
  x: number; y: number;       // centre
  size: number;               // 1 = original Performance Chrome size
  box: boolean;
  /** Digits turn the warning colour when the gauge is in warning. */
  warnColor: boolean;
}

export interface TextPart {
  show: boolean;
  x: number; y: number;
  size: number;               // font size in canvas units
}

export interface LabelPart extends TextPart {
  accentLine: boolean;
}

export interface DesignColors {
  active: string;
  warning: string;
  digits: string;
  off: string;          // unlit segments / track
  text: string;         // scale numbers, unit, label
  tickMajor: string;
  tickMinor: string;
}

export interface GaugeDesign {
  schema: typeof DESIGN_SCHEMA;
  id: string;
  name: string;
  /** Built-in designs ship with the app and can't be overwritten. */
  builtIn?: boolean;
  colors: DesignColors;
  glow: boolean;
  frame: FramePart;
  indicator: Indicator;
  scale: ScalePart;
  readout: ReadoutPart;
  unit: TextPart;
  label: LabelPart;
}
