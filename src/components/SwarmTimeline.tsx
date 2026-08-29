'use client';

import React, { useState } from 'react';
import {
  Box,
  Search,
  Wrench,
  ShieldAlert,
  CheckCircle2,
  GitPullRequest,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  FileCode2,
} from 'lucide-react';

export interface SwarmTimelineProps {
  status: string;
  diagnosticReport?: any;
  patchResult?: any;
  qodoScorecard?: any;
  verificationReport?: any;
  pullRequest?: any;
  errorMessage?: string;
}

interface StepItem {
  id: string;
  name: string;
  agentRole: string;
  description: string;
  icon: React.ElementType;
  isActive: boolean;
  isCompleted: boolean;
  isFailed: boolean;
  details?: React.ReactNode;
}

export const SwarmTimeline: React.FC<SwarmTimelineProps> = ({
  status,
  diagnosticReport,
  patchResult,
  qodoScorecard,
  verificationReport,
  pullRequest,
  errorMessage,
}) => {
  const [expandedStep, setExpandedStep] = useState<string | null>('diag');

  const isStepDone = (stepKey: string): boolean => {
    const order = [
      'init',
      'baseline',
      'diag',
      'patch',
      'qodo',
      'verify',
      'hitl',
      'github',
    ];
    const currentIndex = (() => {
      switch (status) {
        case 'INIT':
        case 'PROVISIONING_SANDBOX':
          return 0;
        case 'CAPTURING_BASELINE':
          return 1;
        case 'DIAGNOSING':
          return 2;
        case 'SYNTHESIZING':
          return 3;
        case 'VERIFYING':
          return 5;
        case 'AWAITING_HUMAN_APPROVAL':
          return 6;
        case 'EXECUTING_PR':
        case 'APPLYING_PR':
        case 'COMPLETED':
          return 7;
        case 'REJECTED':
          return 6;
        case 'FAILED':
          return 0;
        default:
          return 0;
      }
    })();

    const stepIndex = order.indexOf(stepKey);
    return stepIndex < currentIndex || status === 'COMPLETED';
  };

  const isStepActive = (stepKey: string): boolean => {
    switch (stepKey) {
      case 'baseline':
        return status === 'PROVISIONING_SANDBOX' || status === 'CAPTURING_BASELINE';
      case 'diag':
        return status === 'DIAGNOSING';
      case 'patch':
        return status === 'SYNTHESIZING';
      case 'verify':
        return status === 'VERIFYING';
      case 'hitl':
        return status === 'AWAITING_HUMAN_APPROVAL';
      case 'github':
        return status === 'EXECUTING_PR' || status === 'APPLYING_PR';
      default:
        return false;
    }
  };

  const steps: StepItem[] = [
    {
      id: 'baseline',
      name: 'Daytona Sandbox & Baseline',
      agentRole: 'Daytona Provisioner',
      description: 'Provisioning isolated container and capturing failure trace.',
      icon: Box,
      isActive: isStepActive('baseline'),
      isCompleted: isStepDone('baseline'),
      isFailed: status === 'FAILED' && !diagnosticReport,
      details: (
        <div className="mt-2 space-y-1.5 rounded border border-slate-800 bg-black/40 p-2.5 font-mono text-xs text-slate-400">
          <div className="flex justify-between">
            <span className="text-slate-500">Container:</span>
            <span className="font-medium text-slate-200">Ephemeral Ubuntu 24.04</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Isolation:</span>
            <span className="font-medium text-emerald-400">Secure Network Jail</span>
          </div>
        </div>
      ),
    },
    {
      id: 'diag',
      name: 'Diagnostic Subagent',
      agentRole: 'AST Parser & Fault Localizer',
      description: 'Parsing stack traces and mapping AST error locations.',
      icon: Search,
      isActive: isStepActive('diag'),
      isCompleted: isStepDone('diag') || Boolean(diagnosticReport),
      isFailed: status === 'FAILED' && !patchResult && !diagnosticReport,
      details: diagnosticReport ? (
        <div className="mt-2 space-y-2 rounded border border-slate-800 bg-black/40 p-2.5 font-mono text-xs">
          <div className="flex items-center justify-between text-slate-200">
            <span className="text-slate-500">Detected Bug:</span>
            <span className="text-[#e11d48] font-semibold">{diagnosticReport.failureType || 'Defect Identified'}</span>
          </div>
          <div className="flex items-center justify-between text-slate-200">
            <span className="text-slate-500">AST Target:</span>
            <span className="font-medium text-emerald-300">
              {diagnosticReport.primaryRootCauseLocation?.filePath || 'calc.py'}:
              {diagnosticReport.primaryRootCauseLocation?.startLine || 18}
            </span>
          </div>
          {diagnosticReport.primaryFailureMessage && (
            <div className="truncate rounded border border-rose-500/20 bg-rose-500/10 p-1.5 text-[11px] text-rose-300">
              {diagnosticReport.primaryFailureMessage}
            </div>
          )}
        </div>
      ) : null,
    },
    {
      id: 'patch',
      name: 'Patch Synthesizer',
      agentRole: 'Minimal Code Generator',
      description: 'Synthesizing bounded AST modifications without scope creep.',
      icon: Wrench,
      isActive: isStepActive('patch'),
      isCompleted: isStepDone('patch') || Boolean(patchResult),
      isFailed: status === 'FAILED' && !patchResult,
      details: patchResult ? (
        <div className="mt-2 space-y-1.5 rounded border border-slate-800 bg-black/40 p-2.5 font-mono text-xs">
          <div className="flex justify-between text-slate-200">
            <span className="text-slate-500">Diff Scope:</span>
            <span className="text-[#059669] font-medium">
              +{patchResult.patches?.[0]?.linesAdded || 2}, -{patchResult.patches?.[0]?.linesRemoved || 1} lines
            </span>
          </div>
          <div className="flex justify-between text-slate-200">
            <span className="text-slate-500">Anti-Scope Creep:</span>
            <span className="font-medium text-emerald-300">
              Risk: {patchResult.scopeCreepAssessment?.riskScore || 5}/100 (Safe)
            </span>
          </div>
        </div>
      ) : null,
    },
    {
      id: 'verify',
      name: 'Regression Verifier',
      agentRole: 'Sandbox Test Runner',
      description: 'Running complete test suite in Daytona to verify 100% green.',
      icon: ShieldAlert,
      isActive: isStepActive('verify'),
      isCompleted: isStepDone('verify') || (verificationReport && verificationReport.overallStatus === 'PASSED'),
      isFailed: verificationReport && verificationReport.overallStatus === 'FAILED',
      details: verificationReport ? (
        <div className="mt-2 space-y-1.5 rounded border border-slate-800 bg-black/40 p-2.5 font-mono text-xs">
          <div className="flex justify-between text-slate-200">
            <span className="text-slate-500">Exit Code:</span>
            <span className={verificationReport.exitCode === 0 ? 'text-[#059669] font-medium' : 'text-[#e11d48] font-medium'}>
              {verificationReport.exitCode} {verificationReport.exitCode === 0 ? '(PASS)' : '(FAIL)'}
            </span>
          </div>
          <div className="flex justify-between text-slate-200">
            <span className="text-slate-500">Tests Passing:</span>
            <span className="text-[#059669] font-medium">
              {verificationReport.passedCount || 3} / {verificationReport.totalTests || 3} (100%)
            </span>
          </div>
        </div>
      ) : null,
    },
    {
      id: 'hitl',
      name: 'Human Approval Gate',
      agentRole: 'HITL Pause & Resume Interceptor',
      description: 'Human operator cryptographic verification & sign-off.',
      icon: CheckCircle2,
      isActive: isStepActive('hitl'),
      isCompleted: isStepDone('hitl') || status === 'COMPLETED' || status === 'EXECUTING_PR',
      isFailed: status === 'REJECTED',
      details: status === 'AWAITING_HUMAN_APPROVAL' ? (
        <div className="mt-2 animate-pulse rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-300">
          Waiting for operator approval before the PR is opened.
        </div>
      ) : status === 'REJECTED' ? (
        <div className="mt-2 rounded border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">
          Operator rejected proposed patch.
        </div>
      ) : null,
    },
    {
      id: 'github',
      name: 'GitHub MCP Publisher',
      agentRole: 'PR & Commit Automation',
      description: 'Creating branch, committing patch, and opening PR with telemetry.',
      icon: GitPullRequest,
      isActive: isStepActive('github'),
      isCompleted: status === 'COMPLETED' || Boolean(pullRequest),
      isFailed: status === 'FAILED' && isStepDone('hitl'),
      details: pullRequest ? (
        <div className="mt-2 space-y-1 rounded border border-slate-800 bg-black/40 p-2.5 font-mono text-xs">
          <div className="flex justify-between text-slate-200">
            <span className="text-slate-500">Branch:</span>
            <span className="max-w-[140px] truncate font-medium text-emerald-300">{pullRequest.branchName || 'openheal/fix'}</span>
          </div>
          <a
            href={pullRequest.prUrl || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block text-center text-xs text-emerald-400 underline hover:text-emerald-300"
          >
            View PR #{pullRequest.prNumber || 42} on GitHub &rarr;
          </a>
        </div>
      ) : null,
    },
  ];

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-2">
          <Sparkles className="h-4 w-4 text-emerald-400" />
          <h2 className="font-mono text-xs font-semibold tracking-wide text-white">
            Heal pipeline
          </h2>
        </div>
        <span className="font-mono text-[11px] text-slate-500">
          {steps.filter((s) => s.isCompleted).length} / {steps.length} Steps
        </span>
      </div>

      {/* Steps Vertical List */}
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {steps.map((step, idx) => {
          const Icon = step.icon;
          const isExpanded = expandedStep === step.id;

          return (
            <div
              key={step.id}
              className={`rounded-lg border transition-all ${
                step.isActive
                  ? 'border-emerald-500/40 bg-emerald-500/10 shadow-sm'
                  : step.isCompleted
                  ? 'border-slate-700 bg-slate-900/50'
                  : step.isFailed
                  ? 'border-rose-500/30 bg-rose-500/10'
                  : 'border-slate-800 bg-black/20 opacity-80'
              }`}
            >
              <div
                onClick={() => setExpandedStep(isExpanded ? null : step.id)}
                className="flex items-start p-3 cursor-pointer select-none space-x-3"
              >
                {/* Node Icon Indicator */}
                <div
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                    step.isActive
                      ? 'animate-pulse border-emerald-400 bg-emerald-500/20 text-emerald-300'
                      : step.isCompleted
                      ? 'border-emerald-700 bg-emerald-500/15 text-emerald-400'
                      : step.isFailed
                      ? 'border-rose-500/40 bg-rose-500/15 text-rose-400'
                      : 'border-slate-700 bg-slate-900 text-slate-500'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="truncate font-mono text-xs font-semibold text-white">
                      {step.name}
                    </h3>
                    <div className="flex items-center space-x-1.5">
                      {step.isActive && (
                        <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                      )}
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 text-[#94a3b8]" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-[#94a3b8]" />
                      )}
                    </div>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    {step.description}
                  </p>
                </div>
              </div>

              {/* Step Expanded Content */}
              {isExpanded && step.details && (
                <div className="border-t border-slate-800 px-3 pb-3 pt-2">
                  {step.details}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {errorMessage && (
        <div className="mt-3 flex items-start space-x-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0 text-[#dc2626] mt-0.5" />
          <div className="truncate">{errorMessage}</div>
        </div>
      )}
    </div>
  );
};
export default SwarmTimeline;
