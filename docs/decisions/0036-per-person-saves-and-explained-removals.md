# Saves are per person, and the storage sweep stops only on removals nothing explains

- **Status:** Accepted
- **Date:** November 2026

## Context

An agent output (an artifact) belongs to its task, and everyone who can read the task can save a copy into their own Library. That copy is private to the person who saved it. The artifact row had one `saved_drive_file_id` column. On a shared task the first saver took the only slot, and every teammate saw "Save to Library" again after a reload. A filename lookup in `/Artifacts` stood in for the missing state, so a renamed or moved copy led to a duplicate.

The daily stored-file sweep deletes blobs no row references. A brake stops it when more than 100 blobs, and more than half of a prefix, look unreferenced, because that pattern means a path bug. A trash purge deleted rows first and left their blobs for the sweep. A large purge then tripped the brake every day, and only a code change could clear it.

## Decision

**Saves.** `artifact_save` holds one row per artifact and person, pointing at that person's Library file. Its key is `(artifact_id, user_id)`, and `file_id` is unique. Every read joins the viewer's own row (`viewerSave`). `claimArtifactSave` records a copy and returns the one already recorded when there is one. Trashing a file deletes its save row, so that person can save again; nobody else is affected. The column is gone. The migration moves each live linked save to the person who owns the copy, and links each other person's newest matching copy in `/Artifacts`, once.

**Sweep.** The trash purge removes each expired file's bytes by its own stored paths, then deletes only the rows whose bytes are gone. A row whose bytes could not be removed stays for the next run. The prefix sweep counts a candidate as explained when the workspace or account that owns its path no longer exists, because a workspace or account purge removed it on purpose. The brake counts only unexplained candidates. The report carries `explainedBlobs`.

**Storage off.** Blob storage is a capability (`capabilities.storage`). `storageCapability()` throws the existing "File uploads are off" sentence, and every blob wrapper rethrows typed errors instead of wrapping them as an upstream failure. Artifact routes use the shared route error mapping.

## Why

"Saved" is a fact about a person, so it needs a row per person. A filename is not an identity.

The brake exists to catch a bug that makes live bytes look unreferenced. Bytes whose rows a person or a purge removed on purpose are not that bug, and the database can tell them apart without an operator flag.

## Consequences

- Each teammate sees their own saved state on a shared task. Saving twice returns the same copy, wherever it was moved.
- A large trash purge or workspace purge finishes without a code change. A path bug still stops the sweep and reports it.
- A blob under a live workspace that no row references still counts toward the brake, as before.
- Do not reintroduce a per-artifact saved column or a filename lookup for saves.
