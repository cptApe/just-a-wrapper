import { ENABLED_TOOLKITS, type ToolkitMeta, toolkitLogoUrl } from '@/lib/composio/toolkits';
import { IntegrationLogo } from './integration-logo';

function ToolkitTile({ toolkit }: { toolkit: ToolkitMeta }) {
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-lg bg-alpha-6 p-3">
      <IntegrationLogo
        logoUrl={toolkitLogoUrl(toolkit.slug)}
        name={toolkit.name}
        slug={toolkit.slug}
        size={32}
        imagePadding="p-1"
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="truncate text-body font-semibold text-foreground">{toolkit.name}</h3>
        <p className="text-pretty text-meta text-foreground">{toolkit.blurb}</p>
      </div>
    </li>
  );
}

export function IntegrationsAdminShelf() {
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {ENABLED_TOOLKITS.map((toolkit) => (
        <ToolkitTile key={toolkit.slug} toolkit={toolkit} />
      ))}
    </ul>
  );
}
