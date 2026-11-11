import { ImageResponse } from 'next/og';
import { LOGO_MARK_PATH } from '@/components/brand/logo';
import { brand } from '@/lib/brand/identity';

export const alt = brand.name;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: 'center',
        background: '#0e0f0c',
        color: '#ffffff',
        display: 'flex',
        fontFamily: 'Inter, sans-serif',
        fontSize: 88,
        fontWeight: 600,
        gap: 32,
        height: '100%',
        justifyContent: 'center',
        letterSpacing: '-0.04em',
        width: '100%',
      }}
    >
      <svg width={112} height={112} viewBox="0 0 64 64" fill="#ffffff">
        <path d={LOGO_MARK_PATH} />
      </svg>
      {brand.name}
    </div>,
    size,
  );
}
