import { NextResponse } from 'next/server';
import { getActiveGithubConnection, githubConnectionHasWebhookScope, isComposioConfigured } from '@/lib/composio/client';
import { ensureComposioUserId } from '@/lib/composio/user';

export async function GET() {
  try {
    const userId = await ensureComposioUserId();
    if (!isComposioConfigured()) {
      return NextResponse.json({
        success: true,
        configured: false,
        connected: false,
        userId,
        message: 'Set COMPOSIO_API_KEY in .env to enable Connect GitHub.',
      });
    }

    const account = await getActiveGithubConnection(userId);
    const connected = Boolean(account);
    return NextResponse.json({
      success: true,
      configured: true,
      connected,
      userId,
      accountId: account?.id,
      status: account?.status || 'DISCONNECTED',
      webhookScopeOk: account ? githubConnectionHasWebhookScope(account) : false,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to check GitHub connection';
    return NextResponse.json({ success: false, configured: isComposioConfigured(), connected: false, error: message }, { status: 500 });
  }
}
