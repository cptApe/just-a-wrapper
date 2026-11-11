'use client';
import { IconAlertCircle } from '@/components/icons';
import { MobileNavButton } from '@/components/layouts/mobile-nav';
import { useHomeViewState } from '../hooks/use-home-view-state';
import type { AttachContext } from '../lib/attachments';
import { HOME_DRAFT_KEY, OPENING_DRAFT_KEY } from '../lib/draft-store';
import {
  homeColumnClass,
  homeGreetingClass,
  homeScrollAreaClass,
  homeSpacerBottomClass,
  homeSpacerMidClass,
  homeSpacerTopClass,
  homeTopRowClass,
} from '../lib/home-geometry';
import { ChatView } from './chat-view';
import { Composer } from './composer';
import { ComposerBannerSlot } from './composer-banner-slot';
import { type HomeBilling, HomeCreditsPopover } from './home-credits-popover';
import { PendingCreate } from './pending-create';
import { TierSelect } from './tier-select';

// Home shows an immediate optimistic task frame while session creation runs.
// Text and Library references use one create; local uploads defer the opening
// message until the batch is mounted. Carry messages into the task route.
// Use the server greeting to avoid hydration differences.
// The whole Home page accepts drops into the composer.

export function HomeView({
  greeting,
  billing,
  attach,
}: {
  greeting: string;
  /** Null when billing is off on this deployment. */
  billing: HomeBilling | null;
  attach: AttachContext;
}) {
  const {
    navigation: { frame, taskId, openedSession, organizationId, viewer },
    opening: { pending, pendingAttachments, pendingComposerRef },
    composer: { initialCredits, tier, setTier, onSend, composerRef, createError },
    drop: { pageDragProps, pageDragActive },
  } = useHomeViewState({ billing, attach });

  if (frame === 'chat' && taskId) {
    return (
      <ChatView
        sessionId={taskId}
        session={openedSession}
        workspaceId={attach.workspaceId}
        uploadConfig={attach.uploadConfig}
        organizationId={organizationId ?? undefined}
        userId={viewer?.id}
        loadContext
      />
    );
  }

  if (frame === 'pending' && pending !== null) {
    return (
      <main className="flex h-full flex-col" {...pageDragProps} data-testid="home-page">
        <PendingCreate
          text={pending}
          attachments={pendingAttachments}
          composer={
            <Composer
              draftKey={OPENING_DRAFT_KEY}
              initialCredits={initialCredits}
              onSend={onSend}
              attach={attach}
              placeholder="Message the agent…"
              handleRef={pendingComposerRef}
              dragHighlight={pageDragActive}
              // The opening turn reads as running, so the button shows the stop
              // state. With no onStop it stays disabled: the create call cannot
              // be cancelled.
              streaming
            />
          }
        />
      </main>
    );
  }

  return (
    <main className="flex h-full flex-col" {...pageDragProps} data-testid="home-page">
      {/* Slim top row inside the page container: tier picker left, credits right.
          When the sidebar is collapsed its floating open button sits fixed at
          left-3 top-3 — the sibling variant clears it (md+, where it renders).
          Frame classes live in lib/home-geometry.ts, shared with
          HomeViewSkeleton so the loading frame cannot drift from this one. */}
      <div className={homeTopRowClass}>
        {/* <md this row is the page's ONLY top bar, so it carries the drawer
            trigger (the shell chrome bar stands down on /app). -ml-2 lines the
            glyph up with the shell bar's hamburger on every other page. */}
        <MobileNavButton className="-ml-2 md:hidden" />
        <TierSelect
          tier={tier}
          onChange={setTier}
          disabled={pending !== null}
          showCreditRates={billing !== null}
        />
        <div className="flex-1" />
        {billing ? <HomeCreditsPopover billing={billing} /> : null}
      </div>

      <div className={homeScrollAreaClass}>
        {/* Gravity spacers. md+: the 2:3 ratio floats greeting+composer as one
            group ~40% down. <md: the top and mid spacers grow so the greeting
            centres in the space above and the composer pins to the bottom edge;
            the mid spacer collapses at md+. */}
        <div aria-hidden className={homeSpacerTopClass} />
        <div className={homeColumnClass}>
          <h1 className={homeGreetingClass}>{greeting}</h1>
        </div>
        <div aria-hidden className={homeSpacerMidClass} />
        <div className={homeColumnClass}>
          {/* The notification banner slot sits directly above the composer.
              px-0 makes it span the column width like the composer; it renders
              nothing until a producer (the out-of-credits 402) registers. */}
          <ComposerBannerSlot className="mb-2 px-0" />
          <Composer
            draftKey={HOME_DRAFT_KEY}
            initialCredits={initialCredits}
            variant="home"
            paused={pending !== null}
            onSend={onSend}
            attach={attach}
            libraryPicker
            skillPicker
            dragHighlight={pageDragActive}
            placeholder="Assign a task or ask anything"
            handleRef={composerRef}
          />
          {/* The create-failure line: one sentence directly under the
              box, announced to assistive tech, with the draft still in the box
              so retrying is just sending again. */}
          {createError ? (
            <p
              role="alert"
              data-testid="home-create-error"
              className="mt-2 flex items-start gap-1.5 px-1 text-meta font-normal text-destructive"
            >
              <IconAlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{createError}</span>
            </p>
          ) : null}
        </div>
        <div aria-hidden className={homeSpacerBottomClass} />
      </div>
    </main>
  );
}
