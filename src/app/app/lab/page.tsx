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
import { FindingsPanel } from '@/components/FindingsPanel';
import { HealMark } from '@/components/HealMark';
import { HEAL_LAB_SCENARIOS, type ScenarioItem } from '@/lib/scenarios-catalog';
import { useHealSession } from '@/hooks/useHealSession';
import { statusTone } from '@/lib/run-phases';
import { statsForFiles } from '@/lib/diff';

type Pane = 'findings' | 'patch' | 'report';

export default function LabPage() {
  const [scenario, setScenario] = useState<ScenarioItem>(HEAL_LAB_SCENARIOS[0]);
  const [pane, setPane] = useState<Pane>('findings');
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
    findings,
    phases,
    runStartedAt,
    runEndedAt,
    setLogs,
    handleStartHeal,
    handleApprove,
    handleReject,
    resetSession,
  } = useHealSession();

  useEffect(() => {
    if (approvalPayload) setLogOpen(false);
  }, [approvalPayload]);

  useEffect(() => {
    if (sessionId) {
      window.location.href = `/app/runs/${sessionId}`;
    }
  }, [sessionId]);

  const patchStats = useMemo(() => statsForFiles(diffFiles), [diffFiles]);
  const tone = statusTone(sessionStatus, isStreaming);

  return (
    <div className="flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <header className="flex min-h-[52px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-rule bg-card px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/app" className="flex shrink-0 items-center gap-2 text-ink">
            <HealMark className="h-[18px] w-[18px]" />
            <span className="t-display text-[15px]">OpenHeal Lab</span>
          </Link>
        </div>
        <StatusPill label={tone.label} tone={tone.tone} />
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-6">
        <p className="text-[14px] text-ink-2">
          Manual lab runs for bundled scenarios. PR-triggered swarm runs appear on the{' '}
          <Link href="/app" className="text-signal hover:underline">
            dashboard
          </Link>
          .
        </p>
        <RunSetup
          scenarios={HEAL_LAB_SCENARIOS}
          selectedScenarioId={scenario.id}
          onSelectScenario={setScenario}
          onStartHeal={handleStartHeal}
          isLoading={isLoading}
        />
        {sessionId ? (
          <p className="text-[13px] text-ink-2">Redirecting to run {sessionId.slice(0, 8)}…</p>
        ) : null}
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
