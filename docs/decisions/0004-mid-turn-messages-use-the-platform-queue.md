# Messages sent mid-turn use the platform's queue

- **Status:** Accepted
- **Date:** September 2026

## Context

A person can send another message while the agent is still working. The app can either send it right away and let the platform queue it, or hold it in the browser so it can be edited or merged.

## Decision

A mid-turn send posts immediately as a `user.message`. The queued cards above the composer show status only. The one action on a card is Retry, shown when the POST itself failed. See [`composer-queue.tsx`](../../src/features/chat/components/composer-queue.tsx).

A message counts as queued while its `processed_at` is null.

## Why

Once a message reaches the platform it cannot be changed or withdrawn, because the events API is append-only.

Live probes in September 2026 showed how the platform drains the queue:

- At a tool step, all queued messages join the next model request. One reply can answer several.
- At the end of a turn, exactly one queued message starts each new inference. N queued messages get N replies.

We looked at client-side holding, a dismissable queue and interrupt-based batching, and kept plain serial sends. The turn-end gap is a platform behaviour.

## Consequences

- Use `processed_at` to decide a message's place. Do not infer it from run status at the time of the send.
- The store keeps unprocessed messages as a stable suffix, so live order matches replay order.
- Idle events between queued turns are not a reliable turn boundary.
- Do not add edit or withdraw controls to queued cards. The platform cannot honour them.
