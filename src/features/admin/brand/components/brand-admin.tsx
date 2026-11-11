import { AdminSection } from '@/components/admin/admin-section';
import { brand } from '@/lib/brand/identity';
import { BRAND_IDENTITY } from '../identity';
import { resolvedOrigin } from '../origin';
import { HOME_PAGE_METADATA } from '../page-metadata';
import { IdentityRow } from './identity-row';
import { OgImageProvider } from './og-image-provider';
import { SearchResultPreview } from './search-result-preview';
import { SocialCardPreview } from './social-card-preview';

/** `contact` is the editable contact section, composed in by the page because it reads the store. */
export function BrandAdmin({ contact }: { contact: React.ReactNode }) {
  const origin = resolvedOrigin();

  return (
    <OgImageProvider>
      <>
        <AdminSection id="brand-identity" title="Identity">
          <div className="divide-y divide-border">
            {BRAND_IDENTITY.map((field) => (
              <IdentityRow key={field.label} field={field} />
            ))}
          </div>
        </AdminSection>

        {contact}

        <AdminSection id="link-previews" title="Link previews">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-meta font-medium text-muted-foreground">On Google</p>
              <SearchResultPreview
                siteName={brand.name}
                host={origin.host}
                route={HOME_PAGE_METADATA.route}
                title={HOME_PAGE_METADATA.title}
                description={HOME_PAGE_METADATA.description}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-meta font-medium text-muted-foreground">
                In messages and social apps
              </p>
              <SocialCardPreview
                host={origin.host}
                title={HOME_PAGE_METADATA.title}
                description={HOME_PAGE_METADATA.description}
              />
            </div>
          </div>
        </AdminSection>
      </>
    </OgImageProvider>
  );
}
