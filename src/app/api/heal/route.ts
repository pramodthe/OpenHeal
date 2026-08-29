import { NextRequest, NextResponse, after } from 'next/server';
import { startHealPipeline } from '@/lib/heal/run-session';
import { startReviewSwarm } from '@/lib/review/run-review-swarm';
import { ensureComposioUserId } from '@/lib/composio/user';
import { parseGitHubRepo } from '@/lib/heal/github';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const repoUrl = body.repoUrl || 'https://github.com/openheal-demo/python-calculator';
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const composioUserId = await ensureComposioUserId();
    const useReview =
      body.mode === 'review' ||
      body.scenarioId === 'demo-web-app' ||
      Boolean(body.prNumber);

    after(() => {
      if (useReview) {
        const parsed = parseGitHubRepo(repoUrl);
        startReviewSwarm({
          sessionId,
          repoUrl,
          repoFullName: parsed ? `${parsed.owner}/${parsed.repo}` : undefined,
          scenarioId: body.scenarioId,
          composioUserId,
          prNumber: body.prNumber,
          headBranch: body.headBranch,
          triggerPrompt: body.triggerPrompt,
          autoFix: Boolean(body.autoFix),
        }).catch((err) => console.error('[heal] review swarm failed', err));
        return;
      }

      startHealPipeline({
        sessionId,
        repoUrl,
        language: body.language,
        scenarioId: body.scenarioId,
        testCommand: body.testCommand,
        customCode: body.customCode,
        customFilePath: body.customFilePath,
        autoApprovePR: Boolean(body.autoApprovePR),
        openaiKey: body.openaiKey || body.llmApiKey,
        githubToken: body.githubToken,
        daytonaKey: body.daytonaKey,
        model: body.model,
        targetBranch: body.targetBranch,
        composioUserId,
      }).catch((err) => {
        console.error('[heal] pipeline failed', err);
      });
    });

    return NextResponse.json({
      success: true,
      sessionId,
      status: useReview ? 'BUILDING' : 'PROVISIONING_SANDBOX',
      mode: useReview ? 'review' : 'heal',
      message: useReview
        ? 'Agent swarm PR review queued'
        : 'Autonomous self-healing session queued for execution',
      config: { sessionId, repoUrl },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to initialize healing session' },
      { status: 500 }
    );
  }
}
