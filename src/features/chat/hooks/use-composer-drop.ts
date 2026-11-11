'use client';
import { useReducer } from 'react';
import { type ComposerDragState, reduceComposerDrag } from '../lib/composer-drag-machine';

const initial: ComposerDragState = { kind: 'inactive' };

export function useComposerDrop(enabled: boolean, addFiles: (files: FileList) => void) {
  const [state, dispatch] = useReducer(reduceComposerDrag, initial);
  return {
    active: state.kind === 'active',
    props: enabled
      ? {
          onDragEnter(event: React.DragEvent) {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.stopPropagation();
            dispatch('enter');
          },
          onDragOver(event: React.DragEvent) {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            event.stopPropagation();
          },
          onDragLeave(event: React.DragEvent) {
            event.stopPropagation();
            dispatch('leave');
          },
          onDrop(event: React.DragEvent) {
            event.preventDefault();
            event.stopPropagation();
            dispatch('drop');
            addFiles(event.dataTransfer.files);
          },
        }
      : {},
  };
}
