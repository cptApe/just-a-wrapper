import { AdminSection } from '@/components/admin/admin-section';
import { AdminStatusBanner } from '@/components/admin/status-banner';
import { IconChevronRight } from '@/components/icons';
import type { DisplayFormat } from '@/lib/format/display-format';
import { formatDateTime } from '@/lib/format/format-date';
import type { StripeWebhookStatus } from '../api/get-stripe-webhook-status';
import { readEnvironmentKeys } from '../lib/env-status';
import { buildEnvTemplate } from '../lib/env-template';
import { readCapabilityGroups } from '../lib/environment-capabilities';
import { EnvKeyRow } from './env-key-row';
import { EnvTemplateCopyButton } from './env-template-copy-button';

export function EnvironmentAdmin({
  stripeWebhook,
  displayFormat,
}: {
  stripeWebhook: StripeWebhookStatus;
  /** The viewer's zone and clock for the last-webhook time. */
  displayFormat: DisplayFormat;
}) {
  const keys = readEnvironmentKeys();
  const capabilityGroups = readCapabilityGroups(keys);
  const missingRequired = capabilityGroups
    .flatMap((section) => section.keys)
    .filter((key) => key.required && !key.isSet);
  const missingNames = new Set(missingRequired.map((key) => key.name));

  return (
    <>
      {missingRequired.length > 0 ? (
        <section
          aria-labelledby="missing-required"
          className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning-soft px-5 py-4"
        >
          <h2 id="missing-required" className="text-title-section text-warning">
            Your app can&apos;t start without these
          </h2>
          <ul className="flex flex-col divide-y divide-warning/20">
            {missingRequired.map((envKey) => (
              <EnvKeyRow key={envKey.name} envKey={envKey} />
            ))}
          </ul>
        </section>
      ) : (
        <AdminStatusBanner tone="ready">All required keys are set</AdminStatusBanner>
      )}

      <AdminSection
        id="key-template"
        title="Set up your keys"
        action={<EnvTemplateCopyButton template={buildEnvTemplate(keys)} />}
      />

      <div className="grid gap-6">
        {capabilityGroups.map((section) => {
          const visibleKeys = section.keys.filter((envKey) => !missingNames.has(envKey.name));
          const sectionId = `capability-${section.group.toLowerCase().replaceAll(' ', '-')}`;
          return (
            <details
              key={section.group}
              open
              className="group/env overflow-hidden rounded-xl border bg-card"
            >
              <summary className="flex cursor-pointer select-none list-none items-center gap-3 bg-alpha-3 px-4 py-3 hover:bg-alpha-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden sm:px-5">
                <IconChevronRight
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-[var(--ease-out)] motion-reduce:transition-none group-open/env:rotate-90"
                />
                <h2 id={sectionId} className="text-title-section">
                  {section.group}
                </h2>
              </summary>
              <ul className="flex flex-col divide-y border-t">
                {visibleKeys.map((envKey) => (
                  <EnvKeyRow
                    key={envKey.name}
                    envKey={envKey}
                    detail={
                      envKey.name === 'STRIPE_WEBHOOK_SECRET'
                        ? stripeWebhook.configurationErrors.length > 0
                          ? stripeWebhook.configurationErrors.join(' ')
                          : stripeWebhook.kind === 'received'
                            ? `Last webhook received ${formatDateTime(stripeWebhook.at, displayFormat)}.`
                            : 'No Stripe webhook has been received in this environment.'
                        : undefined
                    }
                  />
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </>
  );
}
