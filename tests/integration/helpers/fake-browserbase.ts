/** An in-memory Browserbase v1 REST API for `fetch`, shaped like the live bodies the client parses. */

type FakeSession = {
  id: string;
  status: 'RUNNING' | 'COMPLETED';
  startedAt: string;
  endedAt?: string;
  userMetadata: Record<string, string>;
};

const BASE = 'https://api.browserbase.com/v1';

export function fakeBrowserbase() {
  const sessions = new Map<string, FakeSession>();
  const calls: string[] = [];
  let created = 0;
  let failRelease = false;

  function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
  }

  function view(session: FakeSession) {
    return {
      ...session,
      expiresAt: new Date(Date.parse(session.startedAt) + 3_600_000).toISOString(),
      connectUrl: `wss://connect.example/${session.id}`,
    };
  }

  async function handle(url: string, init: RequestInit = {}): Promise<Response> {
    const method = init.method ?? 'GET';
    const parsed = new URL(url);
    const path = parsed.pathname.replace('/v1', '');
    calls.push(`${method} ${path}`);
    if (method === 'POST' && path === '/contexts') return json({ id: 'context_1' });
    if (method === 'POST' && path === '/sessions') {
      const body = JSON.parse(String(init.body ?? '{}')) as {
        userMetadata?: Record<string, string>;
      };
      return json(view(open(body.userMetadata ?? {})), 201);
    }
    if (method === 'GET' && path === '/sessions') {
      const match = /user_metadata\['([^']+)'\]:'([^']+)'/.exec(parsed.searchParams.get('q') ?? '');
      const found = [...sessions.values()].filter(
        (session) => match && session.userMetadata[match[1] ?? ''] === match[2],
      );
      return json(found.map(view));
    }
    const id = decodeURIComponent(path.split('/')[2] ?? '');
    const session = sessions.get(id);
    if (!session) return json({ statusCode: 404, message: 'Not Found' }, 404);
    if (method === 'GET') return json(view(session));
    if (method === 'POST') {
      if (failRelease) return json({ message: 'release failed' }, 503);
      release(id);
      return json(view(session));
    }
    return json({ message: 'unsupported' }, 405);
  }

  /** A session as the provider holds it after a create, whoever created it. */
  function open(userMetadata: Record<string, string>, startedAt = new Date()): FakeSession {
    created += 1;
    const session: FakeSession = {
      id: `browser_${created}`,
      status: 'RUNNING',
      startedAt: startedAt.toISOString(),
      userMetadata,
    };
    sessions.set(session.id, session);
    return session;
  }

  function release(id: string) {
    const session = sessions.get(id);
    if (!session || session.status === 'COMPLETED') return;
    session.status = 'COMPLETED';
    session.endedAt = new Date().toISOString();
  }

  return {
    sessions,
    calls,
    open,
    release,
    failRelease(value: boolean) {
      failRelease = value;
    },
    running: () => [...sessions.values()].filter((session) => session.status === 'RUNNING'),
    /** A `fetch` that answers Browserbase calls and refuses everything else. */
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith(BASE)) throw new Error(`Unexpected network call: ${url}`);
      return handle(url, init);
    },
  };
}
