import { TOOL_ROUTER_EXECUTOR } from '@/features/permissions/lib/resolve';
import { IMAGE_MODEL_ID, TRANSPARENT_IMAGE_MODEL_ID } from '@/features/tool-catalog/generate-image';
import { VIDEO_MODEL_ID } from '@/features/tool-catalog/generate-video';
import { recordOf } from './record-of';
import { titleCase } from './title-case';
import { str } from './tool-activity-phrases';
import { describeSlug, sentenceCase, type ToolStatus } from './tool-display-activity';

export { type WebSource, webSourcesOf } from './web-sources';

type ArgRow = { label: string; value: string };

const LONG_INPUT_LENGTH = 160;

function meaningfulInputEntries(input: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(input).filter(([, value]) => {
    if (value === null || value === undefined) return false;
    return typeof value !== 'string' || value.trim().length > 0;
  });
}

/** Whether a tool input carries enough structure to deserve its own block. */
export function isComplexInput(input: Record<string, unknown>): boolean {
  const entries = meaningfulInputEntries(input);
  if (entries.length > 1) return true;
  const value = entries[0]?.[1];
  if (typeof value === 'string') return value.length > LONG_INPUT_LENGTH || value.includes('\n');
  return typeof value === 'object' && value !== null;
}

/**
 * Flatten a tool input into plain label/value rows for the expanded card —
 * never a raw JSON dump. Batch executor inputs unwrap to their embedded
 * actions' arguments; nested objects render as compact JSON only as the last
 * resort (a `<pre>` may scroll, per 09-modals).
 */
export function describeToolArgs(name: string, input: Record<string, unknown>): ArgRow[] {
  // A skill folder is name + description + its file paths — never the file
  // contents as a JSON dump (the only input whose generic projection read
  // technical).
  if (name === 'save_skill' || name === 'update_skill') return skillArgRows(input);
  // The generated-media prompt is the one argument worth reading; size and
  // quality live in the settled popover.
  if (name === 'generate_image' || name === 'edit_image' || name === 'generate_video') {
    const prompt = str(input.prompt);
    return prompt ? [{ label: 'Prompt', value: prompt }] : [];
  }
  if (name === TOOL_ROUTER_EXECUTOR) {
    const tools = input.tools;
    if (Array.isArray(tools)) {
      const entries = tools.flatMap((value) => {
        const entry = recordOf(value);
        return entry ? [entry] : [];
      });
      const rows: ArgRow[] = [];
      for (const entry of entries) {
        const slug = typeof entry.tool_slug === 'string' ? entry.tool_slug : null;
        const action = slug ? describeSlug(slug).done : 'Action';
        const argumentsRecord = recordOf(entry.arguments);
        const args = argumentsRecord ? argRows(argumentsRecord) : [];
        if (args.length === 0) {
          rows.push({ label: action, value: 'No details' });
          continue;
        }
        // Prefix rows with their action only when several are batched.
        for (const row of args) {
          rows.push(entries.length > 1 ? { ...row, label: `${action} · ${row.label}` } : row);
        }
      }
      if (rows.length > 0) return rows;
    }
  }
  return argRows(input);
}

