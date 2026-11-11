import { BillingError } from '@/lib/errors';
import { persistAutoTopupSettings } from './auto-topup-settings-transitions';
import type { ActiveWorkspace } from './resolve-workspace';
import 'server-only';
import type { z } from 'zod';
import { monthlyCapError } from '../lib/auto-topup-cap';
import type { autoTopupSettingsSchema } from '../lib/billing-response';
import { AUTO_TOPUP, CREDIT_PACKAGES, isPlanTier } from '../pricing-config';

export type AutoTopupSettingsInput = {
  enabled: boolean;
  thresholdCredits: number;
  credits: number;

  monthlyCapDollars: number;
};

export type AutoTopupSettings = z.infer<typeof autoTopupSettingsSchema>;

export async function updateAutoTopupSettings(input: {
  workspace: ActiveWorkspace;
  settings: AutoTopupSettingsInput;
}): Promise<AutoTopupSettings> {
  const { workspace } = input;
  if (input.settings.enabled && !isPlanTier(workspace.planTier)) {
    throw new BillingError(
      'VALIDATION_FAILED',
      'Automatic top-ups run only on a subscription, and this workspace has none.',
      {
        workspaceId: workspace.id,
        planTier: workspace.planTier,
      },
    );
  }
  if (
    !AUTO_TOPUP.thresholdChoices.some((threshold) => threshold === input.settings.thresholdCredits)
  ) {
    throw new BillingError('VALIDATION_FAILED', 'That is not a balance we offer as a trigger.', {
      workspaceId: workspace.id,
      thresholdCredits: input.settings.thresholdCredits,
    });
  }
  if (!CREDIT_PACKAGES.some((credits) => credits === input.settings.credits)) {
    throw new BillingError('VALIDATION_FAILED', 'That is not a credit amount we sell.', {
      workspaceId: workspace.id,
      credits: input.settings.credits,
    });
  }
  const capError = monthlyCapError(input.settings);
  if (capError) {
    throw new BillingError('VALIDATION_FAILED', capError, {
      workspaceId: workspace.id,
      enabled: input.settings.enabled,
      monthlyCapDollars: input.settings.monthlyCapDollars,
    });
  }

  const outcome = await persistAutoTopupSettings(workspace.id, input.settings);
  if (outcome.kind === 'refused') {
    throw new BillingError(
      'CONFLICT',
      'The workspace is no longer eligible for these automatic top-up settings. Reload billing and retry.',
      { workspaceId: workspace.id },
    );
  }
  return outcome.settings;
}
