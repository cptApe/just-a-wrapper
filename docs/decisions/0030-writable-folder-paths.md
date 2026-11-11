# Writing into a folder path needs every existing folder on it to be writable

- **Status:** Accepted
- **Date:** November 2026

## Context

A member can navigate a teammate's private folder when it holds one of their own files. Uploads, moves and agent tools checked only that the target path was valid. A member could therefore add a file inside a teammate's private folder. The folder's owner could then not rename, move or delete it, because it held a file they did not own.

## Decision

Before any write into a path, `refuseTeammateFoldersOnPath` in [`team-folder.ts`](../../src/features/files/lib/team-folder.ts) checks every existing folder on that path, the path itself included. Each one must pass `folderWritableBy`: created by the caller, or inside `/Team`, or `/Chat uploads`. Uploads, folder creation, moves and agent file tools all call it.

The agent output folders (`/Artifacts`, `/Generated images`, `/Generated videos`, `/Generated audio`, `/Transcripts`) accept every member's files. They are `AGENT_OUTPUT_FOLDER_PATHS` in [`paths.ts`](../../src/features/files/lib/paths.ts). Renaming, moving or deleting those folders still follows `folderWritableBy`.

## Why

Seeing a folder must not grant control over it. Agents write into the same output folders for every member, so those folders cannot belong to whoever created them first.

## Consequences

- A new write path into the Library calls `refuseTeammateFoldersOnPath` before it inserts.
- Adding a new shared output folder means adding it to `AGENT_OUTPUT_FOLDER_PATHS`.
- The refusal message names no teammate and no file.
