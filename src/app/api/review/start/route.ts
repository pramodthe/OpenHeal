import { NextRequest, NextResponse } from 'next/server';
import { ensureComposioUserId } from '@/lib/composio/user';
import {
  executeGithubTool,
  getActiveGithubConnection,
  githubConnectionHasWebhookScope,
  isComposioConfigured,
} from '@/lib/composio/client';
import { getEnrolledRepo } from '@/lib/store/enrolled-repos';
import { startReviewSwarm } from '@/lib/review/run-review-swarm';

/** Manually start a PR review run (works without Composio PR triggers). */
export async function POST(request: NextRequest) {
  try {
    if (!isComposioConfigured()) {
      return NextResponse.json({ success: false, error: 'Composio is not configured' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const fullName = String(body.fullName || '').trim();
    const prNumber = Number(body.prNumber);
    if (!fullName.includes('/') || !Number.isFinite(prNumber) || prNumber < 1) {
      return NextResponse.json(
        { success: false, error: 'Provide fullName (owner/repo) and prNumber' },
        { status: 400 }
      );
    }

    const userId = await ensureComposioUserId();
    const connection = await getActiveGithubConnection(userId);
    if (!connection) {
      return NextResponse.json({ success: false, error: 'Connect GitHub first.' }, { status: 400 });
    }

    const enrolled = await getEnrolledRepo(fullName, userId);
    const autoFix = enrolled?.autoFix ?? false;

    const [owner, repo] = fullName.split('/');
    const pr = (await executeGithubTool('GITHUB_GET_A_PULL_REQUEST', userId, {
      pull_number: prNumber,
    })) as Record<string, unknown>;

    const head = pr.head && typeof pr.head === 'object' ? (pr.head as Record<string, unknown>) : {};
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    startReviewSwarm({
      sessionId,
      repoUrl: `https://github.com/${fullName}`,
      repoFullName: fullName,
      composioUserId: userId,
      prNumber,
      prUrl: typeof pr.html_url === 'string' ? pr.html_url : undefined,
      headBranch: typeof head.ref === 'string' ? head.ref : undefined,
      headSha: typeof head.sha === 'string' ? head.sha : undefined,
      autoFix,
      triggerPrompt:
        `Manually requested review of pull request #${prNumber} on ${fullName}. ` +
        'Spawn the swarm in order: BuildOps → Explorer → Diagnostic → Reporter.',
    }).catch((err) => console.error('[review/start] swarm failed', err));

    return NextResponse.json({
      success: true,
      sessionId,
      prNumber,
      repoFullName: fullName,
      webhookScopeOk: githubConnectionHasWebhookScope(connection),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to start review';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
