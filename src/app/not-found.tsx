import Link from 'next/link';
import { IconCompass } from '@/components/icons';
import { Button } from '@/components/ui/button';

// Root not-found — served for any URL that matches no route, and for any
// notFound() call without a closer not-found.tsx. A wrong or stale link is a
// normal user moment, not an error: say what happened in one line, then give
// the next click. It has no app sidebar, so it reads cleanly wherever a 404
// lands.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col items-center justify-center gap-5 px-6 text-center">
      <div
        aria-hidden
        className="inline-flex size-12 items-center justify-center rounded-full bg-alpha-8 text-muted-foreground"
      >
        <IconCompass className="size-6" />
      </div>
      <div className="flex max-w-[420px] flex-col gap-1.5">
        <p className="text-balance text-body-lg text-foreground">This page doesn’t exist</p>
        <p className="text-balance text-meta text-muted-foreground">
          The link may be broken, or the page may have moved.
        </p>
      </div>
      <div className="mt-1 flex items-center gap-3">
        <Button asChild variant="primary" size="sm">
          <Link href="/">Go home</Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link href="/app">Open the app</Link>
        </Button>
      </div>
    </main>
  );
}
