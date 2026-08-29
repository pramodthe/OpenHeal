import { NextResponse } from 'next/server';
import { ensureComposioUserId } from '@/lib/composio/user';
import { getActiveGithubConnection, getComposio, isComposioConfigured } from '@/lib/composio/client';

/** Remove the active GitHub connection so the user can re-authorize with webhook scopes. */
export async function POST() {
  try {
    if (!isComposioConfigured()) {
      return NextResponse.json({ success: false, error: 'Composio is not configured' }, { status: 400 });
    }
    const userId = await ensureComposioUserId();
    const connection = await getActiveGithubConnection(userId);
    if (!connection) {
      return NextResponse.json({ success: true, disconnected: false });
    }

    await getComposio().connectedAccounts.delete(connection.id);
    return NextResponse.json({ success: true, disconnected: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to disconnect GitHub';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
