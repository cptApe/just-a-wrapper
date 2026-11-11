import { CopyButton } from '@/components/ui/copy-button';
import type { AdminSourceFile } from '../registry';

export function AdminSourceFootnotes({ files }: { files: readonly AdminSourceFile[] }) {
  if (files.length === 0) return null;

  return (
    <footer className="mt-14 border-t pt-6">
      <h2 className="text-meta text-muted-foreground">Source files</h2>
      <ul className="mt-2 flex flex-col items-start gap-2">
        {files.map((file) => (
          <li key={file.path} className="max-w-full">
            <CopyButton
              label={file.path}
              accessibleLabel={`Copy ${file.path}`}
              op="admin.copy-source-file"
              context={{ path: file.path }}
              text={file.path}
              variant="ghost"
              size="xs"
              className="h-auto max-w-full min-w-0 whitespace-normal break-all bg-alpha-6 px-2 py-1 text-left font-mono text-muted-foreground hover:bg-alpha-12 hover:text-foreground"
            />
          </li>
        ))}
      </ul>
    </footer>
  );
}
