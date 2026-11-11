import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/brand/identity';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified },
    { url: `${SITE_URL}/terms`, lastModified },
    { url: `${SITE_URL}/privacy`, lastModified },
  ];
}
