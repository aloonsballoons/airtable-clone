import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const initials = searchParams.get('initials') || '??';

  // Create SVG favicon matching the base button style
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="7" fill="#8c4078"/>
      <rect width="32" height="32" rx="7" fill="none" stroke="#743663" stroke-width="1"/>
      <text
        x="16"
        y="17"
        font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
        font-size="16"
        font-weight="500"
        fill="#ffffff"
        text-anchor="middle"
        dominant-baseline="middle"
      >${initials}</text>
    </svg>
  `.trim();

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
