'use client';

import * as React from 'react';
import { useBillingEnabled } from '@/components/providers/deployment-capabilities-provider';
import { Command, CommandInput } from '@/components/ui/command';
import { Modal, ModalTitle } from '@/components/ui/modal';
import { PillTabs } from '@/components/ui/pill-tabs';
import { useSearchResults } from '../api/use-search-results';
import { useSearchConsultation } from '../hooks/use-search-consultation';
import { useSearchNavigation } from '../hooks/use-search-navigation';
import { useSearchOpening } from '../hooks/use-search-opening';
import { normalizeQuery } from '../lib/match';
import { filterSearchResults, matchingCommands, SEARCH_FILTERS } from '../lib/result-list';
import { ACTION_COMMANDS } from '../lib/static-commands';
import { type SearchFilter } from '../types';
import { SearchResultList } from './search-result-list';

// Global search combines server-scoped dynamic results and local static domains.
// Disable cmdk filtering because server and matchesQuery own relevance.
// The persistent consultation action hands the query to the agent.

export function CommandSearch() {
  const billingEnabled = useBillingEnabled();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const { ask, askAgent, resetAsk } = useSearchConsultation(query, () => setOpen(false));
  const { state, recent, retry } = useSearchResults(query, open);
  const [filter, setFilter] = React.useState<SearchFilter>('all');

  const { navigate, runStatic } = useSearchNavigation(() => setOpen(false));

  const { restoreOpenerFocus } = useSearchOpening(setOpen);

  // Reset after the exit animation so closing search does not flash quick actions.
  React.useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => {
      setQuery('');
      setFilter('all');
      resetAsk();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [open, resetAsk]);

  const normalizedQuery = normalizeQuery(query);
  const hasQuery = normalizedQuery !== '';

  const searching = state.kind === 'loading';
  const results = filterSearchResults(
    state.kind === 'idle' || searching ? [] : state.results,
    filter,
  );
  const commands = searching ? [] : matchingCommands(normalizedQuery, filter, { billingEnabled });

  // Async hits arrive above Ask agent; reset selection to the first visible hit so Enter never targets a stale row.
  const orderedValues: string[] = !hasQuery
    ? [...recent.map((item) => `task-${item.id}`), ...ACTION_COMMANDS.map((command) => command.id)]
    : searching
      ? []
      : [
          ...results.map((item) => `${item.group}-${item.id}`),
          ...commands.map((command) => command.id),
          'ask-agent',
        ];
  const listSignature = orderedValues.join('\n');
  const [selection, setSelection] = React.useState({
    signature: listSignature,
    value: orderedValues[0] ?? '',
  });
  if (selection.signature !== listSignature) {
    setSelection({ signature: listSignature, value: orderedValues[0] ?? '' });
  }

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      presentation="dialog"
      size="default"
      className="h-[min(64dvh,560px)] max-w-[640px]"
      onCloseAutoFocus={restoreOpenerFocus}
    >
      <ModalTitle className="sr-only">Search</ModalTitle>
      <Command
        shouldFilter={false}
        loop
        label="Search the workspace"
        data-testid="command-search"
        value={selection.value}
        onValueChange={(value) => setSelection({ signature: listSignature, value })}
      >
        <CommandInput
          value={query}
          onValueChange={(value) => {
            setQuery(value);
            if (normalizeQuery(value) === '') setFilter('all');
          }}
          placeholder="Search"
          wrapperClassName="h-16 pr-16"
          clearLabel="Clear"
          onClear={() => {
            setQuery('');
            setFilter('all');
          }}
        />
        {hasQuery ? (
          // cmdk owns result-list keys. A focused filter button must keep its
          // native Enter/Space activation without also opening a result.
          <div role="presentation" onKeyDown={(event) => event.stopPropagation()}>
            <PillTabs
              value={filter}
              options={SEARCH_FILTERS}
              onChange={setFilter}
              label="Search types"
              className="shrink-0 px-5 py-3"
            />
          </div>
        ) : null}
        <SearchResultList
          results={{ quickActions: ACTION_COMMANDS, state, recent, matches: results, commands }}
          actions={{ navigate, runStatic, askAgent, retry }}
          ask={ask}
          normalizedQuery={normalizedQuery}
        />
      </Command>
    </Modal>
  );
}
