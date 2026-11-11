export type PageTextState =
  | { kind: 'sampling'; previous: string | null; latest: string }
  | { kind: 'settled'; latest: string };
export function reducePageText(
  state: PageTextState,
  action: { type: 'sample'; text: string; minMeaningfulChars: number } | { type: 'timeout' },
): PageTextState {
  if (state.kind === 'settled') return state;
  if (action.type === 'timeout') return { kind: 'settled', latest: state.latest };
  if (state.previous === action.text && action.text.trim().length >= action.minMeaningfulChars)
    return { kind: 'settled', latest: action.text };
  return { kind: 'sampling', previous: action.text, latest: action.text };
}
