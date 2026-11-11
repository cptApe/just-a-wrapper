# What an agent may do without a person

- **Status:** Accepted
- **Date:** November 2026

## Context

A member can set each connected-app action to Allow, Ask or Block. The gate could read the actions inside a direct call and a well-formed `COMPOSIO_MULTI_EXECUTE_TOOL` batch. It could not read the Tool Router workbench (`COMPOSIO_REMOTE_WORKBENCH`), the bash sandbox, or a batch input in another shape. Those calls followed the session mode, so a task run with "Skip confirmations" ran them, and through them any action the member had blocked. A "for this task" approval of such a call was stored under the meta-tool's own name and approved every later call.

Saving or changing a workspace skill ran without asking, although every member's tasks load workspace skills. Built-in tools had two deciders: the dispatcher's and a different one on the Tools page. The policy table also held wildcard rows (`*`, `*:read`, `*:write`) that every reader resolved but nothing wrote. On a Vercel preview, anyone with the link could open `/admin`.

The product owner decided:

1. Connected-app actions a member blocked never run unattended.
2. An agent asks before saving or changing a workspace skill.
3. The admin console requires sign-in on preview deployments.
4. Who sees credit use on the Members page stays as it is.

Later the owner decided that in a chat, an opaque call asks while the member has any Block, and confirmed that Ask rows stay outside the unattended rule and that every member keeps seeing credit use on the Members page (non-admins see the number without a link).

## Decision

**The unattended-block rule.** A session is unattended when it is a task run with Skip confirmations (`isUnattended` in [`resolve.ts`](../../src/features/permissions/lib/resolve.ts)). `readGatedCall` reads each gated call as exact actions, a read-only meta-tool, or opaque. Opaque means the gate cannot prove which actions the call runs: every meta-tool not on `READ_ONLY_META_TOOLS` (search, schemas, connection status), any batch with an entry it does not recognise, and any name outside the enabled toolkits. In an unattended session an opaque call is refused while the task's creator has Block on any action of any enabled toolkit (`decideOpaqueCall`). The refusal is a denied confirmation whose message tells the agent to call each action directly or through the executor instead. Then each action meets its own Allow, Ask or Block.

We chose "any Block anywhere" over "a Block the call could reach" because the gate cannot know what an opaque call reaches. The simpler rule holds without that knowledge. A member with no Block rows loses nothing.

**Person present.** In a chat, or a task run that asks, an opaque call asks for approval while the creator has Block on any action, because a person can read the call before it runs. With no Block it follows the session mode, as every other unknown call does: chats run it and asking task runs ask. A chat member with no Block rows sees no change.

**Remembered approvals name exact actions.** "For this task" is stored under each action a call runs, or under a read-only meta-tool's name. An opaque call cannot be remembered: `rememberToolApprovalForSession` refuses it and the gate ignores old rows stored under such names. "Always allow" writes Tools page rows, so it works only for calls made of real actions. `approvalScopesFor` says which scopes a call can offer.

**Skill writes ask.** `save_skill`, `update_skill` and `delete_skill` are declared `alwaysAsk`. In every permission mode the call parks for a person's approval. An unattended run waits for input as it does for any other approval. The approval card shows the skill's name, description and files with the existing approval UI. `skill.created_by_user_id` records who first saved a custom skill; rows saved before it are null. Who may edit a teammate's skill did not change.

**One decider for built-in tools.** `decideBuiltinToolGate` is the only rule. The dispatcher calls it, and the Tools page shows each row through it. A tool that always asks has a fixed "Always asks you" row, and a test fails when a declaration and its row disagree. `setToolPermissions` refuses a row the gate never reads: a built-in that is not configurable, or an action outside the toolkit it is saved under.

**Exact rows only.** The wildcard rows are gone, with their resolution and their write path. Migration `0005` deletes any that exist and adds `tool_permission_exact_tool_check`. Nothing in the app wrote them, and connecting an app writes an exact row for every action, which would have hidden a wildcard anyway.

**Admin console.** `requireAdminAccess` in `src/app/(admin)/admin-access.ts` is the one gate. The `(admin)` layout and every admin route handler call it. `adminConsoleAccess` in [`env-schema.ts`](../../src/lib/env-schema.ts) decides: off without the flag, off in production, open on a loopback app outside Vercel, and sign-in everywhere else, Vercel previews included. Local stays open because a fresh checkout may not have sign-in working yet, and the console is where its setup is checked.

## What a customer hears

A scheduled task that used the app workbench while you have any app action blocked will no longer run the workbench; it calls each app action directly instead, and the ones you blocked stay blocked.

In a chat, while you have any app action blocked, the agent asks before it uses the app workbench. Each workbench call asks, because no answer can be remembered for a call that could run any action.

## Why

A Block that an agent can step around is a control that lies. The gate is the only enforcement point, so whatever it cannot read must count as dangerous. Skills change what every teammate's tasks do, so a person should see each change before it lands. One decider means the Tools page cannot drift from enforcement.

## Consequences

- A new Tool Router meta-tool is opaque until someone adds it to `READ_ONLY_META_TOOLS` after checking that it cannot run an action.
- Explicit Ask rows are not covered by the unattended rule: an opaque call in an unattended run can still reach an action set to Ask. Extending the rule to Ask would refuse the workbench for nearly every member, because connecting an app sets every write to Ask. The owner confirmed this.
- An agent seeded before this change still reads the old skill tool descriptions until `pnpm seed:agents` runs. Enforcement does not depend on the description.
- Do not add wildcard policy rows again; add exact rows.