function skillArgRows(input: Record<string, unknown>): ArgRow[] {
  const rows: ArgRow[] = [];
  const currentName = str(input.current_name);
  if (currentName) rows.push({ label: 'Current name', value: currentName });
  const name = str(input.name);
  if (name) rows.push({ label: 'Name', value: name });
  const description = str(input.description);
  if (description) rows.push({ label: 'Description', value: description });
  const files = input.files;
  if (Array.isArray(files)) {
    const paths = files
      .map((f) => recordOf(f)?.path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
    if (paths.length > 0) {
      // One path per line — the card's value cell renders real line breaks.
      rows.push({
        label: paths.length === 1 ? 'File' : `Files · ${paths.length}`,
        value: paths.join('\n'),
      });
    }
  }
  return rows.length > 0 ? rows : argRows(input);
}

function argRows(input: Record<string, unknown>): ArgRow[] {
  return Object.entries(input).map(([key, value]) => ({
    label: humanizeKey(key),
    value: printValue(value),
  }));
}

/** Exa posts no icons with its results (web-search-exa.ts projects title, url,
 *  snippet, publishedDate only), so the leading favicon is resolved by host
 *  through Google's public favicon service. 32px covers the 2x 16px glyph. */
const FAVICON_SIZE = 32;
export function faviconUrl(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${FAVICON_SIZE}`;
}

// The shimmer treatment: a frameless media card with a shimmer skeleton while
// it runs (the activity line above it carries the running words), and a
// settled ⓘ details popover. Every string those two renderers show lives here,
// the single copy source — the popover's accessible name, its meta labels, and
// the Library line. Values arrive as the tools' enum strings and are humanized
// here so no copy leaks into the components.

export type MediaKind = 'image' | 'video';

/** Accessible name for the corner ⓘ button that opens the details popover. */
export function mediaDetailsLabel(kind: MediaKind): string {
  return kind === 'image' ? 'Image details' : 'Video details';
}

/** Accessible name for the details popover surface itself. */
export function mediaPopoverTitle(kind: MediaKind): string {
  return kind === 'image' ? 'About this image' : 'About this video';
}

/** The Library-location line, shared by both settled media cards. */
export const MEDIA_SAVED_TO_LIBRARY = 'Saved to your Library';

/**
 * Whether a frameless tool (generate_image/generate_video) renders its artifact
 * ALONE at the current status — no activity line above it. Only a readable,
 * settled result does: the image is the message. Every other status keeps the
 * line (running shows the shimmer skeleton under it; gated/denied/failed carry
 * their decision and outcome), and a garbled ok result falls back to the line
 * plus its raw outcome instead of an empty frame. Pure so the shell and tests
 * read the same rule.
 */
export function isFramelessRender(
  status: ToolStatus,
  { frameless, canRenderSettled }: { frameless: boolean; canRenderSettled: boolean },
): boolean {
  if (!frameless) return false;
  return status === 'done' && canRenderSettled;
}

export type MediaMetaRow = { label: string; value: string };

const MODEL_LABELS: Record<string, string> = {
  [IMAGE_MODEL_ID]: 'GPT Image 2.6',
  // Saved results keep the model that made them.
  'openai/gpt-image-2': 'GPT Image 2',
  [TRANSPARENT_IMAGE_MODEL_ID]: 'GPT Image 1.5',
  [VIDEO_MODEL_ID]: 'Seedance 2.5',
};

function modelLabel(model: string): string {
  return MODEL_LABELS[model] ?? model;
}

const IMAGE_SIZE_LABELS: Record<string, string> = {
  square: 'Square',
  portrait: 'Portrait',
  landscape: 'Landscape',
  wide: 'Wide',
};

const IMAGE_QUALITY_LABELS: Record<string, string> = {
  low: 'Draft',
  mid: 'Standard',
  high: 'High',
};

const VIDEO_ASPECT_LABELS: Record<string, string> = {
  wide: 'Wide (16:9)',
  portrait: 'Portrait (9:16)',
  square: 'Square (1:1)',
};

/** Detail rows for a settled generate_image card's popover. */
export function imageMetaRows(meta: {
  model?: string;
  size?: string;
  quality?: string;
}): MediaMetaRow[] {
  const rows: MediaMetaRow[] = [];
  if (meta.model) rows.push({ label: 'Model', value: modelLabel(meta.model) });
  if (meta.size)
    rows.push({
      label: 'Size',
      value: IMAGE_SIZE_LABELS[meta.size] ?? titleCase(meta.size),
    });
  if (meta.quality)
    rows.push({
      label: 'Quality',
      value: IMAGE_QUALITY_LABELS[meta.quality] ?? titleCase(meta.quality),
    });
  return rows;
}

/** Detail rows for a settled generate_video card's popover. */
export function videoMetaRows(meta: {
  model?: string;
  duration?: string;
  aspect?: string;
}): MediaMetaRow[] {
  const rows: MediaMetaRow[] = [];
  if (meta.model) rows.push({ label: 'Model', value: modelLabel(meta.model) });
  if (meta.duration) rows.push({ label: 'Length', value: `${meta.duration} seconds` });
  if (meta.aspect)
    rows.push({
      label: 'Aspect',
      value: VIDEO_ASPECT_LABELS[meta.aspect] ?? titleCase(meta.aspect),
    });
  return rows;
}

/** Argument names whose mechanical spelling reads wrong to a person. */
const ARG_LABELS: Record<string, string> = {
  name: 'File name',
  source: 'File source',
  url: 'Link',
  urls: 'Links',
  numResults: 'Results wanted',
  num_results: 'Results wanted',
  folder_path: 'Folder',
  output_filename: 'File',
  from_path: 'From',
  to_path: 'To',
};

function humanizeKey(key: string): string {
  const known = ARG_LABELS[key];
  if (known) return known;
  const words = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_\-\s]+/)
    .filter(Boolean);
  return sentenceCase(words);
}

function printValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not set';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number')) {
    return value.join(', ');
  }
  return JSON.stringify(value, null, 2);
}
