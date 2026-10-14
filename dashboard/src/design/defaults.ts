import {
  DESIGN_SCHEMA,
  type GaugeDesign,
  type Indicator,
  type IndicatorType,
} from './types.ts';

/** Per-type defaults so switching indicator type in the maker gives something sensible. */
export const INDICATOR_DEFAULTS: { [K in IndicatorType]: Extract<Indicator, { type: K }> } = {
  'arc-segments': {
    type: 'arc-segments', startDeg: -124, endDeg: 124, radius: 325, thickness: 38,
    segments: 34, fill: 0.838,
  },
  'arc-smooth': {
    type: 'arc-smooth', startDeg: -135, endDeg: 135, radius: 325, thickness: 44, roundCaps: true,
  },
  needle: {
    type: 'needle', startDeg: -135, endDeg: 135, radius: 330, length: 330, width: 22,
    tail: 60, hubRadius: 40, color: '#ff3b1f', zoneBand: true,
  },
  bar: {
    type: 'bar', orientation: 'vertical', x: 560, y: 150, width: 150, height: 600,
    segments: 20, fill: 0.78, radius: 6,
  },
  none: { type: 'none' },
};

/** The original Performance Chrome gauge, expressed as parts. Every other design is merged onto this. */
export const DEFAULT_DESIGN: GaugeDesign = {
  schema: DESIGN_SCHEMA,
  id: 'performance_chrome',
  name: 'Performance Chrome',
  colors: {
    active: '#ff9700',
    warning: '#e62929',
    digits: '#ff6a00',
    off: '#b9bec2',
    text: '#f4f5f7',
    tickMajor: '#f1f3f5',
    tickMinor: '#7f858b',
  },
  glow: true,
  frame: { style: 'chrome', shape: 'round', color: '#8a9096', face: 'carbon', faceColor: '#0b0c0d' },
  indicator: INDICATOR_DEFAULTS['arc-segments'],
  scale: {
    show: true, offset: 18, majorLength: 21, minorLength: 16, labelGap: 31, labelSize: 31, side: 'start',
  },
  readout: { show: true, style: 'segment', x: 500, y: 488, size: 1, box: true, warnColor: false },
  unit: { show: true, x: 500, y: 625, size: 30 },
  label: { show: true, x: 500, y: 790, size: 48, accentLine: true },
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep-merge `src` onto `base`, keeping only keys `base` knows and values of the same type. */
function mergeKnown<T>(base: T, src: unknown): T {
  if (!isObj(src) || !isObj(base)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, bv] of Object.entries(base)) {
    const sv = src[k];
    if (sv === undefined) continue;
    if (isObj(bv)) out[k] = mergeKnown(bv, sv);
    else if (typeof sv === typeof bv) out[k] = sv;
  }
  return out as T;
}

/**
 * Turn any (possibly partial or hand-edited) design JSON into a complete,
 * safe GaugeDesign. Returns null if it isn't a design at all.
 */
export function normalizeDesign(raw: unknown): GaugeDesign | null {
  if (!isObj(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null;

  const merged = mergeKnown(DEFAULT_DESIGN, raw);
  const rawInd = isObj(raw.indicator) ? raw.indicator : {};
  const type = (rawInd.type as IndicatorType) in INDICATOR_DEFAULTS
    ? (rawInd.type as IndicatorType)
    : DEFAULT_DESIGN.indicator.type;
  const indicator = mergeKnown(INDICATOR_DEFAULTS[type], rawInd) as Indicator;

  return {
    ...merged,
    schema: DESIGN_SCHEMA,
    id: raw.id.trim(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : raw.id.trim(),
    builtIn: raw.builtIn === true,
    indicator: { ...indicator, type } as Indicator,
  };
}
