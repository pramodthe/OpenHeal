/**
 * TrueForge Human-in-the-Loop (HITL) Gate Protocol & Cryptographic Resume Tokens
 * Matching @truefoundry/trueforge-sdk & trueforge.dev/api/use-agent
 */

import { randomBytes, createHmac } from 'node:crypto';
import type {
  ToolApprovalRequestPayload,
  UserToolApprovalPayload,
  QodoScorecardResult,
} from './types.ts';
import { sessionManager } from './session.ts';
import { eventBus } from './event-bus.ts';

export class HitlGate {
  private secretKey: string;
  private pendingRequests: Map<string, ToolApprovalRequestPayload> = new Map(); // key: sessionId
  private resolvedTokens: Set<string> = new Set(); // tracks used tokens to prevent replay attacks
  private defaultTtlMs: number = 30 * 60 * 1000; // 30 minutes

  constructor(secret?: string) {
    this.secretKey = secret || process.env.HITL_SECRET_KEY || randomBytes(32).toString('hex');
  }

  /**
   * Generate a cryptographically signed resume token bound to a session and tool call.
   */
  public generateResumeToken(sessionId: string, toolCallId: string, expiresAt: number): string {
    const entropy = randomBytes(16).toString('hex');
    const rawData = `${sessionId}:${toolCallId}:${expiresAt}:${entropy}`;
    const signature = createHmac('sha256', this.secretKey)
      .update(rawData)
      .digest('hex')
      .slice(0, 32);
    return `tok_sec_${entropy}_${expiresAt}_${signature}`;
  }

  /**
   * Validate token authenticity, expiry, and binding.
   */
  public verifyTokenSignature(sessionId: string, toolCallId: string, resumeToken: string): boolean {
    if (!resumeToken.startsWith('tok_sec_')) {
      return false;
    }

    const parts = resumeToken.split('_');
    if (parts.length < 5) return false;
    // format: ['tok', 'sec', entropy, expiresAt, signature]
    const entropy = parts[2];
    const expiresAtStr = parts[3];
    const signature = parts[4];
    const expiresAt = parseInt(expiresAtStr, 10);

    if (isNaN(expiresAt) || Date.now() > expiresAt) {
      return false; // Expired
    }

    const rawData = `${sessionId}:${toolCallId}:${expiresAt}:${entropy}`;
    const expectedSig = createHmac('sha256', this.secretKey)
      .update(rawData)
      .digest('hex')
      .slice(0, 32);

    return signature === expectedSig;
  }

  /**
   * Pause execution loop and create a pending HITL tool approval request.
   */
  public createApprovalRequest(
    sessionId: string,
    threadId: string,
    turnId: string,
    toolCallId: string,
    toolName: string,
    parameters: Record<string, unknown>,
    options?: {
      proposedPatch?: string;
      scorecard?: QodoScorecardResult;
      ttlMs?: number;
    }
  ): ToolApprovalRequestPayload {
    const createdAt = Date.now();
    const expiresAt = createdAt + (options?.ttlMs ?? this.defaultTtlMs);
    const resumeToken = this.generateResumeToken(sessionId, toolCallId, expiresAt);

    const payload: ToolApprovalRequestPayload = {
      sessionId,
      threadId,
      turnId,
      toolCallId,
      toolName,
      parameters,
      resumeToken,
      createdAt,
      expiresAt,
      proposedPatch: options?.proposedPatch,
      scorecard: options?.scorecard,
    };

    this.pendingRequests.set(sessionId, payload);

    // Update Session State to AWAITING_HUMAN_APPROVAL
    sessionManager.updateSession(sessionId, (state) => {
      state.status = 'AWAITING_HUMAN_APPROVAL';
      state.hitlApproval = {
        resumeToken,
        toolCallId,
        requestedAt: new Date(createdAt).toISOString(),
        status: 'pending',
      };
      if (options?.scorecard) {
        state.qodoScorecard = options.scorecard;
      }
    });

    // Emit SSE event for UI to render glowing HITL approval card
    eventBus.emitEvent(sessionId, threadId, 'tool.approval_required', {
      toolCallId,
      toolName,
      parameters,
      resumeToken,
      proposedPatch: options?.proposedPatch,
      scorecard: options?.scorecard,
      timestamp: new Date(createdAt).toISOString(),
    }, turnId);

    return payload;
  }

