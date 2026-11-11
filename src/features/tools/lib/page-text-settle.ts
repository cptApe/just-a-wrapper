import { type PageTextState, reducePageText } from './page-text-machine';
// Runs in the remote page: XML and SVG documents may have no HTML body.
export function readDocumentBodyText(): string {
  return document.querySelector('body')?.innerText ?? '';
}

type SettlePageTextInput = {
  sample: () => Promise<string>;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
  budgetMs: number;
  intervalMs: number;
  minMeaningfulChars: number;
};

/**
 * Poll page text until a meaningful render repeats or the settle budget ends.
 * A timeout is a successful best-effort read: callers receive the last sample.
 */
export async function settlePageText({
  sample,
  sleep,
  now,
  budgetMs,
  intervalMs,
  minMeaningfulChars,
}: SettlePageTextInput): Promise<string> {
  const deadline = now() + budgetMs;
  let state: PageTextState = { kind: 'sampling', previous: null, latest: '' };
  while (state.kind === 'sampling') {
    const remaining = deadline - now();
    const sampled = remaining > 0 ? await sampleBeforeTimeout(sample, remaining) : undefined;
    state = reducePageText(
      state,
      sampled === undefined
        ? { type: 'timeout' }
        : { type: 'sample', text: sampled, minMeaningfulChars },
    );
    if (state.kind === 'sampling') await sleep(Math.max(0, Math.min(intervalMs, deadline - now())));
  }
  return state.latest;
}

const SAMPLE_TIMEOUT = Symbol('sample-timeout');

/** Bound a sampler that has no native timeout, clearing the timer when it wins. */
async function sampleBeforeTimeout(
  sample: () => Promise<string>,
  timeoutMs: number,
): Promise<string | undefined> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = new Promise<typeof SAMPLE_TIMEOUT>((resolve) => {
    timeout = setTimeout(() => resolve(SAMPLE_TIMEOUT), timeoutMs);
  });

  try {
    const result = await Promise.race([sample(), timeoutResult]);
    return result === SAMPLE_TIMEOUT ? undefined : result;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
