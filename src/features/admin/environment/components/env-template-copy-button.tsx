'use client';

import { CopyButton } from '@/components/ui/copy-button';

// The template is generated server-side and passed down as a plain string; the
// shared CopyButton owns the copy flow and its announcements.
export function EnvTemplateCopyButton({ template }: { template: string }) {
  return (
    <CopyButton label="Copy .env template" op="admin.copy-env-template" text={template} size="lg" />
  );
}
