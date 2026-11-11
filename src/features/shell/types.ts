// Shell-local types shared by the (app) layout (server, resolves the data) and
// the sidebar components (client, render it).

export type ShellUser = {
  name: string | null;
  email: string;
  image: string | null;
};

// One row in the top-left workspace switcher: every workspace the user belongs
// to, projected from `listUserWorkspaces` (the layout drops the role — the
// switcher doesn't show it). `isActive` marks the session's current org.
export type ShellWorkspace = {
  organizationId: string;
  name: string;
  isActive: boolean;
};

type ShellViewer = { user: ShellUser; userId: string };
export type ShellGateState =
  | { kind: 'signed_out' }
  | ({
      kind: 'ready';
      organizationId: string;
      workspaceName: string;
      workspaces: ShellWorkspace[];
    } & ShellViewer)
  | ({ kind: 'failed'; workspaces: ShellWorkspace[] } & ShellViewer);
