import type { ThemeEditState, ThemeEditValues } from '../types';
import { EMPTY_THEME_EDIT_VALUES } from './theme-values';
export type ThemeEditEvent =
  | { type: 'activate' | 'deactivate' | 'discard' }
  | { type: 'update' | 'prune'; values: ThemeEditValues };
export function themeEditReducer(state: ThemeEditState, event: ThemeEditEvent): ThemeEditState {
  switch (event.type) {
    case 'activate':
      return { ...state, active: true };
    case 'deactivate':
      return { ...state, active: false };
    case 'discard':
      return { ...state, ...EMPTY_THEME_EDIT_VALUES };
    case 'update':
      return state.active ? { ...state, ...event.values } : state;
    case 'prune':
      return { ...state, ...event.values };
  }
}
