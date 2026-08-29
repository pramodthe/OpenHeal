'use client';

import React, { useEffect, useState } from 'react';
import {
  PHASES,
  formatDuration,
  formatOffset,
  tapeHeight,
  type PhaseId,
  type PhaseSpec,
} from '@/lib/run-phases';
import type { PhaseRecord } from '@/hooks/useHealSession';

export interface RunTapeProps {
  phases: PhaseRecord[];
  runStartedAt: number | null;
  runEndedAt: number | null;
  status: string;
  diagnosticReport?: any;
  patchResult?: any;
  qodoScorecard?: any;
  verificationReport?: any;
  pullRequest?: any;
  errorMessage?: string;
  repoLabel?: string;
  /** Added/removed computed from the diff itself, shared with the patch view. */
  patchStats?: { added: number; removed: number };
}

const SPEC: Record<PhaseId, PhaseSpec> = PHASES.reduce(
  (acc, p) => ({ ...acc, [p.id]: p }),
  {} as Record<PhaseId, PhaseSpec>
);

/**
 * The run tape.
 *
 * Each completed phase is drawn at a height derived from how long it actually
 * took, against a ruled gutter of elapsed-time stamps. The open phase grows as
 * it runs. Phases the run has not reached yet sit below the rule at minimum
 * height so the operator can see what is still coming.
 */
