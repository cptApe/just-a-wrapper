'use client';

import { useRef } from 'react';
import { extractTableDataFromElement, tableDataToTSV } from 'streamdown';
import { isNumericCell } from '@/lib/markdown-text';
import { cn } from '@/lib/utils';
import { MarkdownCopyAction } from './markdown-copy-action';

function alignmentClass(align: string | undefined, numeric = false): string {
  if (align === 'center') return 'text-center';
  if (align === 'right' || (align === undefined && numeric)) return 'text-right';
  return 'text-left';
}

const TABLE_CELL = 'px-3 py-2.5 align-top wrap-anywhere';

export function MarkdownTableHeaderCell(props: React.ComponentProps<'th'> & { node?: unknown }) {
  const { children, className } = props;
  const cellProps: Partial<React.ComponentProps<'th'>> & { node?: unknown } = {
    ...props,
  };
  delete cellProps.node;
  delete cellProps.children;
  delete cellProps.className;
  return (
    <th
      {...cellProps}
      className={cn(
        TABLE_CELL,
        'whitespace-normal text-meta font-medium text-muted-foreground',
        alignmentClass(props.align),
        className,
      )}
    >
      {children}
    </th>
  );
}

export function MarkdownTableCell(props: React.ComponentProps<'td'> & { node?: unknown }) {
  const { children, className } = props;
  const numeric = isNumericCell(children);
  const cellProps: Partial<React.ComponentProps<'td'>> & { node?: unknown } = {
    ...props,
  };
  delete cellProps.node;
  delete cellProps.children;
  delete cellProps.className;
  return (
    <td
      {...cellProps}
      className={cn(
        TABLE_CELL,
        'whitespace-normal',
        alignmentClass(props.align, numeric),
        numeric && 'tabular-nums',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function MarkdownTable(props: React.ComponentProps<'table'> & { node?: unknown }) {
  const tableRef = useRef<HTMLTableElement>(null);
  const { children, className } = props;
  const tableProps: Partial<React.ComponentProps<'table'>> & {
    node?: unknown;
  } = { ...props };
  delete tableProps.node;
  delete tableProps.children;
  delete tableProps.className;

  function tableText(): string {
    const table = tableRef.current;
    return table ? tableDataToTSV(extractTableDataFromElement(table)) : '';
  }

  return (
    <div data-streamdown="table-wrapper" className="my-5 w-full min-w-0 max-w-full">
      <div className="flex min-h-11 items-center justify-end">
        <MarkdownCopyAction
          accessibleLabel="Copy table as tab-separated text"
          getText={tableText}
        />
      </div>
      <div
        className="w-full max-w-full overflow-x-auto overscroll-x-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        role="region"
        aria-label="Scrollable table"
        tabIndex={0}
      >
        <table
          {...tableProps}
          ref={tableRef}
          data-markdown-table
          className={cn(
            'w-full border-collapse bg-transparent text-body font-normal',
            '[&_thead_tr]:border-b [&_thead_tr]:border-border',
            '[&_tbody_tr]:border-b [&_tbody_tr]:border-border [&_tbody_tr:last-child]:border-b-0',
            className,
          )}
        >
          {children}
        </table>
      </div>
    </div>
  );
}
