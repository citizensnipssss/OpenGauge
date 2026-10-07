import type { LayoutRegistry } from './types';
import layoutRegistryJson from '../../public/config/layout_registry.json';

export async function loadLayoutRegistry(): Promise<LayoutRegistry> {
  return layoutRegistryJson as unknown as LayoutRegistry;
}
