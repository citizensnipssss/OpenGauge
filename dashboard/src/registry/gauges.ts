import type { GaugeDefinition } from './types';
import gaugeRegistryJson from '../../public/config/gauge_registry.json';

export async function loadGaugeRegistry(): Promise<GaugeDefinition[]> {
  return (gaugeRegistryJson as { gauges: GaugeDefinition[] }).gauges;
}
