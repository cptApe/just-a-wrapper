type StreamRead<T> =
  | { kind: 'event'; event: IteratorResult<T> }
  | { kind: 'error'; cause: unknown };
// A disconnect can abort a prefetched read while the consumer handles the previous event.
export function pendingStreamRead<T>(iterator: AsyncIterator<T>): Promise<StreamRead<T>> {
  return iterator.next().then<StreamRead<T>, StreamRead<T>>(
    (event) => ({ kind: 'event', event }),
    (cause: unknown) => ({ kind: 'error', cause }),
  );
}
