import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { brand, SITE_URL } from '@/lib/brand/identity';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  // The base every route's relative canonical and Open Graph URL resolves
  // against. SITE_URL is the single origin source, shared with sitemap.ts.
  metadataBase: new URL(SITE_URL),
  title: brand.name,
  description: brand.description,
};

// viewportFit: 'cover' lets the app paint into the iOS safe-area insets so the
// bottom-pinned composer can clear the home indicator itself (via
// env(safe-area-inset-bottom)); interactiveWidget: 'resizes-content' shrinks
// the layout viewport when the mobile keyboard opens, so the composer rides
// above the keyboard instead of being covered by it.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full overscroll-none antialiased ${inter.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-full overscroll-none bg-background text-foreground font-sans">
        {/* NuqsAdapter roots shared typed query state; each page owns its query schema. */}
        <NuqsAdapter>
          <ThemeProvider>
            {children}
            <Toaster />
          </ThemeProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
