import type { GaugeDefinition, ThemeConfig } from './types';
import gaugeRegistryJson from '../../public/config/gauge_registry.json';
import themeJson from '../../public/config/theme_performance_chrome.json';

export async function loadGaugeRegistry(): Promise<GaugeDefinition[]> {
  return (gaugeRegistryJson as { gauges: GaugeDefinition[] }).gauges;
}

export async function loadTheme(): Promise<ThemeConfig> {
  return themeJson as unknown as ThemeConfig;
}
