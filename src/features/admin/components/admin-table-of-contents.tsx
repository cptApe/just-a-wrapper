'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type TocItem = {
  title: string;
  url: `#${string}`;
  /** Headings below h2 opt in with data-toc and follow the same indent rhythm. */
  level: 2 | 3 | 4;
};

function headingId(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function pageHeadings(content: HTMLElement): TocItem[] {
  const usedIds = new Set<string>();

  // Every h2 is a top-level entry. Lower headings join only when they opt in,
  // so pages whose h3s and h4s are row titles keep their existing index.
  return Array.from(content.querySelectorAll<HTMLHeadingElement>('h2, h3[data-toc], h4[data-toc]'))
    .filter((heading) => !heading.closest('[data-toc-ignore]'))
    .map((heading, index) => {
      const title = heading.textContent.trim() || `Section ${index + 1}`;
      const level: TocItem['level'] =
        heading.tagName === 'H4' ? 4 : heading.tagName === 'H3' ? 3 : 2;
      let anchor: HTMLElement = heading;
      let ancestor = heading.parentElement;

      while (!heading.id && ancestor && ancestor !== content) {
        if (ancestor.id) {
          anchor = ancestor;
          break;
        }
        ancestor = ancestor.parentElement;
      }

      const baseId = anchor.id || headingId(title) || `section-${index + 1}`;
      let id = baseId;
      let suffix = 2;

      while (usedIds.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }

      usedIds.add(id);
      anchor.id = id;
      anchor.classList.add('scroll-mt-16');
      return { title, url: `#${id}`, level };
    });
}

/** Scroll ONLY the admin container to a heading. Native fragment navigation
 *  (and scrollIntoView) scrolls every scrollable ancestor, window included —
 *  which overshoots the shell and leaves a dead gap under the page. The target
 *  position is clamped by the browser to the container's real scroll range. */
function scrollHeadingIntoContainer(scrollRoot: HTMLElement, heading: HTMLElement) {
  const top =
    heading.getBoundingClientRect().top -
    scrollRoot.getBoundingClientRect().top +
    scrollRoot.scrollTop -
    64;
  scrollRoot.scrollTo({ top: Math.max(0, top) });
}

function TableOfContentsLinks({
  items,
  activeUrl,
}: {
  items: TocItem[];
  activeUrl?: TocItem['url'];
}) {
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = activeUrl === item.url;
        return (
          <Link
            key={item.url}
            href={item.url}
            onClick={(event) => {
              // Keep the hash for deep links but do the scroll ourselves:
              // letting the browser handle it also scrolls the window.
              event.preventDefault();
              const heading = document.getElementById(item.url.slice(1));
              const scrollRoot = document.querySelector<HTMLElement>(
                '[data-admin-scroll-container]',
              );
              if (heading && scrollRoot) scrollHeadingIntoContainer(scrollRoot, heading);
              window.history.replaceState(null, '', item.url);
            }}
            data-active={active || undefined}
            aria-current={active ? 'location' : undefined}
            className={cn(
              'rounded-sm py-[3px] text-meta font-medium leading-[19px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:text-foreground',
              item.level === 3 && 'pl-3',
              item.level === 4 && 'pl-6',
            )}
          >
            {item.title}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminTableOfContents() {
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeUrl, setActiveUrl] = useState<TocItem['url']>();

  useEffect(() => {
    const content = document.querySelector<HTMLElement>('[data-admin-page-content]');
    const scrollRoot = document.querySelector<HTMLElement>('[data-admin-scroll-container]');
    if (!content || !scrollRoot) return;

    let currentItems: TocItem[] = [];
    let frame: number | undefined;
    const update = () => {
      frame = undefined;
      if (currentItems.length === 0) return;
      if (scrollRoot.scrollTop + scrollRoot.clientHeight >= scrollRoot.scrollHeight - 8) {
        setActiveUrl(currentItems.at(-1)?.url);
        return;
      }

      const offset = scrollRoot.getBoundingClientRect().top + 112;
      let next = currentItems[0]?.url;
      for (const item of currentItems) {
        const heading = document.getElementById(item.url.slice(1));
        if (heading && heading.getBoundingClientRect().top <= offset) next = item.url;
      }
      setActiveUrl(next);
    };

    const scheduleUpdate = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(update);
    };

    const refreshItems = () => {
      const nextItems = pageHeadings(content);
      currentItems = nextItems;
      if (nextItems.length > 0) observer.disconnect();
      setItems(nextItems);
      setActiveUrl(nextItems[0]?.url);

      const hashTarget = decodeURIComponent(window.location.hash.slice(1));
      if (hashTarget) {
        const heading = document.getElementById(hashTarget);
        if (heading) scrollHeadingIntoContainer(scrollRoot, heading);
      }
      scheduleUpdate();
    };

    const observer = new MutationObserver(refreshItems);
    observer.observe(content, { childList: true, subtree: true });
    const initializeFrame = window.requestAnimationFrame(refreshItems);

    scrollRoot.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(initializeFrame);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      scrollRoot.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, []);

  return (
    <aside
      className="hidden w-64 min-w-0 shrink-0 border-l border-border 2xl:block"
      aria-label="On this page"
    >
      <div className="scroll-fade sticky top-0 max-h-dvh overflow-y-auto overscroll-contain px-6 pb-12 pt-8 [--scroll-fade-size:16px]">
        <p className="mb-3 text-meta font-medium leading-4 text-muted-foreground">On This Page</p>
        {items.length > 0 ? (
          <TableOfContentsLinks items={items} activeUrl={activeUrl} />
        ) : (
          <p className="text-meta text-muted-foreground">Overview</p>
        )}
      </div>
    </aside>
  );
}
