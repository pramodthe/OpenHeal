import { NextRequest, NextResponse } from 'next/server';
import { ensureComposioUserId } from '@/lib/composio/user';
import {
  getActiveGithubConnection,
  githubConnectionHasWebhookScope,
  isComposioConfigured,
} from '@/lib/composio/client';
import { armRepoPrTrigger, ensureComposioTriggerDelivery } from '@/lib/composio/webhook-setup';
import type { HealTriggerKind } from '@/lib/composio/triggers';
import { armHealTriggers } from '@/lib/composio/triggers';

/** Report which GitHub triggers are currently armed for this user. */
export async function GET() {
  if (!isComposioConfigured()) {
    return NextResponse.json({ success: false, error: 'COMPOSIO_API_KEY is not set' }, { status: 400 });
  }
  const userId = await ensureComposioUserId();
  const connection = await getActiveGithubConnection(userId);
  const delivery = await ensureComposioTriggerDelivery();
  const { getComposio } = await import('@/lib/composio/client');
  const active = await getComposio()
    .triggers.listActive({ connectedAccountIds: connection ? [connection.id] : undefined })
    .catch(() => ({ items: [] as Array<{ triggerName?: string }> }));

  return NextResponse.json({
    success: true,
    connected: Boolean(connection),
    triggers: (active.items || []).map((item) => item.triggerName).filter(Boolean),
    delivery,
    webhookUrl: delivery.publicUrl ? `${delivery.publicUrl}/api/webhooks/composio` : undefined,
  });
}

/** Arm Composio triggers after webhook delivery is configured. */
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

  const repoFullName = typeof body.repoFullName === 'string' ? body.repoFullName.trim() : undefined;

  if (repoFullName?.includes('/')) {
    const result = await armRepoPrTrigger({
      userId,
      fullName: repoFullName,
      connectedAccountId: connection.id,
      hasWebhookScope: githubConnectionHasWebhookScope(connection),
    });
    return NextResponse.json({
      success: result.failed.length === 0,
      ...result,
      webhook: result.delivery.publicUrl
        ? `${result.delivery.publicUrl}/api/webhooks/composio`
        : undefined,
    });
  }

  const kinds: HealTriggerKind[] =
    Array.isArray(body.kinds) && body.kinds.length > 0 ? body.kinds : ['prOpened'];

  const delivery = await ensureComposioTriggerDelivery();
  if (!delivery.webhookRegistered) {
    return NextResponse.json(
      { success: false, error: delivery.error, delivery },
      { status: 400 }
    );
  }

  const result = await armHealTriggers(userId, kinds, repoFullName, connection.id);

  return NextResponse.json({
    success: true,
    ...result,
    delivery,
    webhook: delivery.publicUrl ? `${delivery.publicUrl}/api/webhooks/composio` : undefined,
  });
}
