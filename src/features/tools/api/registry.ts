import 'server-only';
import { capabilities } from '@/lib/runtime-capabilities';
import { buildCustomToolRegistry } from '../custom-tool-registry';
import type { BoundTool } from '../lib/bind-tool';

const customTools = buildCustomToolRegistry(capabilities);

export async function getCustomTool(name: string): Promise<BoundTool | undefined> {
  const load = customTools.get(name);
  return load ? load() : undefined;
}
