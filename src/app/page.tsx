import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { HealMark } from '@/components/HealMark';
import { PHASES } from '@/lib/run-phases';

/**
 * The hero replays a real run from the bundled Python fixture: the pytest
 * failure it starts from, the two-line patch it proposes, the green suite that
 * proves it, and the fact that it then stops. That sequence is the product.
 */
const HERO_BEATS = [
  { delay: 0.15, kind: 'fail', text: 'FAILED tests/test_calculator.py::test_divide_by_zero' },
  { delay: 0.35, kind: 'fail-detail', text: 'ZeroDivisionError: integer division or modulo by zero' },
  { delay: 0.9, kind: 'rule', text: 'calculator/calculator.py' },
  { delay: 1.1, kind: 'del', text: '        return a // b' },
  { delay: 1.35, kind: 'ins', text: '        if b == 0:' },
  { delay: 1.5, kind: 'ins', text: '            raise ValueError("Cannot divide by zero")' },
  { delay: 1.65, kind: 'ins', text: '        return a / b' },
  { delay: 2.25, kind: 'pass', text: '3 passed in 0.04s' },
] as const;

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-rule bg-card">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <span className="flex items-center gap-2 text-ink">
            <HealMark className="h-5 w-5" />
            <span className="t-display text-[17px]">OpenHeal</span>
          </span>
          <div className="flex items-center gap-5">
            <a href="#run" className="hidden text-[13px] text-ink-2 hover:text-ink sm:block">
              How a run works
            </a>
            <a href="#stack" className="hidden text-[13px] text-ink-2 hover:text-ink sm:block">
              What it runs on
            </a>
            <Link
              href="/app"
              className="rounded bg-ink px-3 py-1.5 text-[13px] font-medium text-paper transition-colors hover:bg-signal"
            >
              Dashboard
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-14 lg:grid-cols-[1.05fr_1fr] lg:py-20">
        <div>
          <p className="t-label anim-rise">Agent swarm PR review</p>
          <h1
            className="t-display anim-rise mt-3 text-[40px] leading-[0.95] sm:text-[50px]"
            style={{ animationDelay: '0.05s' }}
          >
            Every PR gets
            <br />
            a real run.
            <br />
            <span className="text-signal">
              BuildOps → Explorer
              <br />
              → Diagnostic → Report
            </span>
          </h1>
          <p
            className="anim-rise mt-6 max-w-prose text-[15px] leading-relaxed text-ink-2"
            style={{ animationDelay: '0.12s' }}
          >
            Connect GitHub and OpenHeal&apos;s agent swarm builds your app in a sandbox,
            explores user flows, diagnoses root causes, and posts evidence on the pull request —
            automatically on every PR you watch.
          </p>
          <div
            className="anim-rise mt-8 flex flex-wrap items-center gap-3"
            style={{ animationDelay: '0.2s' }}
          >
            <Link
              href="/app"
              className="flex items-center gap-2 rounded bg-signal px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-signal-ink"
            >
              Open dashboard
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </Link>
            <a
              href="#run"
              className="rounded border border-rule-strong bg-card px-5 py-2.5 text-[14px] font-medium text-ink transition-colors hover:bg-paper-2"
            >
              See how a run works
            </a>
          </div>
        </div>

        {/* The artifact itself */}
        <figure className="well overflow-hidden rounded">
          <figcaption className="flex items-center justify-between border-b border-well-rule px-3 py-2">
            <span className="t-mono text-[11px] text-well-ink-2">
              python-calculator · pytest
            </span>
            <span className="t-label !text-well-ink-2">Run replay</span>
          </figcaption>

          <div className="space-y-px px-3 py-3.5">
            {HERO_BEATS.map((beat, i) => (
              <HeroLine key={i} kind={beat.kind} text={beat.text} delay={beat.delay} />
            ))}

            <div
              className="anim-rise !mt-4 flex items-center gap-2 border-t border-well-rule pt-3"
              style={{ animationDelay: '2.6s' }}
            >
              <span aria-hidden className="anim-playhead h-1.5 w-1.5 rounded-full bg-well-signal" />
              <span className="t-mono text-[11.5px] text-well-signal">
                Paused — waiting for your approval
              </span>
            </div>
          </div>
        </figure>
      </section>

      {/* The run */}
      <section id="run" className="border-y border-rule bg-card">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <h2 className="t-label">How a run works</h2>
          <p className="t-display mt-2 max-w-2xl text-[26px] leading-tight">
            Agent swarm on every pull request.
          </p>
          <p className="mt-3 max-w-prose text-[15px] leading-relaxed text-ink-2">
            BuildOps provisions the sandbox, Explorer clicks through your app, Diagnostic
            localizes root causes, Reporter posts findings on the PR — with optional auto-fix.
          </p>

          <ol className="mt-9 grid gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
            {PHASES.map((phase) => (
              <li key={phase.id} className="border-t-2 border-ink pt-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="t-display-sm text-[15px]">{phase.label}</h3>
                  <span className="t-label shrink-0 !text-[9px]">{phase.actor}</span>
                </div>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{phase.blurb}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Stack */}
      <section id="stack" className="mx-auto max-w-6xl px-5 py-14">
        <h2 className="t-label">What it runs on</h2>
        <p className="t-display mt-2 max-w-2xl text-[26px] leading-tight">
          Four systems, each doing the job it is good at.
        </p>

        <dl className="mt-9 grid gap-px overflow-hidden rounded border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['TrueForge', 'Runs the agent loop, holds session state across turns, and owns the approval pause.'],
            ['Daytona', 'Gives every run a throwaway container with its own kernel and filesystem.'],
            ['Qodo', 'Reviews the diff for quality, security, and coverage before you see it.'],
            ['GitHub', 'Opens the branch and the pull request, with the run’s evidence attached.'],
          ].map(([name, blurb]) => (
            <div key={name} className="bg-card p-4">
              <dt className="t-display-sm text-[15px]">{name}</dt>
              <dd className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{blurb}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-12 flex flex-col items-start gap-5 border-t-2 border-ink pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="t-display max-w-xl text-[24px] leading-tight">
            Pick a broken repository, watch the run, sign the patch.
          </p>
          <Link
            href="/app"
            className="flex shrink-0 items-center gap-2 rounded bg-signal px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-signal-ink"
          >
            Open the console
            <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
          </Link>
        </div>
      </section>

      <footer className="border-t border-rule bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6">
          <span className="flex items-center gap-2 text-ink-2">
            <HealMark className="h-4 w-4" accent="rgb(var(--ink-3))" />
            <span className="text-[13px]">OpenHeal</span>
          </span>
          <p className="t-mono text-[11px] text-ink-3">
            No patch reaches a pull request without a human approving it.
          </p>
        </div>
      </footer>
    </div>
  );
}

function HeroLine({
  kind,
  text,
  delay,
}: {
  kind: string;
  text: string;
  delay: number;
}) {
  if (kind === 'rule') {
    return (
      <p
        className="anim-rise !mt-3 border-t border-well-rule pt-2.5 t-mono text-[11px] text-well-ink-2"
        style={{ animationDelay: `${delay}s` }}
      >
        {text}
      </p>
    );
  }

  const tone =
    kind === 'fail' || kind === 'fail-detail'
      ? 'text-well-fail'
      : kind === 'pass'
        ? 'text-well-pass'
        : kind === 'del'
          ? 'text-well-fail'
          : 'text-well-pass';

  const bg =
    kind === 'del' ? 'bg-[#2a1416]' : kind === 'ins' ? 'bg-[#0f2119]' : '';

  const sign = kind === 'del' ? '−' : kind === 'ins' ? '+' : ' ';

  return (
    <div
      className={`anim-wipe flex gap-2 rounded-sm px-1.5 ${bg}`}
      style={{ animationDelay: `${delay}s` }}
    >
      <span aria-hidden className={`t-mono w-2 shrink-0 text-[11.5px] ${tone}`}>
        {kind === 'del' || kind === 'ins' ? sign : ''}
      </span>
      <pre
        className={`t-mono min-w-0 flex-1 overflow-x-auto text-[11.5px] leading-[19px] ${tone} ${
          kind === 'fail-detail' ? 'opacity-70' : ''
        }`}
      >
        {text}
      </pre>
    </div>
  );
}
