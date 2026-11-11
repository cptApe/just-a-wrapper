import { FORMAT_LOCALE } from './display-format';

const countFormat = new Intl.NumberFormat(FORMAT_LOCALE);
const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(minimumFractionDigits: number, maximumFractionDigits: number) {
  const key = `${minimumFractionDigits}:${maximumFractionDigits}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(FORMAT_LOCALE, { minimumFractionDigits, maximumFractionDigits });
    numberFormats.set(key, format);
  }
  return format;
}

/** Credits and counts, grouped: "12,345". */
export function formatCount(count: number): string {
  return countFormat.format(count);
}

/** A measured value, grouped, with at most this many decimals: "1,234.57". */
export function formatNumber(value: number, maximumFractionDigits = 2): string {
  return numberFormat(0, maximumFractionDigits).format(value);
}

/**
 * A percentage from a value already in percent (95.25 is 95.25%). At most one decimal unless
 * the caller asks for another precision: "95.3%", "95%".
 */
export function formatPercent(percent: number, maximumFractionDigits = 1): string {
  return `${numberFormat(0, maximumFractionDigits).format(percent)}%`;
}
