import { NextRequest, NextResponse } from 'next/server';
import { getActiveGithubConnection, getComposio, getGithubAuthConfigId, isComposioConfigured } from '@/lib/composio/client';
import { ensureComposioUserId } from '@/lib/composio/user';

export async function POST(request: NextRequest) {
  try {
    if (!isComposioConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error: 'COMPOSIO_API_KEY is missing. Add it once in .env — users then click Connect GitHub instead of pasting a PAT.',
        },
        { status: 400 }
      );
    }

    const userId = await ensureComposioUserId();
    const existing = await getActiveGithubConnection(userId);
    if (existing && String(existing.status).toUpperCase() === 'ACTIVE') {
      return NextResponse.json({
        success: true,
        alreadyConnected: true,
        connected: true,
        accountId: existing.id,
      });
    }

    const origin = request.nextUrl.origin;
    const authConfigId = await getGithubAuthConfigId();
    const connectionRequest = await getComposio().connectedAccounts.link(userId, authConfigId, {
      callbackUrl: `${origin}/api/github/callback`,
    });

    if (!connectionRequest.redirectUrl) {
      return NextResponse.json({ success: false, error: 'Composio did not return a GitHub OAuth URL.' }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      redirectUrl: connectionRequest.redirectUrl,
      connectionId: connectionRequest.id,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to start GitHub OAuth';
    if (/multiple connected accounts/i.test(message)) {
      return NextResponse.json({ success: true, alreadyConnected: true, connected: true });
    }
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
