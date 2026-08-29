/**
 * The run's phase vocabulary.
 *
 * A heal run is genuinely a sequence — each phase consumes the evidence the
 * previous one produced — so the console renders it as a time tape rather than
 * a checklist. Ordering and elapsed time both carry information, which is why
 * phases are stamped rather than numbered.
 */

export type PhaseId =
  | 'sandbox'
  | 'baseline'
  | 'diagnose'
  | 'patch'
  | 'verify'
  | 'review'
  | 'signoff'
  | 'publish';

export interface PhaseSpec {
  id: PhaseId;
  /** Shown on the tape. Names the work, in the operator's words. */
  label: string;
  /** One line explaining what this phase does, for the empty state. */
  blurb: string;
  /** Who does the work — the harness role, for operators who care. */
  actor: string;
}

export const PHASES: PhaseSpec[] = [
  {
    id: 'sandbox',
    label: 'Sandbox',
    blurb: 'Provisions an isolated container and clones the repository.',
    actor: 'Daytona',
  },
  {
    id: 'baseline',
    label: 'Baseline',
    blurb: 'Runs your suite untouched and records how it fails.',
    actor: 'Sandbox',
  },
  {
    id: 'diagnose',
    label: 'Diagnose',
    blurb: 'Reads the trace and locates the line responsible.',
    actor: 'Diagnostic agent',
  },
  {
    id: 'patch',
    label: 'Patch',
    blurb: 'Writes the smallest change that could fix it.',
    actor: 'Patch agent',
  },
  {
    id: 'verify',
    label: 'Verify',
    blurb: 'Re-runs the full suite against the patch.',
    actor: 'Verifier agent',
  },
  {
    id: 'review',
    label: 'Review',
    blurb: 'Scores the diff for quality, security, and coverage.',
    actor: 'Qodo',
  },
  {
    id: 'signoff',
    label: 'Sign-off',
    blurb: 'Waits for you. Nothing is pushed without approval.',
    actor: 'You',
  },
  {
    id: 'publish',
    label: 'Publish',
    blurb: 'Opens a branch and a pull request with the evidence attached.',
    actor: 'GitHub',
  },
];

export const PHASE_ORDER: PhaseId[] = PHASES.map((p) => p.id);

/** Maps a session status onto the phase that status represents. */
export function phaseForStatus(status: string): PhaseId | null {
  switch (status) {
    case 'INIT':
    case 'PROVISIONING_SANDBOX':
      return 'sandbox';
    case 'CAPTURING_BASELINE':
      return 'baseline';
    case 'DIAGNOSING':
      return 'diagnose';
    case 'SYNTHESIZING':
      return 'patch';
    case 'VERIFYING':
      return 'verify';
    case 'AWAITING_HUMAN_APPROVAL':
      return 'signoff';
    case 'EXECUTING_PR':
    case 'APPLYING_PR':
      return 'publish';
    default:
      return null;
  }
}

export interface StatusTone {
  /** Short, plain-language state. Sentence case — this is a label, not a shout. */
  label: string;
  tone: 'idle' | 'working' | 'attention' | 'good' | 'bad';
}

export function statusTone(status: string, isStreaming = false): StatusTone {
  switch (status) {
    case 'IDLE':
      return { label: 'Idle', tone: 'idle' };
    case 'INIT':
    case 'PROVISIONING_SANDBOX':
      return { label: 'Provisioning sandbox', tone: 'working' };
    case 'CAPTURING_BASELINE':
      return { label: 'Running baseline', tone: 'working' };
    case 'DIAGNOSING':
      return { label: 'Diagnosing', tone: 'working' };
    case 'SYNTHESIZING':
      return { label: 'Writing patch', tone: 'working' };
    case 'VERIFYING':
      return { label: 'Verifying', tone: 'working' };
    case 'AWAITING_HUMAN_APPROVAL':
      return { label: 'Waiting for you', tone: 'attention' };
    case 'EXECUTING_PR':
    case 'APPLYING_PR':
      return { label: 'Opening pull request', tone: 'working' };
    case 'COMPLETED':
      return { label: 'Pull request open', tone: 'good' };
    case 'REJECTED':
      return { label: 'Sent back', tone: 'bad' };
    case 'FAILED':
      return { label: 'Run failed', tone: 'bad' };
    default:
      return { label: isStreaming ? 'Running' : 'Idle', tone: isStreaming ? 'working' : 'idle' };
  }
}

/** `+12.4s` — offsets from run start, the tape's structural device. */
export function formatOffset(ms: number): string {
  if (ms < 0) return '+0.0s';
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `+${m}m${String(s).padStart(2, '0')}s`;
}

/** `2.4s` — a duration on its own, no offset sign. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/**
 * Tape block height in px. Compressed with a square root so a 40s verify does
 * not dwarf a 200ms diagnose off the screen, while still reading as longer.
 */
export function tapeHeight(durationMs: number): number {
  const seconds = Math.max(0, durationMs) / 1000;
  return Math.min(196, Math.round(30 + Math.sqrt(seconds) * 27));
}
