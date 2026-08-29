/**
 * Reporter subagent — aggregate findings into PR review markdown.
 */
import { eventBus } from '../event-bus.ts';
import type { SwarmFinding } from '../../store/runs-store.ts';
import { formatReviewMarkdown, type ReviewReportInput } from '../../review/report-markdown.ts';

export class ReporterSubagent {
  public async report(
    sessionId: string,
    threadId: string,
    input: ReviewReportInput
  ): Promise<{ markdown: string; findingsCount: number }> {
    eventBus.emitEvent(sessionId, threadId, 'agent.status', {
      agent: 'reporter',
      status: 'running',
      message: 'Reporter: compiling PR review...',
    });

    const markdown = formatReviewMarkdown(input);
    eventBus.emitEvent(sessionId, threadId, 'review.completed', {
      markdown,
      findingsCount: input.findings.length,
      prNumber: input.prNumber,
    });
    eventBus.emitEvent(sessionId, threadId, 'agent.status', {
      agent: 'reporter',
      status: 'completed',
      message: `Review report ready (${input.findings.length} findings)`,
    });
    return { markdown, findingsCount: input.findings.length };
  }
}

export const reporterSubagent = new ReporterSubagent();

export type { SwarmFinding };
