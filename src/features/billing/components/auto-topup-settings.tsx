'use client';

import { SettingsDetailRow } from '@/components/settings/settings-detail-row';
import { InlinePrompt } from '@/components/ui/inline-prompt';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { formatCount } from '@/lib/format/format-number';
import type { AutoTopupSettings as AutoTopupSettingsValue } from '../api/auto-topup-settings';
import { useAutoTopupSettings } from '../hooks/use-auto-topup-settings';
import { autoTopupRule } from '../lib/credit-rules-copy';
import { AUTO_TOPUP, CREDIT_PACKAGES } from '../pricing-config';

// Form copy and validation share the configured ceiling so the UI cannot offer a limit the server rejects.
const MAX_MONTHLY_CAP_DOLLARS = AUTO_TOPUP.maxMonthlyCapCents / 100;

export function AutoTopupSettings({
  initial,
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initial: AutoTopupSettingsValue;
}) {
  const { saved, fields, update, validation, submission } = useAutoTopupSettings(initial);
  const { enabled, threshold, credits, capDollars } = fields;
  const { setEnabled, setThreshold, setCredits, setCapDollars } = update;
  const { capError, setCapError, capErrorId, capInputRef } = validation;
  const { saving, save } = submission;

  return (
    <SettingsDetailRow
      layout="stacked"
      open={open}
      onOpenChange={onOpenChange}
      label="Automatic top-ups"
      value={
        saved.enabled
          ? autoTopupRule(saved.thresholdCredits, saved.topupCredits, saved.monthlyCapCents / 100)
          : 'Off'
      }
      onSave={save}
      saveDisabled={saving}
      onCancel={() => {
        setEnabled(saved.enabled);
        setThreshold(saved.thresholdCredits);
        setCredits(saved.topupCredits);
        setCapDollars(saved.monthlyCapCents / 100);
        setCapError(null);
      }}
    >
      <fieldset disabled={saving} className="flex max-w-xl flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center justify-between gap-4 text-body font-medium">
            <span className="font-medium">Keep working if I run out</span>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label="Keep working if I run out"
            />
          </label>
          {enabled ? (
            <p className="text-meta text-muted-foreground">
              {autoTopupRule(threshold, credits, capDollars)}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5 text-body font-medium">
            <span id="auto-topup-threshold-label">Top up at</span>
            <Select
              value={String(threshold)}
              onValueChange={(value) => setThreshold(Number(value))}
            >
              <SelectTrigger aria-labelledby="auto-topup-threshold-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTO_TOPUP.thresholdChoices.map((amount) => (
                  <SelectItem key={amount} value={String(amount)}>
                    {formatCount(amount)} credits
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5 text-body font-medium">
            <span id="auto-topup-credits-label">Add</span>
            <Select value={String(credits)} onValueChange={(value) => setCredits(Number(value))}>
              <SelectTrigger aria-labelledby="auto-topup-credits-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CREDIT_PACKAGES.map((amount) => (
                  <SelectItem key={amount} value={String(amount)}>
                    {formatCount(amount)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex flex-col gap-1.5 text-body font-medium">
            Monthly limit ($)
            <Input
              ref={capInputRef}
              name="autoTopupMonthlyCapDollars"
              aria-label="Monthly limit in dollars"
              autoComplete="off"
              type="number"
              min={0}
              max={MAX_MONTHLY_CAP_DOLLARS}
              step={1}
              value={capDollars}
              aria-invalid={Boolean(capError)}
              aria-describedby={capError ? capErrorId : undefined}
              onChange={(event) => {
                setCapError(null);
                setCapDollars(Number(event.target.value || '0'));
              }}
            />
            {capError ? (
              <InlinePrompt id={capErrorId} className="text-meta">
                {capError}
              </InlinePrompt>
            ) : null}
          </label>
        </div>
      </fieldset>
    </SettingsDetailRow>
  );
}
