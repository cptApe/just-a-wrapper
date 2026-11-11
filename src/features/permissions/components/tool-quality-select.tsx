'use client';
import { IconChevronDown } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  GENERATION_QUALITIES,
  GENERATION_QUALITY_LABEL,
  type GenerationQuality,
} from '../lib/tool-settings';

export function QualitySelect({
  title,
  value,
  onChange,
  disabled,
}: {
  title: string;
  value: GenerationQuality;
  onChange: (next: GenerationQuality) => void;
  disabled: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Default quality for ${title.toLowerCase()}`}
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-button border border-alpha-8 pl-3 pr-2 text-meta font-medium text-foreground',
            'transition-colors duration-150 ease-[var(--ease-out)]',
            'hover:bg-alpha-6',
            'data-[state=open]:bg-alpha-6',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          <span className="text-muted-foreground">Quality</span>
          <span>{GENERATION_QUALITY_LABEL[value]}</span>
          <IconChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {GENERATION_QUALITIES.map((quality) => (
          <DropdownMenuCheckItem
            key={quality}
            checked={value === quality}
            onSelect={() => onChange(quality)}
          >
            <span>{GENERATION_QUALITY_LABEL[quality]}</span>
          </DropdownMenuCheckItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
