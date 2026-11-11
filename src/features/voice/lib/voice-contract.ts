export const MAX_TTS_CHARS = 10_000;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// 6 kbit/s, the lowest Opus bitrate a browser recorder produces. Real dictation is far denser, so
// bytes divided by this bounds the audio length from above.
const MIN_AUDIO_BYTES_PER_SECOND = 750;

/** Longest audio, in seconds, that a file of this size can plausibly hold. */
export function transcriptionUpperBoundSeconds(bytes: number): number {
  return Math.ceil(Math.max(0, bytes) / MIN_AUDIO_BYTES_PER_SECOND);
}

// Keep a small set of premade voices so tool schemas do not depend on an account-specific voice catalog.
// Sarah is the product default when the user does not request a named voice.
export const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
export const ELEVENLABS_VOICE_IDS: Record<VoiceName, string> = {
  sarah: DEFAULT_VOICE_ID,
  george: 'JBFqnCBsd6RMkjVDRZzb',
  bella: 'hpp4J3VqNfWAUOO0d1Us',
};

export const STT_MODEL_ID = 'elevenlabs/scribe-v2';
export const TTS_MODEL_ID = 'elevenlabs/eleven-v4';
export const VOICE_NAMES = ['sarah', 'george', 'bella'] as const;
export type VoiceName = (typeof VOICE_NAMES)[number];
