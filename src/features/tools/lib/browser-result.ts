const BROWSE_ACT_RESULT_MAX_CHARS = 11_000;

export function capBrowseActResult(result: string): string {
  if (result.length <= BROWSE_ACT_RESULT_MAX_CHARS) return result;
  return `${result.slice(0, BROWSE_ACT_RESULT_MAX_CHARS - 1)}…`;
}
