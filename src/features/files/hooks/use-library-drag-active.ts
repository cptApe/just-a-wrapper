'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { dragCarriesItems } from '../components/browser/types';
import { beginDrag, dragSnapshot, serverDragSnapshot, subscribeDrag } from '../lib/drag-store';

export function useLibraryDragActive(): boolean {
  const state = useSyncExternalStore(subscribeDrag, dragSnapshot, serverDragSnapshot);
  useEffect(() => {
    const enter = (event: DragEvent) => {
      if (
        event.dataTransfer !== null &&
        dragCarriesItems(event.dataTransfer) &&
        dragSnapshot().kind === 'idle'
      )
        beginDrag([]);
    };
    window.addEventListener('dragover', enter);
    return () => window.removeEventListener('dragover', enter);
  }, []);
  return state.kind === 'dragging';
}
