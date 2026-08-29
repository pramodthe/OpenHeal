'use client';

import React, { useState } from 'react';
import { ArrowRight, Loader2, Undo2 } from 'lucide-react';

export interface SignOffProps {
  sessionId: string;
  resumeToken: string;
  prDetails?: {
    repo?: string;
    branch?: string;
    title?: string;
    body?: string;
  };
  qodoScore?: number;
  qodoGrade?: string;
  verificationReport?: {
    overallStatus?: string;
    passedCount?: number;
    totalTests?: number;
    exitCode?: number;
  } | null;
  patchResult?: any;
  /** Added/removed computed from the diff itself, shared with the patch view. */
  patchStats?: { added: number; removed: number };
  onApprove: (resumeToken: string) => Promise<void>;
  onReject: (resumeToken: string, feedback?: string) => Promise<void>;
}

/**
 * The sign-off dock.
 *
 * This is the one irreversible action in the product, so it states plainly what
 * will happen, shows the evidence behind it, and stays docked beneath the diff
 * rather than covering it — you should be able to read the change you are
 * approving while you approve it.
 */
export function SignOff({
  sessionId,
  resumeToken,
  prDetails,
  qodoScore,
  qodoGrade,
  verificationReport,
  patchResult,
  patchStats,
  onApprove,
  onReject,
}: SignOffProps) {
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);

  const branch = prDetails?.branch || `openheal/fix-${(sessionId || 'run').slice(0, 8)}`;
  const title = prDetails?.title;
  const repo = prDetails?.repo;

  const verified = verificationReport?.overallStatus === 'PASSED';
  const patches = patchResult?.patches ?? [];
  const added =
    patchStats?.added ?? patches.reduce((n: number, p: any) => n + (p.linesAdded || 0), 0);
  const removed =
    patchStats?.removed ?? patches.reduce((n: number, p: any) => n + (p.linesRemoved || 0), 0);

  const approve = async () => {
    if (busy) return;
    setBusy('approve');
    try {
      await onApprove(resumeToken);
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    if (busy) return;
    if (!revising) {
      setRevising(true);
      return;
    }
    setBusy('reject');
    try {
      await onReject(resumeToken, feedback.trim() || undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-label="Sign off on this change"
      className="anim-rise shrink-0 border-t-2 border-signal bg-card"
    >
      <div className="flex flex-col gap-4 px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="t-display text-[19px] text-ink">Approve this change?</h2>
          <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-ink-2">
            Approving opens a pull request on{' '}
            <span className="t-mono text-ink">{repo || 'the target repository'}</span> from branch{' '}
            <span className="t-mono text-ink">{branch}</span>. Nothing is pushed until you do.
          </p>
          {title && (
            <p className="t-mono mt-2 truncate text-[12px] text-ink-2">
              <span className="text-ink-3">Title </span>
              {title}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {verificationReport?.totalTests !== undefined && (
              <Evidence
                term="Tests"
                value={`${verificationReport.passedCount}/${verificationReport.totalTests}`}
                tone={verified ? 'pass' : 'fail'}
              />
            )}
            {patches.length > 0 && (
              <Evidence term="Diff" value={`+${added} −${removed}`} />
            )}
            {qodoScore !== undefined && (
              <Evidence
                term="Review"
                value={`${qodoScore}${qodoGrade ? ` · ${qodoGrade}` : ''}`}
              />
            )}
          </dl>

          <div className="flex items-center gap-2">
            <button
              onClick={reject}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded border border-rule-strong bg-paper px-3 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-paper-2 disabled:opacity-50"
            >
              {busy === 'reject' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <Undo2 className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              {revising ? 'Confirm send back' : 'Send back'}
            </button>
            <button
              onClick={approve}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded bg-signal px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-signal-ink disabled:opacity-50"
            >
              {busy === 'approve' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : null}
              Approve and open pull request
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>

      {revising && (
        <div className="anim-rise border-t border-rule px-4 py-3">
          <label htmlFor="signoff-feedback" className="t-label">
            What should change?
          </label>
          <textarea
            id="signoff-feedback"
            rows={2}
            autoFocus
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Only guard the divide path — leave the rounding alone."
            className="mt-1.5 w-full rounded border border-rule bg-paper px-3 py-2 text-[13px] text-ink placeholder:text-ink-3 focus:border-signal focus:outline-none"
          />
          <p className="mt-1.5 text-[12px] text-ink-2">
            The patch agent gets this note and tries again. Leave it blank to send
            the patch back without guidance.
          </p>
        </div>
      )}

      {/* Provenance — quiet, but the harness contract matters to operators */}
      <p className="t-mono border-t border-rule px-4 py-1.5 text-[10px] text-ink-3">
        Turn paused on <span className="text-ink-2">tool.approval_required</span> · resumes with{' '}
        <span className="text-ink-2">user.tool_approval</span>
      </p>
    </section>
  );
}

function Evidence({
  term,
  value,
  tone = 'neutral',
}: {
  term: string;
  value: string;
  tone?: 'neutral' | 'pass' | 'fail';
}) {
  return (
    <div>
      <dt className="t-label">{term}</dt>
      <dd
        className={`t-num mt-0.5 text-[15px] ${
          tone === 'pass' ? 'text-pass' : tone === 'fail' ? 'text-fail' : 'text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

export default SignOff;
