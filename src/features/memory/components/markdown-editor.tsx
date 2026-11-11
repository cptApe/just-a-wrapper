'use client';

import { useState } from 'react';
import { MarkdownMessage } from '@/components/ui/markdown-message';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// Tailwind child-selectors give the rendered markdown design-system typography
// without pulling in the Typography plugin.
const PROSE = cn(
  'text-body font-normal text-foreground',
  '[&_h1]:mt-0 [&_h1]:mb-3 [&_h1]:text-title-section [&_h1]:font-semibold',
  '[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-title-section [&_h2]:font-semibold',
  '[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-title-section [&_h3]:font-semibold',
  '[&_p]:my-2',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1',
  '[&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2',
  '[&_code]:rounded-sm [&_code]:bg-alpha-8 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-meta',
  '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:overscroll-x-contain [&_pre]:rounded-lg [&_pre]:bg-alpha-8 [&_pre]:p-3 [&_pre]:text-meta',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
  '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
  '[&_hr]:my-4 [&_hr]:border-border',
);

function MarkdownPreview({ value }: { value: string }) {
  const trimmed = value.trim();
  if (!trimmed) {
    return <p className="text-meta italic text-muted-foreground">Nothing here yet.</p>;
  }
  return <MarkdownMessage text={value} className={PROSE} />;
}

type MarkdownEditorProps = {
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  ariaLabel: string;
  placeholder: string;
};

export function MarkdownEditor({
  value,
  onChange,
  disabled,
  ariaLabel,
  placeholder,
}: MarkdownEditorProps) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (value === 'write' || value === 'preview') setTab(value);
      }}
    >
      <TabsList>
        <TabsTrigger value="write">Write</TabsTrigger>
        <TabsTrigger value="preview">Preview</TabsTrigger>
      </TabsList>
      <TabsContent value="write" className="mt-3">
        <Textarea
          value={value}
          autoFocus
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={ariaLabel}
          placeholder={placeholder}
          spellCheck
          className="min-h-[220px] resize-y font-mono text-meta leading-relaxed"
        />
      </TabsContent>
      <TabsContent value="preview" className="mt-3">
        <div
          className="min-h-[220px] rounded-xl border bg-background p-4"
          aria-label={`${ariaLabel} preview`}
        >
          <MarkdownPreview value={value} />
        </div>
      </TabsContent>
    </Tabs>
  );
}
