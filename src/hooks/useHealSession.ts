'use client';

import { useRef, useState } from 'react';
import type { DiffFileEntry } from '@/components/MonacoDiffViewer';
import type { TerminalLogEntry } from '@/components/TerminalLogs';
import type { ScenarioItem } from '@/lib/scenarios-catalog';
import type { HealLaunchCredentials } from '@/lib/heal/credentials';

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
  const eventSourceRef = useRef<EventSource | null>(null);

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
        setSessionStatus('CAPTURING_BASELINE');
        break;
      case 'agent.status':
        if (payload?.message) addLog(payload.message, 'agent');
        if (payload.status === 'running') {
          if (payload.agent === 'diagnostic') setSessionStatus('DIAGNOSING');
          if (payload.agent === 'patcher') setSessionStatus('SYNTHESIZING');
          if (payload.agent === 'verifier') setSessionStatus('VERIFYING');
          if (payload.agent === 'orchestrator' && payload.message?.includes('Pull Request')) {
            setSessionStatus('EXECUTING_PR');
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
        setPatchResult(payload.result || payload);
        if (payload.result?.patches?.length > 0) {
          setDiffFiles(
            payload.result.patches.map((p: any) => ({
              filePath: p.filePath,
              originalContent: p.originalContent || '',
              patchedContent: p.patchedContent || '',
              diff: p.diff || payload.diff,
              linesAdded: p.linesAdded,
              linesRemoved: p.linesRemoved,
            }))
          );
        } else if (payload.filePatches?.length > 0) {
          setDiffFiles(
            payload.filePatches.map((p: any) => ({
              filePath: p.filePath,
              originalContent: p.originalContent || '',
              patchedContent: p.patchedContent || '',
              diff: p.diff,
              linesAdded: p.linesAdded,
              linesRemoved: p.linesRemoved,
            }))
          );
        }
        break;
      case 'qodo.scorecard':
        setQodoScorecard(payload);
        break;
      case 'verification.completed':
        setVerificationReport(payload);
        break;
      case 'tool.approval_required':
        setSessionStatus('AWAITING_HUMAN_APPROVAL');
        setApprovalPayload(payload);
        break;
      case 'github.pr_created':
        setPullRequest(payload);
        setSessionStatus('COMPLETED');
        break;
      case 'session.completed':
        if (payload.status === 'healed') setSessionStatus('COMPLETED');
        else if (payload.status === 'rejected') setSessionStatus('REJECTED');
        else setSessionStatus('FAILED');
        setIsLoading(false);
        break;
      case 'session.error':
        setSessionStatus('FAILED');
        setErrorMessage(payload.error || 'Unknown swarm error');
        setIsLoading(false);
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
    setSessionStatus('PROVISIONING_SANDBOX');

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
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to start healing session');
      setSessionId(data.sessionId);
      connectSSE(data.sessionId);
    } catch (err: any) {
      setSessionStatus('FAILED');
      setErrorMessage(err.message || 'Network error');
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
      if (!res.ok || !data.success) throw new Error(data.error || 'Approval failed');
      setApprovalPayload(null);
      setSessionStatus('EXECUTING_PR');
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
      if (!res.ok || !data.success) throw new Error(data.error || 'Rejection failed');
      setApprovalPayload(null);
      setSessionStatus('REJECTED');
    } catch (err: any) {
      setErrorMessage(err.message);
    }
  };

  const resetSession = () => {
    eventSourceRef.current?.close();
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
    setLogs,
    handleStartHeal,
    handleApprove,
    handleReject,
    resetSession,
  };
}
