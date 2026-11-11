import { dismissComposerBanner, getComposerBanners } from './composer-banner-store';
import { resetHomeDrafts } from './draft-store';

let generation = 0;

export function workspaceClientGeneration(): number {
  return generation;
}

export function resetWorkspaceClientState(): void {
  generation += 1;
  for (const banner of getComposerBanners()) dismissComposerBanner(banner.id);
  resetHomeDrafts();
}
