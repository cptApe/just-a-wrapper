import type { AuthStep } from '../types';
export type AuthFormState = { step: AuthStep; email: string };
export type AuthFormEvent = { type: 'email'; email: string } | { type: 'step'; step: AuthStep };
const moves: Record<AuthStep, readonly AuthStep[]> = {
  email: ['otp', 'closed'],
  otp: ['email'],
  closed: ['email'],
};
export function authFormReducer(state: AuthFormState, event: AuthFormEvent): AuthFormState {
  if (event.type === 'email') return { ...state, email: event.email };
  if (!moves[state.step].includes(event.step)) return state;
  return { ...state, step: event.step };
}
