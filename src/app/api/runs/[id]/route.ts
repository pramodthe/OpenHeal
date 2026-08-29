import { NextRequest, NextResponse } from 'next/server';
import { getRun } from '@/lib/store/runs-store';
import { sessionManager } from '@/lib/trueforge/session';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const record = await getRun(id);
  const session = sessionManager.getSession(id);
  return NextResponse.json({
    success: true,
    run: record || null,
    session: session || null,
  });
}
