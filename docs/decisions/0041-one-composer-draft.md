# One composer draft, one send-failure path

- **Status:** Accepted
- **Date:** November 2026

## Context

The composer held its draft in five separate `useState`s: text, files, Library files, folders and skills. Four places merged or cleared them by hand, and `useComposerSubmit` took 17 parameters only to copy the draft and clear it. Putting a draft back after a failed send had four owners and three stores: the composer's own restore, a per-task pick store (`attachment-recovery-store`) beside the text in localStorage, and a Home stash (`home-restore`) fed by two places in the Home send. A sixth kind of pick meant editing about six call sites, and a missed one dropped part of the draft without a sound.

Home and a task each classified a failed send themselves. On Home, credits that ran out between creating a chat and sending its first message showed the fetch's log line, `POST /api/sessions/<id>/send failed (402)`, in the "Add credits" banner; a chats-at-once refusal at the same point did the same. The same "out of credits" banner offered the top-up dialog on Home and a link to the billing page in a task. In a task a chats-at-once refusal showed only a failed bubble with no reason.

The skills picker listed every workspace skill, while a session loads only published ones that are not being deleted. In a task it also offered skills created after the task started, which that agent never received.

## Decision

- **One draft value.** `ComposerDraft` (`src/features/chat/lib/composer-draft.ts`) holds text, files and every kind of pick. `reduceComposerDraft` is pure and returns the same object when an event changes nothing, so the store can say whether it moved. Its events: text, attach, attachment (an upload moved), detach, pick (add), choose (replace a kind), unpick, clear, release and restore. Every kind of pick and what makes two picks the same lives in one function, `eachPickKind`; a new kind is one line there and one renderer.
- **One store, keyed by where the composer sits.** `src/features/chat/lib/draft-store.ts` keeps one draft per key: a task's session id, `#home` for Home and `#opening` for the composer under a Home opening while its chat is created. A task's text and cursor go to localStorage as before. A draft outlives its composer: when the last composer on a key leaves the page, Home's draft clears and a task keeps only its text, which is what component state did.
- **One restore function.** A failed send calls `restoreComposerDraft(key, draft)`. The composer's submit does it for a rejected `onSend`, and the Home send does it for a failed opening, also folding back what was typed under the opening. A delivered opening moves the `#opening` draft to the new task the same way. It works whether or not a composer shows the key; the next composer on the key shows it, rebuilds image previews and restarts interrupted uploads.
- **Submitting** reads the draft once, clears it once, and passes the snapshot to `onSend` as `ComposerSubmission.draft`.
- **The hooks each do one job:** `useComposerDraft` (read and hold the key), `useComposerUploads`, `useComposerSubmit`, `useComposerInput`. `composerStatus` derives what the composer may do on every render. The `Composer` component wires them and passes plain props to the card, input and toolbar.
- **One send-failure path.** `classifySendFailure` gives every kind a sentence a person can read: the server's (`context.serverMessage`), the typed create error's, or a fixed fallback, and never the fetch's own message. `showSendFailureBanner` shows the out-of-credits banner (the server's sentence and "Add credits", which opens the top-up dialog) and the chats-at-once banner (no action) for Home and tasks alike. A task shows one out-of-credits bar at a time: the composer's balance notice stands down while that banner shows, and a credit-paused task's own banner hides it (`omit` on `ComposerBannerSlot`). Attachment failures that are not our sentence read "The attachment could not be prepared."
- **Skills.** `listAttachableSkills` in the skills feature is the one predicate. Session creation attaches that set; the Home picker lists it. In a task the picker lists only the skills in the session's own agent snapshot (`sessions.retrieve(...).agent.skills`), filtered by the same predicate, and only the task's creator can ask.
- **Per-session state.** `ChatView` keys its body by `sessionId` itself, so a mount without a `key` cannot show one chat's transcript, pending sends or tool requests in another. `useMachineStore` is the one way to mount a reducer store that needs a synchronous snapshot or a "did it move" answer; plain `useReducer` covers the rest.

## Why

A draft is one thing the person made; keeping it as one value makes "clear", "restore" and "move to the new task" each a single event, and the reducer can be tested without React. Keying the store by place, not by component, is what lets a failed send land even after the composer left the page, without a second store for that case. Reading the snapshot of the session's agent is the only way to know what that agent loaded without recording it ourselves.

## Consequences

- Opening the skills picker in a task makes one provider read.
- Restored Home files keep their finished upload instead of uploading again.
- A new kind of pick: a field on `ComposerDraft`, a line in `eachPickKind`, a renderer in `ComposerAttachments`.
