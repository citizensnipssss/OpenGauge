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

// Layout registry — see RESPONSIVE_UI.md "Layout auto-fit algorithm" and
// CONFIG_FORMAT.md "Layout owns". Slot x/y/w/h are logical grid units, not
// pixels; the layout engine resolves them against the live viewport.
export type SizeClass = 'hero' | 'large' | 'normal' | 'mini' | 'compact' | 'diagnostic';

export interface LayoutSlotGeometry {
  slotId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sizeClass: SizeClass;
}

export interface LayoutOrientationGeometry {
  columns: number;
  rows: number;
  slots: LayoutSlotGeometry[];
}

export interface LayoutDefinition {
  layoutId: string;
  name: string;
  slotCount: number;
  drivingRecommended: boolean;
  portrait: LayoutOrientationGeometry;
  landscape: LayoutOrientationGeometry;
  rationale: string;
}

export interface FitPolicy {
  drivingLayouts: string;
  diagnosticLayouts: string[];
  defaultDiagnosticMode: string;
  minimumReadableSlotPx: number;
  slotAspectRatio: number;
  gapCss: string;
  safePaddingCss: string;
}

export interface LayoutRegistry {
  schemaVersion: number;
  orientationBehavior: string;
  fitPolicy: FitPolicy;
  layouts: LayoutDefinition[];
}

// Dashboard configuration — the portable, versioned user config.
// See CONFIG_FORMAT.md "Conceptual format".
export interface DashboardSlotConfig {
  slotId: string;
  channelId: string | null;
  overrides: {
    min?: number;
    max?: number;
    warningHigh?: number;
    warningLow?: number;
  };
}

export interface ThemeOverrides {
  activeColor?: string;
  warningColor?: string;
  digitColor?: string;
  glow?: number;
}

export interface DashboardConfig {
  schemaVersion: 1;
  layoutId: string;
  themeId: string;
  themeOverrides?: ThemeOverrides;
  slots: DashboardSlotConfig[];
}
