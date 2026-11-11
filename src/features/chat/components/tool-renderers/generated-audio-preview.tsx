'use client';
import { z } from 'zod';
import type { FileEntry } from '@/features/files/types';
import { buildOverlayHash, openOverlay } from '@/features/overlays';
import { useAsyncAction } from '@/hooks/use-async-action';
import { useChatLibraryFiles } from '../../hooks/use-chat-library-files';
import type { ToolChatItem } from '../../lib/chat-state';
import { parseResultObject } from '../../lib/tool-result-data';
import type { ToolRendererProps } from './tool-renderer-types';

const audioSchema = z.object({
  url: z.string().min(1),
  path: z.string().min(1),
  characters: z.number(),
});
function readGeneratedAudio(text: string) {
  const parsed = audioSchema.safeParse(parseResultObject(text));
  if (!parsed.success) return null;
  const filename = parsed.data.path.split('/').filter(Boolean).at(-1);
  return filename ? { ...parsed.data, filename } : null;
}

type GeneratedAudio = NonNullable<ReturnType<typeof readGeneratedAudio>>;

export function hasGeneratedAudio(item: ToolChatItem): boolean {
  return (
    item.result !== undefined &&
    !item.result.isError &&
    readGeneratedAudio(item.result.text) !== null
  );
}

function fullPath(file: FileEntry): string {
  return file.folderPath === '/' ? `/${file.filename}` : `${file.folderPath}/${file.filename}`;
}

export function GeneratedAudioPreview({ item, status }: ToolRendererProps) {
  const request = useAsyncAction();
  const library = useChatLibraryFiles(false, item.id);
  const opening = request.pending;
  if (status !== 'done' || !item.result || item.result.isError) return null;
  const audio = readGeneratedAudio(item.result.text);
  if (!audio) return null;
  const openFailed =
    library.isFetched &&
    (library.isError ||
      !library.data?.some((file) => file.url === audio.url || fullPath(file) === audio.path));

  async function openPreview(generatedAudio: GeneratedAudio) {
    await request.run(async () => {
      const response = await library.refetch();
      const file = response.data?.find(
        (candidate) =>
          candidate.url === generatedAudio.url || fullPath(candidate) === generatedAudio.path,
      );
      if (!file || response.isError) return;
      openOverlay(buildOverlayHash('file', file.id, { in: file.folderPath }));
    });
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-2" data-testid="generated-audio-preview">
      {/* Generated speech has no separate captions track. */}
      <audio
        controls
        preload="metadata"
        src={audio.url}
        aria-label={`Generated audio: ${audio.filename}`}
        className="w-full"
        data-testid="generated-audio-player"
      />
      <div className="flex min-w-0 items-center gap-3 text-meta font-medium text-muted-foreground">
        <button
          type="button"
          onClick={() => openPreview(audio)}
          disabled={opening}
          aria-busy={opening}
          className="min-w-0 truncate text-left text-foreground underline underline-offset-4 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {audio.filename}
        </button>
        {openFailed ? <span role="status">Couldn’t open the Library preview.</span> : null}
      </div>
    </div>
  );
}