  /**
   * Validate a resume token against pending requests.
   */
  public validateResumeToken(
    sessionId: string,
    resumeToken: string
  ): { valid: boolean; error?: string; payload?: ToolApprovalRequestPayload } {
    if (this.resolvedTokens.has(resumeToken)) {
      return { valid: false, error: 'Resume token has already been used (idempotency violation)' };
    }

    const pending = this.pendingRequests.get(sessionId);
    if (!pending) {
      return { valid: false, error: `No pending approval request found for session ${sessionId}` };
    }

    if (pending.resumeToken !== resumeToken) {
      return { valid: false, error: 'Resume token mismatch' };
    }

    if (Date.now() > pending.expiresAt) {
      this.pendingRequests.delete(sessionId);
      sessionManager.updateSession(sessionId, (state) => {
        if (state.hitlApproval) state.hitlApproval.status = 'expired';
      });
      return { valid: false, error: 'Resume token has expired (TTL 30m exceeded)' };
    }

    const isValidSig = this.verifyTokenSignature(sessionId, pending.toolCallId, resumeToken);
    if (!isValidSig) {
      return { valid: false, error: 'Invalid resume token cryptographic signature' };
    }

    return { valid: true, payload: pending };
  }

  /**
   * Resolve an approval request with allow/deny decision and optional parameter modifications.
   */
  public resolveApproval(
    payload: UserToolApprovalPayload
  ): {
    success: boolean;
    status: 'allow' | 'deny';
    reason?: string;
    modifiedParameters?: Record<string, unknown>;
    error?: string;
    toolCallId?: string;
  } {
    const { sessionId, resumeToken, decision } = payload;
    const validation = this.validateResumeToken(sessionId, resumeToken);

    if (!validation.valid || !validation.payload) {
      return {
        success: false,
        status: decision.status,
        error: validation.error || 'Validation failed',
      };
    }

    const pending = validation.payload;

    // Mark token as resolved (idempotency guard)
    this.resolvedTokens.add(resumeToken);
    this.pendingRequests.delete(sessionId);

    const decidedAt = new Date().toISOString();

    // Update Session State
    sessionManager.updateSession(sessionId, (state) => {
      state.hitlApproval = {
        resumeToken,
        toolCallId: pending.toolCallId,
        requestedAt: new Date(pending.createdAt).toISOString(),
        status: decision.status === 'allow' ? 'allowed' : 'denied',
        decision: {
          approver: decision.approver || 'human_operator',
          decidedAt,
          reason: decision.reason,
          modifiedParameters: decision.modifiedParameters,
        },
      };

      if (decision.status === 'allow') {
        state.status = 'EXECUTING_PR';
      } else {
        state.status = 'REJECTED';
        state.errorMessage = decision.reason || 'Approval denied by operator';
      }
    });

    // Emit resolution SSE events
    eventBus.emitEvent(sessionId, pending.threadId, 'tool.approval_resolved', {
      status: decision.status,
      timestamp: decidedAt,
      reason: decision.reason,
      modifiedParameters: decision.modifiedParameters,
    }, pending.turnId);

    eventBus.emitEvent(sessionId, pending.threadId, 'user.tool_approval', {
      sessionId,
      toolCallId: pending.toolCallId,
      status: decision.status,
      approver: decision.approver,
      reason: decision.reason,
      modifiedParameters: decision.modifiedParameters,
    }, pending.turnId);

    return {
      success: true,
      status: decision.status,
      reason: decision.reason,
      modifiedParameters: decision.modifiedParameters,
      toolCallId: pending.toolCallId,
    };
  }

  /**
   * Check if a session has an active pending approval request.
   */
  public isPendingApproval(sessionId: string): boolean {
    const pending = this.pendingRequests.get(sessionId);
    if (!pending) return false;
    if (Date.now() > pending.expiresAt) {
      this.pendingRequests.delete(sessionId);
      return false;
    }
    return true;
  }

  /**
   * Get pending approval details if any.
   */
  public getPendingApproval(sessionId: string): ToolApprovalRequestPayload | undefined {
    if (!this.isPendingApproval(sessionId)) {
      return undefined;
    }
    return this.pendingRequests.get(sessionId);
  }

  /**
   * Expire an approval request manually.
   */
  public expireApproval(sessionId: string): boolean {
    const pending = this.pendingRequests.get(sessionId);
    if (!pending) return false;
    this.pendingRequests.delete(sessionId);
    sessionManager.updateSession(sessionId, (state) => {
      if (state.hitlApproval) {
        state.hitlApproval.status = 'expired';
      }
    });
    return true;
  }

  /**
   * Clear all pending requests (for testing).
   */
  public clear(): void {
    this.pendingRequests.clear();
    this.resolvedTokens.clear();
  }
}

// Global Singleton Instance
export const hitlGate = new HitlGate();
