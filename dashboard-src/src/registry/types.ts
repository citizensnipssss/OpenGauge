// Semantic gauge/channel metadata — owned by the PID/gauge definition,
// not the theme. See GAUGE_SYSTEM_SPEC.md "Theme/PID/layout separation".

export type WarningMode = 'high_segments' | 'low_all_lit' | 'outside_band_all_lit' | 'none';

export interface WarningConfig {
  mode: WarningMode;
  high?: number;
  low?: number;
}

export interface GaugeDefinition {
  id: string;
  label: string;
  unit: string;
  precision: number;
  scale: { min: number; max: number };
  warning: WarningConfig;
  telemetryKey: string;
  demoValue: number;
}

// Theme owns geometry/appearance only — see GAUGE_SYSTEM_SPEC.md.
export interface ThemeConfig {
  id: string;
  name: string;
  colors: {
    active: string;
    warning: string;
    digits: string;
  };
  geometry: {
    viewBox: [number, number, number, number];
    arcStartDeg: number;
    arcEndDeg: number;
    segments: number;
    segmentOuterRadius: number;
    segmentInnerRadius: number;
    segmentHalfAngleDeg: number;
    majorTickOuterRadius: number;
    majorTickInnerRadius: number;
    minorTickOuterRadius: number;
    minorTickInnerRadius: number;
    scaleLabelRadius: number;
  };
  display: {
    outer: { x: number; y: number; width: number; height: number; rx: number };
    inner: { x: number; y: number; width: number; height: number; rx: number };
  };
  lowerIdentity: {
    showIcon: boolean;
    accentLine: boolean;
    label: boolean;
  };
}
