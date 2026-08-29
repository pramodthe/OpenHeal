import { NextRequest, NextResponse } from 'next/server';
import { eventBus } from '@/lib/trueforge/event-bus';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json(
      { error: 'Missing required parameter: sessionId' },
      { status: 400 }
    );
  }

  const lastEventId = request.headers.get('last-event-id') || searchParams.get('lastEventId') || undefined;
  const stream = eventBus.toSSEStream(sessionId, request.signal, lastEventId);

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
