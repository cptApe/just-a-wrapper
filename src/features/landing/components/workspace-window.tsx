import { WorkspaceSidebar } from './workspace-sidebar';
import { WorkspaceTask } from './workspace-task';

/**
 * The product drawn in code at its true size, running off the fold of the hero.
 * The bezel and the dimmed content keep it behind the heading and the page's
 * buttons. The bezel padding plus the window radius equals the bezel radius, so
 * the two corners stay concentric.
 */
export function WorkspaceWindow() {
  return (
    <div aria-hidden inert className="rounded-t-xl bg-alpha-3 px-2 pt-2 shadow-popover">
      <div className="h-[548px] overflow-hidden rounded-t-lg border border-b-0 bg-background md:h-[584px]">
        <div className="flex h-full opacity-85">
          <WorkspaceSidebar />
          <WorkspaceTask />
        </div>
      </div>
    </div>
  );
}
