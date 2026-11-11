import { home } from '@content/home';
import { brand } from '@/lib/brand/identity';
import { type ShellToken, shellTokens } from '../lib/shell-tokens';

const copy = home.takeIt;

const TOKEN_CLASS: Record<ShellToken['kind'], string> = {
  comment: 'text-code-comment',
  command: 'text-code-command',
  argument: 'text-code-plain',
  string: 'text-code-string',
};

const LINES = [
  copy.cloneComment,
  `git clone ${brand.repositoryUrl}.git`,
  copy.setupComment,
  ...copy.setupCommands,
];

/** The setup steps, colored the way an editor colors a shell script. */
export function SetupCommands() {
  return (
    <pre className="overflow-hidden rounded-tl-xl bg-code-surface py-6 pl-6 font-mono text-meta leading-7">
      {LINES.map((line) => (
        <code key={line} className="block whitespace-pre">
          {shellTokens(line).map((token, index) => (
            <span key={token.text} className={TOKEN_CLASS[token.kind]}>
              {index > 0 ? ' ' : null}
              {token.text}
            </span>
          ))}
        </code>
      ))}
    </pre>
  );
}
