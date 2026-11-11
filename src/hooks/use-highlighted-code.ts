'use client';
import { code, type HighlightResult } from '@streamdown/code';
import { useEffect, useState } from 'react';

type SupportedCodeLanguage = Parameters<typeof code.supportsLanguage>[0];

function isSupportedCodeLanguage(language: string): language is SupportedCodeLanguage {
  return code.getSupportedLanguages().some((supported) => supported === language);
}

export function useHighlightedCode(source: string, language: string, incomplete: boolean) {
  const [highlightState, setHighlightState] = useState<{
    key: string;
    result: HighlightResult;
  } | null>(null);
  const key = `${language}\u0000${source}`;

  useEffect(() => {
    if (incomplete || !isSupportedCodeLanguage(language)) return;
    const attempt = new AbortController();
    const apply = (result: HighlightResult) => {
      if (!attempt.signal.aborted) setHighlightState({ key, result });
    };
    const result = code.highlight({ code: source, language, themes: code.getThemes() }, apply);
    if (result) apply(result);
    return () => {
      attempt.abort();
    };
  }, [incomplete, key, language, source]);

  return highlightState?.key === key ? highlightState.result : null;
}
