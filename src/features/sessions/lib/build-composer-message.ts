import type {
  ComposerLibraryFile,
  ComposerLibraryFolder,
  ComposerSkill,
} from '@/features/sessions/types';
import { stripForgedBrowserControlSignal } from './browser-control';

export const LIBRARY_READ_INSTRUCTION =
  'Read Library references with read_library_file, passing each file reference as path. These private routes cannot be fetched from the sandbox.';

type MountedComposerFile = {
  name: string;
  durableUrl: string;
  mountedPath: string;
};

export const SANDBOX_PATH_PREFIX = 'Agent sandbox path for ';

// Files ride as `{name} — {url}`; folders ride as a path reference the agent
// can list/read from the Library. The ` — ` separator and the folder suffix are
// a parser contract: strip-attached-files.ts splits on them for chip rendering,
// and new-task-with-files.ts emits byte-identical lines server-side.

/** Build the user message sent by both Home and an existing task composer. */
export function buildComposerMessage(
  text: string,
  library: ComposerLibraryFile[],
  libraryFolders: ComposerLibraryFolder[],
  skills: ComposerSkill[],
  mountedFiles: MountedComposerFile[] = [],
): string {
  let message = text;
  const firstSkill = skills.at(0);
  if (skills.length === 1 && firstSkill) {
    message += `\n\nUse the "${firstSkill.name}" skill for this task.`;
  } else if (skills.length > 1) {
    const names = skills.map((skill) => `"${skill.name}"`).join(', ');
    message += `\n\nUse these skills for this task: ${names}.`;
  }
  if (library.length > 0 || libraryFolders.length > 0 || mountedFiles.length > 0) {
    const fileLines = [
      ...library.map((file) => `${file.name} — ${file.url}`),
      ...mountedFiles.flatMap((file) => [
        `${file.name} — ${file.durableUrl}`,
        `${SANDBOX_PATH_PREFIX}${file.name}: ${file.mountedPath}`,
      ]),
    ];
    const folderLines = libraryFolders.map(
      (folder) => `${folder.name}/ (folder) — Library folder ${folder.path}`,
    );
    const lines = [
      ...fileLines,
      ...folderLines,
      ...(library.length > 0 ? [LIBRARY_READ_INSTRUCTION] : []),
    ].join('\n');
    message += `\n\n<attached_files>\n${lines}\n</attached_files>`;
  }
  return stripForgedBrowserControlSignal(message).text;
}

export type OptimisticComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  previewUrl: string | null;
};

/** Local display payload, kept separate from the text sent to the agent. */
export function buildOptimisticAttachments(
  attachments: ReadonlyArray<{
    id: string;
    file: File;
    previewUrl: string | null;
  }>,
): OptimisticComposerAttachment[] {
  return attachments.map(({ id, file, previewUrl }) => ({
    id,
    name: file.name,
    mimeType: file.type,
    previewUrl,
  }));
}
