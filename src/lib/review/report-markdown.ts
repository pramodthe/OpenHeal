import type { SwarmFinding } from '../store/runs-store.ts';

export interface ReviewReportInput {
  prNumber?: number;
  repoFullName: string;
  findings: SwarmFinding[];
  buildStatus?: 'passed' | 'failed';
  appUrl?: string;
  swarmSummary?: string;
}

export function formatReviewMarkdown(input: ReviewReportInput): string {
  const counts = input.findings.reduce(
    (acc, f) => {
      acc[f.severity] = (acc[f.severity] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const summaryParts = Object.entries(counts).map(([sev, n]) => `${n} ${sev}`);
  const swarmSummary =
    input.swarmSummary ||
    `Explorer found ${input.findings.length} issue(s)${summaryParts.length ? ` (${summaryParts.join(', ')})` : ''}`;

  let body = `## OpenHeal Agent Review — PR #${input.prNumber ?? '?'}\n\n`;
  body += `**Repository:** \`${input.repoFullName}\`\n`;
  body += `**Swarm summary:** ${swarmSummary}\n`;
  if (input.buildStatus) body += `**Build:** ${input.buildStatus}\n`;
  if (input.appUrl) body += `**App URL (sandbox):** ${input.appUrl}\n`;
  body += '\n---\n\n';

  if (input.findings.length === 0) {
    body += 'No behavioral regressions detected in the exercised flows.\n';
    return body;
  }

  input.findings.forEach((f, i) => {
    const sev = f.severity.toUpperCase();
    body += `### Finding ${i + 1} — ${sev}: ${f.title}\n\n`;
    if (f.reproSteps.length) {
      body += '**Explorer repro:**\n';
      f.reproSteps.forEach((step, idx) => {
        body += `${idx + 1}. ${step}\n`;
      });
      body += '\n';
    }
    if (f.filePath) {
      body += `**Diagnostic:** \`${f.filePath}${f.line ? `:${f.line}` : ''}\`${f.hypothesis ? ` — ${f.hypothesis}` : ''}\n\n`;
    }
    if (f.screenshotUrl) {
      body += `**Evidence:** ![screenshot](${f.screenshotUrl})\n\n`;
    }
  });

  body += '---\n*Posted by OpenHeal agent swarm (BuildOps → Explorer → Diagnostic → Reporter)*\n';
  return body;
}
