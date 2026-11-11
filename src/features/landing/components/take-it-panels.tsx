import { home } from '@content/home';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { MockComposer } from './mock-composer';
import { SetupCommands } from './setup-commands';

const copy = home.takeIt;

const PANEL_CLASS =
  'landing-settle flex h-[26rem] flex-col overflow-hidden rounded-xl bg-background md:h-[30rem]';
const PANEL_TITLE_CLASS = 'font-medium text-[26px] tracking-tight md:text-[32px]';

/** The two ways in. The hosted app comes first because it is the main way in. */
export function TakeItPanels() {
  return (
    <section className="mx-auto max-w-6xl px-6 pt-28 md:pt-44">
      <h2 className="landing-display mx-auto max-w-3xl text-center text-[38px] md:text-[60px]">
        {copy.heading}
      </h2>
      <div className="mt-14 grid gap-4 md:mt-20 md:grid-cols-2">
        <div className={PANEL_CLASS}>
          <div className="p-8 md:p-12">
            <h3 className={PANEL_TITLE_CLASS}>{copy.hostedTitle}</h3>
            <p className="mt-2 text-[17px] text-muted-foreground">{copy.hostedLine}</p>
            <Button asChild size="lg" className="mt-6 px-8">
              <Link href="/login">{home.getStartedAction}</Link>
            </Button>
          </div>
          <div aria-hidden inert className="mt-auto pl-8 md:pl-12">
            <MockComposer
              placeholder={home.workspace.homePlaceholder}
              className="-mb-6 rounded-r-none border-r-0 pb-6"
            />
          </div>
        </div>

        <div className={PANEL_CLASS}>
          <div className="p-8 md:p-12">
            <h3 className={PANEL_TITLE_CLASS}>{copy.repositoryTitle}</h3>
            <p className="mt-2 text-[17px] text-muted-foreground">{copy.repositoryLine}</p>
          </div>
          <div aria-hidden className="mt-auto pl-8 md:pl-12">
            <SetupCommands />
          </div>
        </div>
      </div>
    </section>
  );
}
