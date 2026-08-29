import { NextResponse } from 'next/server';
import { SCENARIO_CATALOG } from '@/lib/scenarios-catalog';

export async function GET() {
  return NextResponse.json({
    success: true,
    scenarios: SCENARIO_CATALOG,
    count: SCENARIO_CATALOG.length,
    timestamp: new Date().toISOString(),
  });
}
