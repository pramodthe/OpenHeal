/**
 * TrueForge Multi-Turn Session Manager with Thread Isolation and State Persistence
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentSessionConfig,
  SessionState,
  SessionStatus,
  TurnEvent,
  DiagnosticReport,
  PatchSynthesisResult,
  VerificationReport,
  QodoScorecardResult,
  HitlApprovalState,
  PullRequestResult,
} from './types.ts';

export class SessionManager {
  private sessions: Map<string, SessionState> = new Map();
  private threadEvents: Map<string, TurnEvent[]> = new Map(); // key: `${sessionId}:${threadId}`

  /**
   * Create a new self-healing session with isolated state and default configuration.
   */
  public createSession(
    config: Partial<AgentSessionConfig> & { repoUrl: string; sessionId?: string }
  ): SessionState {
    const sessionId = config.sessionId || `sess_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const now = new Date().toISOString();

    const fullConfig: AgentSessionConfig = {
      sessionId,
      repoUrl: config.repoUrl,
      targetBranch: config.targetBranch || 'main',
      targetCommit: config.targetCommit || 'HEAD',
      maxPatchAttempts: config.maxPatchAttempts ?? 3,
      testCommandOverride: config.testCommandOverride,
      autoApprovePR: config.autoApprovePR ?? false,
      qodoScoreThreshold: config.qodoScoreThreshold ?? 70,
      workspaceId: config.workspaceId,
      language: config.language || 'generic',
      sandboxTimeoutMs: config.sandboxTimeoutMs ?? 60000,
      ...config,
    };

    const sessionState: SessionState = {
      config: fullConfig,
      status: 'INIT',
      createdAt: now,
      updatedAt: now,
      currentAttempt: 0,
      patchHistory: [],
      verificationHistory: [],
    };

    this.sessions.set(sessionId, sessionState);
    return this.cloneState(sessionState);
  }

  /**
   * Retrieve a session by its ID.
   */
  public getSession(sessionId: string): SessionState | undefined {
    const state = this.sessions.get(sessionId);
    return state ? this.cloneState(state) : undefined;
  }

  /**
   * Retrieve a session or throw if not found.
   */
  public getRequiredSession(sessionId: string): SessionState {
    const state = this.getSession(sessionId);
    if (!state) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return state;
  }

  /**
   * Update session state atomically.
   */
  public updateSession(
    sessionId: string,
    updater:
      | Partial<SessionState>
      | ((state: SessionState) => void | Partial<SessionState>)
  ): SessionState {
    const current = this.sessions.get(sessionId);
    if (!current) {
      throw new Error(`Cannot update non-existent session: ${sessionId}`);
    }

    if (typeof updater === 'function') {
      const result = updater(current);
      if (result && typeof result === 'object') {
        Object.assign(current, result);
      }
    } else {
      Object.assign(current, updater);
    }

    current.updatedAt = new Date().toISOString();
    return this.cloneState(current);
  }

  /**
   * Transition session status with validation and audit trail.
   */
  public transitionStatus(
    sessionId: string,
    newStatus: SessionStatus,
    reason?: string
  ): SessionState {
    return this.updateSession(sessionId, (state) => {
      state.status = newStatus;
      if (reason && newStatus === 'FAILED') {
        state.errorMessage = reason;
      }
    });
  }

  /**
   * Create an isolated thread ID for a specialized subagent.
   */
  public createThread(
    sessionId: string,
    agentType: 'diagnostic' | 'patcher' | 'verifier' | 'orchestrator' | string,
    attempt: number = 1
  ): string {
    const threadId = `thread_${agentType}_${sessionId.slice(0, 8)}_a${attempt}_${randomUUID().slice(0, 6)}`;
    const key = this.getThreadKey(sessionId, threadId);
    if (!this.threadEvents.has(key)) {
      this.threadEvents.set(key, []);
    }
    return threadId;
  }

  /**
   * Record a turn event into an isolated thread history.
   */
  public appendThreadEvent(
    sessionId: string,
    threadId: string,
    event: TurnEvent
  ): void {
    const key = this.getThreadKey(sessionId, threadId);
    let events = this.threadEvents.get(key);
    if (!events) {
      events = [];
      this.threadEvents.set(key, events);
    }
    events.push({
      ...event,
      id: event.id || randomUUID(),
      timestamp: event.timestamp || new Date().toISOString(),
    });
  }

  /**
   * Get historical events for a specific thread.
   */
  public getThreadHistory(sessionId: string, threadId: string): TurnEvent[] {
    const key = this.getThreadKey(sessionId, threadId);
    const events = this.threadEvents.get(key) || [];
    return JSON.parse(JSON.stringify(events));
  }

  /**
   * Get thread events filtered by event type.
   */
  public getThreadEventsByType(
    sessionId: string,
    threadId: string,
    eventType: string
  ): TurnEvent[] {
    return this.getThreadHistory(sessionId, threadId).filter(
      (e) => e.type === eventType
    );
  }

  /**
   * Get all thread IDs associated with a session.
   */
  public listSessionThreads(sessionId: string): string[] {
    const prefix = `${sessionId}:`;
    const threads: string[] = [];
    for (const key of this.threadEvents.keys()) {
      if (key.startsWith(prefix)) {
        threads.push(key.slice(prefix.length));
      }
    }
    return threads;
  }

  /**
   * Save a diagnostic report to the session state.
   */
  public setDiagnosticReport(
    sessionId: string,
    report: DiagnosticReport
  ): SessionState {
    return this.updateSession(sessionId, (state) => {
      state.diagnosticReport = report;
    });
  }

  /**
   * Add a patch synthesis result to history and update active patch.
   */
  public recordPatchResult(
    sessionId: string,
    patchResult: PatchSynthesisResult
  ): SessionState {
    return this.updateSession(sessionId, (state) => {
      state.patchHistory.push(patchResult);
      state.activePatch = patchResult;
      state.currentAttempt = patchResult.attemptNumber;
    });
  }

  /**
   * Add a verification report to history and update latest verification.
   */
  public recordVerificationResult(
    sessionId: string,
    report: VerificationReport
  ): SessionState {
    return this.updateSession(sessionId, (state) => {
      state.verificationHistory.push(report);
      state.latestVerification = report;
    });
  }

  /**
   * Update Qodo scorecard.
   */
  public setQodoScorecard(
    sessionId: string,
    scorecard: QodoScorecardResult
  ): SessionState {
    return this.updateSession(sessionId, (state) => {
      state.qodoScorecard = scorecard;
    });
  }

  /**
   * Update HITL approval status.
   */
  public setHitlApproval(
    sessionId: string,
    approval: HitlApprovalState
  ): SessionState {
    return this.updateSession(sessionId, (state) => {
      state.hitlApproval = approval;
    });
  }

  /**
   * Update Pull Request details upon creation.
   */
  public setPullRequest(
    sessionId: string,
    pr: PullRequestResult
  ): SessionState {
    return this.updateSession(sessionId, (state) => {
      state.pullRequest = pr;
    });
  }

  /**
   * Serialize entire session state to JSON.
   */
  public serializeSession(sessionId: string): string {
    const session = this.getRequiredSession(sessionId);
    const threads = this.listSessionThreads(sessionId);
    const threadData: Record<string, TurnEvent[]> = {};
    for (const tid of threads) {
      threadData[tid] = this.getThreadHistory(sessionId, tid);
    }

    return JSON.stringify({
      session,
      threads: threadData,
    });
  }

  /**
   * Restore a session from serialized JSON.
   */
  public deserializeSession(json: string): SessionState {
    const data = JSON.parse(json);
    if (!data.session || !data.session.config || !data.session.config.sessionId) {
      throw new Error('Invalid serialized session payload');
    }

    const state: SessionState = data.session;
    this.sessions.set(state.config.sessionId, state);

    if (data.threads && typeof data.threads === 'object') {
      for (const [tid, events] of Object.entries(data.threads)) {
        const key = this.getThreadKey(state.config.sessionId, tid);
        this.threadEvents.set(key, events as TurnEvent[]);
      }
    }

    return this.cloneState(state);
  }

  /**
   * List all stored sessions.
   */
  public listSessions(): SessionState[] {
    return Array.from(this.sessions.values()).map((s) => this.cloneState(s));
  }

  /**
   * Delete a session and all its thread histories.
   */
  public deleteSession(sessionId: string): boolean {
    const existed = this.sessions.delete(sessionId);
    const prefix = `${sessionId}:`;
    for (const key of Array.from(this.threadEvents.keys())) {
      if (key.startsWith(prefix)) {
        this.threadEvents.delete(key);
      }
    }
    return existed;
  }

  /**
   * Clear all sessions and thread histories (for testing).
   */
  public clear(): void {
    this.sessions.clear();
    this.threadEvents.clear();
  }

  private getThreadKey(sessionId: string, threadId: string): string {
    return `${sessionId}:${threadId}`;
  }

  private cloneState(state: SessionState): SessionState {
    return JSON.parse(JSON.stringify(state));
  }
}

// Global Singleton Instance
export const sessionManager = new SessionManager();

// Standalone Helper Exports
export const createSession = (
  config: Partial<AgentSessionConfig> & { repoUrl: string; sessionId?: string }
) => sessionManager.createSession(config);

export const getSession = (sessionId: string) =>
  sessionManager.getSession(sessionId);

export const updateSession = (
  sessionId: string,
  updater:
    | Partial<SessionState>
    | ((state: SessionState) => void | Partial<SessionState>)
) => sessionManager.updateSession(sessionId, updater);

export const transitionStatus = (
  sessionId: string,
  newStatus: SessionStatus,
  reason?: string
) => sessionManager.transitionStatus(sessionId, newStatus, reason);

export const serializeSession = (sessionId: string) =>
  sessionManager.serializeSession(sessionId);

export const deserializeSession = (json: string) =>
  sessionManager.deserializeSession(json);
