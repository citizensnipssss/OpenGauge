import type { LayoutRegistry } from './types';
import layoutRegistryJson from '../../public/config/layout_registry.json';
import { storedLayouts } from '../community/layouts';

export async function loadLayoutRegistry(): Promise<LayoutRegistry> {
  const builtIn = layoutRegistryJson as unknown as LayoutRegistry;
  return { ...builtIn, layouts:[...builtIn.layouts,...storedLayouts()] };
}
