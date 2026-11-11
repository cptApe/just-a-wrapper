export type BrowserContextStore = {
  read: () => Promise<string | null>;
  create: () => Promise<string>;
  claim: (contextId: string) => Promise<string | null>;
  discard: (contextId: string) => Promise<void>;
};

/** Converge concurrent first-use calls on the context id stored by the winner. */
export async function ensureBrowserContext(store: BrowserContextStore): Promise<string | null> {
  const existing = await store.read();
  if (existing) return existing;
  const created = await store.create();
  const claimed = await store.claim(created);
  if (claimed !== created) await store.discard(created);
  return claimed;
}
