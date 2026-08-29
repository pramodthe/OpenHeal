'use client';

import React from 'react';

export interface FindingItem {
  id: string;
  severity: string;
  title: string;
  reproSteps?: string[];
  filePath?: string;
  line?: number;
  hypothesis?: string;
  screenshotUrl?: string;
}

export function FindingsPanel({ findings }: { findings: FindingItem[] }) {
  if (!findings.length) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-[13px] text-ink-2">
        No behavioral findings yet. The Explorer agent will post them here.
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      {findings.map((f) => (
        <article key={f.id} className="rounded border border-rule bg-card p-3">
          <header className="mb-2 flex items-center gap-2">
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${
                f.severity === 'critical' || f.severity === 'high'
                  ? 'bg-fail-wash text-fail'
                  : 'bg-signal-wash text-signal-ink'
              }`}
            >
              {f.severity}
            </span>
            <h3 className="text-[14px] font-medium text-ink">{f.title}</h3>
          </header>
          {f.filePath ? (
            <p className="t-mono mb-2 text-[12px] text-ink-2">
              {f.filePath}
              {f.line ? `:${f.line}` : ''}
              {f.hypothesis ? ` — ${f.hypothesis}` : ''}
            </p>
          ) : null}
          {f.reproSteps?.length ? (
            <ol className="list-decimal space-y-1 pl-4 text-[12px] text-ink-2">
              {f.reproSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          ) : null}
        </article>
      ))}
    </div>
  );
}
