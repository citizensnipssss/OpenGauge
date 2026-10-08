import type { GaugeDefinition, ThemeConfig } from './types';
import gaugeRegistryJson from '../../public/config/gauge_registry.json';
import themeJson from '../../public/config/theme_performance_chrome.json';
import bebopJson from '../../public/config/theme_bebop_2071.json';

export async function loadGaugeRegistry(): Promise<GaugeDefinition[]> {
  return (gaugeRegistryJson as { gauges: GaugeDefinition[] }).gauges;
}

export async function loadThemes(): Promise<ThemeConfig[]> {
  return [themeJson, bebopJson] as unknown as ThemeConfig[];
}
