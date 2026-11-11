'use client';

import { code } from '@streamdown/code';
import { createMathPlugin } from '@streamdown/math';
import { InlineImage } from '@/components/ui/inline-image';
import { isTrustedMarkdownImage } from '@/lib/markdown-image-source';
import { isSafeInternalHref } from '@/lib/safe-internal-href';
import { cn } from '@/lib/utils';
import 'katex/dist/katex.min.css';
import { createContext, useContext } from 'react';
import { type Components, Streamdown } from 'streamdown';
import 'streamdown/styles.css';
import { MarkdownCodeBlock, MarkdownInlineCode } from './markdown-code-block';
import './markdown-message.css';
import { MarkdownTable, MarkdownTableCell, MarkdownTableHeaderCell } from './markdown-table';

// Shared Streamdown renderer supports streaming GFM, highlighted code and math.
// Custom anchors open external URLs directly with opener isolation; fragments
// scroll in place and app-relative links navigate normally.
// Links remain underlined and use --attention for hover and keyboard focus.
// Styling uses theme tokens; consumers can override the body size.
const PROSE = cn(
  'min-w-0 max-w-full text-body !leading-[1.625] text-foreground',
  '[&_h1]:mt-8 [&_h1]:mb-3 [&_h1]:text-balance [&_h1]:text-title-section [&_h1]:font-semibold',
  '[&_h2]:mt-7 [&_h2]:mb-3 [&_h2]:text-balance [&_h2]:text-title-section [&_h2]:font-semibold',
  '[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-balance [&_h3]:text-title-section [&_h3]:font-semibold',
  '[&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:text-balance [&_h4]:font-semibold',
  '[&_p]:my-3',
  '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1',
  '[&_li>ul]:my-1.5 [&_li>ol]:my-1.5',
  '[&_strong]:font-semibold',
  '[&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-3 [&_a]:transition-colors [&_a]:duration-150',
  '[&_a]:hover:text-attention [&_a]:hover:decoration-attention',
  '[&_a]:focus-visible:text-attention [&_a]:focus-visible:decoration-attention [&_a]:focus-visible:rounded-sm [&_a]:focus-visible:outline-none [&_a]:focus-visible:ring-2 [&_a]:focus-visible:ring-ring',
  '[&_blockquote]:my-5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground',
  '[&_hr]:my-8 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-border',
  '[&_section[data-footnotes]]:mt-8 [&_section[data-footnotes]]:text-meta [&_sup]:text-meta [&_sup]:font-medium',
);

// Single-dollar math is disabled because currency such as "$2k and $10k"
// can pair into a math expression. Block $$...$$ math remains supported.
const math = createMathPlugin({ singleDollarTextMath: false });

// Streamdown flags a link still being streamed with this sentinel href; it must
// never reach the DOM as a navigable target.
const INCOMPLETE_LINK = 'streamdown:incomplete-link';

// A fragment click (footnote ref/backref) scrolls to its target INSIDE this
// message. Handled ourselves for two reasons: the sanitizer clobbers ids with a
// second "user-content-" prefix the hrefs don't carry (native fragment
// navigation finds nothing and jumps the thread to the top), and every message
// in a thread numbers its own footnotes from 1, so a document-wide lookup could
// land in a different message. Scope to the message root, try both id spellings.
function scrollToFragment(event: React.MouseEvent<HTMLAnchorElement>, fragment: string) {
  const root = event.currentTarget.closest('[data-markdown-root]') ?? document;
  const target =
    root.querySelector(`[id="${CSS.escape(fragment)}"]`) ??
    root.querySelector(`[id="${CSS.escape(`user-content-${fragment}`)}"]`);
  if (!target) return;
  event.preventDefault();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({
    block: 'start',
    behavior: reduceMotion ? 'auto' : 'smooth',
  });
}

export type MarkdownLinkProps = React.ComponentProps<'a'> & { node?: unknown };

