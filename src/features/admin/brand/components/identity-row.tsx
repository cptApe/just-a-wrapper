import { IconInfoCircle } from '@/components/icons';
import { CopyButton } from '@/components/ui/copy-button';
import { DelayedTooltip } from '@/components/ui/tooltip';
import { type IdentityField, identityPromptText } from '../identity';

export function IdentityRow({ field }: { field: IdentityField }) {
  return (
    <div className="flex items-start justify-between gap-5 py-6">
      <div className="min-w-0">
        <h3 className="flex items-center gap-1.5 text-title-card">
          {field.label}
          <DelayedTooltip content={field.description} side="top">
            <button
              type="button"
              aria-label={`Where ${field.label.toLowerCase()} shows up`}
              className="relative inline-flex size-5 shrink-0 items-center justify-center rounded-button text-muted-foreground transition-colors duration-150 before:absolute before:-inset-2 before:content-[''] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            >
              <IconInfoCircle className="size-4" aria-hidden="true" />
            </button>
          </DelayedTooltip>
        </h3>
        <p
          className="break-words pt-1 text-title-section font-semibold tracking-tight"
          translate="no"
        >
          {field.value}
        </p>
      </div>
      <div className="shrink-0 pt-1">
        <CopyButton
          label="Change"
          op="admin.copy-brand-field-prompt"
          context={{ field: field.label }}
          text={identityPromptText(field)}
          size="default"
        />
      </div>
    </div>
  );
}
