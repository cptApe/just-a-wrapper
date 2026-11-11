import { home } from '@content/home';
import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { brand } from '@/lib/brand/identity';
import { TakeItPanels } from './take-it-panels';
import { WorkspaceWindow } from './workspace-window';

export function HomeLanding() {
  return (
    <div className="min-h-dvh bg-card text-foreground">
      <header className="sticky top-0 z-sticky bg-card/85 backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Logo />
          <div className="flex items-center gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/login">{home.signInAction}</Link>
            </Button>
            <Button asChild size="sm">
              <a href={brand.repositoryUrl} target="_blank" rel="noreferrer">
                {home.repositoryAction}
              </a>
            </Button>
          </div>
        </nav>
      </header>

      <main>
        <section className="overflow-hidden pt-14 md:pt-24">
          <div className="mx-auto max-w-6xl px-6">
            <div className="text-center">
              <h1 className="landing-display landing-rise mx-auto max-w-4xl text-[46px] md:text-[84px]">
                {home.heading}
              </h1>
              <p className="landing-rise mx-auto mt-6 max-w-xl text-balance text-[19px] text-muted-foreground leading-[1.4] [--landing-delay:80ms] md:text-[21px]">
                {home.line}
              </p>
              <div className="landing-rise mt-9 [--landing-delay:160ms]">
                <Button asChild size="lg" className="px-8">
                  <Link href="/login">{home.getStartedAction}</Link>
                </Button>
              </div>
            </div>
            <div className="landing-rise mt-14 [--landing-delay:240ms] md:mt-20">
              <WorkspaceWindow />
            </div>
          </div>
        </section>

        <TakeItPanels />
      </main>

      <footer className="mt-24 flex justify-center gap-6 pb-10 text-meta text-muted-foreground md:mt-32">
        <Link href="/terms" className="hover:text-foreground">
          {home.termsLink}
        </Link>
        <Link href="/privacy" className="hover:text-foreground">
          {home.privacyLink}
        </Link>
      </footer>
    </div>
  );
}
