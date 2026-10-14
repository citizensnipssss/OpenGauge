import type { GaugeDefinition } from '../../registry/types';
import type { TelemetryStore } from '../../telemetry/TelemetryStore';
import type { TelemetrySample, ChannelStatus } from '../../telemetry/types';
import type {
  ArcSegmentsIndicator,
  ArcSmoothIndicator,
  GaugeDesign,
  NeedleIndicator,
} from '../../design/types';

// Seven-segment shape polygons — GAUGE_SYSTEM_SPEC.md "Digital display".
const SHAPE_MAP: Record<string, string> = {
  a: '13,0 61,0 70,9 61,18 13,18 4,9',
  b: '74,14 83,23 83,64 74,73 65,64 65,23',
  c: '74,79 83,88 83,129 74,138 65,129 65,88',
  d: '13,134 61,134 70,143 61,152 13,152 4,143',
  e: '0,79 9,88 9,129 0,138 -9,129 -9,88',
  f: '0,14 9,23 9,64 0,73 -9,64 -9,23',
  g: '13,67 61,67 70,76 61,85 13,85 4,76',
};
const DIGIT_MAP: Record<string, string[]> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'c', 'd', 'g'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'g', 'e', 'c', 'd'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
  '-': ['g'],
};

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Readout artwork was drawn around this centre; designs move/scale it from here. */
const READOUT_ORIGIN_Y = 488;
let instanceCounter = 0;

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r: number, g: number, b: number) {
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
  );
}
function mix(a: string, b: string, t: number) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}
const lighter = (c: string, t = 0.35) => mix(c, '#ffffff', t);
const darker = (c: string, t = 0.35) => mix(c, '#000000', t);

function niceNum(range: number, round: boolean) {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 4.5) niceFraction = 2.5;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 2.5) niceFraction = 2.5;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}
function makeTicks(min: number, max: number, target = 7) {
  const raw = (max - min) / (target - 1);
  const step = niceNum(raw, true);
  const first = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max + step * 1e-6; v += step) {
    if (v >= min - 1e-9) ticks.push(Number(v.toFixed(10)));
  }
  if (Math.abs(ticks[0] - min) > step * 0.18) ticks.unshift(min);
  if (Math.abs(ticks[ticks.length - 1] - max) > step * 0.18) ticks.push(max);
  return { ticks, step };
}

function polar(r: number, angleDeg: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [500 + r * Math.cos(a), 500 + r * Math.sin(a)];
}

/** SVG path for an arc stroke at radius r from a1 to a2 (degrees, 0 = up). */
function arcPath(r: number, a1: number, a2: number) {
  const [x1, y1] = polar(r, a1);
  const [x2, y2] = polar(r, a2);
  const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
  const sweep = a2 > a1 ? 1 : 0;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} ${sweep} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** A lit stretch of the indicator, as fractions of the scale (0..1). */
interface LitRange { from: number; to: number; warn: boolean }

/**
 * <pc-gauge> — one reusable SVG gauge. Driven entirely by gauge metadata
 * (GaugeDefinition: label, unit, scale, warning) + a GaugeDesign (which
 * parts to draw and how). Same element renders arcs, needles, bars and
 * digital-only gauges.
 */
export class PcGauge extends HTMLElement {
  private def!: GaugeDefinition;
  private design!: GaugeDesign;
  private uid: string;
  private currentValue = 0;
  private hasReading = true;
  private channelStatus: ChannelStatus = 'good';
  private elLive!: SVGGElement;
  private elDigits!: SVGGElement;
  private elOverlay!: SVGGElement;
  private elNeedle: SVGGElement | null = null;
  private unsubscribe?: () => void;
  private connectionUnsubscribe?: () => void;
  private connectionStatus: import('../../telemetry/types').ConnectionStatus = 'connected';

  constructor() {
    super();
    this.uid = `pcg${instanceCounter++}`;
    this.attachShadow({ mode: 'open' });
  }

  configure(def: GaugeDefinition, design: GaugeDesign) {
    this.disconnectStore();
    this.def = def;
    this.design = design;
    this.currentValue = def.demoValue;
    this.hasReading = true;
    this.channelStatus = 'good';
    this.render();
  }

