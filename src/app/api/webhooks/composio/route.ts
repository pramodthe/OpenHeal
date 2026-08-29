import { NextRequest, NextResponse } from 'next/server';
import { getComposio } from '@/lib/composio/client';

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
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Invalid webhook' },
      { status: 401 }
    );
  }

  const { handleComposioTriggerPayload } = await import('@/lib/composio/handle-trigger');
  const result = await handleComposioTriggerPayload(payload);

  return NextResponse.json({
    success: true,
    ...result,
  });
}
