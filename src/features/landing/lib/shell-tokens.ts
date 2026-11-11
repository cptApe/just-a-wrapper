type ShellTokenKind = 'comment' | 'command' | 'argument' | 'string';

export type ShellToken = { kind: ShellTokenKind; text: string };

/** Splits one shell line into the pieces the setup block colors. */
export function shellTokens(line: string): ShellToken[] {
  if (line.startsWith('#')) return [{ kind: 'comment', text: line }];
  return line.split(' ').map((text, index) => ({
    kind: index === 0 ? 'command' : text.includes('://') ? 'string' : 'argument',
    text,
  }));
}
