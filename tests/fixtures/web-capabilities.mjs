export const PAID_PROVIDERS = {
  googleSignIn: { kind: 'off' },
  email: { kind: 'off' },
  media: { kind: 'gateway', apiKey: 'fixture' },
  webSearch: { kind: 'exa', apiKey: 'test-exa' },
  browser: { kind: 'browserbase', apiKey: 'test-browser', projectId: 'test-project' },
  billing: { kind: 'off' },
  connectedApps: { kind: 'off' },
  storage: { kind: 'off' },
};
export const NATIVE_PROVIDERS = {
  googleSignIn: { kind: 'off' },
  email: { kind: 'off' },
  media: { kind: 'off' },
  webSearch: { kind: 'anthropic' },
  browser: { kind: 'sandbox' },
  billing: { kind: 'off' },
  connectedApps: { kind: 'off' },
  storage: { kind: 'off' },
};
export const WEB_COMBINATIONS = Object.fromEntries(
  ['exa', 'anthropic'].flatMap((search) =>
    ['browserbase', 'sandbox'].map((browser) => [
      `${search}-${browser}`,
      {
        googleSignIn: { kind: 'off' },
        email: { kind: 'off' },
        media: PAID_PROVIDERS.media,
        webSearch: search === 'exa' ? PAID_PROVIDERS.webSearch : NATIVE_PROVIDERS.webSearch,
        browser: browser === 'browserbase' ? PAID_PROVIDERS.browser : NATIVE_PROVIDERS.browser,
        billing: { kind: 'off' },
        connectedApps: { kind: 'off' },
        storage: { kind: 'off' },
      },
    ]),
  ),
);
