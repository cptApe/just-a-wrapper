import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';

// Wrap memory-store lifecycle through the SDK.
// Stores contain text documents at hierarchical paths. Note CRUD and versions
// live in their own modules; agents write mounted files directly.

/** Create a memory store and return its `memstore_...` id. */
export async function createMemoryStore(
  client: Anthropic,
  params: { name: string; description: string; metadata: Record<string, string> },
): Promise<string> {
  const store = await client.beta.memoryStores.create({
    name: params.name,
    description: params.description,
    metadata: params.metadata,
  });
  return store.id;
}
