import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';
import { brand } from '@/lib/brand/identity';

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="mx-auto flex h-16 w-full max-w-2xl items-center px-6">
        <Link href="/" aria-label={`${brand.name} home`}>
          <Logo />
        </Link>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
