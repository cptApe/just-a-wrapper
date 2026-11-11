'use client';

import { createContext, useContext } from 'react';
import { type DisplayFormat, FALLBACK_DISPLAY_FORMAT } from '@/lib/format/display-format';

// The reader's zone and clock, resolved on the server and handed down once, so the server
// render and the browser format every date the same way and hydration never jumps.
const DisplayFormatContext = createContext<DisplayFormat>(FALLBACK_DISPLAY_FORMAT);

export function DisplayFormatProvider({
  value,
  children,
}: {
  value: DisplayFormat;
  children: React.ReactNode;
}) {
  return <DisplayFormatContext.Provider value={value}>{children}</DisplayFormatContext.Provider>;
}

/** The zone and time format every client date, clock and relative time is formatted with. */
export function useDisplayFormat(): DisplayFormat {
  return useContext(DisplayFormatContext);
}
