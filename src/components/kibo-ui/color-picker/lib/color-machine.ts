type Channels = { hue: number; saturation: number; lightness: number; alpha: number };
export type ColorState = { kind: 'synced' | 'changed'; channels: Channels };
export type ColorEvent =
  | { type: 'channel'; channel: keyof Channels; value: number }
  | { type: 'emitted'; channels: Channels };
export function colorReducer(state: ColorState, event: ColorEvent): ColorState {
  if (event.type === 'emitted')
    return state.channels === event.channels ? { ...state, kind: 'synced' } : state;
  return state.channels[event.channel].toFixed(2) === event.value.toFixed(2)
    ? state
    : {
        kind: 'changed',
        channels: { ...state.channels, [event.channel]: event.value },
      };
}
export type DragState =
  | { kind: 'idle' }
  | { kind: 'dragging'; pointerId: number; x: number; y: number };
export function dragReducer(
  state: DragState,
  event:
    | { type: 'start' | 'move'; pointerId: number; x: number; y: number }
    | { type: 'end'; pointerId: number },
): DragState {
  if (event.type === 'start')
    return state.kind === 'idle'
      ? { kind: 'dragging', pointerId: event.pointerId, x: event.x, y: event.y }
      : state;
  if (state.kind !== 'dragging' || state.pointerId !== event.pointerId) return state;
  return event.type === 'end' ? { kind: 'idle' } : { ...state, x: event.x, y: event.y };
}

export function selectionFromChannels(saturation: number, lightness: number) {
  const light = lightness / 100;
  const value = light + (saturation / 100) * Math.min(light, 1 - light);
  return { x: value === 0 ? 0 : 2 * (1 - light / value), y: 1 - value };
}
export function channelsFromSelection(x: number, y: number) {
  const value = 1 - y;
  const light = value * (1 - x / 2);
  const saturation = light === 0 || light === 1 ? 0 : (value - light) / Math.min(light, 1 - light);
  return { saturation: saturation * 100, lightness: light * 100 };
}
