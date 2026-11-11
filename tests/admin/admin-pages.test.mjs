// Every console rail link has a page behind it; a missing route is a 404 only the disk shows.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { ADMIN_PAGE_SLUGS, isAdminPageSlug } from '../../src/features/admin/lib/slugs.ts';

test('every admin slug has a page route, and only real slugs are accepted', () => {
  for (const slug of ADMIN_PAGE_SLUGS) {
    const route =
      slug === 'overview'
        ? 'src/app/(admin)/admin/page.tsx'
        : `src/app/(admin)/admin/${slug}/page.tsx`;
    assert.ok(existsSync(route), `${route} is missing, so the ${slug} rail link is a 404`);
    assert.equal(isAdminPageSlug(slug), true, slug);
  }
  for (const bogus of ['', 'Overview', 'theme/', '__proto__', 'constructor', 'toString']) {
    assert.equal(isAdminPageSlug(bogus), false, bogus);
  }
});
