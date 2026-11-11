'use client';

import { IconCamera01, IconTrash01 } from '@/components/icons';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Spinner } from '@/components/ui/spinner';
import { initialsFrom } from '@/lib/initials';
import { cn } from '@/lib/utils';

// The identity-page top (Account, Workspace): the avatar with
// the name as a large heading and a muted secondary line under it. Change /
// Remove reveal on hover (and keyboard focus) OVER the avatar itself — never
// as buttons below. This is the control surface only: upload wiring is the
// caller's job via onChangeImage/onRemoveImage.

// Deterministic pastel for the initials fallback: the hue comes from the seed, so no token can hold it.
function fallbackColors(seed: string): { background: string; color: string } {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return {
    background: `hsl(${hash} 48% 88%)`,
    color: `hsl(${hash} 52% 28%)`,
  };
}

const overlayButtonClass = cn(
  'flex size-9 max-sm:size-11 items-center justify-center rounded-button text-on-media',
  'transition-colors duration-150 hover:bg-on-media/20',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-media',
);

export function SettingsAvatarHero({
  imageUrl,
  fallback,
  name,
  secondary,
  editable = false,
  busy = false,
  onChangeImage,
  onRemoveImage,
  changeLabel = 'Change image',
  removeLabel = 'Remove image',
}: {
  imageUrl?: string | null;
  /** Seed for the colored-initials fallback (the name or email). */
  fallback: string;
  /** The large heading — the page's identity, identity pages have no title. */
  name: string;
  /** Muted line under the name (email / slug). */
  secondary?: string;
  /** Owner/admin only — false renders a plain hero with no hover controls. */
  editable?: boolean;
  /** Pending state while an upload/save is in flight. */
  busy?: boolean;
  /** The click event passes through so image uploads can consume it. */
  onChangeImage?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Omit (or pass undefined) while there's no image — Remove only shows with one. */
  onRemoveImage?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  changeLabel?: string;
  removeLabel?: string;
}) {
  const showRemove = Boolean(imageUrl && onRemoveImage);
  return (
    <div className="flex flex-col items-start gap-4">
      <div className={cn('relative size-20 max-sm:size-24', editable && 'group')}>
        <Avatar className="size-20 max-sm:size-24">
          {imageUrl ? <AvatarImage src={imageUrl} alt="" /> : null}
          <AvatarFallback className="text-body font-medium" style={fallbackColors(fallback)}>
            {initialsFrom(null, fallback)}
          </AvatarFallback>
        </Avatar>
        {editable ? (
          // Opacity-only reveal — the overlay is absolutely positioned, so
          // showing it never reflows anything. focus-within keeps the
          // controls reachable (and visible) by keyboard.
          <div
            className={cn(
              'absolute inset-0 flex items-center justify-center gap-1 rounded-full bg-scrim',
              // Coarse (touch) pointers can't hover — surface the change/remove
              // controls at rest so the avatar is editable on touch.
              'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100',
              busy && 'opacity-100',
            )}
          >
            {busy ? (
              <Spinner className="size-5 text-on-media" aria-hidden />
            ) : (
              <>
                <button
                  type="button"
                  onClick={onChangeImage}
                  aria-label={changeLabel}
                  title={changeLabel}
                  className={overlayButtonClass}
                >
                  <IconCamera01 className="size-4.5" aria-hidden />
                </button>
                {showRemove ? (
                  <button
                    type="button"
                    onClick={onRemoveImage}
                    aria-label={removeLabel}
                    title={removeLabel}
                    className={overlayButtonClass}
                  >
                    <IconTrash01 className="size-4.5" aria-hidden />
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 max-w-full flex-col gap-0.5 break-words">
        <h1 className="text-title-page">{name}</h1>
        {secondary ? <p className="text-body text-muted-foreground">{secondary}</p> : null}
      </div>
    </div>
  );
}
