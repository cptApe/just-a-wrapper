# A share link's grant is checked each time it is used

- **Status:** Accepted
- **Date:** November 2026

## Context

Some share links need a role or ownership to create: root folder links need an admin, and edit links need the folder's creator or an admin. The check ran only at creation. A link made by an admin kept working after that person lost the role. Deleting a workspace keeps its rows for a retention window, and its links kept resolving in that window.

## Decision

One rule decides who may hold a link: `shareGrantRefusal` in [`live-share.ts`](../../src/features/files/api/live-share.ts). Creating a link asks it. Using a link asks it again for the link's creator, through `shareLinkState`. A link whose creator no longer qualifies reads as revoked.

One liveness rule covers every public link: `publicLinkState` in [`share-token.ts`](../../src/lib/share-token.ts). A link in a workspace that is not live reads as revoked. File and task links both use it.

A link exposes only what its creator can see now, through `shareFileScope`. The list of a target's links never returns tokens.

## Why

A link is a standing grant. If its conditions are checked only once, a role change or a deletion cannot take it back.

## Consequences

- Every file and folder link resolver loads the creator's current role and the workspace state with the link, through `loadShare`. Task links need no role, and removing a member revokes their task links.
- Demoting a member silently disables their admin-only links. The rows stay, so restoring the role brings them back.
- Do not add a resolver that reads `revokedAt` and `expiresAt` alone. The share dialog's list reads the same query (`selectShares`) and returns `shareLinkState` for each link, so its owner sees what visitors get.
