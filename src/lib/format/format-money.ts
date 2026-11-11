import { FORMAT_LOCALE } from './display-format';

// Currency exponents vary: JPY is not divided by 100.
function currencyAmount(amountMinor: number, currency: string) {
  const code = currency.toUpperCase();
  const digits =
    new Intl.NumberFormat(FORMAT_LOCALE, { style: 'currency', currency: code }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return { code, digits, amount: amountMinor / 10 ** digits };
}

/** "$20", "$1,234.50": whole amounts drop the trailing ".00"; parts keep full precision. */
export function formatMoney(amountMinor: number, currency: string): string {
  const { code, digits, amount } = currencyAmount(amountMinor, currency);
  const precision = amount % 1 === 0 ? 0 : digits;
  return new Intl.NumberFormat(FORMAT_LOCALE, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(amount);
}

/** Vendor rates keep sub-cent precision so small metered costs stay visible: "$0.013". */
export function formatVendorRate(amountMinor: number, currency: string): string {
  const { code, amount } = currencyAmount(amountMinor, currency);
  const precision =
    amount === 0 ? 2 : Math.min(4, Math.max(2, 1 - Math.floor(Math.log10(Math.abs(amount)))));
  return new Intl.NumberFormat(FORMAT_LOCALE, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: precision,
  }).format(amount);
}
