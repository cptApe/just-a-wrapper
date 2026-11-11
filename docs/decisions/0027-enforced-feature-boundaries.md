# Enforced feature boundaries instead of one public door

- **Status:** Accepted. The edge map half is superseded by [decision 0040](0040-layered-features.md).
- **Date:** November 2026

## Context

Code standard 6.2 and [decision 0007](0007-feature-folders-and-thin-routes.md) said a feature has one public door: `index.ts`, plus `server.ts` for routes and a browser entry for client code. A lint rule enforced the door for API routes only, and there it held. Everywhere else it did not. A count found 639 imports past the door: 498 from other features, 125 from pages and layouts, and 15 from `src/lib`, `src/hooks` and `src/components`. A recount that also follows relative paths found 679.

Several `index.ts` files already told callers to import deep files, because the barrel pulled in server code or formed a cycle. Shared layers imported feature internals, so the layer meant to sit below every feature depended on chat, files and sessions. The overlays feature imported overlay components from 13 features, and those features imported `openOverlay` from it. That put 12 pairs of features in a cycle through overlays.

## Decision

The route rule stays: an API route imports a feature through `index.ts` or `server.ts`. The door rule no longer applies to feature-to-feature or page imports. Two lint rules replace it:

- `just-a-wrapper/no-shared-feature-import`: nothing in `src/lib`, `src/hooks`, `src/components` or `src/db` imports a feature. `src/lib/auth.ts` is the one exemption, because Better Auth takes its hooks in one config object.
- A rule on feature-to-feature imports. This decision listed every allowed edge in a generated map; [decision 0040](0040-layered-features.md) replaces the map with an ordered layer table and `just-a-wrapper/no-upward-feature-import`.

Code with one owner moved into that owner. The overlay host and registry moved to `src/app/_overlays`, so the overlays feature imports no other feature.

## Why

Barrels everywhere would bring back import cycles, and client bundles would pull in whole features. The direction of a dependency matters more than its entry file. A shared layer that imports a feature makes everything a cycle. An unlisted edge between features is an architecture change that should be visible in review. The edge map is short enough to read as the architecture diagram.

## Consequences

- A feature-to-feature import that points up the layer table fails lint ([decision 0040](0040-layered-features.md)).
- Pages, layouts and features may import any file of a feature they can reach. A barrel is still the right place for what most callers need.
- Shared UI that needs feature behaviour takes it as a prop. `AppDataProviders` takes chat's `resetWorkspaceClientState` this way, and the `/app` layout passes it in through `src/app/app/_providers`.
