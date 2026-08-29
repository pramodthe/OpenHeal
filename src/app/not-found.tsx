import Link from 'next/link';
import { HealMark } from '@/components/HealMark';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-5 py-16 text-center">
      <HealMark className="h-6 w-6 text-ink" />
      <p className="t-label mt-6">Error 404</p>
      <h1 className="t-display mt-2 text-[34px] leading-none">Nothing at this address</h1>
      <p className="mt-3 max-w-prose text-[15px] leading-relaxed text-ink-2">
        The page you asked for does not exist. Runs live in the console, and old
        run links stop working once the session ends.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/app"
          className="rounded bg-signal px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-signal-ink"
        >
          Open the console
        </Link>
        <Link
          href="/"
          className="rounded border border-rule-strong bg-card px-5 py-2.5 text-[14px] font-medium text-ink transition-colors hover:bg-paper-2"
        >
          Back to the start
        </Link>
      </div>
    </main>
  );
}
