import type { GaugeDefinition, ThemeConfig } from '../../registry/types';

// Seven-segment shape polygons — GAUGE_SYSTEM_SPEC.md "Digital display".
// These are fixed artwork constants owned by the theme, not per-gauge data.
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

/**
 * <pc-gauge> — one reusable Performance Chrome SVG gauge.
 * Driven entirely by gauge metadata (GaugeDefinition) + theme metadata
 * (ThemeConfig). See CLAUDE.md "Most important implementation rule":
 * this must reproduce all 11 reference_gauges/ from config alone.
 */
export class PcGauge extends HTMLElement {
  private def!: GaugeDefinition;
  private theme!: ThemeConfig;
  private uid: string;
  private currentValue = 0;
  private svg!: SVGSVGElement;
  private elLive!: SVGGElement;
  private elOff!: SVGGElement;
  private elTicks!: SVGGElement;
  private elLabels!: SVGGElement;
  private elDigits!: SVGGElement;

  constructor() {
    super();
    this.uid = `pcg${instanceCounter++}`;
    this.attachShadow({ mode: 'open' });
  }

  configure(def: GaugeDefinition, theme: ThemeConfig) {
    this.def = def;
    this.theme = theme;
    this.currentValue = def.demoValue;
    this.render();
  }

  set value(v: number) {
    this.currentValue = v;
    if (this.elLive) {
      this.updateSegments();
      this.renderDigits();
    }
  }
  get value() {
    return this.currentValue;
  }

  private angleFor(v: number) {
    const { arcStartDeg, arcEndDeg } = this.theme.geometry;
    const sweep = arcEndDeg - arcStartDeg;
    const frac = Math.max(0, Math.min(1, (v - this.def.scale.min) / (this.def.scale.max - this.def.scale.min)));
    return arcStartDeg + frac * sweep;
  }

