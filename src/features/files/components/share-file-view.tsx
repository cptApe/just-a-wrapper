'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { IconDownload01 } from '@/components/icons';
import { OrganizationIdProvider } from '@/components/providers/app-providers';
import { Button } from '@/components/ui/button';
import { downloadUrl } from '../lib/download-url';
import type { FileEntry } from '../types';
import { FilePreview } from './file-preview';

export function ShareFileView({
  workspaceId,
  workspaceName,
  file,
}: {
  workspaceId: string;
  workspaceName: string;
  file: FileEntry;
}) {
  // Public previews have their own cache and never mount signed-in app effects.
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <OrganizationIdProvider value={workspaceId}>
        <main className="mx-auto flex min-h-dvh w-full max-w-[1040px] flex-col gap-6 px-6 py-10">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
            <div className="min-w-0 flex-1">
              <p className="text-meta font-medium text-muted-foreground">{workspaceName}</p>
              <h1 className="mt-1.5 break-words text-title-section font-semibold">
                {file.filename}
              </h1>
            </div>
            <Button asChild variant="secondary" size="sm">
              <a href={downloadUrl(file.url)} download={file.filename}>
                <IconDownload01 className="size-4" /> Download
              </a>
            </Button>
          </header>
          <section aria-label="File preview" className="h-[min(70dvh,800px)] min-h-[320px]">
            <FilePreview key={file.url} file={file} />
          </section>
        </main>
      </OrganizationIdProvider>
    </QueryClientProvider>
  );
}
