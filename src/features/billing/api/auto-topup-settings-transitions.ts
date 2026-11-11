import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db';
import { workspace, workspaceNotDeleted } from '@/db/schema';
import type { AutoTopupSettings, AutoTopupSettingsInput } from './auto-topup-settings';

export async function persistAutoTopupSettings(
  workspaceId: string,
  settings: AutoTopupSettingsInput,
): Promise<{ kind: 'moved'; settings: AutoTopupSettings } | { kind: 'refused' }> {
  const updated = (
    await db
      .update(workspace)
      .set({
        autoTopupEnabled: settings.enabled,
        autoTopupThresholdCredits: settings.thresholdCredits,
        autoTopupCredits: settings.credits,
        autoTopupMonthlyCapCents: settings.monthlyCapDollars * 100,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workspace.id, workspaceId),
          workspaceNotDeleted,
          settings.enabled ? ne(workspace.planTier, 'none') : undefined,
        ),
      )
      .returning({
        enabled: workspace.autoTopupEnabled,
        thresholdCredits: workspace.autoTopupThresholdCredits,
        topupCredits: workspace.autoTopupCredits,
        monthlyCapCents: workspace.autoTopupMonthlyCapCents,
      })
  ).at(0);
  return updated ? { kind: 'moved', settings: updated } : { kind: 'refused' };
}
