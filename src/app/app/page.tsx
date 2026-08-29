'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronUp } from 'lucide-react';
import RunTape from '@/components/RunTape';
import PatchView from '@/components/PatchView';
import LogStream from '@/components/LogStream';
import SignOff from '@/components/SignOff';
import ReviewReport from '@/components/ReviewReport';
import RunSetup from '@/components/RunSetup';
import { HealMark } from '@/components/HealMark';
import { SCENARIO_CATALOG, type ScenarioItem } from '@/lib/scenarios-catalog';
import { useHealSession } from '@/hooks/useHealSession';
import { statusTone } from '@/lib/run-phases';
import { statsForFiles } from '@/lib/diff';

type Pane = 'patch' | 'report';

export default function ConsolePage() {
  const [scenario, setScenario] = useState<ScenarioItem>(SCENARIO_CATALOG[0]);
  const [pane, setPane] = useState<Pane>('patch');
  const [logOpen, setLogOpen] = useState(true);

  const {
    sessionId,
    sessionStatus,
    isLoading,
    isStreaming,
    logs,
    diagnosticReport,
    patchResult,
    diffFiles,
    qodoScorecard,
    verificationReport,
    approvalPayload,
    pullRequest,
    errorMessage,
    phases,
    runStartedAt,
    runEndedAt,
    setLogs,
    handleStartHeal,
    handleApprove,
    handleReject,
    resetSession,
  } = useHealSession();

  // At the decision moment, give the diff and the sign-off the room.
  useEffect(() => {
    if (approvalPayload) setLogOpen(false);
  }, [approvalPayload]);

  // The report is only worth switching to once there is one.
  useEffect(() => {
    if (pullRequest || sessionStatus === 'COMPLETED') setPane('report');
  }, [pullRequest, sessionStatus]);

  // One derivation of +/- for the tape, the patch toolbar, and the sign-off card.
  const patchStats = useMemo(() => statsForFiles(diffFiles), [diffFiles]);

  const handleNewRun = () => {
    resetSession();
    setPane('patch');
    setLogOpen(true);
  };

  const tone = statusTone(sessionStatus, isStreaming);

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <header className="flex min-h-[52px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-rule bg-card px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 text-ink"
            aria-label="OpenHeal home"
          >
            <HealMark className="h-[18px] w-[18px]" />
            <span className="t-display text-[15px]">OpenHeal</span>
          </Link>
          <span aria-hidden className="h-4 w-px bg-rule" />
          <p className="t-mono min-w-0 truncate text-[11px] text-ink-2">
            {sessionId ? (
              <>
                <span className="text-ink-3">run </span>
                {sessionId.slice(0, 8)}
                <span className="text-ink-3"> · </span>
              </>
            ) : null}
            {scenario.name}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <StatusPill label={tone.label} tone={tone.tone} />
          {sessionId && (
            <button
              onClick={handleNewRun}
              className="rounded border border-rule-strong bg-paper px-2.5 py-1 text-[12px] text-ink transition-colors hover:bg-paper-2"
            >
              New run
            </button>
          )}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left rail: what to run, and the tape of what happened */}
        <aside className="flex shrink-0 flex-col gap-4 border-b border-rule bg-paper px-4 py-4 lg:w-[352px] lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <section>
            <h2 className="t-label mb-2 border-b border-rule pb-1.5">Target</h2>
            <RunSetup
              scenarios={SCENARIO_CATALOG}
              selectedScenarioId={scenario.id}
              onSelectScenario={setScenario}
              onStartHeal={handleStartHeal}
              isLoading={isLoading}
            />
          </section>

          <section className="min-h-[320px] flex-1">
            <RunTape
              phases={phases}
              runStartedAt={runStartedAt}
              runEndedAt={runEndedAt}
              status={sessionStatus}
              diagnosticReport={diagnosticReport}
              patchResult={patchResult}
              qodoScorecard={qodoScorecard}
              verificationReport={verificationReport}
              pullRequest={pullRequest}
              errorMessage={errorMessage}
              repoLabel={scenario.targetRepoUrl?.replace('https://github.com/', '')}
              patchStats={patchStats}
            />
          </section>
        </aside>

        {/* Right: the evidence */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-0.5 border-b border-rule bg-card px-3 py-1.5">
            {(
              [
                ['patch', 'Patch'],
                ['report', 'Report'],
              ] as Array<[Pane, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setPane(id)}
                aria-current={pane === id}
                className={`rounded px-2.5 py-1 text-[12px] transition-colors ${
                  pane === id ? 'bg-ink text-paper' : 'text-ink-2 hover:bg-paper-2 hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
            {diffFiles.length > 0 && (
              <span className="t-num ml-2 text-[11px] text-ink-3">
                {diffFiles.length} {diffFiles.length === 1 ? 'file' : 'files'} changed
              </span>
            )}
          </div>

          <div className="flex min-h-[420px] flex-1 flex-col lg:min-h-0">
            {pane === 'patch' ? (
              <PatchView files={diffFiles} placeholderPath={scenario.targetFiles?.[0]} />
            ) : (
              <ReviewReport
                qodoScorecard={qodoScorecard}
                verificationReport={verificationReport}
                diagnosticReport={diagnosticReport}
                patchResult={patchResult}
                pullRequest={pullRequest}
              />
            )}
          </div>

          {approvalPayload && (
            <SignOff
              sessionId={sessionId}
              resumeToken={approvalPayload.resumeToken || ''}
              prDetails={approvalPayload.parameters}
              qodoScore={qodoScorecard?.overallScore}
              qodoGrade={qodoScorecard?.grade}
              verificationReport={verificationReport}
              patchResult={patchResult}
              patchStats={patchStats}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          )}

          <div
            className={`flex shrink-0 flex-col border-t border-rule bg-paper ${
              logOpen ? 'h-[38vh] min-h-[200px]' : ''
            }`}
          >
            {logOpen ? (
              <LogStream
                logs={logs}
                onClearLogs={() => setLogs([])}
                isStreaming={isStreaming}
                onCollapse={() => setLogOpen(false)}
              />
            ) : (
              <button
                onClick={() => setLogOpen(true)}
                className="flex items-center justify-between px-3 py-2 text-left transition-colors hover:bg-paper-2"
              >
                <span className="t-label">Log</span>
                <span className="flex items-center gap-2 text-[12px] text-ink-2">
                  {logs.length.toLocaleString()} lines
                  <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} />
                </span>
              </button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: 'idle' | 'working' | 'attention' | 'good' | 'bad';
}) {
  const styles: Record<typeof tone, string> = {
    idle: 'border-rule text-ink-3',
    working: 'border-signal/40 bg-signal-wash text-signal-ink',
    attention: 'border-signal bg-signal text-white',
    good: 'border-pass/40 bg-pass-wash text-pass',
    bad: 'border-fail/40 bg-fail-wash text-fail',
  };
  const dot: Record<typeof tone, string> = {
    idle: 'bg-ink-3',
    working: 'anim-playhead bg-signal',
    attention: 'bg-white',
    good: 'bg-pass',
    bad: 'bg-fail',
  };

  return (
    <span
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium ${styles[tone]}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot[tone]}`} />
      {label}
    </span>
  );
}
