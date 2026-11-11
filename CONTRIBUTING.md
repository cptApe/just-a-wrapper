# Contributing

Follow the [README setup](README.md#quick-start), then read the [code standard](docs/spec/01-code-standard.md) and [patterns](docs/spec/03-patterns.md). Before changing how something fundamental works, check [the decisions folder](docs/decisions/README.md) for why it is the way it is. Use your own development database and provider accounts. Never commit secrets or local environment files.

Make focused changes on a branch. Use imperative commit subjects such as `Add workspace permission checks`; explain why in the body when it is not clear from the diff.

Run `pnpm verify` before opening a pull request. Run targeted tests during development and `pnpm test:unit` for the unit suite. For database behavior, run `pnpm test:integration:docker`, which starts and removes an isolated Docker stack. To use an existing test stack, set `TEST_DATABASE_URL` and `TEST_WS_PROXY`, then run `pnpm test:integration`. Never point tests at production. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs `pnpm verify`, the database integration suite and the Playwright smoke tests on each pull request that changes more than documentation.

Describe the problem, resulting behavior and actual checks in your pull request. Include relevant limitations. Regenerate `.env.example` with `pnpm env:example` when changing the environment registry.

Open a [bug report or feature request](https://github.com/cptApe/just-a-wrapper/issues/new/choose) before starting large work, so the approach can be agreed first. The pull request template lists the checks above. Report security problems privately as described in [SECURITY.md](SECURITY.md). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
