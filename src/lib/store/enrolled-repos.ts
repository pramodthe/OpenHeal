import { readJsonFile, writeJsonFile } from './json-store.ts';

export interface EnrolledRepo {
  fullName: string;
  owner: string;
  repo: string;
  htmlUrl: string;
  watchPrs: boolean;
  autoFix: boolean;
  enrolledAt: string;
  composioUserId: string;
  triggerArmed?: string[];
  triggerFailed?: Array<{ slug: string; error: string }>;
  triggerUpdatedAt?: string;
}

const FILE = 'enrolled-repos.json';

export async function listEnrolledRepos(composioUserId?: string): Promise<EnrolledRepo[]> {
  const all = await readJsonFile<EnrolledRepo[]>(FILE, []);
  if (!composioUserId) return all;
  return all.filter((r) => r.composioUserId === composioUserId);
}

export async function getEnrolledRepo(
  fullName: string,
  composioUserId: string
): Promise<EnrolledRepo | undefined> {
  const all = await listEnrolledRepos(composioUserId);
  return all.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
}

export async function upsertEnrolledRepo(input: {
  fullName: string;
  htmlUrl: string;
  composioUserId: string;
  watchPrs?: boolean;
  autoFix?: boolean;
  triggerArmed?: string[];
  triggerFailed?: Array<{ slug: string; error: string }>;
}): Promise<EnrolledRepo> {
  const [owner, repo] = input.fullName.split('/');
  const all = await readJsonFile<EnrolledRepo[]>(FILE, []);
  const idx = all.findIndex(
    (r) => r.fullName.toLowerCase() === input.fullName.toLowerCase() && r.composioUserId === input.composioUserId
  );
  const record: EnrolledRepo = {
    fullName: input.fullName,
    owner: owner || input.fullName,
    repo: repo || input.fullName,
    htmlUrl: input.htmlUrl,
    watchPrs: input.watchPrs ?? true,
    autoFix: input.autoFix ?? false,
    enrolledAt: idx >= 0 ? all[idx].enrolledAt : new Date().toISOString(),
    composioUserId: input.composioUserId,
    triggerArmed: input.triggerArmed ?? (idx >= 0 ? all[idx].triggerArmed : undefined),
    triggerFailed: input.triggerFailed ?? (idx >= 0 ? all[idx].triggerFailed : undefined),
    triggerUpdatedAt:
      input.triggerArmed || input.triggerFailed
        ? new Date().toISOString()
        : idx >= 0
          ? all[idx].triggerUpdatedAt
          : undefined,
  };
  if (idx >= 0) all[idx] = record;
  else all.push(record);
  await writeJsonFile(FILE, all);
  return record;
}

export async function resolveComposioUserForRepo(fullName: string): Promise<string | undefined> {
  const all = await readJsonFile<EnrolledRepo[]>(FILE, []);
  const match = all.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase() && r.watchPrs);
  return match?.composioUserId;
}
