/* eslint-disable just-a-wrapper/no-raw-color-literals -- card network marks use the networks' fixed brand colors, which themes must not change. */
import type { ReactNode } from 'react';

// Brand tiles draw the card networks' own colors, so they stay outside the theme tokens and the
// shared icon set. Only the generic tile follows the theme.
type CardBrandTile = 'visa' | 'mastercard' | 'amex' | 'discover' | 'generic';

const BRAND_TILES = new Map<string | null, CardBrandTile>([
  ['visa', 'visa'],
  ['mastercard', 'mastercard'],
  ['amex', 'amex'],
  ['discover', 'discover'],
]);

const TILE_NAMES: Record<CardBrandTile, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  generic: 'Card',
};

const TILE_ART: Record<CardBrandTile, ReactNode> = {
  visa: (
    <>
      <rect width="24" height="16" rx="2.5" fill="#1434CB" />
      <path
        transform="translate(3.6 -0.4) scale(0.7)"
        fill="#FFFFFF"
        d="M9.112 8.262L5.97 15.758H3.92L2.374 9.775c-.094-.368-.175-.503-.461-.658C1.447 8.864.677 8.627 0 8.479l.046-.217h3.3a.904.904 0 01.894.764l.817 4.338 2.018-5.102zm8.033 5.049c.008-1.979-2.736-2.088-2.717-2.972.006-.269.262-.555.822-.628a3.66 3.66 0 011.913.336l.34-1.59a5.207 5.207 0 00-1.814-.333c-1.917 0-3.266 1.02-3.278 2.479-.012 1.079.963 1.68 1.698 2.04.756.367 1.01.603 1.006.931-.005.504-.602.725-1.16.734-.975.015-1.54-.263-1.992-.473l-.351 1.642c.453.208 1.289.39 2.156.398 2.037 0 3.37-1.006 3.377-2.564m5.061 2.447H24l-1.565-7.496h-1.656a.883.883 0 00-.826.55l-2.909 6.946h2.036l.405-1.12h2.488zm-2.163-2.656l1.02-2.815.588 2.815zm-8.16-4.84l-1.603 7.496H8.34l1.605-7.496z"
      />
    </>
  ),
  mastercard: (
    <>
      <rect width="24" height="16" rx="2.5" fill="#111111" />
      <circle cx="9.75" cy="8" r="4.5" fill="#EB001B" />
      <circle cx="14.25" cy="8" r="4.5" fill="#F79E1B" />
      <path d="M12 4.1A4.5 4.5 0 0 1 12 11.9A4.5 4.5 0 0 1 12 4.1Z" fill="#FF5F00" />
    </>
  ),
  amex: (
    <>
      <rect width="24" height="16" rx="2.5" fill="#1F9DDB" />
      <text
        x="12"
        y="10.3"
        fill="#FFFFFF"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="6.4"
        fontWeight="700"
        textAnchor="middle"
        textLength="18"
        lengthAdjust="spacingAndGlyphs"
      >
        AMEX
      </text>
    </>
  ),
  discover: (
    <>
      <rect width="24" height="16" rx="2.5" fill="#FFFFFF" />
      <text
        x="12"
        y="8.6"
        fill="#1A1A1A"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="3.7"
        fontWeight="700"
        textAnchor="middle"
        textLength="19"
        lengthAdjust="spacingAndGlyphs"
      >
        DISCOVER
      </text>
      <path d="M24 10.5V13.5A2.5 2.5 0 0 1 21.5 16H10C16 15.5 21 13.5 24 10.5Z" fill="#F58220" />
      <rect
        x="0.25"
        y="0.25"
        width="23.5"
        height="15.5"
        rx="2.25"
        fill="none"
        stroke="#000000"
        strokeOpacity="0.12"
        strokeWidth="0.5"
      />
    </>
  ),
  generic: (
    <>
      <rect width="24" height="16" rx="2.5" className="fill-muted" />
      <rect y="3.5" width="24" height="3" className="fill-muted-foreground" fillOpacity="0.45" />
      <rect
        x="3"
        y="10"
        width="7"
        height="1.75"
        rx="0.5"
        className="fill-muted-foreground"
        fillOpacity="0.7"
      />
    </>
  ),
};

/** The small rounded brand tile Stripe's payments table puts beside a card number. */
export function CardBrandIcon({ brand }: { brand: string | null }) {
  // Stripe adds new networks over time, and a non-card payment method has no brand at all.
  const tile = BRAND_TILES.get(brand) ?? 'generic';
  return (
    <svg
      role="img"
      aria-label={TILE_NAMES[tile]}
      data-card-brand={tile}
      width="21"
      height="14"
      viewBox="0 0 24 16"
      className="shrink-0"
    >
      {TILE_ART[tile]}
    </svg>
  );
}
