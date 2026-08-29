import { NextRequest, NextResponse } from 'next/server';
import { ensureComposioUserId } from '@/lib/composio/user';
import { getActiveGithubConnection, isComposioConfigured } from '@/lib/composio/client';
import { armHealTriggers, registerWebhook, type HealTriggerKind } from '@/lib/composio/triggers';

/** Report which GitHub triggers are currently armed for this user. */
export async function GET() {
  if (!isComposioConfigured()) {
    return NextResponse.json({ success: false, error: 'COMPOSIO_API_KEY is not set' }, { status: 400 });
  }
  const userId = await ensureComposioUserId();
  const connection = await getActiveGithubConnection(userId);
  const { getComposio } = await import('@/lib/composio/client');
  const active = await getComposio()
    .triggers.listActive({ connectedAccountIds: connection ? [connection.id] : undefined })
    .catch(() => ({ items: [] as Array<{ triggerName?: string }> }));

  return NextResponse.json({
    success: true,
    connected: Boolean(connection),
    triggers: (active.items || []).map((item) => item.triggerName).filter(Boolean),
  });
}

/** Arm the heal triggers, and point Composio's webhook at this deployment. */
export async function POST(request: NextRequest) {
  if (!isComposioConfigured()) {
    return NextResponse.json({ success: false, error: 'COMPOSIO_API_KEY is not set' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const userId = await ensureComposioUserId();

  const connection = await getActiveGithubConnection(userId);
  if (!connection) {
    return NextResponse.json(
      { success: false, error: 'Connect GitHub first — triggers need an active Composio connection.' },
      { status: 400 }
    );
  }

  const kinds: HealTriggerKind[] = Array.isArray(body.kinds) && body.kinds.length > 0
    ? body.kinds
    : ['checkRun', 'issueOpened', 'reviewComment'];

  const result = await armHealTriggers(userId, kinds, body.repoFullName);

  // Only meaningful once the app is reachable from the internet; the websocket
  // listener covers localhost demos instead.
  const publicUrl = body.publicUrl || process.env.OPENHEAL_PUBLIC_URL?.trim();
  let webhook: string | undefined;
  if (publicUrl) {
    await registerWebhook(publicUrl).catch(() => undefined);
    webhook = `${publicUrl.replace(/\/$/, '')}/api/webhooks/composio`;
  }

  return NextResponse.json({ success: true, ...result, webhook });
}
