import type { LayoutDefinition, LayoutOrientationGeometry, FitPolicy } from '../registry/types';

export interface FitResult {
  unitPx: number;
  gapPx: number;
  columns: number;
  rows: number;
  orientation: 'portrait' | 'landscape';
  scrollMode: boolean;
}

// Cheap resolver for the simple px values fitPolicy uses in practice; the
// full clamp()/env() expressions in layout_registry.json are also applied
// verbatim as CSS by dashboard-view, this is only for the JS-side unit math.
function parseCssLength(value: string, fallback: number): number {
  const m = value.match(/(-?\d+(?:\.\d+)?)px/);
  return m ? Number(m[1]) : fallback;
}

export function pickOrientation(width: number, height: number): 'portrait' | 'landscape' {
  return width >= height ? 'landscape' : 'portrait';
}

// RESPONSIVE_UI.md "Layout auto-fit algorithm".
export function computeFit(
  geometry: LayoutOrientationGeometry,
  fitPolicy: FitPolicy,
  containerWidth: number,
  containerHeight: number,
  isDiagnostic: boolean,
  diagnosticMode: 'fit-all' | 'readable-scroll',
): FitResult {
  const gapPx = parseCssLength(fitPolicy.gapCss, 12);
  const { columns, rows } = geometry;

  const rawUnit = Math.min(
    (containerWidth - gapPx * (columns - 1)) / columns,
    (containerHeight - gapPx * (rows - 1)) / rows,
  );

  let unitPx = Math.max(0, Math.floor(rawUnit));
  let scrollMode = false;

  if (isDiagnostic && diagnosticMode === 'readable-scroll' && unitPx < fitPolicy.minimumReadableSlotPx) {
    unitPx = fitPolicy.minimumReadableSlotPx;
    scrollMode = true;
  }

  return { unitPx, gapPx, columns, rows, orientation: pickOrientation(containerWidth, containerHeight), scrollMode };
}

/**
 * Keeps a layout container fitted to its available space, live — refits on
 * resize, rotation, and browser-chrome changes rather than a one-time
 * measurement. See RESPONSIVE_UI.md "Runtime resize handling".
 */
export class LayoutFitController {
  private ro: ResizeObserver;
  private container: HTMLElement;
  private layout: LayoutDefinition;
  private fitPolicy: FitPolicy;
  private diagnosticMode: 'fit-all' | 'readable-scroll';
  private onFit?: (result: FitResult, geometry: LayoutOrientationGeometry) => void;

  constructor(
    container: HTMLElement,
    layout: LayoutDefinition,
    fitPolicy: FitPolicy,
    diagnosticMode: 'fit-all' | 'readable-scroll' = 'fit-all',
    onFit?: (result: FitResult, geometry: LayoutOrientationGeometry) => void,
  ) {
    this.container = container;
    this.layout = layout;
    this.fitPolicy = fitPolicy;
    this.diagnosticMode = diagnosticMode;
    this.onFit = onFit;
    this.ro = new ResizeObserver(() => this.refit());
    this.ro.observe(container);
  }

  setLayout(layout: LayoutDefinition, diagnosticMode: 'fit-all' | 'readable-scroll' = 'fit-all') {
    this.layout = layout;
    this.diagnosticMode = diagnosticMode;
    this.refit();
  }

  refit() {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const orientation = pickOrientation(rect.width, rect.height);
    const geometry = this.layout[orientation];
    const isDiagnostic = this.layout.layoutId === 'diagnostic-eleven';

    const result = computeFit(geometry, this.fitPolicy, rect.width, rect.height, isDiagnostic, this.diagnosticMode);

    // Literal px track sizes (not var() inside repeat()) for reliable cross-
    // browser grid support. justify/align-content center the tracks when
    // the computed grid is smaller than the container's fit-viewport box.
    this.container.style.display = 'grid';
    this.container.style.gridTemplateColumns = `repeat(${geometry.columns}, ${result.unitPx}px)`;
    this.container.style.gridTemplateRows = `repeat(${geometry.rows}, ${result.unitPx}px)`;
    this.container.style.gap = `${result.gapPx}px`;
    this.container.style.justifyContent = 'center';
    this.container.style.alignContent = 'center';
    this.container.style.setProperty('--layout-unit', `${result.unitPx}px`);
    this.container.style.setProperty('--layout-gap', `${result.gapPx}px`);
    this.container.style.overflowY = result.scrollMode ? 'auto' : 'hidden';
    this.container.classList.toggle('layout-scroll', result.scrollMode);

    this.onFit?.(result, geometry);
  }

  destroy() {
    this.ro.disconnect();
  }
}
