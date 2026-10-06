import type { GaugeDefinition, ThemeConfig } from './types';

// Inlined so the built dashboard.html is fully self-contained (no external fetches needed)

const GAUGE_REGISTRY: GaugeDefinition[] = [
  {
    id: 'fuel_pressure', label: 'FUEL PRESS', unit: 'PSI', precision: 0,
    scale: { min: 0, max: 30 },
    warning: { mode: 'low_all_lit', low: 10 },
    telemetryKey: 'fuel_psi', demoValue: 14,
  },
  {
    id: 'trans_temp', label: 'TRANS TEMP', unit: '°F', precision: 0,
    scale: { min: 100, max: 300 },
    warning: { mode: 'high_segments', high: 220 },
    telemetryKey: 'trans_f', demoValue: 165,
  },
  {
    id: 'boost', label: 'BOOST', unit: 'PSI', precision: 0,
    scale: { min: -15, max: 40 },
    warning: { mode: 'high_segments', high: 30 },
    telemetryKey: 'boost_psi', demoValue: 0,
  },
  {
    id: 'egt', label: 'EGT', unit: '°F', precision: 0,
    scale: { min: 0, max: 1600 },
    warning: { mode: 'high_segments', high: 1250 },
    telemetryKey: 'egt_f', demoValue: 360,
  },
];

const THEME: ThemeConfig = {
  id: 'performance_chrome',
  name: 'Performance Chrome',
  colors: { active: '#ff9700', warning: '#e62929', digits: '#ff6a00' },
  geometry: {
    viewBox: [0, 0, 1000, 1000],
    arcStartDeg: -124, arcEndDeg: 124,
    segments: 34,
    segmentOuterRadius: 344, segmentInnerRadius: 306, segmentHalfAngleDeg: 3.15,
    majorTickOuterRadius: 282, majorTickInnerRadius: 261,
    minorTickOuterRadius: 288, minorTickInnerRadius: 272,
    scaleLabelRadius: 236,
  },
  display: {
    outer: { x: 322, y: 398, width: 356, height: 185, rx: 21 },
    inner: { x: 335, y: 411, width: 330, height: 159, rx: 15 },
  },
  lowerIdentity: { showIcon: false, accentLine: true, label: true },
};

export async function loadGaugeRegistry(): Promise<GaugeDefinition[]> {
  return GAUGE_REGISTRY;
}

export async function loadTheme(): Promise<ThemeConfig> {
  return THEME;
}
