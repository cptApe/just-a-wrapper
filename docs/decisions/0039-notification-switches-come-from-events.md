# Notification switches come from the events, and people controls say why before they refuse

- **Status:** Accepted
- **Date:** November 2026

## Context

The owner's rule: nothing fake in the app. Every control does what it says or is gone.

Settings → Notifications showed a Product updates row, a weekly or instant digest editor and a Team & sharing Email switch. No event belonged to product updates, nothing read the digest, and none of the Team & sharing events sends email. The row list and the event table were two lists kept by hand.

A schedule's "Email + App" and "Email only" emailed only a person who had been away for ten minutes, so an active person who chose "Email only" got nothing. The email for a paused schedule or a missed run said "Stopped on an error." while the feed item gave the real reason. An email the retry sweep never sent stayed `pending` forever, and a late retry ignored a person who had since turned email off or left.

On the Members page a member's credit number was a link to a page that shows only the member's own usage, admins were offered inviting an owner, and "Remove from workspace" was offered on your own row. Each was refused after the click.

A cache clear for the Tool Router URL compared against the URL it replaced. A mint that started from an empty cache could land after a clear and keep old account pins for a week.

## Decision

- **Rows and channels are derived from the event table.** Each event in `NOTIFICATION_EVENTS` names its preference category. `categoryChannels` gives a category an In-app switch when it has events and an Email switch when one of its events sends email. The settings page, its skeleton and the write action all use it, and a unit test proves each shown channel maps to an event. Product updates, the digest and the Team & sharing Email switch are gone, with their column and CHECK values.
- **A schedule's email choice is the person's choice.** `notify()` with `email: 'force'` sends whether or not the person is away; preference email still waits for away. The stored notification records why (`emailReason`), and the email footer says so.
- **The email says what the feed says.** A notification email uses the emitter's `body` when there is one and the event's fixed copy otherwise. The owner confirmed the `task.completed` fixed copy, "The task finished." A paused notice's feed button reads "Add credits", as every other out-of-credits surface does.
- **Every email claim ends.** `notificationEmailMachine` gains `expired` and lets `pending` or an abandoned `sending` move to `skipped`. The sweep expires rows older than a day, even with email off, and before each retry checks the account is live, the person is still a member and, for preference email, the switch is still on.
- **Time format has one server function.** `resolveTimeFormat({ timeFormat, locale })` returns `'12h' | '24h'`: the setting, else the locale's hour cycle, else 12-hour. `getDisplayPreferences(headers)` gives server renders `{ timeZone, timeFormat }`, with the locale from Accept-Language. An email has no locale and passes `null`.
- **People controls refuse first, with the server's reason.** A member sees credit numbers as text. The invite dialog disables Owner for a non-owner with the role menu's reason. Your own row's "Remove from workspace" is disabled with the sentence the server would return.
- **The Tool Router cache has a generation.** `workspace_member.tool_router_generation` goes up on every clear and every mint. A mint persists only onto the generation it read before resolving pins, so a clear always wins. A mint that loses to a clear mints once more from the cleared row.
- **Dead columns go.** `workspace_member.personalization_prompt`, `workspace.jurisdiction` and `integration.connected_at` were written or read on one side only. `tool_request.kind` and `toolkit` held only the request kind; the old tool feedback rows move into `message_feedback` as app feedback before the columns drop.

## Why

A list of switches kept apart from the events drifts the moment either changes. Deriving one from the other makes a fake switch impossible to add by accident. Refusing in the UI with the server's own sentence keeps one rule and one explanation for each refusal.

## Consequences

- Adding an event that sends email to a category gives that category an Email switch with no page edit.
- Do not add a notification row, channel or cadence without an event that delivers on it.
- Rows stored before this change carry no `emailReason` and read as preference email.
