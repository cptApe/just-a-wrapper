'use client';

import * as React from 'react';
import type { BrowserItem } from '../components/browser/types';
import { selectionReducer } from '../lib/selection-machine';

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

// Share click, checkbox, range, modifier-toggle and select-all selection.
// The hook owns selected ids and the range anchor; callers reset on view changes.

export type BrowserSelection = {
  selected: ReadonlySet<string>;
  selectionMode: boolean;
  /** Single-click semantics (plain replace / meta toggle / shift range). */
  onItemClick: (item: BrowserItem, modifiers: { shift: boolean; meta: boolean }) => void;
  toggle: (key: string) => void;
  selectAll: () => void;
  clear: () => void;
  /** Keys to move when a drag starts on `key`: the whole selection when the
      dragged item is part of it, else just the dragged item. */
  dragKeysFor: (key: string) => string[];
};

export function useBrowserSelection(items: BrowserItem[]): BrowserSelection {
  const [state, dispatch] = React.useReducer(selectionReducer, { kind: 'empty' });
  const selected = state.kind === 'selected' ? state.keys : EMPTY_SELECTION;
  const anchor = state.kind === 'selected' ? state.anchor : null;
  const selectableKeys = React.useMemo(
    () => items.filter((i) => i.selectable).map((i) => i.key),
    [items],
  );

  // Items can disappear under the selection (delete, refetch, facet change) —
  // consumers see the DERIVED intersection, so stale keys can never inflate
  // the action-bar count (no state write needed).
  const effectiveSelected = React.useMemo(() => {
    if (selected.size === 0) return selected;
    const valid = new Set(selectableKeys);
    const next = new Set([...selected].filter((k) => valid.has(k)));
    return next.size === selected.size ? selected : next;
  }, [selected, selectableKeys]);

  if (effectiveSelected.size !== selected.size) dispatch({ type: 'prune', keys: selectableKeys });
  const toggle = React.useCallback((key: string) => dispatch({ type: 'toggle', key }), []);

  const onItemClick = React.useCallback(
    (item: BrowserItem, modifiers: { shift: boolean; meta: boolean }) => {
      if (!item.selectable) return;
      if (modifiers.shift && anchor !== null) {
        const from = selectableKeys.indexOf(anchor);
        const to = selectableKeys.indexOf(item.key);
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from <= to ? [from, to] : [to, from];
          const range = selectableKeys.slice(lo, hi + 1);
          // Shift extends from the anchor over the existing selection.
          dispatch({ type: 'range', keys: range });
          return;
        }
      }
      if (modifiers.meta) {
        toggle(item.key);
        return;
      }
      dispatch({ type: 'only', key: item.key });
    },
    [selectableKeys, toggle, anchor],
  );

  const selectAll = React.useCallback(() => {
    dispatch({ type: 'all', keys: selectableKeys });
  }, [selectableKeys]);

  const clear = React.useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);

  const dragKeysFor = React.useCallback(
    (key: string) => (effectiveSelected.has(key) ? [...effectiveSelected] : [key]),
    [effectiveSelected],
  );

  // Esc leaves selection mode (unless something else claimed the key).
  React.useEffect(() => {
    if (effectiveSelected.size === 0) return undefined;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !e.defaultPrevented) clear();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [effectiveSelected.size, clear]);

  return {
    selected: effectiveSelected,
    selectionMode: effectiveSelected.size > 0,
    onItemClick,
    toggle,
    selectAll,
    clear,
    dragKeysFor,
  };
}