/** Sanitized markdown attributes (the footnote backref id, title, aria/data-*)
    without what the anchor owns: the hast `node`, and the sanitizer-stamped
    target/rel, which mark EVERY anchor as a new-tab external link. */
export function markdownAnchorProps(props: MarkdownLinkProps): Partial<MarkdownLinkProps> {
  const anchorProps: Partial<MarkdownLinkProps> = { ...props };
  delete anchorProps.node;
  delete anchorProps.target;
  delete anchorProps.rel;
  delete anchorProps.href;
  delete anchorProps.children;
  return anchorProps;
}

export function MarkdownLink(props: MarkdownLinkProps) {
  const { href, children } = props;
  const incomplete = href === INCOMPLETE_LINK;
  // Fragments (footnotes) and app-relative paths stay in-page; everything else
  // is external and gets the new-tab + opener isolation.
  const fragment = Boolean(href?.startsWith('#'));
  const internal = fragment || (href !== undefined && isSafeInternalHref(href));
  const external = Boolean(href) && !incomplete && !internal;
  const anchorProps = markdownAnchorProps(props);
  return (
    <a
      {...anchorProps}
      href={incomplete ? undefined : href}
      data-streamdown="link"
      data-incomplete={incomplete || undefined}
      className="wrap-anywhere"
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      {...(fragment && href
        ? {
            onClick: (event: React.MouseEvent<HTMLAnchorElement>) =>
              scrollToFragment(event, href.slice(1)),
          }
        : {})}
    >
      {children}
    </a>
  );
}

export function MarkdownImage({
  onOpen,
  ...props
}: React.ComponentProps<'img'> & { node?: unknown; onOpen?: () => void }) {
  const src = typeof props.src === 'string' ? props.src : '';
  const alt = props.alt || 'Image';

  if (!src) return null;
  if (!isTrustedMarkdownImage(src)) {
    return /^https?:\/\//i.test(src) ? (
      <MarkdownLink href={src}>{alt}</MarkdownLink>
    ) : (
      <span>{alt}</span>
    );
  }
  return (
    <InlineImage src={src} alt={alt} onOpen={onOpen} className="my-5" testId="markdown-image" />
  );
}

export const MARKDOWN_COMPONENTS = {
  a: MarkdownLink,
  blockquote: 'blockquote',
  code: MarkdownCodeBlock,
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  h6: 'h6',
  hr: 'hr',
  img: MarkdownImage,
  inlineCode: MarkdownInlineCode,
  li: 'li',
  ol: 'ol',
  strong: 'strong',
  tbody: 'tbody',
  table: MarkdownTable,
  td: MarkdownTableCell,
  th: MarkdownTableHeaderCell,
  thead: 'thead',
  tr: 'tr',
  ul: 'ul',
} satisfies Components;

/** The authed app swaps in file-aware links and images; every other surface
    renders plain markdown. */
export const MarkdownComponentsContext = createContext<Components>(MARKDOWN_COMPONENTS);

// With the word pacer feeding one word per ~15-35ms, a short unstaggered fade
// keeps only a handful of words mid-animation at the flow's tail.
const STREAM_FADE = {
  animation: 'fadeIn',
  sep: 'word',
  duration: 150,
  stagger: 0,
} as const;

export function MarkdownMessage({
  text,
  className,
  streaming = false,
}: {
  text: string;
  className?: string;
  /** True for the live delta preview: each newly revealed word fades in.
   *  Settled messages leave this off so history never re-animates. */
  streaming?: boolean;
}) {
  const components = useContext(MarkdownComponentsContext);
  return (
    <div data-markdown-root className={cn(PROSE, className)}>
      <Streamdown
        className="space-y-0"
        plugins={{ code, math }}
        animated={streaming ? STREAM_FADE : false}
        isAnimating={streaming}
        linkSafety={{ enabled: false }}
        components={components}
      >
        {text}
      </Streamdown>
    </div>
  );
}
