import Image from 'next/image';
import { AdminSection } from '@/components/admin/admin-section';
import { IconLinkExternal01 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { formatAdminPrompt } from '@/lib/admin-prompt';
import composioLogo from '../assets/composio-logo.svg';
import {
  COMPOSIO_TOOLKIT_DIRECTORY_URL,
  INTEGRATIONS_ADMIN_PROMPT,
} from '../lib/admin-page-content';
import { IntegrationsAdminShelf } from './integrations-admin-shelf';

export function IntegrationsAdmin() {
  return (
    <>
      <AdminSection id="browse-and-add" title="Browse and add">
        <div className="flex flex-col gap-6 rounded-xl bg-alpha-6 p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-glass-bg p-2">
              <Image src={composioLogo} alt="" className="size-full" />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <h3 className="text-title-card font-semibold text-foreground">Composio</h3>
              <p className="max-w-2xl text-pretty text-body text-foreground">
                Composio is the integration partner that connects your product to hundreds of apps.
                The kit uses one partner so customers can connect their tools safely without you
                building every connection yourself.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button asChild size="lg" className="w-full sm:w-fit">
              <a href={COMPOSIO_TOOLKIT_DIRECTORY_URL} target="_blank" rel="noopener noreferrer">
                Browse 1000+ apps
                <span className="sr-only"> (opens in a new tab)</span>
                <IconLinkExternal01 aria-hidden />
              </a>
            </Button>
            <CopyButton
              label="Add an app with your agent"
              op="admin.copy-add-integration"
              text={formatAdminPrompt(INTEGRATIONS_ADMIN_PROMPT)}
              variant="secondary"
              size="lg"
              className="w-full sm:w-fit"
            />
          </div>
        </div>
      </AdminSection>

      <AdminSection
        id="apps"
        title="Apps your product supports"
        support="Your customers connect these from their Tools page. Actions that change data ask first. Your customers can change this for each action."
      >
        <IntegrationsAdminShelf />
      </AdminSection>
    </>
  );
}
