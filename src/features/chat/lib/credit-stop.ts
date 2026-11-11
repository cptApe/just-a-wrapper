import { parseResultObject } from './tool-result-data';

/** Structured billing signals only: a tool discussing credits is not a stop. */
export function isCreditStopError(errorType: string | undefined): boolean {
  return errorType === 'billing_error' || errorType === 'CREDITS_EXHAUSTED';
}

export function isCreditStopResult(
  result: { isError: boolean; text?: string } | undefined,
): boolean {
  if (!result?.isError || !result.text) return false;
  return parseResultObject(result.text)?.code === 'CREDITS_EXHAUSTED';
}
