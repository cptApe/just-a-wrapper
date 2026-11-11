/** A rejection-tolerant FIFO for message delivery transactions. */
export function createSerialSendQueue(): {
  run: <T>(operation: () => Promise<T>) => Promise<T>;
} {
  let tail: Promise<void> = Promise.resolve();
  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      const task = tail.then(operation);
      tail = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
  };
}
