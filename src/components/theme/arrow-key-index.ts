/** Left and right arrows move one segment and wrap; other keys do nothing. */
export function arrowKeyIndex(key: string, activeIndex: number, length: number): number | null {
  const delta = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
  if (delta === 0 || length === 0) return null;
  return (activeIndex + delta + length) % length;
}
