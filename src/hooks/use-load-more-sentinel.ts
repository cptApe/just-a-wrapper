'use client';

import * as React from 'react';

/**
 * A ref for the 1px node at the end of a paged list: it asks for the next page when the node
 * scrolls into view. The observer is made again each time `canLoadMore` turns back on, because a
 * node still in view after a page lands never crosses the edge again and would stall the list.
 */
export function useLoadMoreSentinel<T extends Element>({
  canLoadMore,
  loadMore,
  rootMargin,
}: {
  /** True while another page exists and none is loading. */
  canLoadMore: boolean;
  loadMore: () => void;
  /** Starts the next page this far before the end comes into view. */
  rootMargin?: string;
}): React.RefCallback<T> {
  return React.useCallback(
    (node: T | null) => {
      if (!node || !canLoadMore) return undefined;
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) loadMore();
        },
        rootMargin === undefined ? undefined : { rootMargin },
      );
      observer.observe(node);
      return () => observer.disconnect();
    },
    [canLoadMore, loadMore, rootMargin],
  );
}
