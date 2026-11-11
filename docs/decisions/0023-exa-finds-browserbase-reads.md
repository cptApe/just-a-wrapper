# Exa finds pages and Browserbase reads the hard ones

- **Status:** Accepted
- **Date:** July 2026, re-checked September 2026

## Context

Agents search the web, read pages and sometimes need a real browser. Anthropic offers built-in web tools, and Exa and Browserbase offer overlapping search and fetch products.

## Decision

With an Exa key, agents use `web_search_exa` and `fetch_page`, and the built-in web tools are off. With Browserbase keys, agents get the `browse_*` tools for pages that need a real browser. Each is optional and is chosen once by the [capabilities resolver](0009-capabilities-resolved-once.md). Without keys, agents use Anthropic's web tools and a sandbox browser.

## Why

We compared the vendors in September 2026, from docs and live probes:

- Browserbase Search is powered by Exa. It had the same price with fewer controls.
- Browserbase's Fetch API does not run JavaScript and cost more than Exa Contents.
- Exa's live crawl failed on a bot-walled single-page site, returning the same near-empty shell each time.

So each vendor does the job it does best. Bot-wall features such as verified fingerprints and CAPTCHA solving are session features, which our browser tools use.

## Consequences

- Provider keys stay inside their capability.
- `browse_page` must wait for the page to render before reading it.
- `browse_page` bills its browser like every other browser use, at the provider's one-minute minimum, through the browser lifecycle ([0038](0038-every-browser-on-a-row.md)).
- Vendor prices and features move, so re-check before replacing a vendor.
- Do not add a fallback from one provider to another at runtime.
