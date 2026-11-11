'use client';

export function DataTable({
  rows,
  emptyMessage,
  truncated = false,
}: {
  rows: string[][];
  emptyMessage: string;
  truncated?: boolean;
}) {
  const header = rows.at(0);
  if (!header) {
    return <p className="px-1 py-4 text-meta text-muted-foreground">{emptyMessage}</p>;
  }

  const body = rows.slice(1);
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto overscroll-x-contain rounded-lg border">
        <table className="w-full border-collapse text-meta">
          <thead>
            <tr className="border-b bg-alpha-6">
              {header.map((cell, index) => (
                <th
                  key={`h${index}`}
                  className="px-3 py-2 text-left font-semibold whitespace-nowrap"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={`r${rowIndex}`} className="border-b last:border-b-0">
                {row.map((cell, columnIndex) => (
                  <td key={`c${columnIndex}`} className="px-3 py-1.5 align-top whitespace-pre-wrap">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated ? (
        <p className="text-meta font-normal text-muted-foreground">
          Preview truncated. Download the file for the full data.
        </p>
      ) : null}
    </div>
  );
}
