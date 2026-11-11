// Client-safe public surface of the files feature: the share views, the Library query shape and
// shared types. Server functions live in `@/features/files/server`; the reusable browser in
// `@/features/files/browser`.

export type { LibraryFilesPage } from './api/load';
export type { SyncedSessionAttachment } from './api/sync-metadata';
export { ShareFileView } from './components/share-file-view';
export { ShareView } from './components/share-view';
export { filesQueryKey, type LibraryTab } from './lib/library-items';
export type { FolderEntry, UploadConfig } from './types';
