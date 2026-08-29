'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronUp } from 'lucide-react';
import RunTape from '@/components/RunTape';
import PatchView from '@/components/PatchView';
import LogStream from '@/components/LogStream';
import SignOff from '@/components/SignOff';
import ReviewReport from '@/components/ReviewReport';
import { FindingsPanel } from '@/components/FindingsPanel';
import { HealMark } from '@/components/HealMark';
import { useHealSession } from '@/hooks/useHealSession';
import { statusTone } from '@/lib/run-phases';
import { statsForFiles } from '@/lib/diff';

type Pane = 'findings' | 'patch' | 'report';

export default function RunDetailPageClient({ sessionId: sessionIdParam }: { sessionId: string }) {
  const [pane, setPane] = useState<Pane>('findings');
  const [logOpen, setLogOpen] = useState(true);
  const [repoLabel, setRepoLabel] = useState('');

  const {
    sessionId,
    sessionStatus,
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
    findings,
    setLogs,
    handleApprove,
    handleReject,
    connectSSE,
    applyStatusFromServer,
  } = useHealSession();

  useEffect(() => {
    if (sessionIdParam && sessionIdParam !== sessionId) {
      connectSSE(sessionIdParam);
    }
  }, [sessionIdParam, sessionId, connectSSE]);

  useEffect(() => {
    if (!sessionIdParam) return;
    let cancelled = false;

    const syncRun = () => {
      fetch(`/api/runs/${sessionIdParam}`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d.run?.repoFullName) setRepoLabel(d.run.repoFullName);
          else if (d.session?.config?.githubOwner && d.session?.config?.githubRepo) {
            setRepoLabel(`${d.session.config.githubOwner}/${d.session.config.githubRepo}`);
          }
          if (d.session?.status) applyStatusFromServer(d.session.status);
        })
        .catch(() => undefined);
    };

    syncRun();
    const timer = window.setInterval(syncRun, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionIdParam, applyStatusFromServer]);

  useEffect(() => {
    if (approvalPayload) setLogOpen(false);
  }, [approvalPayload]);

  useEffect(() => {
    if (pullRequest || sessionStatus === 'COMPLETED') setPane('report');
  }, [pullRequest, sessionStatus]);

  const patchStats = useMemo(() => statsForFiles(diffFiles), [diffFiles]);
  const tone = statusTone(sessionStatus, isStreaming);
  const activeId = sessionId || sessionIdParam;

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <header className="flex min-h-[52px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-rule bg-card px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/app" className="flex shrink-0 items-center gap-2 text-ink">
            <HealMark className="h-[18px] w-[18px]" />
            <span className="t-display text-[15px]">OpenHeal</span>
          </Link>
          <span aria-hidden className="h-4 w-px bg-rule" />
          <p className="t-mono min-w-0 truncate text-[11px] text-ink-2">
            run {activeId.slice(0, 8)} · {repoLabel || 'swarm run'}
          </p>
        </div>
        <StatusPill label={tone.label} tone={tone.tone} />
      </header>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex shrink-0 flex-col border-b border-rule bg-paper px-4 py-4 lg:w-[352px] lg:overflow-y-auto lg:border-b-0 lg:border-r">
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
            repoLabel={repoLabel}
            patchStats={patchStats}
          />
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-0.5 border-b border-rule bg-card px-3 py-1.5">
            {(
              [
                ['findings', 'Findings'],
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
          </div>

          <div className="flex min-h-[420px] flex-1 flex-col lg:min-h-0">
            {pane === 'findings' ? (
              <FindingsPanel findings={findings} />
            ) : pane === 'patch' ? (
              <PatchView files={diffFiles} />
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
              sessionId={activeId}
              resumeToken={approvalPayload.resumeToken || ''}
              prDetails={approvalPayload.parameters}
              qodoScore={qodoScorecard?.overallScore}
              qodoGrade={qodoScorecard?.grade}
              verificationReport={verificationReport}
              patchResult={patchResult}
              patchStats={patchStats}
              onApprove={(token) => handleApprove(token, activeId)}
              onReject={(token, feedback) => handleReject(token, feedback, activeId)}
            />
          )}

          <div
            className={`flex shrink-0 flex-col border-t border-rule bg-paper ${
              logOpen ? 'h-[38vh] min-h-[200px]' : ''
            }`}
          >
            {logOpen ? (
              <>
                <div className="flex items-center justify-end gap-3 border-b border-rule px-3 py-1">
                  <a
                    href={`/api/runs/${activeId}/trace`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-ink-3 hover:text-signal hover:underline"
                  >
                    Turn trace JSON
                  </a>
                </div>
                <LogStream
                  logs={logs}
                  onClearLogs={() => setLogs([])}
                  isStreaming={isStreaming}
                  onCollapse={() => setLogOpen(false)}
                />
              </>
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
