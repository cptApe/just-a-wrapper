'use client';

import { useEffect, useState } from 'react';
import type { IntegrationView } from '../types';

const OPENING_VIEW_MAX_AGE_MS = 1_000;

type OpeningIntegrationView = {
  view: IntegrationView;
  recordedAt: number;
};

let openingView: OpeningIntegrationView | null = null;

export function rememberOpeningIntegrationView(view: IntegrationView, now = Date.now()): void {
  openingView = { view, recordedAt: now };
}

function readOpeningIntegrationView(slug: string, now = Date.now()): IntegrationView | null {
  if (
    openingView === null ||
    openingView.view.slug !== slug ||
    now - openingView.recordedAt > OPENING_VIEW_MAX_AGE_MS
  ) {
    return null;
  }
  return openingView.view;
}

export function useOpeningIntegrationView(slug: string): IntegrationView | null {
  const [initialView] = useState(() => readOpeningIntegrationView(slug));

  useEffect(() => {
    if (openingView?.view === initialView) openingView = null;
  }, [initialView]);

  return initialView;
}
