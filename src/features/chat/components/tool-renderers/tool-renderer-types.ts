import type { ComponentType } from 'react';
import type { Icon } from '@/components/icons';
import type { ArtifactSummary } from '@/features/files/types';
import type { ToolChatItem } from '../../lib/chat-state';
import type { ToolVisibility } from '../../lib/tool-display';
import type { ToolStatus } from '../../lib/tool-display-activity';

export type ToolRendererProps = {
  item: ToolChatItem;
  status: ToolStatus;
  /** Session artifacts keyed by Anthropic file id, when the surface has them. */
  artifactsByFileId?: ReadonlyMap<string, ArtifactSummary>;
};

export type ToolRendererDescriptor = {
  /** What this renderer shows, in plain English (maintainer index). */
  description: string;
  /** How prominently the call renders in the thread; the tiers are documented on
   * `ToolVisibility` in lib/tool-display.ts. Absent → resolved dynamically
   * (connected-app writes are product receipts, reads are process; everything
   * else process). Governance is untouched — hiding is chat presentation only
   * (tool-transparency rule). */
  visibility?: ToolVisibility;
  /** The one consequence a person should read on the approval card before saying yes. */
  consequence?: string;
  /** Leading glyph. Tools without an entry fall back per-toolkit, then to Zap. */
  icon?: Icon;
  /** Rich output rendered right under the line, always visible — never
   * behind the unfold. The artifact itself is the point (images, files). */
  Preview?: ComponentType<ToolRendererProps>;
  /** Custom unfolded detail; absent → default argument rows + outcome text. */
  Details?: ComponentType<ToolRendererProps>;
  /** Suppress disclosure for receipt tools whose settled line is the whole result. */
  disclosure?: 'none';
  /** Replace a failed activity row with the renderer's plain failure detail. */
  failedPresentation?: 'details-only';
  /** Whether this call has content worth placing behind the disclosure control. */
  hasDetails?: (item: ToolChatItem) => boolean;
  /** Render the Preview ALONE — no activity line — once the call settles
   * successfully. The artifact is the message. Every other status keeps the
   * line (running shows the skeleton under it; gated, denied and failed carry
   * their decision and outcome). Requires a Preview. */
  frameless?: boolean;
  /** With `frameless`, gates the DONE-state frameless render on the settled
   * result being renderable — a garbled ok result keeps the line plus its raw
   * outcome instead of an empty frame. Absent → always renderable when done. */
  canRenderFrameless?: (item: ToolChatItem) => boolean;
};
