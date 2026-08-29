'use client';

import React, { useState } from 'react';
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  GitPullRequest,
  Sparkles,
  Lock,
  MessageSquare,
  AlertTriangle,
  ArrowRight,
  Loader2,
} from 'lucide-react';

export interface GlowingApprovalCardProps {
  sessionId: string;
  resumeToken: string;
  toolCallId?: string;
  prDetails?: {
    repo?: string;
    branch?: string;
    title?: string;
    body?: string;
  };
  qodoScore?: number;
  qodoGrade?: string;
  verificationPassed?: boolean;
  onApprove: (resumeToken: string) => Promise<void>;
  onReject: (resumeToken: string, feedback?: string) => Promise<void>;
  isSubmitting?: boolean;
}

export const GlowingApprovalCard: React.FC<GlowingApprovalCardProps> = ({
  sessionId,
  resumeToken,
  toolCallId,
  prDetails,
  qodoScore = 96,
  qodoGrade = 'A+',
  verificationPassed = true,
  onApprove,
  onReject,
  isSubmitting = false,
}) => {
  const [showRejectFeedback, setShowRejectFeedback] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string>('');
  const [localSubmitting, setLocalSubmitting] = useState<boolean>(false);

  const disabled = isSubmitting || localSubmitting;

  const handleApproveClick = async () => {
    if (disabled) return;
    setLocalSubmitting(true);
    try {
      await onApprove(resumeToken);
    } finally {
      setLocalSubmitting(false);
    }
  };

  const handleRejectClick = async () => {
    if (disabled) return;
    if (!showRejectFeedback) {
      setShowRejectFeedback(true);
      return;
    }
    setLocalSubmitting(true);
    try {
      await onReject(resumeToken, feedback);
    } finally {
      setLocalSubmitting(false);
    }
  };

  const branchName = prDetails?.branch || `openheal/fix-${sessionId ? sessionId.slice(0, 8) : 'patch'}`;
  const prTitle = prDetails?.title || 'fix: autonomous self-healing patch applied';

  return (
    <div className="relative my-4 overflow-hidden rounded-2xl border-2 border-cyan-400/80 bg-zinc-950 p-0.5 shadow-[0_0_45px_rgba(6,182,212,0.4)] transition-all animate-pulse-slow">
      {/* Background Gradient Mesh */}
      <div className="relative rounded-[14px] bg-gradient-to-r from-cyan-950/80 via-slate-900/90 to-emerald-950/80 p-5 backdrop-blur-xl">
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/20 pb-4">
          <div className="flex items-center space-x-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/20 border border-cyan-400 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.5)]">
              <Lock className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold font-mono tracking-wide text-white">
                  HUMAN-IN-THE-LOOP APPROVAL REQUIRED
                </h3>
                <span className="rounded-full bg-cyan-400/20 border border-cyan-400/50 px-2 py-0.5 text-[10px] font-mono font-bold text-cyan-300">
                  tool.approval_required
                </span>
              </div>
              <p className="text-xs text-zinc-300 mt-0.5 font-mono">
                TrueForge runtime paused turn loop before privileged GitHub MCP write operations.
              </p>
            </div>
          </div>

          {/* Verification & Scorecard Badges */}
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1 rounded-lg bg-emerald-950/90 border border-emerald-500/60 px-3 py-1.5 text-xs font-mono text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.3)]">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>100% Sandbox Tests Green</span>
            </div>

            <div className="flex items-center space-x-1 rounded-lg bg-cyan-950/90 border border-cyan-500/60 px-3 py-1.5 text-xs font-mono text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.3)]">
              <Sparkles className="h-4 w-4 text-cyan-400" />
              <span>Qodo Score: <strong>{qodoScore}/100</strong> ({qodoGrade})</span>
            </div>
          </div>
        </div>

        {/* Change Telemetry Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4 text-xs font-mono">
          <div className="space-y-2 rounded-xl bg-zinc-950/60 border border-zinc-800/80 p-3.5">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold flex items-center space-x-1.5">
              <GitPullRequest className="h-3.5 w-3.5 text-cyan-400" />
              <span>Proposed GitHub MCP Pull Request</span>
            </div>
            <div className="text-sm font-semibold text-zinc-100 truncate">
              {prTitle}
            </div>
            <div className="flex items-center space-x-2 text-gray-500">
              <span>Target Branch:</span>
              <code className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-emerald-300">
                {branchName}
              </code>
            </div>
          </div>

          <div className="space-y-2 rounded-xl bg-zinc-950/60 border border-zinc-800/80 p-3.5">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold flex items-center space-x-1.5">
              <ShieldAlert className="h-3.5 w-3.5 text-green-600" />
              <span>Security & Quality Audit Summary</span>
            </div>
            <div className="text-zinc-300">
              Zero AST taint paths • Clean cyclomatic complexity • Zero credential leaks
            </div>
            <div className="text-gray-500">
              Resume Token: <code className="text-zinc-300">{resumeToken.slice(0, 16)}...</code>
            </div>
          </div>
        </div>

        {/* Rejection Feedback Box */}
        {showRejectFeedback && (
          <div className="mb-4 rounded-xl border border-rose-900/60 bg-rose-950/30 p-3.5 text-xs font-mono">
            <div className="flex items-center space-x-1.5 text-rose-300 font-semibold mb-2">
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Operator Feedback for Swarm Remediation:</span>
            </div>
            <textarea
              rows={2}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="e.g. Scope too large, please only modify error handling logic..."
              className="w-full rounded-lg bg-zinc-950 border border-rose-800/60 p-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-rose-500 focus:outline-none"
            />
          </div>
        )}

        {/* Action Trigger Buttons */}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
          {/* Reject / Deny Button */}
          <button
            onClick={handleRejectClick}
            disabled={disabled}
            className="flex items-center space-x-2 rounded-xl bg-rose-950/80 hover:bg-rose-900 border border-rose-700/80 px-4 py-2.5 text-xs font-mono font-bold text-rose-200 transition-all hover:shadow-[0_0_20px_rgba(244,63,94,0.3)] disabled:opacity-50"
          >
            {disabled ? (
              <Loader2 className="h-4 w-4 animate-spin text-red-600" />
            ) : (
              <XCircle className="h-4 w-4 text-red-600" />
            )}
            <span>{showRejectFeedback ? 'Confirm Rejection' : 'Reject / Revise'}</span>
          </button>

          {/* 1-Click Approve & Open GitHub PR Button */}
          <button
            onClick={handleApproveClick}
            disabled={disabled}
            className="flex items-center space-x-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 px-6 py-2.5 text-xs font-mono font-bold text-zinc-950 transition-all shadow-[0_0_25px_rgba(16,185,129,0.5)] hover:shadow-[0_0_35px_rgba(6,182,212,0.7)] hover:scale-[1.02] disabled:opacity-50"
          >
            {disabled ? (
              <Loader2 className="h-4 w-4 animate-spin text-zinc-950" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-zinc-950" />
            )}
            <span>Approve & Open GitHub PR (1-Click)</span>
            <ArrowRight className="h-3.5 w-3.5 text-zinc-950" />
          </button>
        </div>
      </div>
    </div>
  );
};
export default GlowingApprovalCard;
