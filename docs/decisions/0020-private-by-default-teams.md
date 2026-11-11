# Private by default, with one Team folder

- **Status:** Accepted
- **Date:** July 2026, tightened November 2026

## Context

The first team version showed every member every task.

## Decision

Tasks and files are private to their creator, including from owners and admins. Sharing is an explicit act.

- A shared task appears in a Team group in the sidebar. Teammates can read it and save outputs. Only the creator can send messages, approve tools or control its browser.
- The Library has one shared place, the `/Team` folder. Everything else stays with the person who created it.
- There are no per-task roles or access lists.

[13-privacy.md](../spec/13-privacy.md) has the table of who can read and write each resource, with the function that enforces each rule.

## Why

Trust is what lets an owner invite people, and every share should be a deliberate act. We avoided roles and access lists to keep the model simple.

The first shared tasks accepted writes from teammates. In November 2026 we made them read-only for teammates as part of tightening member privacy. Custom tools run with the creator's permissions and data access.

## Consequences

- Every new list, search or read must use the existing predicates, such as `sessionVisibleToViewer`, `taskVisibleToViewer` and `fileVisibleTo`, never plain workspace scoping.
- Writes use their own checks: [0028](0028-separate-read-and-write-grants.md) for sessions and tasks, [0030](0030-writable-folder-paths.md) for folder paths, and [0029](0029-share-links-checked-on-use.md) for share links.
- Private events reach only their creator. Visibility events carry no content.
- Do not add an admin view into private work.
