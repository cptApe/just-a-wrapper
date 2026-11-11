# One answer to "what kind of file is this"

- **Status:** Accepted
- **Date:** November 2026

## Context

Three modules classified files, each with its own extension lists, its own mime cleanup and its own label. Chat had `fileTypeKind`, the Library classified by viewer kind, and the share page checked mime strings inline. Two exported functions were both named `fileTypeLabel` and returned different things. The Library's video check skipped the mime cleanup, so `VIDEO/MP4` was not video. Four icon tables drew the same kind differently, and one comment claimed the Library mirrored chat when it did not.

## Decision

- **`src/features/files/lib/file-types.ts` is the one classifier.** `fileKind(mime, name)` returns one `FileKind`: a specific mime wins, and the extension fills in for generic mimes. The module also holds `baseMime`, `fileExtension`, the extension and mime lists the SQL type facets read, the Shiki language table, `fileKindLabel` (chat's "Spreadsheet") and `fileExtensionBadge` (the Library's "CSV").
- **The viewer keeps its own split.** `classifyArtifact` in `artifact-kind.ts` answers a different question, which renderer opens a file (docx, xlsx, pptx, csv, markdown), and builds on the same helpers.
- **One glyph and one tint per kind, on every surface.** `src/features/files/components/file-kind-icon.tsx` holds one table from `FileKind` to a glyph and a `--file-*` colour family. Chat, the Library, the composer's Library picker, the task-files overlay and the share page all draw from it through `FileKindIcon`, `fileKindGlyph` and `fileGlyphTone`; each surface sets only the size. The set is the Library's, with `IconPackage` for archives so no known kind falls back to the plain file glyph. Archives and unknown files stay muted. The table is in `docs/spec/08-design-system.md`.

## Why

- One classifier means one place to add a format, and every surface agrees on what a file is.
- The product owner chose the Library's styling and colours for every surface: a file looks the same wherever a person meets it.
- `--file-*` has dark-mode values and is held to 3:1 on every surface; the chat-only `--file-icon-*` family had neither, so it is gone.

## Consequences

- Surfaces that classified by viewer kind or by mime alone now follow `fileKind`. A Library tile for `.doc`, `.xls`, `.ppt` or an image known only by its extension gets its kind's glyph and tint instead of the plain file glyph; plain text shows as a document, not code.
- The per-surface tables and the `--file-icon-*` tokens are deleted. Adding a kind or changing a glyph is one row in one table.
- Chat shows video with a play circle, code with a code-file glyph, and code and HTML in violet. The share page and task-files overlay show PDFs, slides, audio, video, code and HTML with their own glyphs and tints instead of a grey file.
