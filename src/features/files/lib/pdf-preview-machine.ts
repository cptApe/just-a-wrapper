export type PdfRenderState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; pages: number; total: number };
type Gesture = { kind: 'rest' } | { kind: 'drag'; pointerId: number; x: number; y: number };
export type PdfPreviewState = { render: PdfRenderState; zoom: number; gesture: Gesture };
export const initialPdfPreview: PdfPreviewState = {
  render: { kind: 'loading' },
  zoom: 1,
  gesture: { kind: 'rest' },
};
export type PdfPreviewEvent =
  | { type: 'render'; render: PdfRenderState }
  | { type: 'zoom'; zoom: number }
  | { type: 'drag'; pointerId: number; x: number; y: number }
  | { type: 'release' };
export function pdfPreviewReducer(state: PdfPreviewState, event: PdfPreviewEvent): PdfPreviewState {
  switch (event.type) {
    case 'render':
      return { ...state, render: event.render };
    case 'zoom':
      return {
        ...state,
        zoom: event.zoom,
        gesture: event.zoom === 1 ? { kind: 'rest' } : state.gesture,
      };
    case 'drag':
      return state.zoom > 1
        ? {
            ...state,
            gesture: { kind: 'drag', pointerId: event.pointerId, x: event.x, y: event.y },
          }
        : state;
    case 'release':
      return { ...state, gesture: { kind: 'rest' } };
  }
}
