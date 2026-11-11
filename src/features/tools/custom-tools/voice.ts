import { unsavedMediaError } from '../lib/paid-tool-error';
// The dispatcher gates each run on its estimate and bills the completed Gateway request through
// generation accrual.
import 'server-only';
import { creditsForVendorCents } from '@/features/billing/lib/credit-math';
import {
  MEDIA_ESTIMATE_CENTS,
  speechEstimateCents,
  transcriptionEstimateCents,
} from '@/features/billing/pricing-config';
import { readBlobBytes } from '@/features/files/api/blob-storage';
import { importDriveFile } from '@/features/files/api/import-drive-file';
import { ensureLibraryFolderPath } from '@/features/files/api/library-operations';
import { joinPath, normalizeFolderPath, TRANSCRIPTS_FOLDER_PATH } from '@/features/files/lib/paths';
import type { CustomTool, ToolContext } from '@/features/tool-catalog/types';
import {
  GENERATE_AUDIO_DECL,
  type GenerateAudioInput,
  GenerateAudioInputSchema,
  type GenerateAudioOutput,
  GenerateAudioOutputSchema,
  inlineTranscript,
  mp3Filename,
  TRANSCRIBE_AUDIO_DECL,
  type TranscribeAudioInput,
  TranscribeAudioInputSchema,
  type TranscribeAudioOutput,
  TranscribeAudioOutputSchema,
  transcriptFilename,
} from '@/features/tool-catalog/voice';
import { MAX_AUDIO_BYTES } from '@/features/voice';
import {
  DEFAULT_VOICE_ID,
  ELEVENLABS_VOICE_IDS,
  STT_MODEL_ID,
  TTS_MODEL_ID,
} from '@/features/voice/lib/voice-contract';
import { synthesizeSpeech, transcribeAudio } from '@/features/voice/server';
import { ToolError } from '@/lib/errors';
import { capabilities } from '@/lib/runtime-capabilities';
import { resolveToolFile } from '../api/file-resolver';
import { resolveUrlAudio } from '../lib/voice-download';

type ResolvedAudio = { bytes: Uint8Array<ArrayBuffer>; filename: string; mimeType: string };

async function resolveAudioSource(
  input: TranscribeAudioInput,
  ctx: ToolContext,
): Promise<ResolvedAudio> {
  const resolved = await resolveToolFile(
    {
      libraryPath: input.source.library_path,
      name: input.source.name,
      outputFilename: input.source.output_filename,
      url: input.source.url,
    },
    ctx,
  );
  if (resolved.sizeBytes && resolved.sizeBytes > MAX_AUDIO_BYTES) {
    throw new ToolError('TOOL_INPUT_INVALID', 'Audio or video exceeds the 25 MB limit', {
      filename: resolved.filename,
      sizeBytes: resolved.sizeBytes,
    });
  }
  if (resolved.source.kind === 'blob') {
    return {
      bytes: await readBlobBytes(resolved.source.storagePath, MAX_AUDIO_BYTES),
      filename: resolved.filename,
      mimeType: resolved.mimeType,
    };
  }
  if (resolved.source.kind === 'bytes') {
    return {
      bytes: resolved.source.bytes,
      filename: resolved.filename,
      mimeType: resolved.mimeType,
    };
  }
  const downloaded = await resolveUrlAudio(resolved.source.url);
  return { ...downloaded, filename: resolved.filename };
}

export const generateAudioTool: CustomTool<GenerateAudioInput, GenerateAudioOutput> = {
  ...GENERATE_AUDIO_DECL,
  inputSchema: GenerateAudioInputSchema,
  outputSchema: GenerateAudioOutputSchema,
  accrualSource: 'generation',
  mediaBilling: (output) => output.mediaBilling,
  estimateCredits: ({ text }) => creditsForVendorCents(speechEstimateCents(text.length)),
  async handler({ text, voice, filename: requestedFilename, folder_path }, ctx) {
    const estimatedCostCents = speechEstimateCents(text.length);
    const folderPath = normalizeFolderPath(folder_path);
    if (folderPath === null) {
      throw new ToolError('TOOL_INPUT_INVALID', 'Invalid Library folder path', {
        path: folder_path,
      });
    }
    const speech = await synthesizeSpeech(capabilities.media, {
      text,
      voiceId: voice ? ELEVENLABS_VOICE_IDS[voice] : DEFAULT_VOICE_ID,
    });
    try {
      const bytes = new Uint8Array(await new Response(speech.body).arrayBuffer());
      await ensureLibraryFolderPath(ctx, folderPath);
      const saved = await importDriveFile({
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        bytes,
        filename: mp3Filename(text, requestedFilename),
        mimeType: 'audio/mpeg',
        folderPath,
        source: 'agent_generated',
        sessionId: ctx.sessionRowId,
      });
      return {
        path: joinPath(saved.folderPath, saved.filename),
        url: saved.url,
        characters: text.length,
        mediaBilling: {
          generationId: speech.generationId,
          model: TTS_MODEL_ID,
          estimatedCostCents,
        },
      };
    } catch (cause) {
      throw unsavedMediaError(
        { generationId: speech.generationId, model: TTS_MODEL_ID, estimatedCostCents },
        cause,
      );
    }
  },
};

export const transcribeAudioTool: CustomTool<TranscribeAudioInput, TranscribeAudioOutput> = {
  ...TRANSCRIBE_AUDIO_DECL,
  inputSchema: TranscribeAudioInputSchema,
  outputSchema: TranscribeAudioOutputSchema,
  accrualSource: 'generation',
  mediaBilling: (output) => output.mediaBilling,
  // The source length is unknown before it is fetched, so the estimate assumes the preflight hour.
  estimateCredits: () =>
    creditsForVendorCents(
      transcriptionEstimateCents(MEDIA_ESTIMATE_CENTS[STT_MODEL_ID].preflightSeconds),
    ),
  async handler(input, ctx) {
    const source = await resolveAudioSource(input, ctx);
    const result = await transcribeAudio(capabilities.media, {
      file: new File([source.bytes], source.filename, { type: source.mimeType }),
    });
    try {
      const inline = inlineTranscript(result.text);
      let transcriptPath: string | undefined;
      if (inline.truncated) {
        const folderPath = await ensureLibraryFolderPath(ctx, TRANSCRIPTS_FOLDER_PATH);
        const saved = await importDriveFile({
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          bytes: new TextEncoder().encode(result.text),
          filename: transcriptFilename(source.filename),
          mimeType: 'text/plain',
          folderPath,
          source: 'agent_generated',
          sessionId: ctx.sessionRowId,
        });
        transcriptPath = joinPath(saved.folderPath, saved.filename);
      }
      return {
        text: inline.text,
        seconds: result.audioSeconds,
        ...(result.language ? { language: result.language } : {}),
        truncated: inline.truncated,
        ...(transcriptPath ? { path: transcriptPath } : {}),
        mediaBilling: {
          generationId: result.generationId,
          model: STT_MODEL_ID,
          estimatedCostCents: transcriptionEstimateCents(result.audioSeconds),
        },
      };
    } catch (cause) {
      throw unsavedMediaError(
        {
          generationId: result.generationId,
          model: STT_MODEL_ID,
          estimatedCostCents: transcriptionEstimateCents(result.audioSeconds),
        },
        cause,
      );
    }
  },
};
