import { describe, it, before } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  classifyTriggerPayload,
  alreadyHandled,
  resetDedupe,
  OPENHEAL_BRANCH_PREFIX,
} from '../triggers.ts';

const repository = { full_name: 'acme/api', html_url: 'https://github.com/acme/api' };

const checkRun = (overrides: Record<string, unknown> = {}) => ({
  triggerSlug: 'GITHUB_CHECK_RUN_STATUS_CHANGED_TRIGGER',
  data: {
    repository,
    check_run: { name: 'pytest', conclusion: 'failure', head_sha: 'abc123' },
    ...overrides,
  },
});

describe('Composio GitHub trigger routing', () => {
  before(() => {
    process.env.OPENHEAL_BOT_LOGIN = 'openheal-bot';
    resetDedupe();
  });

  it('heals a failing CI check', () => {
    const decision = classifyTriggerPayload(checkRun());
    assert.equal(decision.act, true);
    assert.equal(decision.kind, 'checkRun');
    assert.equal(decision.repoUrl, 'https://github.com/acme/api');
    assert.match(decision.prompt!, /pytest/);
  });

  it('ignores a check that passed', () => {
    const decision = classifyTriggerPayload(
      checkRun({ check_run: { name: 'pytest', conclusion: 'success' } })
    );
    assert.equal(decision.act, false);
  });

  // The loop guards below are what stop OpenHeal from healing its own pull
  // requests forever. Removing either one re-opens that loop.
  it('ignores events authored by OpenHeal itself', () => {
    const decision = classifyTriggerPayload(checkRun({ sender: { login: 'openheal-bot' } }));
    assert.equal(decision.act, false);
    assert.match(decision.reason, /itself/i);
  });

  it('ignores events on branches OpenHeal pushed', () => {
    const decision = classifyTriggerPayload(
      checkRun({
        check_run: {
          name: 'pytest',
          conclusion: 'failure',
          check_suite: { head_branch: `${OPENHEAL_BRANCH_PREFIX}fix-123` },
        },
      })
    );
    assert.equal(decision.act, false);
    assert.match(decision.reason, /own branch/i);
  });

  it('only heals issues carrying the opt-in label', () => {
    const issue = (labels: Array<{ name: string }>) => ({
      triggerSlug: 'GITHUB_ISSUE_ADDED_EVENT',
      data: { repository, issue: { number: 7, title: 'crash', body: 'boom', labels } },
    });
    assert.equal(classifyTriggerPayload(issue([{ name: 'bug' }])).act, false);
    assert.equal(classifyTriggerPayload(issue([{ name: 'openheal' }])).act, true);
  });

  it('only answers review comments that mention @openheal', () => {
    const comment = (body: string) => ({
      triggerSlug: 'GITHUB_PR_REVIEW_COMMENT_CREATED_TRIGGER',
      data: { repository, pull_request: { number: 12 }, comment: { body } },
    });
    assert.equal(classifyTriggerPayload(comment('nit: rename this')).act, false);
    assert.equal(classifyTriggerPayload(comment('@openheal please fix')).act, true);
  });

  it('ignores an event with no repository', () => {
    const decision = classifyTriggerPayload({
      triggerSlug: 'GITHUB_CHECK_RUN_STATUS_CHANGED_TRIGGER',
      data: { check_run: { conclusion: 'failure' } },
    });
    assert.equal(decision.act, false);
  });

  it('suppresses a redelivered event', () => {
    resetDedupe();
    assert.equal(alreadyHandled('check:acme/api:abc'), false);
    assert.equal(alreadyHandled('check:acme/api:abc'), true);
  });
});
