## Problem

<!-- What was wrong or missing, and who it affects. Link the issue if there is one: Closes #123 -->

## Change

<!-- What behaves differently now. Note any decision in docs/decisions this touches. -->

## Checks

<!-- The checks you actually ran and what they showed. Evidence comes from running code. -->

- [ ] `pnpm verify` passes
- [ ] Targeted unit tests cover the change (`pnpm test:unit`)
- [ ] `pnpm test:integration:docker` passes, if database behavior changed
- [ ] Loading, empty, success and error states checked, if UI changed
- [ ] `pnpm env:example` run, if the environment registry changed
- [ ] `pnpm exec next typegen` run, if routes changed
- [ ] No secrets, local settings or generated evidence committed

## Limitations

<!-- What this does not cover, known gaps, and follow-ups. Write "None" if there are none. -->
