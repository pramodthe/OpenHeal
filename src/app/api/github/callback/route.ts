import { NextRequest, NextResponse } from 'next/server';
import { bootstrapComposioTriggers } from '@/lib/composio/webhook-setup';

export async function GET(request: NextRequest) {
  const publicUrl = process.env.OPENHEAL_PUBLIC_URL?.trim();
  if (publicUrl?.startsWith('https://')) {
    const { ensureComposioProjectWebhook } = await import('@/lib/composio/triggers');
    await ensureComposioProjectWebhook(publicUrl).catch(() => undefined);
  } else {
    await bootstrapComposioTriggers().catch(() => undefined);
  }
  const appUrl = new URL('/app', request.nextUrl.origin);
  appUrl.searchParams.set('github', 'connected');
  return NextResponse.redirect(appUrl);
}