  /** Wire this gauge to a TelemetryStore. Call again to switch stores/keys. */
  connectStore(store: TelemetryStore) {
    this.disconnectStore();
    if (!this.def) return;
    // Show NO SIGNAL until the first real sample arrives from the store.
    if (!Number.isFinite(store.get(this.def.telemetryKey)?.value)) {
      this.hasReading = false;
      this.currentValue = this.def.scale.min;
      this.channelStatus = 'unavailable';
      this.updateIndicator();
      this.renderDigits();
      this.renderOverlay();
    }
    this.connectionUnsubscribe = store.subscribeConnection(status => {this.connectionStatus=status;this.renderOverlay();});
    this.unsubscribe = store.subscribe(this.def.telemetryKey, (_key, sample) => {
      this.applyTelemetrySample(sample);
    });
  }

  disconnectStore() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.connectionUnsubscribe?.();this.connectionUnsubscribe=undefined;
    this.connectionStatus='connected';
  }

  disconnectedCallback() {
    this.disconnectStore();
  }

  private applyTelemetrySample(sample: TelemetrySample) {
    this.channelStatus = sample.status;
    if (sample.status !== 'good') {
      // Show fault overlay, keep last value
      this.renderOverlay();
      return;
    }
    this.channelStatus = 'good';
    this.hasReading = true;
    this.currentValue = sample.value;
    if (this.elLive) {
      this.updateIndicator();
      this.renderDigits();
      this.renderOverlay();
    }
  }

  set value(v: number) {
    this.hasReading = true;
    this.currentValue = v;
    if (this.elLive) {
      this.updateIndicator();
      this.renderDigits();
    }
  }
  get value() {
    return this.currentValue;
  }

  // ---------------------------------------------------------------
  // Value helpers
  // ---------------------------------------------------------------

  private fracFor(v: number) {
    const { min, max } = this.def.scale;
    if (max === min) return 0;
    return Math.max(0, Math.min(1, (v - min) / (max - min)));
  }

  /** Whole-gauge warning state (used by needles, digits, all-lit modes). */
  private inWarning(): boolean {
    const w = this.def.warning;
    const v = this.currentValue;
    switch (w.mode) {
      case 'high_segments':
        return w.high !== undefined && v >= w.high;
      case 'low_all_lit':
        return w.low !== undefined && v <= w.low;
      case 'outside_band_all_lit':
        return (w.low !== undefined && v <= w.low) || (w.high !== undefined && v >= w.high);
      default:
        return false;
    }
  }

  /** Whether a lit piece at `segValue` should be warning-coloured. */
  private isSegmentWarning(segValue: number): boolean {
    const w = this.def.warning;
    if (w.mode === 'high_segments') return w.high !== undefined && segValue >= w.high;
    return this.inWarning();
  }

  /** Lit stretches for continuous indicators (smooth arc, solid bar). */
  private litRanges(): LitRange[] {
    const f = this.fracFor(this.currentValue);
    const w = this.def.warning;
    if (f <= 0) return [];
    if (w.mode === 'high_segments' && w.high !== undefined) {
      const fh = this.fracFor(w.high);
      if (f <= fh) return [{ from: 0, to: f, warn: false }];
      return [{ from: 0, to: fh, warn: false }, { from: fh, to: f, warn: true }];
    }
    return [{ from: 0, to: f, warn: this.inWarning() }];
  }

  /** Warning zones along the scale (fractions), for needle zone bands. */
  private warningZones(): [number, number][] {
    const w = this.def.warning;
    const zones: [number, number][] = [];
    if ((w.mode === 'high_segments' || w.mode === 'outside_band_all_lit') && w.high !== undefined) {
      zones.push([this.fracFor(w.high), 1]);
    }
    if ((w.mode === 'low_all_lit' || w.mode === 'outside_band_all_lit') && w.low !== undefined) {
      zones.push([0, this.fracFor(w.low)]);
    }
    return zones.filter(([a, b]) => b > a);
  }

  private fillFor(warn: boolean, solid = false) {
    const c = this.design.colors;
    if (solid) return warn ? c.warning : c.active;
    return warn ? `url(#warnGrad-${this.uid})` : `url(#activeGrad-${this.uid})`;
  }

  // ---------------------------------------------------------------
  // Static artwork
  // ---------------------------------------------------------------

  private defs(): string {
    const d = this.design;
    const u = this.uid;
    const c = d.colors;
    const face = d.frame.faceColor;
    const bezel = this.bezelStops();
    return `
      <defs>
        <radialGradient id="bezelOuter-${u}" cx="42%" cy="35%" r="70%">
          ${bezel.map(([o, col]) => `<stop offset="${o}%" stop-color="${col}"/>`).join('')}
        </radialGradient>
        <linearGradient id="bezelInner-${u}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0a0b0c"/><stop offset="40%" stop-color="#34383b"/>
          <stop offset="65%" stop-color="#050607"/><stop offset="100%" stop-color="#1d2023"/>
        </linearGradient>
        <radialGradient id="faceGrad-${u}" cx="50%" cy="45%" r="65%">
          <stop offset="0%" stop-color="${lighter(face, 0.06)}"/><stop offset="65%" stop-color="${face}"/>
          <stop offset="100%" stop-color="${darker(face, 0.7)}"/>
        </radialGradient>
        <radialGradient id="faceGlow-${u}" cx="50%" cy="38%" r="70%">
          <stop offset="0%" stop-color="${lighter(face, 0.22)}"/><stop offset="100%" stop-color="${darker(face, 0.5)}"/>
        </radialGradient>
        <linearGradient id="lcdGrad-${u}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#111315"/><stop offset="45%" stop-color="#020303"/><stop offset="100%" stop-color="#0c0e10"/>
        </linearGradient>
        <linearGradient id="activeGrad-${u}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lighter(c.active, 0.36)}"/>
          <stop offset="36%" stop-color="${c.active}"/>
          <stop offset="100%" stop-color="${darker(c.active, 0.28)}"/>
        </linearGradient>
        <linearGradient id="warnGrad-${u}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lighter(c.warning, 0.3)}"/>
          <stop offset="35%" stop-color="${c.warning}"/>
          <stop offset="100%" stop-color="${darker(c.warning, 0.38)}"/>
        </linearGradient>
        <pattern id="carbon-${u}" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="16" height="16" fill="${face}"/><rect width="8" height="16" fill="${lighter(face, 0.05)}"/>
          <rect x="8" width="8" height="16" fill="${darker(face, 0.3)}"/>
          <path d="M0 0H16M0 8H16" stroke="${lighter(face, 0.1)}" stroke-width="1" opacity=".6"/>
        </pattern>
        <filter id="softShadow-${u}" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity=".75"/>
        </filter>
        <filter id="segmentGlow-${u}" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="digitGlow-${u}" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="4.1" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>`;
  }

  private bezelStops(): [number, string][] {
    const f = this.design.frame;
    switch (f.style) {
      case 'black':
        return [[0, '#4a4e52'], [16, '#151719'], [35, '#3a3e42'], [58, '#08090a'], [76, '#26292c'], [100, '#000000']];
      case 'brushed':
        return [[0, '#e2e5e8'], [16, '#9a9fa4'], [35, '#cfd3d7'], [58, '#7a7f84'], [76, '#b9bdc1'], [100, '#45494d']];
      case 'color':
        return [[0, lighter(f.color, 0.55)], [16, f.color], [35, lighter(f.color, 0.35)],
                [58, darker(f.color, 0.35)], [76, lighter(f.color, 0.15)], [100, darker(f.color, 0.65)]];
      default: // chrome
        return [[0, '#f4f5f6'], [16, '#a7adb2'], [35, '#f7f7f7'], [58, '#777d82'], [76, '#d7dadd'], [100, '#34383c']];
    }
  }

  /** Circle or rounded square of "radius" r around the centre. */
  private ring(r: number, attrs: string) {
    if (this.design.frame.shape === 'square') {
      const rx = Math.round(r * 0.18);
      return `<rect x="${500 - r}" y="${500 - r}" width="${2 * r}" height="${2 * r}" rx="${rx}" ${attrs}/>`;
    }
    return `<circle cx="500" cy="500" r="${r}" ${attrs}/>`;
  }

  private frameSvg(): string {
    const f = this.design.frame;
    const u = this.uid;
    let s = '';
    if (f.style === 'flat') {
      s += this.ring(462, `fill="${darker(f.color, 0.55)}" stroke="${f.color}" stroke-width="26"`);
    } else if (f.style !== 'none') {
      s += this.ring(472, `fill="#080909" filter="url(#softShadow-${u})"`);
      s += this.ring(455, `fill="url(#bezelOuter-${u})" stroke="${f.style === 'chrome' ? '#f4f5f6' : lighter(this.bezelStops()[0][1], 0.2)}" stroke-width="4"`);
      s += this.ring(414, `fill="url(#bezelInner-${u})" stroke="#1a1c1e" stroke-width="7"`);
    }
    // Face
    const faceR = f.style === 'none' ? 440 : 383;
    switch (f.face) {
      case 'carbon':
        s += this.ring(faceR, `fill="url(#faceGrad-${u})" stroke="#090a0b" stroke-width="3"`);
        s += this.ring(faceR - 11, `fill="url(#carbon-${u})" opacity=".78"`);
        s += this.ring(faceR - 23, `fill="rgba(0,0,0,.42)"`);
        break;
      case 'matte':
        s += this.ring(faceR, `fill="${f.faceColor}" stroke="#090a0b" stroke-width="3"`);
        break;
      case 'gradient':
        s += this.ring(faceR, `fill="url(#faceGlow-${u})" stroke="#090a0b" stroke-width="3"`);
        break;
      case 'none':
        break;
    }
    return s;
  }

  /** Inner edge radius of an arc-type indicator — the scale hangs inside it. */
  private arcInnerEdge(): number {
    const ind = this.design.indicator;
    if (ind.type === 'arc-segments' || ind.type === 'arc-smooth') return ind.radius - ind.thickness / 2;
    if (ind.type === 'needle') return ind.radius - (ind.zoneBand ? 9 : 0);
    return 0;
  }

  private arcAngle(frac: number) {
    const ind = this.design.indicator as ArcSegmentsIndicator | ArcSmoothIndicator | NeedleIndicator;
    return ind.startDeg + frac * (ind.endDeg - ind.startDeg);
  }

  private formatTick(v: number, step: number) {
    const abs = Math.abs(step);
    if (abs >= 1) return String(Math.round(v));
    if (abs >= 0.1) return v.toFixed(1);
    return v.toFixed(2);
  }

  private renderScale(ticksG: SVGGElement, labelsG: SVGGElement) {
    const d = this.design;
    const ind = d.indicator;
    const sc = d.scale;
    if (!sc.show || ind.type === 'none') return;
    const { min, max } = this.def.scale;
    const { ticks, step } = makeTicks(min, max, 7);
    const minorStep = step / 5;
    const start = Math.ceil(min / minorStep) * minorStep;

    // Returns [x1,y1,x2,y2] for a tick and the label anchor for a value
    let tickAt: (frac: number, len: number) => [number, number, number, number];
    let labelAt: (frac: number) => { x: number; y: number; anchor: string };

    if (ind.type === 'bar') {
      const vertical = ind.orientation === 'vertical';
      const before = sc.side === 'start';
      tickAt = (f, len) => {
        if (vertical) {
          const y = ind.y + ind.height * (1 - f);
          const x0 = before ? ind.x - sc.offset : ind.x + ind.width + sc.offset;
          const x1 = before ? x0 - len : x0 + len;
          return [x0, y, x1, y];
        }
        const x = ind.x + ind.width * f;
        const y0 = before ? ind.y - sc.offset : ind.y + ind.height + sc.offset;
        const y1 = before ? y0 - len : y0 + len;
        return [x, y0, x, y1];
      };
      labelAt = (f) => {
        const dist = sc.offset + sc.majorLength + sc.labelGap * 0.5;
        if (vertical) {
          const y = ind.y + ind.height * (1 - f) + sc.labelSize * 0.35;
          return before
            ? { x: ind.x - dist, y, anchor: 'end' }
            : { x: ind.x + ind.width + dist, y, anchor: 'start' };
        }
        const x = ind.x + ind.width * f;
        return before
          ? { x, y: ind.y - dist, anchor: 'middle' }
          : { x, y: ind.y + ind.height + dist + sc.labelSize * 0.75, anchor: 'middle' };
      };
    } else {
      const edge = this.arcInnerEdge() - sc.offset;
      tickAt = (f, len) => {
        const a = this.arcAngle(f);
        const [x1, y1] = polar(edge, a);
        const [x2, y2] = polar(edge - len, a);
        return [x1, y1, x2, y2];
      };
      labelAt = (f) => {
        const [x, y] = polar(edge - sc.majorLength - sc.labelGap, this.arcAngle(f));
        return { x, y: y + sc.labelSize * 0.23, anchor: 'middle' };
      };
    }

    for (let v = start; v <= max + minorStep * 0.25; v += minorStep) {
      if (v < min - 1e-6) continue;
      const major = ticks.some((t) => Math.abs(t - v) < minorStep * 0.08);
      const [x1, y1, x2, y2] = tickAt(this.fracFor(v), major ? sc.majorLength : sc.minorLength);
      ticksG.appendChild(el('line', {
        x1, y1, x2, y2,
        stroke: major ? d.colors.tickMajor : d.colors.tickMinor,
        'stroke-width': major ? 5 : 2,
        'stroke-linecap': 'round',
      }));
    }

    for (const v of ticks) {
      const p = labelAt(this.fracFor(v));
      const t = el('text', {
        x: p.x, y: p.y, fill: d.colors.text, 'font-size': sc.labelSize, 'font-weight': 700,
        'text-anchor': p.anchor, 'font-family': 'Arial, Helvetica, sans-serif',
      });
      t.textContent = this.formatTick(v, step);
      labelsG.appendChild(t);
    }
  }

  /** Unlit track / segments + the live group the update loop recolours. */
  private renderIndicatorStatic(offG: SVGGElement) {
    const d = this.design;
    const ind = d.indicator;
    const { min, max } = this.def.scale;
    this.elNeedle = null;

    if (ind.type === 'arc-segments') {
      const sweep = ind.endDeg - ind.startDeg;
      const n = Math.max(2, Math.round(ind.segments));
      const half = (Math.abs(sweep) / (n - 1)) * ind.fill / 2;
      const rOut = ind.radius + ind.thickness / 2;
      const rIn = ind.radius - ind.thickness / 2;
      for (let i = 0; i < n; i++) {
        const frac = i / (n - 1);
        const a = ind.startDeg + frac * sweep;
        const p1 = polar(rOut, a - half), p2 = polar(rOut, a + half);
        const p3 = polar(rIn, a + half), p4 = polar(rIn, a - half);
        const path = `M ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} L ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} L ${p3[0].toFixed(1)} ${p3[1].toFixed(1)} L ${p4[0].toFixed(1)} ${p4[1].toFixed(1)} Z`;
        offG.appendChild(el('path', { d: path, fill: d.colors.off, opacity: '.78', stroke: '#2c2f31', 'stroke-width': 2 }));
        const live = el('path', { d: path });
        live.dataset.value = String(min + frac * (max - min));
        this.elLive.appendChild(live);
      }
    } else if (ind.type === 'arc-smooth') {
      offG.appendChild(el('path', {
        d: arcPath(ind.radius, ind.startDeg, ind.endDeg), fill: 'none', stroke: d.colors.off,
        'stroke-opacity': '.22', 'stroke-width': ind.thickness, 'stroke-linecap': ind.roundCaps ? 'round' : 'butt',
      }));
    } else if (ind.type === 'needle') {
      if (ind.zoneBand) {
        offG.appendChild(el('path', {
          d: arcPath(ind.radius, ind.startDeg, ind.endDeg), fill: 'none',
          stroke: d.colors.off, 'stroke-opacity': '.35', 'stroke-width': 14,
        }));
        for (const [a, b] of this.warningZones()) {
          offG.appendChild(el('path', {
            d: arcPath(ind.radius, this.arcAngle(a), this.arcAngle(b)), fill: 'none',
            stroke: d.colors.warning, 'stroke-width': 14,
          }));
        }
      }
    } else if (ind.type === 'bar') {
      const n = Math.round(ind.segments);
      if (n >= 2) {
        const vertical = ind.orientation === 'vertical';
        const len = vertical ? ind.height : ind.width;
        const slot = len / n;
        const block = slot * ind.fill;
        for (let i = 0; i < n; i++) {
          const frac = i / (n - 1);
          const pos = i * slot + (slot - block) / 2;
          const r = vertical
            ? { x: ind.x, y: ind.y + ind.height - pos - block, width: ind.width, height: block }
            : { x: ind.x + pos, y: ind.y, width: block, height: ind.height };
          offG.appendChild(el('rect', { ...r, rx: ind.radius, fill: d.colors.off, opacity: '.22' }));
          const live = el('rect', { ...r, rx: ind.radius });
          live.dataset.value = String(min + frac * (max - min));
          this.elLive.appendChild(live);
        }
      } else {
        offG.appendChild(el('rect', {
          x: ind.x, y: ind.y, width: ind.width, height: ind.height, rx: ind.radius,
          fill: d.colors.off, opacity: '.22',
        }));
      }
    }
  }

  private needleSvg(ind: NeedleIndicator): SVGGElement {
    const w = ind.width;
    const g = el('g', {}) as SVGGElement;
    g.style.transformOrigin = '500px 500px';
    g.style.transformBox = 'view-box';
    g.style.transition = 'transform .12s linear';
    g.appendChild(el('polygon', {
      points: `${500 - w / 2},${500 + ind.tail} ${500 + w / 2},${500 + ind.tail} ${500 + w * 0.12},${500 - ind.length} ${500 - w * 0.12},${500 - ind.length}`,
      fill: ind.color, stroke: darker(ind.color, 0.4), 'stroke-width': 2,
    }));
    return g;
  }

  // ---------------------------------------------------------------
  // Live updates
  // ---------------------------------------------------------------

  private updateIndicator() {
    const ind = this.design.indicator;

    if (ind.type === 'arc-segments' || (ind.type === 'bar' && Math.round(ind.segments) >= 2)) {
      for (const n of [...this.elLive.children] as SVGElement[]) {
        const v = Number(n.dataset.value);
        if (v <= this.currentValue) {
          n.style.opacity = '1';
          n.setAttribute('fill', this.fillFor(this.isSegmentWarning(v), ind.type === 'bar'));
        } else {
          n.style.opacity = '0';
        }
      }
      return;
    }

    if (ind.type === 'arc-smooth') {
      this.elLive.innerHTML = '';
      for (const r of this.litRanges()) {
        this.elLive.appendChild(el('path', {
          d: arcPath(ind.radius, this.arcAngle(r.from), this.arcAngle(Math.max(r.to, r.from + 0.001))),
          fill: 'none', stroke: r.warn ? this.design.colors.warning : this.design.colors.active,
          'stroke-width': ind.thickness, 'stroke-linecap': ind.roundCaps ? 'round' : 'butt',
        }));
      }
      return;
    }

    if (ind.type === 'bar') {
      this.elLive.innerHTML = '';
      const vertical = ind.orientation === 'vertical';
      for (const r of this.litRanges()) {
        const rect = vertical
          ? { x: ind.x, y: ind.y + ind.height * (1 - r.to), width: ind.width, height: ind.height * (r.to - r.from) }
          : { x: ind.x + ind.width * r.from, y: ind.y, width: ind.width * (r.to - r.from), height: ind.height };
        this.elLive.appendChild(el('rect', { ...rect, rx: ind.radius, fill: this.fillFor(r.warn, true) }));
      }
      return;
    }

    if (ind.type === 'needle' && this.elNeedle) {
      const a = this.arcAngle(this.fracFor(this.currentValue));
      this.elNeedle.style.transform = `rotate(${a}deg)`;
    }
  }

  private drawDigit(ch: string, x: number, y: number, scale: number, color: string) {
    const gg = el('g', { transform: `translate(${x} ${y}) scale(${scale})` });
    const on = DIGIT_MAP[ch] || [];
    const off = darker(color, 0.88);
    for (const [name, pts] of Object.entries(SHAPE_MAP)) {
      const lit = on.includes(name);
      const p = el('polygon', { points: pts, fill: lit ? color : off });
      if (lit && this.design.glow) p.setAttribute('filter', `url(#digitGlow-${this.uid})`);
      gg.appendChild(p);
    }
    this.elDigits.appendChild(gg);
  }

  private renderDigits() {
    this.elDigits.innerHTML = '';
    const r = this.design.readout;
    if (!r.show) return;
    const c = this.design.colors;
    const color = r.warnColor && this.inWarning() ? c.warning : c.digits;
    const txt = this.hasReading ? this.currentValue.toFixed(this.def.precision) : '--';

    if (r.style === 'text' || !this.hasReading) {
      const t = el('text', {
        x: 500, y: READOUT_ORIGIN_Y + 52, fill: color, 'font-size': 150, 'font-weight': 800,
        'text-anchor': 'middle', 'font-family': '"Arial Black", Arial, Helvetica, sans-serif',
      });
      if (this.design.glow) t.setAttribute('filter', `url(#digitGlow-${this.uid})`);
      t.textContent = txt;
      this.elDigits.appendChild(t);
      return;
    }

    if (this.def.precision > 0) {
      // Decimal-point layout (e.g. voltage)
      const chars = [...txt];
      const scale = 0.94;
      const digitWidth = 83 * scale;
      const dotWidth = 24 * scale;
      let total = 0;
      chars.forEach((ch, i) => {
        total += ch === '.' ? dotWidth : digitWidth;
        if (i < chars.length - 1) total += ch === '.' ? 10 * scale : 18 * scale;
      });
      let x = 500 - total / 2;
      const y = 416;
      chars.forEach((ch) => {
        if (ch === '.') {
          const dot = el('circle', { cx: x + 8 * scale, cy: y + 143 * scale, r: 7 * scale, fill: color });
          if (this.design.glow) dot.setAttribute('filter', `url(#digitGlow-${this.uid})`);
          this.elDigits.appendChild(dot);
          x += dotWidth + 10 * scale;
        } else {
          this.drawDigit(ch, x, y, scale, color);
          x += digitWidth + 18 * scale;
        }
      });
    } else {
      let scale = 1.02;
      if (txt.length >= 4) scale = 0.88;
      const digitWidth = 83 * scale;
      const advance = 108 * scale;
      const total = digitWidth + (txt.length - 1) * advance;
      let x = 500 - total / 2;
      const y = 410;
      [...txt].forEach((ch) => {
        this.drawDigit(ch, x, y, scale, color);
        x += advance;
      });
    }
  }

  private renderOverlay() {
    if (!this.elOverlay) return;
    const r = this.design.readout;
    const cx = r.show ? r.x : 500;
    const cy = r.show ? r.y - 68 * r.size : 500;
    const connectionLabel = this.connectionStatus === 'stale' ? 'STALE' : this.connectionStatus === 'disconnected' ? 'OFFLINE' : this.connectionStatus === 'connecting' ? 'CONNECTING' : this.channelStatus === 'stale' ? 'STALE' : '';
    if(this.elLive) this.elLive.style.opacity = connectionLabel || this.channelStatus !== 'good' ? '0.35' : '1';
    if(this.elDigits) this.elDigits.style.opacity = connectionLabel || this.channelStatus !== 'good' ? '0.35' : '1';
    if(connectionLabel) {
      this.elOverlay.innerHTML = `<rect x="${cx-190}" y="${cy-30}" width="380" height="60" rx="8" fill="rgba(0,0,0,.85)"/><text x="${cx}" y="${cy+12}" fill="#ffbc64" font-size="28" text-anchor="middle" font-family="Arial,sans-serif">${connectionLabel}</text>`;
    } else if (this.channelStatus === 'fault') {
      this.elOverlay.innerHTML = `
        <rect x="${cx - 150}" y="${cy - 30}" width="300" height="60" rx="8" fill="rgba(0,0,0,.72)"/>
        <text x="${cx}" y="${cy + 12}" fill="#ff4444" font-size="30" font-weight="800"
              text-anchor="middle" font-family="Arial,sans-serif" letter-spacing="2">FAULT</text>`;
    } else if (this.channelStatus === 'unavailable') {
      this.elOverlay.innerHTML = `
        <rect x="${cx - 190}" y="${cy - 30}" width="380" height="60" rx="8" fill="rgba(0,0,0,.72)"/>
        <text x="${cx}" y="${cy + 12}" fill="#aaa" font-size="28" font-weight="700"
              text-anchor="middle" font-family="Arial,sans-serif" letter-spacing="2">NO SIGNAL</text>`;
    } else {
      this.elOverlay.innerHTML = '';
    }
  }

  private render() {
    if (!this.shadowRoot || !this.design || !this.def) return;
    const d = this.design;
    const u = this.uid;
    const r = d.readout;

    this.shadowRoot.innerHTML = '';
    const svg = el('svg', { viewBox: '0 0 1000 1000', role: 'img', 'aria-label': `${this.def.label} gauge` }) as SVGSVGElement;
    svg.style.cssText = 'width:100%;height:100%;display:block;overflow:visible';
    // Readout box + digits live in one group so the design can move/scale them together
    const readoutTransform =
      `translate(${r.x} ${r.y}) scale(${r.size}) translate(-500 ${-READOUT_ORIGIN_Y})`;
    svg.innerHTML = `
      ${this.defs()}
      ${this.frameSvg()}
      <g id="off-${u}"></g>
      <g id="live-${u}" ${d.glow ? `filter="url(#segmentGlow-${u})"` : ''}></g>
      <g id="ticks-${u}"></g>
      <g id="labels-${u}"></g>
      <g transform="${readoutTransform}">
        ${r.show && r.box ? `
          <rect x="322" y="398" width="356" height="185" rx="21" fill="#050607" stroke="#24282c" stroke-width="5"/>
          <rect x="335" y="411" width="330" height="159" rx="15" fill="url(#lcdGrad-${u})" stroke="#090b0d" stroke-width="3"/>` : ''}
        <g id="digits-${u}"></g>
      </g>
      ${d.unit.show ? `<text x="${d.unit.x}" y="${d.unit.y}" fill="${d.colors.text}" font-size="${d.unit.size}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" letter-spacing="2">${this.def.unit}</text>` : ''}
      ${d.label.show && d.label.accentLine ? `<line x1="${d.label.x - 70}" y1="${d.label.y - 60}" x2="${d.label.x + 70}" y2="${d.label.y - 60}" stroke="${d.colors.active}" stroke-width="6" stroke-linecap="round"/>` : ''}
      ${d.label.show ? `<text x="${d.label.x}" y="${d.label.y}" fill="${d.colors.text}" font-size="${d.label.size}" font-weight="800" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" letter-spacing="3">${this.def.label}</text>` : ''}
      <g id="needle-${u}"></g>
      <g id="overlay-${u}"></g>
    `;
    this.shadowRoot.appendChild(svg);

    this.elLive = svg.querySelector(`#live-${u}`)!;
    this.elDigits = svg.querySelector(`#digits-${u}`)!;
    this.elOverlay = svg.querySelector(`#overlay-${u}`)!;

    this.renderIndicatorStatic(svg.querySelector(`#off-${u}`)!);
    this.renderScale(svg.querySelector(`#ticks-${u}`)!, svg.querySelector(`#labels-${u}`)!);

    if (d.indicator.type === 'needle') {
      const ind = d.indicator;
      const holder = svg.querySelector(`#needle-${u}`)!;
      this.elNeedle = this.needleSvg(ind);
      holder.appendChild(this.elNeedle);
      // Hub on top of the needle
      holder.appendChild(el('circle', { cx: 500, cy: 500, r: ind.hubRadius, fill: `url(#bezelOuter-${u})`, stroke: '#111', 'stroke-width': 3 }));
      holder.appendChild(el('circle', { cx: 500, cy: 500, r: ind.hubRadius * 0.45, fill: '#111' }));
    }

    this.updateIndicator();
    this.renderDigits();
    this.renderOverlay();
  }
}

customElements.define('pc-gauge', PcGauge);
