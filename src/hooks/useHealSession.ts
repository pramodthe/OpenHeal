'use client';

import { useCallback, useRef, useState } from 'react';
import type { DiffFileEntry } from '@/components/PatchView';
import type { TerminalLogEntry } from '@/components/LogStream';
import type { ScenarioItem } from '@/lib/scenarios-catalog';
import type { HealLaunchCredentials } from '@/lib/heal/credentials';
import { phaseForStatus, type PhaseId } from '@/lib/run-phases';

/**
 * One occurrence of a phase. Phases can repeat — the verifier can send a patch
 * back for another attempt — so records are append-only and carry an attempt
 * number rather than being keyed by phase id.
 */
export interface PhaseRecord {
  key: string;
  id: PhaseId;
  attempt: number;
  startedAt: number;
  endedAt?: number;
  outcome?: 'ok' | 'bad';
}

export function useHealSession() {
  const [sessionId, setSessionId] = useState('');
  const [sessionStatus, setSessionStatus] = useState('IDLE');
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [logs, setLogs] = useState<TerminalLogEntry[]>([]);
  const [diagnosticReport, setDiagnosticReport] = useState<any>(null);
  const [patchResult, setPatchResult] = useState<any>(null);
  const [diffFiles, setDiffFiles] = useState<DiffFileEntry[]>([]);
  const [qodoScorecard, setQodoScorecard] = useState<any>(null);
  const [verificationReport, setVerificationReport] = useState<any>(null);
  const [approvalPayload, setApprovalPayload] = useState<any>(null);
  const [pullRequest, setPullRequest] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Timing, so the console can draw the run to scale rather than as a checklist.
  const [phases, setPhases] = useState<PhaseRecord[]>([]);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [runEndedAt, setRunEndedAt] = useState<number | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  const mapPatchEntries = (patches: any[], fallbackDiff?: string): DiffFileEntry[] =>
    patches.map((p: any) => ({
      filePath: p.filePath,
      originalContent: p.originalContent || '',
      patchedContent: p.patchedContent || '',
      diff: p.diff || fallbackDiff,
      linesAdded: p.linesAdded,
      linesRemoved: p.linesRemoved,
    }));

  const beginPhase = useCallback((id: PhaseId, at: number = Date.now()) => {
    setPhases((prev) => {
      const open = prev.find((p) => p.endedAt === undefined);
      if (open?.id === id) return prev;
      const closed = prev.map((p) =>
        p.endedAt === undefined ? { ...p, endedAt: at, outcome: p.outcome ?? ('ok' as const) } : p
      );
      const attempt = closed.filter((p) => p.id === id).length + 1;
      return [...closed, { key: `${id}-${attempt}-${at}`, id, attempt, startedAt: at }];
    });
  }, []);

  const closeOpenPhase = useCallback((outcome: 'ok' | 'bad', at: number = Date.now()) => {
    setPhases((prev) =>
      prev.map((p) => (p.endedAt === undefined ? { ...p, endedAt: at, outcome } : p))
    );
  }, []);

  /** Single place where status and the tape stay in step. */
  const applyStatus = useCallback(
    (next: string) => {
      setSessionStatus(next);
      const phase = phaseForStatus(next);
      if (phase) {
        beginPhase(phase);
        return;
      }
      if (next === 'COMPLETED') {
        closeOpenPhase('ok');
        setRunEndedAt(Date.now());
      } else if (next === 'FAILED' || next === 'REJECTED') {
        closeOpenPhase('bad');
        setRunEndedAt(Date.now());
      }
    },
    [beginPhase, closeOpenPhase]
  );

  const addLog = (
    text: string,
    source: TerminalLogEntry['source'] = 'system',
    level?: TerminalLogEntry['level']
  ) => {
    if (!text) return;
    const entry: TerminalLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      source,
      text,
      timestamp: new Date().toISOString(),
      level,
    };
    setLogs((prev) => [...prev, entry]);
  };

  const extractLogText = (payload: any): string => {
    if (!payload) return '';
    if (typeof payload === 'string') return payload;
    if (typeof payload.delta === 'string') return payload.delta;
    if (typeof payload.delta?.text === 'string') return payload.delta.text;
    if (typeof payload.text === 'string') return payload.text;
    if (typeof payload.chunk === 'string') return payload.chunk;
    if (typeof payload.message === 'string') return payload.message;
    return '';
  };

  const processIncomingEvent = (eventType: string, payload: any) => {
    switch (eventType) {
      case 'session.started':
        applyStatus('CAPTURING_BASELINE');
        break;
      case 'agent.status':
        if (payload?.message) addLog(payload.message, 'agent');
        if (payload.status === 'running') {
          if (payload.agent === 'diagnostic') applyStatus('DIAGNOSING');
          if (payload.agent === 'patcher') applyStatus('SYNTHESIZING');
          if (payload.agent === 'verifier') applyStatus('VERIFYING');
          if (payload.agent === 'orchestrator' && payload.message?.includes('Pull Request')) {
            applyStatus('EXECUTING_PR');
          }
        }
        break;
      case 'agent.thought.delta':
        addLog(extractLogText(payload), 'agent');
        break;
      case 'sandbox.log.delta':
        addLog(extractLogText(payload), 'sandbox');
        break;
      case 'diagnostic.completed':
        setDiagnosticReport(payload);
        break;
      case 'patch.generated':
      case 'patch.synthesized':
      case 'diff.generated': {
        setPatchResult(payload.result || payload);
        const patches =
          payload.patches ??
          payload.result?.patches ??
          payload.filePatches;
        if (patches?.length > 0) {
          setDiffFiles(mapPatchEntries(patches, payload.diff ?? payload.unifiedDiff));
        }
        break;
      }
      case 'qodo.scorecard':
        setQodoScorecard(payload);
        // Scoring runs after verification and before the gate; it earns its own
        // block on the tape so the operator can see how little time it takes.
        beginPhase('review');
        break;
      case 'verification.completed':
        setVerificationReport(payload);
        break;
      case 'tool.approval_required':
        applyStatus('AWAITING_HUMAN_APPROVAL');
        setApprovalPayload(payload);
        break;
      case 'github.pr_created':
        setPullRequest(payload);
        applyStatus('COMPLETED');
        break;
      case 'session.completed':
        if (payload.status === 'healed') applyStatus('COMPLETED');
        else if (payload.status === 'rejected') applyStatus('REJECTED');
        else applyStatus('FAILED');
        setIsLoading(false);
        setIsStreaming(false);
        break;
      case 'session.error':
        applyStatus('FAILED');
        setErrorMessage(payload.error || 'The run stopped before it could finish.');
        setIsLoading(false);
        setIsStreaming(false);
        break;
      default:
        break;
    }
  };

  const connectSSE = (id: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    setIsStreaming(true);
    const eventSource = new EventSource(`/api/stream?sessionId=${encodeURIComponent(id)}`);
    eventSourceRef.current = eventSource;

    const handleAnyMessage = (event: MessageEvent, eventType: string) => {
      try {
        const payload = JSON.parse(event.data);
        processIncomingEvent(eventType, payload);
      } catch {
        addLog(event.data, 'system');
      }
    };

    eventSource.onmessage = (event) => handleAnyMessage(event, 'message');

    const eventTypes = [
      'session.started',
      'agent.status',
      'agent.thought.delta',
      'sandbox.log.delta',
      'test.result',
      'diagnostic.completed',
      'patch.generated',
      'patch.synthesized',
      'diff.generated',
      'qodo.scorecard',
      'verification.completed',
      'tool.approval_required',
      'github.pr_created',
      'session.completed',
      'session.error',
    ];

    for (const evt of eventTypes) {
      eventSource.addEventListener(evt, (e: MessageEvent) => handleAnyMessage(e, evt));
    }
  };

  const handleStartHeal = async (
    scenario: ScenarioItem,
    customUrl?: string,
    customCode?: string,
    _customLog?: string,
    credentials?: HealLaunchCredentials
  ) => {
    const startedAt = Date.now();
    setIsLoading(true);
    setErrorMessage('');
    setApprovalPayload(null);
    setPullRequest(null);
    setLogs([]);
    setDiffFiles([]);
    setDiagnosticReport(null);
    setPatchResult(null);
    setQodoScorecard(null);
    setVerificationReport(null);
    setPhases([]);
    setRunStartedAt(startedAt);
    setRunEndedAt(null);
    setSessionStatus('PROVISIONING_SANDBOX');
    beginPhase('sandbox', startedAt);

    try {
      const res = await fetch('/api/heal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoUrl: customUrl || scenario.targetRepoUrl,
          language: scenario.language,
          scenarioId: scenario.id,
          testCommand: scenario.testCommand,
          customCode,
          openaiKey: credentials?.openaiKey,
          githubToken: credentials?.githubToken,
          daytonaKey: credentials?.daytonaKey,
          model: credentials?.model,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'The run could not be started.');
      setSessionId(data.sessionId);
      connectSSE(data.sessionId);
    } catch (err: any) {
      applyStatus('FAILED');
      setErrorMessage(err.message || 'Could not reach the OpenHeal server.');
      setIsLoading(false);
    }
  };

  const handleApprove = async (resumeToken: string) => {
    try {
      const res = await fetch('/api/heal/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, resumeToken, status: 'allow' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'The approval did not go through.');
      setApprovalPayload(null);
      applyStatus('EXECUTING_PR');
      if (data.pullRequest) setPullRequest(data.pullRequest);
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const handleReject = async (resumeToken: string, feedback?: string) => {
    try {
      const res = await fetch('/api/heal/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, resumeToken, status: 'deny', feedback }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'The patch could not be sent back.');
      setApprovalPayload(null);
      applyStatus('REJECTED');
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const resetSession = () => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setSessionId('');
    setSessionStatus('IDLE');
    setIsLoading(false);
    setIsStreaming(false);
    setLogs([]);
    setDiffFiles([]);
    setDiagnosticReport(null);
    setPatchResult(null);
    setQodoScorecard(null);
    setVerificationReport(null);
    setApprovalPayload(null);
    setPullRequest(null);
    setErrorMessage('');
    setPhases([]);
    setRunStartedAt(null);
    setRunEndedAt(null);
  };

  return {
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
  };
}
