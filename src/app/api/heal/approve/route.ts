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

    // When TrueForge owns the run, the pause is a real tool.approval_required and
    // is resumed with user.tool_approval — no OpenHeal-issued resume token exists.
    const harnessRun = getHarnessRun(sessionId);
    if (harnessRun) {
      // Each pending approval carries the thread that owns it; 'main' is only
      // the fallback for events that arrived without one.
      const resolved = await resolveHarnessApproval(sessionId, 'main', true, feedback || reason);
      if (!resolved.success) {
        return NextResponse.json({ success: false, error: resolved.error }, { status: 400 });
      }
      const state = sessionManager.getSession(sessionId);
      return NextResponse.json({
        success: true,
        status: 'allow',
        resumed: true,
        via: 'trueforge',
        sessionStatus: state?.status,
        pullRequest: state?.pullRequest,
        message: 'Approval sent to TrueForge as user.tool_approval; the paused turn resumed.',
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

    const result = await harness.resumeWithApproval(
      sessionId,
      resumeToken,
      {
        status: 'allow',
        reason: feedback || reason || 'Approved by human operator via Mission Control UI',
      }
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || 'Failed to resume session with approval' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      status: 'allow',
      resumed: true,
      sessionStatus: result.sessionState.status,
      pullRequest: result.sessionState.pullRequest,
      message: 'Human approval granted. GitHub PR workflow triggered.',
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error during approval' },
      { status: 500 }
    );
  }
}
