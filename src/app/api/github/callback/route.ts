import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const appUrl = new URL('/app', request.nextUrl.origin);
  appUrl.searchParams.set('github', 'connected');
  return NextResponse.redirect(appUrl);
}
