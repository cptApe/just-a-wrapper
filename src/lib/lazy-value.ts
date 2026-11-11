// A disabled capability is a cached value too. A failed constructor leaves initialization retryable.
export function lazyValue<T>(create: () => T): () => T {
  let state: { kind: 'uninitialized' } | { kind: 'ready'; value: T } = { kind: 'uninitialized' };
  return () => {
    if (state.kind === 'ready') return state.value;
    const value = create();
    state = { kind: 'ready', value };
    return value;
  };
}
