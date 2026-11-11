---
name: make-it-yours
description: Turn this app into the person's own product from one sentence, such as "turn this into a legal assistant called Lexi". Changes the brand, the agent's role and voice, the theme, the bundled skills and the pricing.
---

# Make it yours

Read the request for a product name and a job. Ask once, in one message, for anything you need and cannot infer: the web address, the support email, and whether they plan to charge. Never invent an address or an email.

Work through these in order. Each `customize-*` skill is the full playbook for its step, so read it before you edit.

1. **Brand.** Follow `customize-brand`. The name, web address and support email are configuration: set `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_APP_URL` and `SUPPORT_EMAIL` in their `.env` (and tell them to set the same in their host), never in the code.
2. **Role and voice.** In `src/features/agent-setup/system-prompts.ts`, rewrite `ROLE` and `VOICE` for the new job. Leave the other sections alone, because they describe how the app works.
3. **Theme.** Follow `customize-theme`. Change the shared tokens in `src/app/globals.css` to suit the product, in both light and dark mode. Skip this step if they did not ask for a new look.
4. **Bundled skills.** Follow `customize-skills-pack`. Add the two or three skills this job needs most, and remove the ones it never uses.
5. **Pricing.** Follow `customize-pricing` only if they plan to charge. Billing stays off without Stripe, so otherwise leave it alone.
6. **Legal.** Review `content/legal.ts` and tell them the terms and privacy text is theirs to adapt. It names their product and support email from configuration, but its words describe a one-person operator.

Then run `pnpm validate:config` and fix what it reports; it names every brand value still on its placeholder. Do not run `pnpm seed:agents` yourself, because it writes to their Anthropic account.

Finish by listing what changed and telling them to run `pnpm seed:agents` and restart `pnpm dev`. The agents on Anthropic keep the old prompt until they do.
