import { NextRequest, NextResponse } from 'next/server';
import { readTraceLog } from '@/lib/trueforge/turn-tracer';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const events = readTraceLog(id);
  return NextResponse.json({
    success: true,
    sessionId: id,
    count: events.length,
    events,
  });
}
