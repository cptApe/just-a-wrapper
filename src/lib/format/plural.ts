import { formatCount } from './format-number';

/** The noun alone for a count: "file" for 1, "files" otherwise. */
export function pluralNoun(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

/** A grouped count and its noun: "1 file", "2 files", "1,204 files". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatCount(count)} ${pluralNoun(count, one, many)}`;
}