  private polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
    const a = ((angleDeg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }

  private segmentPath(angle: number): string {
    const g = this.theme.geometry;
    const halfDeg = g.segmentHalfAngleDeg;
    const a1 = angle - halfDeg;
    const a2 = angle + halfDeg;
    const p1 = this.polar(500, 500, g.segmentOuterRadius, a1);
    const p2 = this.polar(500, 500, g.segmentOuterRadius, a2);
    const p3 = this.polar(500, 500, g.segmentInnerRadius, a2);
    const p4 = this.polar(500, 500, g.segmentInnerRadius, a1);
    return `M ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} L ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} L ${p3[0].toFixed(1)} ${p3[1].toFixed(1)} L ${p4[0].toFixed(1)} ${p4[1].toFixed(1)} Z`;
  }

  /** Determines whether a given lit segment renders in warning color. */
  private isSegmentWarning(segValue: number): boolean {
    const w = this.def.warning;
    switch (w.mode) {
      case 'high_segments':
        return w.high !== undefined && segValue >= w.high;
      case 'low_all_lit':
        return w.low !== undefined && this.currentValue <= w.low;
      case 'outside_band_all_lit':
        return (
          (w.low !== undefined && this.currentValue <= w.low) ||
          (w.high !== undefined && this.currentValue >= w.high)
        );
      default:
        return false;
    }
  }

  private updateSegments() {
    const nodes = [...this.elLive.children] as SVGPathElement[];
    nodes.forEach((n) => {
      const v = Number(n.dataset.value);
      if (v <= this.currentValue) {
        n.style.opacity = '1';
        n.setAttribute('fill', this.isSegmentWarning(v) ? `url(#warnGrad-${this.uid})` : `url(#activeGrad-${this.uid})`);
      } else {
        n.style.opacity = '0';
      }
    });
  }

  private renderSegments() {
    this.elOff.innerHTML = '';
    this.elLive.innerHTML = '';
    const g = this.theme.geometry;
    const { min, max } = this.def.scale;
    for (let i = 0; i < g.segments; i++) {
      const frac = i / (g.segments - 1);
      const angle = g.arcStartDeg + frac * (g.arcEndDeg - g.arcStartDeg);
      const segValue = min + frac * (max - min);
      const d = this.segmentPath(angle);

      const off = document.createElementNS(SVG_NS, 'path');
      off.setAttribute('d', d);
      off.setAttribute('fill', '#b9bec2');
      off.setAttribute('opacity', '.78');
      off.setAttribute('stroke', '#2c2f31');
      off.setAttribute('stroke-width', '2');
      this.elOff.appendChild(off);

      const live = document.createElementNS(SVG_NS, 'path');
      live.setAttribute('d', d);
      live.dataset.value = String(segValue);
      this.elLive.appendChild(live);
    }
    this.updateSegments();
  }

  private formatTick(v: number, step: number) {
    const abs = Math.abs(step);
    if (abs >= 1) return String(Math.round(v));
    if (abs >= 0.1) return v.toFixed(1);
    return v.toFixed(2);
  }

  private renderScale() {
    this.elTicks.innerHTML = '';
    this.elLabels.innerHTML = '';
    const g = this.theme.geometry;
    const { min, max } = this.def.scale;
    const { ticks, step } = makeTicks(min, max, 7);
    const minorDiv = step === 0 ? 1 : 5;
    const minorStep = step / minorDiv;
    let start = Math.ceil(min / minorStep) * minorStep;

    for (let v = start; v <= max + minorStep * 0.25; v += minorStep) {
      if (v < min - 1e-6) continue;
      const major = ticks.some((t) => Math.abs(t - v) < minorStep * 0.08);
      const angle = this.angleFor(v);
      const [x1, y1] = this.polar(500, 500, major ? g.majorTickOuterRadius : g.minorTickOuterRadius, angle);
      const [x2, y2] = this.polar(500, 500, major ? g.majorTickInnerRadius : g.minorTickInnerRadius, angle);
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', String(x1));
      line.setAttribute('y1', String(y1));
      line.setAttribute('x2', String(x2));
      line.setAttribute('y2', String(y2));
      line.setAttribute('stroke', major ? '#f1f3f5' : '#7f858b');
      line.setAttribute('stroke-width', major ? '5' : '2');
      line.setAttribute('stroke-linecap', 'round');
      this.elTicks.appendChild(line);
    }

    ticks.forEach((v) => {
      const angle = this.angleFor(v);
      const [x, y] = this.polar(500, 500, g.scaleLabelRadius, angle);
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', String(x));
      text.setAttribute('y', String(y + 7));
      text.setAttribute('fill', '#f4f5f7');
      text.setAttribute('font-size', '31');
      text.setAttribute('font-weight', '700');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-family', 'Arial, Helvetica, sans-serif');
      text.textContent = this.formatTick(v, step);
      this.elLabels.appendChild(text);
    });
  }

  private drawDigit(ch: string, x: number, y: number, scale: number, color: string) {
    const gg = document.createElementNS(SVG_NS, 'g');
    gg.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`);
    const on = DIGIT_MAP[ch] || [];
    const off = darker(color, 0.88);
    for (const [name, pts] of Object.entries(SHAPE_MAP)) {
      const p = document.createElementNS(SVG_NS, 'polygon');
      p.setAttribute('points', pts);
      p.setAttribute('fill', on.includes(name) ? color : off);
      if (on.includes(name)) p.setAttribute('filter', `url(#digitGlow-${this.uid})`);
      gg.appendChild(p);
    }
    this.elDigits.appendChild(gg);
  }

  private renderDigits() {
    this.elDigits.innerHTML = '';
    const color = this.theme.colors.digits;
    const txt = this.currentValue.toFixed(this.def.precision);

    if (this.def.precision > 0) {
      // Decimal-point layout (e.g. voltage) — matches reference_gauges/voltage.html
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
          const c = document.createElementNS(SVG_NS, 'circle');
          c.setAttribute('cx', String(x + 8 * scale));
          c.setAttribute('cy', String(y + 143 * scale));
          c.setAttribute('r', String(7 * scale));
          c.setAttribute('fill', color);
          c.setAttribute('filter', `url(#digitGlow-${this.uid})`);
          this.elDigits.appendChild(c);
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

  private buildStaticSvg(): SVGSVGElement {
    const t = this.theme;
    const u = this.uid;
    const [, , w, h] = t.geometry.viewBox;
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${this.def.label} gauge`);
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';

    svg.innerHTML = `
      <defs>
        <radialGradient id="bezelOuter-${u}" cx="42%" cy="35%" r="70%">
          <stop offset="0%" stop-color="#f4f5f6"/><stop offset="16%" stop-color="#a7adb2"/>
          <stop offset="35%" stop-color="#f7f7f7"/><stop offset="58%" stop-color="#777d82"/>
          <stop offset="76%" stop-color="#d7dadd"/><stop offset="100%" stop-color="#34383c"/>
        </radialGradient>
        <linearGradient id="bezelInner-${u}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0a0b0c"/><stop offset="40%" stop-color="#34383b"/>
          <stop offset="65%" stop-color="#050607"/><stop offset="100%" stop-color="#1d2023"/>
        </linearGradient>
        <radialGradient id="faceGrad-${u}" cx="50%" cy="45%" r="65%">
          <stop offset="0%" stop-color="#151718"/><stop offset="65%" stop-color="#090a0b"/><stop offset="100%" stop-color="#020303"/>
        </radialGradient>
        <linearGradient id="lcdGrad-${u}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#111315"/><stop offset="45%" stop-color="#020303"/><stop offset="100%" stop-color="#0c0e10"/>
        </linearGradient>
        <linearGradient id="activeGrad-${u}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lighter(t.colors.active, 0.36)}"/>
          <stop offset="36%" stop-color="${t.colors.active}"/>
          <stop offset="100%" stop-color="${darker(t.colors.active, 0.28)}"/>
        </linearGradient>
        <linearGradient id="warnGrad-${u}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lighter(t.colors.warning, 0.3)}"/>
          <stop offset="35%" stop-color="${t.colors.warning}"/>
          <stop offset="100%" stop-color="${darker(t.colors.warning, 0.38)}"/>
        </linearGradient>
        <pattern id="carbon-${u}" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="16" height="16" fill="#0b0c0d"/><rect width="8" height="16" fill="#111315"/>
          <rect x="8" width="8" height="16" fill="#070809"/>
          <path d="M0 0H16M0 8H16" stroke="#1d2022" stroke-width="1" opacity=".6"/>
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
      </defs>
      <circle cx="500" cy="500" r="472" fill="#080909" filter="url(#softShadow-${u})"/>
      <circle cx="500" cy="500" r="455" fill="url(#bezelOuter-${u})" stroke="#f4f5f6" stroke-width="4"/>
      <circle cx="500" cy="500" r="414" fill="url(#bezelInner-${u})" stroke="#1a1c1e" stroke-width="7"/>
      <circle cx="500" cy="500" r="383" fill="url(#faceGrad-${u})" stroke="#090a0b" stroke-width="3"/>
      <circle cx="500" cy="500" r="372" fill="url(#carbon-${u})" opacity=".78"/>
      <circle cx="500" cy="500" r="360" fill="rgba(0,0,0,.42)"/>
      <g id="offSegments-${u}"></g>
      <g id="liveSegments-${u}" filter="url(#segmentGlow-${u})"></g>
      <g id="ticks-${u}"></g>
      <g id="labels-${u}"></g>
      <rect x="${t.display.outer.x}" y="${t.display.outer.y}" width="${t.display.outer.width}" height="${t.display.outer.height}" rx="${t.display.outer.rx}" fill="#050607" stroke="#24282c" stroke-width="5"/>
      <rect x="${t.display.inner.x}" y="${t.display.inner.y}" width="${t.display.inner.width}" height="${t.display.inner.height}" rx="${t.display.inner.rx}" fill="url(#lcdGrad-${u})" stroke="#090b0d" stroke-width="3"/>
      <g id="digits-${u}"></g>
      <text id="unitText-${u}" x="500" y="625" fill="#e5e8eb" font-size="30" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" letter-spacing="2">${this.def.unit}</text>
      ${t.lowerIdentity.accentLine ? `<line id="accentLine-${u}" x1="430" y1="730" x2="570" y2="730" stroke="${t.colors.active}" stroke-width="6" stroke-linecap="round"/>` : ''}
      ${t.lowerIdentity.label ? `<text id="labelText-${u}" x="500" y="790" fill="#f4f5f7" font-size="48" font-weight="800" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" letter-spacing="3">${this.def.label}</text>` : ''}
    `;
    return svg;
  }

  private render() {
    if (!this.shadowRoot) return;
    this.shadowRoot.innerHTML = '';
    this.svg = this.buildStaticSvg();
    this.shadowRoot.appendChild(this.svg);

    const u = this.uid;
    this.elOff = this.svg.querySelector(`#offSegments-${u}`)!;
    this.elLive = this.svg.querySelector(`#liveSegments-${u}`)!;
    this.elTicks = this.svg.querySelector(`#ticks-${u}`)!;
    this.elLabels = this.svg.querySelector(`#labels-${u}`)!;
    this.elDigits = this.svg.querySelector(`#digits-${u}`)!;

    this.renderSegments();
    this.renderScale();
    this.renderDigits();
  }
}

customElements.define('pc-gauge', PcGauge);
