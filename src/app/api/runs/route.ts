import { NextResponse } from 'next/server';
import { listRuns } from '@/lib/store/runs-store';

export async function GET() {
  const runs = await listRuns(100);
  return NextResponse.json({ success: true, runs });
}
