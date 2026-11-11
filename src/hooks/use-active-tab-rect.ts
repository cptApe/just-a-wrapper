'use client';
import * as React from 'react';

interface IndicatorRect {
  left: number;
  width: number;
}

export function useActiveTabRect(
  listRef: React.RefObject<HTMLElement | null>,
): IndicatorRect | null {
  const [rect, setRect] = React.useState<IndicatorRect | null>(null);

  React.useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const update = () => {
      const active = list.querySelector<HTMLElement>('[data-state="active"]');
      if (!active) {
        setRect(null);
        return;
      }
      setRect({ left: active.offsetLeft, width: active.offsetWidth });
    };

    update();
    const mutations = new MutationObserver(update);
    mutations.observe(list, { attributes: true, attributeFilter: ['data-state'], subtree: true });
    const resizes = new ResizeObserver(update);
    resizes.observe(list);
    for (const child of list.children) resizes.observe(child);
    return () => {
      mutations.disconnect();
      resizes.disconnect();
    };
  }, [listRef]);

  return rect;
}
