import { plural } from './plural';

/** A span in words, rounded to the nearest unit: "42 seconds", "2 minutes". Never "0 seconds". */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  if (seconds < 60) return plural(seconds, 'second');
  return plural(Math.max(1, Math.round(milliseconds / 60_000)), 'minute');
}

/** A running timer: "0:07", "1:35", "12:00". Rounds down so it never runs ahead. */
export function formatTimer(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
