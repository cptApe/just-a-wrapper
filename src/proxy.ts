import { type NextRequest, NextResponse } from 'next/server';
import { PATHNAME_HEADER } from '@/features/auth/lib/return-to';
import { env } from '@/lib/env';
import { imageContentSecurityPolicy } from '@/lib/image-csp';

export function proxy(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(PATHNAME_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(
    'Content-Security-Policy',
    imageContentSecurityPolicy(env.BLOB_READ_WRITE_TOKEN),
  );
  return response;
}

export const config = {
  matcher: ['/((?!api|ingest|_next/static|_next/image).*)'],
};
