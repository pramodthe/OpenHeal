import { NextRequest, NextResponse } from 'next/server';
import { harness } from '@/lib/trueforge/harness';
import { sessionManager } from '@/lib/trueforge/session';
import { getHarnessRun, resolveHarnessApproval } from '@/lib/trueforge/heal-agent';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { sessionId, resumeToken, feedback, reason } = body;

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: sessionId' },
        { status: 400 }
      );
    }

    // Deny the paused tool call on the harness when TrueForge owns the run.
    if (getHarnessRun(sessionId)) {
      const resolved = await resolveHarnessApproval(sessionId, 'main', false, reason || feedback);
      if (!resolved.success) {
        return NextResponse.json({ success: false, error: resolved.error }, { status: 400 });
      }
      return NextResponse.json({
        success: true,
        status: 'deny',
        via: 'trueforge',
        sessionStatus: sessionManager.getSession(sessionId)?.status,
        message: 'Rejection sent to TrueForge as user.tool_approval deny.',
      });
    }

    if (!resumeToken) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: resumeToken' },
        { status: 400 }
      );
    }

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { success: false, error: `Session "${sessionId}" not found` },
        { status: 404 }
      );
    }

    const denialReason = feedback || reason || 'Rejected by human reviewer';

    const result = await harness.resumeWithApproval(
      sessionId,
      resumeToken,
      {
        status: 'deny',
        reason: denialReason,
      }
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to process rejection' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      status: 'deny',
      feedback: denialReason,
      resumed: true,
      sessionStatus: result.sessionState.status,
      message: 'Patch rejected by human operator.',
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error during rejection' },
      { status: 500 }
    );
  }
}
