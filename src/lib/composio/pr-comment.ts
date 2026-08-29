import { executeGithubTool } from './client.ts';

export async function postPrReviewComment(input: {
  userId: string;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}): Promise<{ url?: string; id?: number }> {
  const data = await executeGithubTool('GITHUB_CREATE_AN_ISSUE_COMMENT', input.userId, {
    owner: input.owner,
    repo: input.repo,
    issue_number: input.issueNumber,
    body: input.body,
  });

  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    return {
      url: typeof record.html_url === 'string' ? record.html_url : undefined,
      id: typeof record.id === 'number' ? record.id : undefined,
    };
  }
  return {};
}