export function RunTape({
  phases,
  runStartedAt,
  runEndedAt,
  status,
  diagnosticReport,
  patchResult,
  qodoScorecard,
  verificationReport,
  pullRequest,
  errorMessage,
  repoLabel,
  patchStats,
}: RunTapeProps) {
  const hasOpenPhase = phases.some((p) => p.endedAt === undefined);
  // The clock starts only once mounted. Reading Date.now() during render would
  // give the server and the client different elapsed values and break hydration.
  const [clock, setClock] = useState<number | null>(null);

  useEffect(() => {
    setClock(Date.now());
    if (!hasOpenPhase) return;
    const id = window.setInterval(() => setClock(Date.now()), 150);
    return () => window.clearInterval(id);
  }, [hasOpenPhase]);

  if (!runStartedAt) {
    return <TapeEmptyState />;
  }

  const now = clock ?? runStartedAt;

  const reached = new Set(phases.map((p) => p.id));
  const upcoming = PHASES.filter((p) => !reached.has(p.id));
  const totalMs = (runEndedAt ?? (hasOpenPhase ? now : runStartedAt)) - runStartedAt;

  return (
    <div className="flex h-full flex-col">
      <header className="mb-3 flex shrink-0 items-baseline justify-between border-b border-rule pb-2">
        <h2 className="t-label">Run tape</h2>
        <span className="t-num text-xs text-ink-2">
          {formatDuration(totalMs)}
          <span className="text-ink-3"> elapsed</span>
        </span>
      </header>

      <ol className="min-h-0 flex-1 overflow-y-auto pr-1">
        {phases.map((record, i) => {
          const spec = SPEC[record.id];
          const isOpen = record.endedAt === undefined;
          const duration = (record.endedAt ?? now) - record.startedAt;
          const height = tapeHeight(duration);
          const failed = record.outcome === 'bad';

          return (
            <li key={record.key} className="grid grid-cols-[52px_15px_1fr] gap-x-2">
              {/* Elapsed-offset stamp — the tape's structural device */}
              <div className="pt-2 text-right">
                <span className="t-num text-2xs leading-none text-ink-3">
                  {formatOffset(record.startedAt - runStartedAt)}
                </span>
              </div>

              {/* Rail */}
              <div className="relative flex justify-center">
                <span
                  aria-hidden
                  className={`w-px ${i === phases.length - 1 && !upcoming.length ? 'h-3' : 'h-full'} ${
                    failed ? 'bg-fail/40' : 'bg-rule-strong'
                  }`}
                />
                <span
                  aria-hidden
                  className={`absolute top-[9px] h-[7px] w-[7px] rounded-full ring-2 ring-paper ${
                    isOpen
                      ? 'anim-playhead bg-signal'
                      : failed
                        ? 'bg-fail'
                        : 'bg-ink'
                  }`}
                />
              </div>

              {/* Phase block, sized by real duration */}
              <div className="pb-2">
                <div
                  style={{ minHeight: height }}
                  className={`anim-rise flex flex-col rounded border px-3 py-2 ${
                    isOpen
                      ? 'border-signal/45 bg-signal-wash'
                      : failed
                        ? 'border-fail/35 bg-fail-wash'
                        : 'border-rule bg-card'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="t-display-sm text-[13px] text-ink">
                      {spec.label}
                      {record.attempt > 1 && (
                        <span className="t-num ml-1.5 text-2xs font-normal text-ink-3">
                          attempt {record.attempt}
                        </span>
                      )}
                    </h3>
                    <span
                      className={`t-num shrink-0 text-2xs ${isOpen ? 'text-signal-ink' : 'text-ink-3'}`}
                    >
                      {formatDuration(duration)}
                    </span>
                  </div>

                  <p className="t-label mt-0.5 !normal-case !tracking-normal !text-[10px] text-ink-3">
                    {spec.actor}
                  </p>

                  <div className="pt-1.5">
                    <PhaseEvidence
                      id={record.id}
                      isOpen={isOpen}
                      status={status}
                      repoLabel={repoLabel}
                      diagnosticReport={diagnosticReport}
                      patchResult={patchResult}
                      qodoScorecard={qodoScorecard}
                      verificationReport={verificationReport}
                      pullRequest={pullRequest}
                      patchStats={patchStats}
                    />
                  </div>
                </div>
              </div>
            </li>
          );
        })}

        {/* Not yet reached — collapsed, so the shape of the run stays visible */}
        {upcoming.map((spec, i) => (
          <li key={spec.id} className="grid grid-cols-[52px_15px_1fr] gap-x-2">
            <div />
            <div className="relative flex justify-center">
              <span
                aria-hidden
                className={`w-px border-l border-dashed border-rule-strong ${
                  i === upcoming.length - 1 ? 'h-3' : 'h-full'
                }`}
              />
              <span
                aria-hidden
                className="absolute top-[9px] h-[7px] w-[7px] rounded-full border border-rule-strong bg-paper"
              />
            </div>
            <div className="pb-2">
              <div className="rounded border border-dashed border-rule px-3 py-1.5">
                <h3 className="t-display-sm text-[13px] text-ink-3">{spec.label}</h3>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {errorMessage && (
        <div className="mt-2 shrink-0 rounded border border-fail/40 bg-fail-wash p-2.5">
          <p className="t-label !text-fail">Run failed</p>
          <p className="t-mono mt-1 break-words text-[11px] leading-relaxed text-ink">
            {errorMessage}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Evidence rendered under each phase. Only ever shows values the run actually
 * produced — a phase with nothing to report shows nothing.
 */
function PhaseEvidence({
  id,
  isOpen,
  status,
  repoLabel,
  diagnosticReport,
  patchResult,
  qodoScorecard,
  verificationReport,
  pullRequest,
  patchStats,
}: {
  id: PhaseId;
  isOpen: boolean;
  status: string;
  repoLabel?: string;
  diagnosticReport?: any;
  patchResult?: any;
  qodoScorecard?: any;
  verificationReport?: any;
  pullRequest?: any;
  patchStats?: { added: number; removed: number };
}) {
  switch (id) {
    case 'sandbox':
      return repoLabel ? <Fact value={repoLabel} truncate /> : null;

    case 'baseline':
      if (!diagnosticReport?.failureCount) return null;
      return (
        <Fact
          tone="fail"
          value={`${diagnosticReport.failureCount} ${
            diagnosticReport.failureCount === 1 ? 'test' : 'tests'
          } failing`}
        />
      );

    case 'diagnose': {
      if (!diagnosticReport) return null;
      const loc = diagnosticReport.primaryRootCauseLocation;
      return (
        <div className="space-y-1">
          {diagnosticReport.failureType && (
            <Fact tone="fail" value={diagnosticReport.failureType} />
          )}
          {loc?.filePath && (
            <Fact value={`${loc.filePath}:${loc.startLine}`} truncate />
          )}
        </div>
      );
    }

    case 'patch': {
      if (!patchResult?.patches?.length) return null;
      // Prefer the figure derived from the diff so the tape, the patch toolbar,
      // and the sign-off card can never disagree.
      const added =
        patchStats?.added ??
        patchResult.patches.reduce((n: number, p: any) => n + (p.linesAdded || 0), 0);
      const removed =
        patchStats?.removed ??
        patchResult.patches.reduce((n: number, p: any) => n + (p.linesRemoved || 0), 0);
      const files = patchResult.patches.length;
      return (
        <div className="t-num flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <span className="text-pass">+{added}</span>
          <span className="text-fail">−{removed}</span>
          <span className="text-ink-3">
            in {files} {files === 1 ? 'file' : 'files'}
          </span>
        </div>
      );
    }

    case 'verify': {
      if (!verificationReport) return null;
      const passed = verificationReport.overallStatus === 'PASSED';
      return (
        <Fact
          tone={passed ? 'pass' : 'fail'}
          value={`${verificationReport.passedCount}/${verificationReport.totalTests} passing · exit ${verificationReport.exitCode}`}
        />
      );
    }

    case 'review':
      if (!qodoScorecard) return null;
      return (
        <Fact
          value={`${qodoScorecard.overallScore}/100${
            qodoScorecard.grade ? ` · ${qodoScorecard.grade}` : ''
          }`}
        />
      );

    case 'signoff':
      if (status === 'REJECTED') return <Fact tone="fail" value="Sent back for revision" />;
      if (isOpen) return <Fact tone="signal" value="Your approval is needed" />;
      return <Fact tone="pass" value="Approved" />;

    case 'publish':
      if (!pullRequest?.prUrl) return null;
      return (
        <a
          href={pullRequest.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="t-num inline-flex items-center gap-1 text-[11px] text-signal underline decoration-signal/30 underline-offset-2 hover:decoration-signal"
        >
          {pullRequest.prNumber ? `Pull request #${pullRequest.prNumber}` : 'View pull request'}
          <span aria-hidden>↗</span>
        </a>
      );

    default:
      return null;
  }
}

function Fact({
  value,
  tone = 'neutral',
  truncate = false,
}: {
  value: string;
  tone?: 'neutral' | 'pass' | 'fail' | 'signal';
  truncate?: boolean;
}) {
  const color =
    tone === 'pass'
      ? 'text-pass'
      : tone === 'fail'
        ? 'text-fail'
        : tone === 'signal'
          ? 'text-signal-ink'
          : 'text-ink-2';
  return (
    <p className={`t-num text-[11px] leading-snug ${color} ${truncate ? 'truncate' : ''}`}>
      {value}
    </p>
  );
}

function TapeEmptyState() {
  return (
    <div className="flex h-full flex-col">
      <header className="mb-3 flex shrink-0 items-baseline justify-between border-b border-rule pb-2">
        <h2 className="t-label">Run tape</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="max-w-prose text-[13px] leading-relaxed text-ink-2">
          Choose a repository and start a run. Each phase below is recorded to
          scale, so you can see where the time went.
        </p>
        <ol className="mt-4 space-y-px">
          {PHASES.map((spec) => (
            <li
              key={spec.id}
              className="grid grid-cols-[15px_1fr] items-start gap-x-2 border-b border-rule/60 py-2 last:border-0"
            >
              <span
                aria-hidden
                className="mt-[5px] h-[7px] w-[7px] justify-self-center rounded-full border border-rule-strong bg-paper"
              />
              <div>
                <h3 className="t-display-sm text-[13px] text-ink">{spec.label}</h3>
                <p className="mt-0.5 text-[12px] leading-snug text-ink-2">{spec.blurb}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export default RunTape;
