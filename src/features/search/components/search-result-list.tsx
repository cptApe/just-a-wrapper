'use client';
import { IconMessageChatCircle } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Spinner } from '@/components/ui/spinner';
import type { SearchState, ServerSearchResult, StaticCommand } from '../types';
import { ResultRow, StaticRow } from './search-result-row';
import { SearchSkeleton } from './search-skeleton';

export function SearchResultList({
  results,
  actions,
  ask,
  normalizedQuery,
}: {
  results: {
    state: SearchState;
    recent: ServerSearchResult[];
    matches: ServerSearchResult[];
    commands: StaticCommand[];
    quickActions: readonly StaticCommand[];
  };
  actions: {
    retry: () => void;
    askAgent: () => Promise<void>;
    navigate: (href: string) => void;
    runStatic: (command: StaticCommand) => void;
  };
  ask: 'idle' | 'creating';
  normalizedQuery: string;
}) {
  const { state, recent, matches, commands, quickActions } = results;
  const { retry, askAgent, navigate, runStatic } = actions;
  const hasQuery = normalizedQuery !== '';
  const searching = state.kind === 'loading';
  return (
    <CommandList className="min-h-0 pb-3">
      {!hasQuery ? (
        <>
          {recent.length > 0 ? (
            <>
              <CommandGroup heading="Recent">
                {recent.map((item) => (
                  <ResultRow key={item.id} item={item} onNavigate={navigate} />
                ))}
              </CommandGroup>
              <div role="separator" className="mx-6 my-2 border-t border-border" />
            </>
          ) : null}
          <CommandGroup heading="Quick actions">
            {quickActions.map((command) => (
              <StaticRow key={command.id} command={command} onRun={runStatic} />
            ))}
          </CommandGroup>
        </>
      ) : searching ? (
        <SearchSkeleton />
      ) : (
        <>
          {state.kind === 'error' ? (
            <div role="alert" className="flex flex-col items-center gap-3 px-6 py-8 text-center">
              <p className="text-body text-muted-foreground">{state.message}</p>
              <Button type="button" variant="secondary" size="sm" onClick={retry}>
                Try again
              </Button>
            </div>
          ) : null}
          <CommandGroup>
            {matches.map((item) => (
              <ResultRow key={`${item.group}-${item.id}`} item={item} onNavigate={navigate} />
            ))}
            {commands.map((command) => (
              <StaticRow key={command.id} command={command} onRun={runStatic} />
            ))}
            <CommandItem
              className="h-10 min-h-10"
              value="ask-agent"
              disabled={ask === 'creating'}
              onSelect={() => void askAgent()}
              data-testid="command-search-ask-agent"
            >
              {ask === 'creating' ? (
                <Spinner className="size-5 text-muted-foreground" />
              ) : (
                <IconMessageChatCircle aria-hidden className="size-5 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {ask === 'creating' ? 'Starting your task' : `Ask agent: ${normalizedQuery}`}
              </span>
            </CommandItem>
          </CommandGroup>
        </>
      )}
    </CommandList>
  );
}
