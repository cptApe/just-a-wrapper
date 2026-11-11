// Resolve the dev-server port: start from .dev-port (worktree convention,
// falling back to 3000), and if that port is already bound (another instance
// of this worktree's server, a sibling worktree, an orphan) walk upward to
// the first free one instead of dying with EADDRINUSE. Prints the chosen
// port to stdout (consumed by `pnpm dev`); diagnostics go to stderr.
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';

let base = 3000;
if (existsSync('.dev-port')) {
  const parsed = Number.parseInt(readFileSync('.dev-port', 'utf8').trim(), 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) base = parsed;
}

function isFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    // Only EADDRINUSE means "taken" — environment errors (e.g. EAFNOSUPPORT on
    // IPv6-less CI runners) must not read as a busy port or the walk never ends.
    probe.once('error', (error) => resolve(error.code !== 'EADDRINUSE'));
    probe.once('listening', () => probe.close(() => resolve(true)));
    // No host: Node binds the unspecified address with its own v6→v4 fallback,
    // matching how `next dev` listens.
    probe.listen(port);
  });
}

let port = base;
while (!(await isFree(port))) {
  port += 1;
  if (port > base + 100) {
    console.error(`[dev] no free port found in ${base}-${base + 100} — giving up`);
    process.exit(1);
  }
}

if (port !== base) {
  console.error(
    `[dev] port ${base} is already in use (another server in this or a sibling worktree?) — starting on ${port} instead`,
  );
}
// String, not number: under FORCE_COLOR (Playwright's webServer sets it) Node
// colorizes inspected numbers, and the ANSI codes end up inside $(…) -> a
// broken --port argument.
process.stdout.write(`${port}\n`);
