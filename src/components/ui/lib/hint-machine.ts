export type HintState = { kind: 'closed' | 'hovered' | 'pinned' };
export function hintReducer(
  state: HintState,
  event: 'enter' | 'leave' | 'toggle' | 'close' | 'pin',
): HintState {
  switch (event) {
    case 'enter':
      return state.kind === 'pinned' ? state : { kind: 'hovered' };
    case 'leave':
      return state.kind === 'hovered' ? { kind: 'closed' } : state;
    case 'toggle':
      return { kind: state.kind === 'pinned' ? 'closed' : 'pinned' };
    case 'pin':
      return { kind: 'pinned' };
    case 'close':
      return { kind: 'closed' };
  }
}
export type TooltipState = { kind: 'unarmed' | 'closed' | 'pending' | 'open' };
export function tooltipReducer(
  state: TooltipState,
  event: 'arm' | 'wait' | 'open' | 'close',
): TooltipState {
  switch (event) {
    case 'arm':
      return state.kind === 'unarmed' ? { kind: 'closed' } : state;
    case 'wait':
      return state.kind === 'closed' ? { kind: 'pending' } : state;
    case 'open':
      return state.kind === 'unarmed' ? state : { kind: 'open' };
    case 'close':
      return state.kind === 'unarmed' ? state : { kind: 'closed' };
  }
}
