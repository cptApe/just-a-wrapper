'use client';
import { useReducer } from 'react';
import { authFormReducer } from '../lib/auth-form-machine';
import type { AuthStep } from '../types';
export function useAuthForm(signupRefused: boolean) {
  const [state, dispatch] = useReducer(authFormReducer, {
    step: signupRefused ? 'closed' : 'email',
    email: '',
  });
  return {
    ...state,
    setEmail: (email: string) => dispatch({ type: 'email', email }),
    goToStep: (step: AuthStep) => dispatch({ type: 'step', step }),
  };
}
