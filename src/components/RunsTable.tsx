'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface RunRow {
  sessionId: string;
  repoFullName: string;
  prNumber?: number;
  status: string;
  findingsCount: number;
  activeSubagent?: string;
  createdAt: string;
  prCommentUrl?: string;
}

export function RunsTable() {
  const [runs, setRuns] = useState<RunRow[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await fetch('/api/runs');
      const data = await res.json();
      if (alive) setRuns(data.runs || []);
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <section className="rounded border border-rule bg-card p-4">
      <h2 className="t-label mb-3">Recent swarm runs</h2>
      {runs.length === 0 ? (
        <p className="text-[13px] text-ink-2">No runs yet. Enroll a repo and open a pull request.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-rule text-ink-3">
                <th className="py-2 pr-3 font-medium">Repository</th>
                <th className="py-2 pr-3 font-medium">PR</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Agent</th>
                <th className="py-2 pr-3 font-medium">Findings</th>
                <th className="py-2 font-medium">Run</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.sessionId} className="border-b border-rule/60">
                  <td className="t-mono py-2 pr-3 text-ink">{run.repoFullName || '—'}</td>
                  <td className="py-2 pr-3">{run.prNumber ? `#${run.prNumber}` : '—'}</td>
                  <td className="py-2 pr-3 capitalize">{run.status}</td>
                  <td className="py-2 pr-3 capitalize">{run.activeSubagent || '—'}</td>
                  <td className="py-2 pr-3">{run.findingsCount ?? 0}</td>
                  <td className="py-2">
                    <Link href={`/app/runs/${run.sessionId}`} className="text-signal hover:underline">
                      Open
                    </Link>
                    {run.prCommentUrl ? (
                      <>
                        {' · '}
                        <a href={run.prCommentUrl} target="_blank" rel="noreferrer" className="text-ink-2 hover:underline">
                          PR comment
                        </a>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
