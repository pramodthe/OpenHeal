'use client';

import React from 'react';

export interface ReviewReportProps {
  qodoScorecard?: any;
  verificationReport?: any;
  diagnosticReport?: any;
  patchResult?: any;
  pullRequest?: any;
}

/**
 * The run's evidence record: what broke, what changed, whether it verified, and
 * how the diff scored. Everything here comes from the run — a section with no
 * data does not render rather than showing a plausible-looking placeholder.
 */
export function ReviewReport({
  qodoScorecard,
  verificationReport,
  diagnosticReport,
  patchResult,
  pullRequest,
}: ReviewReportProps) {
  const hasAnything =
    qodoScorecard || verificationReport || diagnosticReport || patchResult || pullRequest;

  if (!hasAnything) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-prose text-center">
          <p className="t-display-sm text-[15px] text-ink">No report yet</p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            Once a run finishes, everything it found and everything it changed is
            collected here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="mx-auto max-w-3xl space-y-7">
        {diagnosticReport && <Diagnosis report={diagnosticReport} />}
        {verificationReport && <Verification report={verificationReport} />}
        {qodoScorecard && <Scorecard card={qodoScorecard} />}
        {patchResult?.scopeCreepAssessment && (
          <Scope assessment={patchResult.scopeCreepAssessment} rationale={patchResult.rationale} />
        )}
        {pullRequest?.prUrl && <Published pr={pullRequest} />}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2.5 flex items-baseline justify-between gap-3 border-b border-rule pb-1.5">
        <h3 className="t-label">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Diagnosis({ report }: { report: any }) {
  const loc = report.primaryRootCauseLocation;
  const top = report.hypotheses?.[0];
  return (
    <Section
      title="What broke"
      aside={
        report.frameworkDetected ? (
          <span className="t-mono text-[11px] text-ink-3">{report.frameworkDetected}</span>
        ) : null
      }
    >
      <p className="t-display text-[22px] text-fail">{report.failureType}</p>
      {report.primaryFailureMessage && (
        <p className="t-mono mt-1.5 break-words text-[12px] leading-relaxed text-ink-2">
          {report.primaryFailureMessage}
        </p>
      )}
      {loc?.filePath && (
        <p className="t-mono mt-2 text-[12px] text-ink">
          {loc.filePath}:{loc.startLine}
          {loc.symbolName && <span className="text-ink-3"> · {loc.symbolName}</span>}
        </p>
      )}
      {top && (
        <div className="mt-3 rounded border border-rule bg-card p-3">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="text-[13px] font-semibold text-ink">{top.title}</h4>
            {typeof top.confidenceScore === 'number' && (
              <span className="t-num shrink-0 text-[11px] text-ink-3">
                {Math.round(top.confidenceScore * 100)}% confidence
              </span>
            )}
          </div>
          {top.description && (
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{top.description}</p>
          )}
        </div>
      )}
      {report.failingTests?.length > 0 && (
        <ul className="mt-3 space-y-1">
          {report.failingTests.slice(0, 8).map((t: string) => (
            <li key={t} className="t-mono break-words text-[11.5px] text-ink-2">
              <span className="mr-1.5 text-fail" aria-hidden>
                ✗
              </span>
              {t}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Verification({ report }: { report: any }) {
  const passed = report.overallStatus === 'PASSED';
  const fixed = report.baselineComparison?.previouslyFailingNowPassing ?? [];
  const regressions = report.baselineComparison?.newRegressions ?? [];

  return (
    <Section
      title="Verification"
      aside={
        <span className="t-num text-[11px] text-ink-3">exit {report.exitCode}</span>
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <p className={`t-display text-[22px] ${passed ? 'text-pass' : 'text-fail'}`}>
          {report.passedCount}/{report.totalTests} passing
        </p>
        <span className="text-[13px] text-ink-2">
          {passed ? 'Full suite green against the patch.' : 'The suite is still failing.'}
        </span>
      </div>

      {fixed.length > 0 && (
        <div className="mt-3">
          <p className="t-label !text-pass">Now passing</p>
          <ul className="mt-1 space-y-0.5">
            {fixed.slice(0, 6).map((t: string) => (
              <li key={t} className="t-mono break-words text-[11.5px] text-ink-2">
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}

      {regressions.length > 0 && (
        <div className="mt-3 rounded border border-fail/40 bg-fail-wash p-2.5">
          <p className="t-label !text-fail">New regressions</p>
          <ul className="mt-1 space-y-0.5">
            {regressions.map((t: string) => (
              <li key={t} className="t-mono break-words text-[11.5px] text-ink">
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

/**
 * Qodo's composite is 0.35 quality + 0.35 security + 0.20 coverage + 0.10 perf.
 * The strip below is segmented by those exact weights, so segment width shows
 * how much a dimension counts and fill shows how it scored — the formula and
 * the result in one figure.
 */
const DIMENSIONS = [
  { key: 'qualityScore', label: 'Quality', weight: 0.35 },
  { key: 'securityScore', label: 'Security', weight: 0.35 },
  { key: 'coverageScore', label: 'Coverage', weight: 0.2 },
  { key: 'performanceScore', label: 'Perf', weight: 0.1 },
] as const;

function Scorecard({ card }: { card: any }) {
  const violations: string[] = card.breakdown?.ruleViolations ?? [];
  const risks: string[] = card.breakdown?.securityRisks ?? [];

  return (
    <Section
      title="Diff review"
      aside={
        card.verdict ? (
          <span className="t-mono text-[11px] text-ink-3">
            {String(card.verdict).replace(/_/g, ' ').toLowerCase()}
          </span>
        ) : null
      }
    >
      <div className="flex items-baseline gap-3">
        <p className="t-display text-[34px] text-ink">{card.overallScore}</p>
        <span className="text-[13px] text-ink-3">/ 100</span>
        {card.grade && (
          <span className="ml-1 rounded border border-rule-strong px-1.5 py-0.5 text-[12px] font-semibold text-ink">
            {card.grade}
          </span>
        )}
      </div>

      <div className="mt-3 flex h-8 w-full gap-px overflow-hidden rounded border border-rule">
        {DIMENSIONS.map((d) => {
          const score = card[d.key] ?? 0;
          return (
            <div
              key={d.key}
              style={{ width: `${d.weight * 100}%` }}
              className="relative bg-paper-2"
              title={`${d.label}: ${score}/100 · weight ${d.weight}`}
            >
              <div
                className="absolute inset-y-0 left-0 bg-signal/85"
                style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
              />
            </div>
          );
        })}
      </div>

      <dl className="mt-2 flex w-full gap-px">
        {DIMENSIONS.map((d) => (
          <div key={d.key} style={{ width: `${d.weight * 100}%` }} className="min-w-0 pr-2">
            <dt className="t-label truncate !text-[9px]">{d.label}</dt>
            <dd className="t-num text-[12px] text-ink">{card[d.key] ?? '—'}</dd>
          </div>
        ))}
      </dl>

      <p className="t-mono mt-2 text-[10px] text-ink-3">
        Segment width is weight, fill is score
      </p>

      {(violations.length > 0 || risks.length > 0) && (
        <div className="mt-4 space-y-3">
          {risks.length > 0 && (
            <Findings title="Security" items={risks} tone="fail" />
          )}
          {violations.length > 0 && (
            <Findings title="Rule violations" items={violations} tone="hold" />
          )}
        </div>
      )}

      {violations.length === 0 && risks.length === 0 && (
        <p className="mt-3 text-[13px] text-ink-2">
          No rule violations or security findings on this diff.
        </p>
      )}

      {typeof card.breakdown?.synthesizedTests === 'number' &&
        card.breakdown.synthesizedTests > 0 && (
          <p className="mt-2 text-[13px] text-ink-2">
            Qodo Cover wrote {card.breakdown.synthesizedTests} test
            {card.breakdown.synthesizedTests === 1 ? '' : 's'} against the patched
            branches.
          </p>
        )}
    </Section>
  );
}

function Findings({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'fail' | 'hold';
}) {
  return (
    <div>
      <p className={`t-label ${tone === 'fail' ? '!text-fail' : '!text-hold'}`}>{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-[13px] leading-relaxed text-ink-2">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Scope({ assessment, rationale }: { assessment: any; rationale?: string }) {
  return (
    <Section
      title="Scope"
      aside={
        <span className="t-num text-[11px] text-ink-3">risk {assessment.riskScore}/100</span>
      }
    >
      <p className="text-[13px] leading-relaxed text-ink-2">
        {assessment.passed
          ? 'The patch stays inside the files the diagnosis implicated.'
          : 'The patch reaches outside the files the diagnosis implicated.'}
      </p>
      {assessment.unrelatedFilesTouched?.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {assessment.unrelatedFilesTouched.map((f: string) => (
            <li key={f} className="t-mono text-[11.5px] text-hold">
              {f}
            </li>
          ))}
        </ul>
      )}
      {rationale && (
        <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-ink-2">{rationale}</p>
      )}
    </Section>
  );
}

function Published({ pr }: { pr: any }) {
  return (
    <Section title="Published">
      <a
        href={pr.prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="t-mono text-[13px] text-signal underline decoration-signal/30 underline-offset-2 hover:decoration-signal"
      >
        {pr.prNumber ? `Pull request #${pr.prNumber}` : 'View the pull request'} ↗
      </a>
      {pr.branchName && (
        <p className="t-mono mt-1 text-[11.5px] text-ink-3">branch {pr.branchName}</p>
      )}
    </Section>
  );
}

export default ReviewReport;
