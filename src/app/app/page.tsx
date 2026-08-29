'use client';

import React, { useState } from 'react';
import SwarmTimeline from '@/components/SwarmTimeline';
import MonacoDiffViewer from '@/components/MonacoDiffViewer';
import TerminalLogs from '@/components/TerminalLogs';
import GlowingApprovalCard from '@/components/GlowingApprovalCard';
import ScenarioSelector from '@/components/ScenarioSelector';
import { HealMark } from '@/components/HealMark';
import { SCENARIO_CATALOG, ScenarioItem } from '@/lib/scenarios-catalog';
import { useHealSession } from '@/hooks/useHealSession';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function AppPage() {
  const [scenarios] = useState<ScenarioItem[]>(SCENARIO_CATALOG);
  const [selectedScenario, setSelectedScenario] = useState<ScenarioItem>(SCENARIO_CATALOG[0]);
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
    setLogs,
    handleStartHeal,
    handleApprove,
    handleReject,
    resetSession,
  } = useHealSession();

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#07110d] text-slate-100">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-emerald-500/15 bg-black/30 px-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-300">
            <ArrowLeft className="h-3.5 w-3.5" />
            Home
          </Link>
          <div className="flex items-center gap-2 text-emerald-300">
            <HealMark className="h-5 w-5" />
            <span className="text-sm font-semibold text-white">Mission control</span>
          </div>
          <span className="hidden font-mono text-[10px] uppercase tracking-widest text-slate-500 md:inline">
            {sessionStatus === 'IDLE' ? 'waiting for a failing suite' : sessionStatus.replaceAll('_', ' ').toLowerCase()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {sessionId && (
            <button
              onClick={resetSession}
              className="rounded-md border border-slate-700 px-2.5 py-1 font-mono text-[10px] text-slate-300 hover:border-emerald-500/40"
            >
              Reset
            </button>
          )}
        </div>
      </header>

      <main className="flex min-h-0 flex-1">
        <aside className="flex w-[380px] shrink-0 flex-col overflow-y-auto border-r border-slate-800 bg-black/20">
          <div className="border-b border-slate-800 p-3">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-emerald-500/70">Patient</p>
            <ScenarioSelector
              scenarios={scenarios}
              selectedScenarioId={selectedScenario.id}
              onSelectScenario={setSelectedScenario}
              onStartHeal={handleStartHeal}
              isLoading={isLoading}
            />
          </div>
          <div className="flex-1 p-3">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-emerald-500/70">Heal loop</p>
            <SwarmTimeline
              status={sessionStatus}
              diagnosticReport={diagnosticReport}
              patchResult={patchResult}
              qodoScorecard={qodoScorecard}
              verificationReport={verificationReport}
              pullRequest={pullRequest}
              errorMessage={errorMessage}
            />
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col bg-[#050c09]">
          <div className="flex min-h-0 flex-1 flex-col border-b border-slate-800">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-2">
              <h2 className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Failing vs healed</h2>
              {qodoScorecard && (
                <span className="font-mono text-[10px] text-emerald-400">
                  Qodo {qodoScorecard.overallScore}/100
                </span>
              )}
            </div>
            <div className="relative min-h-0 flex-1">
              <MonacoDiffViewer
                files={
                  diffFiles.length > 0
                    ? diffFiles
                    : [
                        {
                          filePath: selectedScenario.targetFiles?.[0] || 'no file yet',
                          originalContent: '// Start a heal. The failing source lands here.',
                          patchedContent: '// The proposed patch lands here after synthesis.',
                          linesAdded: 0,
                          linesRemoved: 0,
                        },
                      ]
                }
                qodoScore={qodoScorecard?.overallScore || 0}
                qodoGrade={qodoScorecard?.grade || '-'}
              />
              {approvalPayload && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
                  <div className="w-full max-w-2xl">
                    <GlowingApprovalCard
                      sessionId={sessionId}
                      resumeToken={approvalPayload.resumeToken || 'token_demo'}
                      toolCallId={approvalPayload.toolCallId}
                      prDetails={approvalPayload.parameters}
                      qodoScore={qodoScorecard?.overallScore || 0}
                      qodoGrade={qodoScorecard?.grade || '-'}
                      verificationPassed={verificationReport?.overallStatus === 'PASSED'}
                      onApprove={handleApprove}
                      onReject={handleReject}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex h-[32%] min-h-[180px] shrink-0 flex-col">
            <div className="border-b border-slate-800 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-slate-500">
              Sandbox log
            </div>
            <div className="min-h-0 flex-1">
              <TerminalLogs logs={logs} onClearLogs={() => setLogs([])} isStreaming={isStreaming} />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
