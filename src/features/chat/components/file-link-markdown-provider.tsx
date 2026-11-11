'use client';

import { createContext, useContext } from 'react';
import {
  MARKDOWN_COMPONENTS,
  MarkdownComponentsContext,
  MarkdownImage,
  MarkdownLink,
  type MarkdownLinkProps,
  markdownAnchorProps,
} from '@/components/ui/markdown-message';
import { FileKindIcon } from '@/features/files/components/file-kind-icon';
import { buildOverlayHash, openOverlay } from '@/features/overlays';
import { useFileLinkIndex } from '../hooks/use-file-link-index';
import {
  type FileLinkIndex,
  looksLikeFileHref,
  primaryAction,
  resolveFileLink,
  targetMimeType,
  targetName,
} from '../lib/file-link';

// Markdown links that name a known file open its preview or download it.
// Library and task-artifact data is shared across links to avoid per-link fetches.

const KnownFileLinksContext = createContext<FileLinkIndex | null>(null);

function FileMarkdownLink(props: MarkdownLinkProps) {
  const { href, children } = props;
  const known = useContext(KnownFileLinksContext);
  const fileCandidate = href !== undefined && looksLikeFileHref(href);
  const loaded = useFileLinkIndex(fileCandidate && known === null);
  const index = known ?? loaded;
  const target = fileCandidate && index ? resolveFileLink(href, index) : null;
  const fileAction = target ? primaryAction(target) : null;
  if (!target || !fileAction) return <MarkdownLink {...props} />;

  const anchorProps = markdownAnchorProps(props);
  const icon = (
    <FileKindIcon
      mimeType={targetMimeType(target)}
      name={targetName(target)}
      className="mr-1 inline-block size-[1em] align-[-0.125em]"
    />
  );
  return fileAction.kind === 'open' ? (
    <a
      {...anchorProps}
      href={href}
      data-streamdown="link"
      data-file-link="open"
      className="wrap-anywhere"
      onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        openOverlay(fileAction.hash);
      }}
    >
      {icon}
      {children}
    </a>
  ) : (
    <a
      {...anchorProps}
      href={fileAction.href}
      download={fileAction.filename}
      data-streamdown="link"
      data-file-link="download"
      className="wrap-anywhere"
    >
      {icon}
      {children}
    </a>
  );
}

/** @public The image transition test renders it directly. */
export function FileMarkdownImage(props: React.ComponentProps<typeof MarkdownImage>) {
  const index = useFileLinkIndex(true);
  const libraryId = index?.libraryFiles.find((file) => file.url === props.src)?.id;
  return (
    <MarkdownImage
      {...props}
      onOpen={libraryId ? () => openOverlay(buildOverlayHash('file', libraryId)) : undefined}
    />
  );
}

const FILE_MARKDOWN_COMPONENTS = {
  ...MARKDOWN_COMPONENTS,
  a: FileMarkdownLink,
  img: FileMarkdownImage,
};

export function FileLinkMarkdownProvider({
  index = null,
  children,
}: {
  /** The files links may resolve to, when already known; otherwise links look them up. */
  index?: FileLinkIndex | null;
  children: React.ReactNode;
}) {
  return (
    <KnownFileLinksContext.Provider value={index}>
      <MarkdownComponentsContext.Provider value={FILE_MARKDOWN_COMPONENTS}>
        {children}
      </MarkdownComponentsContext.Provider>
    </KnownFileLinksContext.Provider>
  );
}
