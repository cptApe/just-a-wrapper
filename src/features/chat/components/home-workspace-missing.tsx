import { MobileNavButton } from '@/components/layouts/mobile-nav';
import { homeGreetingClass } from '../lib/home-geometry';

export function HomeWorkspaceMissing({ greeting }: { greeting: string }) {
  return (
    <main className="flex h-full flex-col" data-testid="home-missing-workspace">
      <div className="mobile-top-inset md:hidden">
        <MobileNavButton className="m-3 self-start" />
      </div>
      <div className="m-auto flex flex-col items-center gap-3 p-6 text-center">
        <h1 className={homeGreetingClass}>{greeting}</h1>
        <p className="text-body text-muted-foreground">
          This workspace is no longer available. Choose another workspace from the sidebar.
        </p>
      </div>
    </main>
  );
}
