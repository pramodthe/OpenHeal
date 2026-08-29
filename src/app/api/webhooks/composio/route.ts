import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { getComposio } from '@/lib/composio/client';
import { alreadyHandled, classifyTriggerPayload } from '@/lib/composio/triggers';
import { startHealPipeline } from '@/lib/heal/run-session';

/** Composio signs deliveries; without the secret we parse but cannot verify. */
function webhookSecret(): string | undefined {
  return process.env.COMPOSIO_WEBHOOK_SECRET?.trim() || undefined;
}

export async function POST(request: NextRequest) {
  let payload: Record<string, unknown>;

  try {
    const parsed = await getComposio().triggers.parse(request, {
      verifySecret: webhookSecret(),
    });
    payload = (parsed as { payload?: Record<string, unknown> }).payload
      ?? (parsed as Record<string, unknown>);
  } catch (err) {
    // A signature failure is a rejected delivery, not a server fault.
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Invalid webhook' },
      { status: 401 }
    );
  }

  const decision = classifyTriggerPayload(payload);
  if (!decision.act) {
    return NextResponse.json({ success: true, acted: false, reason: decision.reason });
  }

  if (decision.dedupeKey && alreadyHandled(decision.dedupeKey)) {
    return NextResponse.json({
      success: true,
      acted: false,
      reason: `Already handling ${decision.dedupeKey}`,
    });
  }

  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const composioUserId =
    typeof payload.userId === 'string'
      ? payload.userId
      : typeof payload.user_id === 'string'
        ? payload.user_id
        : undefined;

  after(() => {
    startHealPipeline({
      sessionId,
      repoUrl: decision.repoUrl!,
      composioUserId,
      triggerPrompt: decision.prompt,
    }).catch((err) => {
      console.error('[composio-trigger] heal failed', err);
    });
  });

  return NextResponse.json({
    success: true,
    acted: true,
    sessionId,
    kind: decision.kind,
    reason: decision.reason,
    repo: decision.repoFullName,
  });
}
